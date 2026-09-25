// Real ComfyUI adapter for MiniMax H3 reference-to-video.
// Submits an API-format workflow, polls /history and maps the produced file.
import type { RenderHandle, RenderProgress, VideoModel } from "./types";
import type { RenderRequest } from "../types";
import { uid } from "../lib/util";

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

function findNode(graph: Graph, classType: string): string | undefined {
  return Object.keys(graph).find((k) => graph[k]?.class_type === classType);
}

async function getJson<T>(url: string, timeoutMs = 30000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 60000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean };
  outputs?: Record<string, Record<string, unknown>>;
}

interface OutputFile {
  filename: string;
  subfolder?: string;
  type?: string;
}

function extractOutputs(entry: HistoryEntry): OutputFile[] {
  const files: OutputFile[] = [];
  for (const node of Object.values(entry.outputs ?? {})) {
    for (const value of Object.values(node)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (item && typeof item === "object" && "filename" in item) {
          files.push(item as OutputFile);
        }
      }
    }
  }
  return files;
}

export interface ComfyOptions {
  baseUrl: string;
  workflowUrl: string;
  defaultLength: number;
  defaultSteps: number;
  defaultSampler: string;
}

export class ComfyVideoModel implements VideoModel {
  name = "comfyui:minimax-h3";
  available = true;
  private template?: Graph;

  constructor(private readonly opts: ComfyOptions) {}

  private async loadTemplate(): Promise<Graph> {
    if (!this.template) {
      this.template = await getJson<Graph>(this.opts.workflowUrl);
    }
    return this.template;
  }

  async render(req: RenderRequest): Promise<RenderHandle> {
    const graph: Graph = JSON.parse(JSON.stringify(await this.loadTemplate()));
    const node = findNode(graph, "MiniMaxH3ReferenceToVideo");
    if (node) {
      graph[node].inputs.prompt = req.promptSpec.positive;
      graph[node].inputs.width = req.width;
      graph[node].inputs.height = req.height;
      graph[node].inputs.length = req.length;
    }
    const noise = findNode(graph, "RandomNoise");
    if (noise) graph[noise].inputs.noise_seed = req.seed;
    const sched = findNode(graph, "BasicScheduler");
    if (sched) graph[sched].inputs.steps = req.steps ?? this.opts.defaultSteps;
    const sampler = findNode(graph, "KSamplerSelect");
    if (sampler) graph[sampler].inputs.sampler_name = req.sampler ?? this.opts.defaultSampler;
    const save = findNode(graph, "SaveVideo");
    if (save) graph[save].inputs.filename_prefix = `xpark/${req.shotId}`;

    const clientId = uid("web");
    const res = await postJson<{ prompt_id: string; node_errors?: unknown }>(
      `${this.opts.baseUrl}/prompt`,
      { prompt: graph, client_id: clientId },
    );
    if (!res.prompt_id) {
      throw new Error(`ComfyUI rejected prompt: ${JSON.stringify(res.node_errors)}`);
    }
    return { promptId: res.prompt_id, clientId };
  }

  async poll(handle: RenderHandle): Promise<RenderProgress> {
    const hist = await getJson<Record<string, HistoryEntry>>(
      `${this.opts.baseUrl}/history/${handle.promptId}`,
      Number.MAX_SAFE_INTEGER,
    );
    const entry = hist[handle.promptId];
    if (!entry) return { state: "running" };
    const status = entry.status?.status_str;
    if (status === "error") {
      return { state: "failed", error: "ComfyUI execution error" };
    }
    if (status === "success" && entry.status?.completed) {
      const file = extractOutputs(entry).find((f) => /\.(mp4|webm|mov)$/i.test(f.filename));
      if (!file) return { state: "failed", error: "no video output" };
      const query = new URLSearchParams({
        filename: file.filename,
        subfolder: file.subfolder ?? "",
        type: file.type ?? "output",
      });
      return {
        state: "generated",
        artifact: {
          assetId: uid("vid"),
          storageKey: `comfy/${file.subfolder ? file.subfolder + "/" : ""}${file.filename}`,
          mediaType: "video",
          width: this.opts.defaultLength ? 512 : 512,
          height: 512,
          durationS: 0,
          seed: 0,
          remoteUrl: `${this.opts.baseUrl}/view?${query.toString()}`,
        },
      };
    }
    return { state: "running" };
  }
}

export async function comfySystemStats(baseUrl: string): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(`${baseUrl}/system_stats`, 8000);
}
