// Real ComfyUI text-to-image adapter (Qwen Image 2.1 7B by default).
// Loads an API-format workflow, injects prompt / size / sampler / seed,
// optionally uploads reference images for character consistency, submits to
// /prompt, then polls /history and returns a viewable generated asset.
import type { GeneratedMedia, ImageModel, ImageRequest } from "./types";
import type { ReferenceImage } from "../types";
import { sleep, uid } from "../lib/util";

type Graph = Record<
  string,
  {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: { title?: string };
  }
>;

interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean };
  outputs?: Record<string, Record<string, unknown>>;
}

interface OutputFile {
  filename: string;
  subfolder?: string;
  type?: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nodesOfType(graph: Graph, classTypes: string[]): string[] {
  return Object.keys(graph)
    .filter((k) => classTypes.includes(graph[k]?.class_type))
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

function findNode(graph: Graph, classTypes: string[]): string | undefined {
  return nodesOfType(graph, classTypes)[0];
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

function extractOutputs(entry: HistoryEntry, re: RegExp): OutputFile[] {
  const files: OutputFile[] = [];
  for (const node of Object.values(entry.outputs ?? {})) {
    for (const value of Object.values(node)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (item && typeof item === "object" && "filename" in item) {
          const file = item as OutputFile;
          if (re.test(file.filename)) files.push(file);
        }
      }
    }
  }
  return files;
}

export interface ComfyImageOptions {
  baseUrl: string;
  workflowUrl: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultSteps: number;
  defaultSampler: string;
  defaultCfg: number;
}

export class ComfyImageModel implements ImageModel {
  name = "comfyui:qwen-image";
  available = true;
  private readonly opts: ComfyImageOptions;
  private template?: Graph;

  constructor(opts: ComfyImageOptions) {
    this.opts = opts;
  }

  private async loadTemplate(): Promise<Graph> {
    if (!this.template) {
      this.template = await getJson<Graph>(this.opts.workflowUrl, 20000);
      if (!this.template || Object.keys(this.template).length === 0) {
        throw new Error(`image workflow is empty: ${this.opts.workflowUrl}`);
      }
    }
    return this.template;
  }

  // Upload a browser-side image (data URL) into ComfyUI/input and return the
  // server-side name usable by LoadImage nodes.
  private async uploadReference(ref: ReferenceImage): Promise<string> {
    const blob = await (await fetch(ref.dataUrl)).blob();
    const form = new FormData();
    form.append("image", blob, ref.name || `${ref.assetId}.png`);
    form.append("overwrite", "true");
    const r = await fetch(`${this.opts.baseUrl}/upload/image`, {
      method: "POST",
      body: form,
    });
    if (!r.ok) throw new Error(`upload ${r.status}`);
    const data = (await r.json()) as { name?: string; subfolder?: string };
    if (!data.name) return ref.name;
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
  }

  private injectPrompt(graph: Graph, req: ImageRequest): void {
    const textIds = nodesOfType(graph, ["CLIPTextEncode", "TextEncodeQwenImageEdit"]);
    const titleOf = (id: string) => graph[id]?._meta?.title ?? "";
    let positiveId = textIds.find((id) => /pos|正/i.test(titleOf(id)));
    let negativeId = textIds.find((id) => /neg|负/i.test(titleOf(id)));
    if (!positiveId) positiveId = textIds[0];
    if (!negativeId) negativeId = textIds.find((id) => id !== positiveId);
    if (positiveId) graph[positiveId].inputs.text = req.prompt;
    if (negativeId) graph[negativeId].inputs.text = req.negativePrompt;
  }

  private injectSampler(graph: Graph, req: ImageRequest): void {
    const latent = findNode(graph, ["EmptyLatentImage", "EmptySD3LatentImage"]);
    if (latent) {
      graph[latent].inputs.width = req.width;
      graph[latent].inputs.height = req.height;
    }
    const sampler = findNode(graph, ["KSampler", "KSamplerAdvanced"]);
    if (sampler) {
      graph[sampler].inputs.seed = req.seed;
      graph[sampler].inputs.steps = this.opts.defaultSteps;
      graph[sampler].inputs.cfg = this.opts.defaultCfg;
      graph[sampler].inputs.sampler_name = this.opts.defaultSampler;
    }
    const noise = findNode(graph, ["RandomNoise"]);
    if (noise) graph[noise].inputs.noise_seed = req.seed;
    const save = findNode(graph, ["SaveImage"]);
    if (save) graph[save].inputs.filename_prefix = `xpark/keyframe_${req.shot.shotId}`;
  }

  private async injectReferences(graph: Graph, req: ImageRequest): Promise<void> {
    const refs = req.referenceImages ?? [];
    if (refs.length === 0) return;
    const loaders = nodesOfType(graph, ["LoadImage"]);
    for (let i = 0; i < loaders.length && i < refs.length; i += 1) {
      try {
        graph[loaders[i]].inputs.image = await this.uploadReference(refs[i]);
      } catch {
        // A missing upload should not abort generation; fall back to no ref.
      }
    }
  }

  async generate(req: ImageRequest): Promise<GeneratedMedia> {
    const graph = clone(await this.loadTemplate());
    this.injectPrompt(graph, req);
    this.injectSampler(graph, req);
    await this.injectReferences(graph, req);

    const clientId = uid("web");
    const res = await postJson<{ prompt_id?: string; node_errors?: unknown }>(
      `${this.opts.baseUrl}/prompt`,
      { prompt: graph, client_id: clientId },
    );
    if (!res.prompt_id) {
      throw new Error(`ComfyUI rejected image prompt: ${JSON.stringify(res.node_errors)}`);
    }
    const promptId = res.prompt_id;

    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(1500);
      const hist = await getJson<Record<string, HistoryEntry>>(
        `${this.opts.baseUrl}/history/${promptId}`,
        Number.MAX_SAFE_INTEGER,
      );
      const entry = hist[promptId];
      if (!entry) continue;
      const status = entry.status?.status_str;
      if (status === "error") throw new Error("ComfyUI image execution error");
      if (status === "success" && entry.status?.completed) {
        const file = extractOutputs(entry, /\.(png|jpe?g|webp)$/i)[0];
        if (!file) throw new Error("ComfyUI produced no image output");
        const query = new URLSearchParams({
          filename: file.filename,
          subfolder: file.subfolder ?? "",
          type: file.type ?? "output",
        });
        return {
          assetId: uid("img"),
          storageKey: `comfy/${file.subfolder ? file.subfolder + "/" : ""}${file.filename}`,
          previewKey: undefined,
          mediaType: "image",
          width: req.width,
          height: req.height,
          durationS: 0,
          seed: req.seed,
          remoteUrl: `${this.opts.baseUrl}/view?${query.toString()}`,
        };
      }
    }
    throw new Error("image generation timeout");
  }
}
