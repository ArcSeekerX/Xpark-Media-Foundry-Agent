// Front/back integration for generation. When a business backend is
// configured (VITE_BACKEND_URL, default "/api") the browser never talks to
// ComfyUI directly: image and video jobs go through the backend, which owns
// the ComfyUI templates, reference uploads and artifact URLs.
import type {
  Capabilities,
  ComposeResult,
  GeneratedMedia,
  ImageModel,
  ImageRequest,
  RenderHandle,
  RenderProgress,
  VideoModel,
} from "./types";
import type { Progress, ReferenceImage, RenderRequest } from "../types";
import { sleep, uid } from "../lib/util";

interface ReferencePayload {
  name: string;
  data_url: string;
  role?: string;
}

interface ImageJobRequest {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  sampler: string;
  reference_images?: ReferencePayload[];
}

interface VideoJobRequest {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  length: number;
  seed: number;
  steps: number;
  sampler: string;
  reference_images?: ReferencePayload[];
}

interface ArtifactPayload {
  asset_id: string;
  url: string;
  storage_key: string;
  width: number;
  height: number;
  duration_s: number;
  seed: number;
}

interface JobStatus<T> {
  state: "queued" | "running" | "succeeded" | "failed";
  progress?: Progress;
  artifact?: T;
  error?: string;
}

function refs(images: ReferenceImage[] | undefined): ReferencePayload[] | undefined {
  if (!images || images.length === 0) return undefined;
  return images.map((r) => ({ name: r.name, data_url: r.dataUrl, role: r.role }));
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 60000,
): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: ctl.signal,
    });
    if (!r.ok) {
      let detail = "";
      try {
        const body = (await r.json()) as { error?: string; detail?: string };
        detail = body.error ?? body.detail ?? "";
      } catch {
        /* non-JSON error body */
      }
      throw new Error(detail ? `${detail} (${r.status})` : `${url} -> ${r.status}`);
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export class GenerationBackend {
  name = "generation-backend";
  available: boolean;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.available = this.baseUrl.length > 0;
    this.token = token;
  }

  private url(path: string): string {
    const base = this.baseUrl || "/api";
    return `${base}${path}`;
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async capabilities(): Promise<Capabilities> {
    return requestJson<Capabilities>(this.url("/capabilities"), {
      headers: this.authHeaders(),
    });
  }

  async compose(clips: string[], projectId: string): Promise<ComposeResult> {
    const res = await requestJson<ComposeResult>(
      this.url("/productions/compose"),
      {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({ clips, project_id: projectId }),
      },
      300000,
    );
    return { ...res, url: this.resolveArtifact(res.url) ?? res.url };
  }

  eventsUrl(projectId: string, since = 0): string {
    const base = this.baseUrl || "/api";
    const params = new URLSearchParams({ project_id: projectId, since: String(since) });
    if (this.token) params.set("token", this.token);
    return `${base}/events?${params.toString()}`;
  }

  // Artifact URLs come back as backend-relative paths (e.g. /api/comfy/view).
  // Resolve them so a remote/absolute VITE_BACKEND_URL also renders in the UI.
  resolveArtifact(path: string | undefined): string | undefined {
    if (!path) return undefined;
    if (/^(https?:|data:|blob:)/.test(path)) return path;
    if (/^https?:\/\//.test(this.baseUrl)) {
      try {
        return new URL(this.baseUrl).origin + path;
      } catch {
        return path;
      }
    }
    return path;
  }

  async health(): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>(this.url("/health"), undefined, 8000);
  }

  async createImageJob(req: ImageJobRequest): Promise<string> {
    const res = await requestJson<{ job_id: string }>(this.url("/images/jobs"), {
      method: "POST",
      body: JSON.stringify(req),
    });
    return res.job_id;
  }

  async getImageJob(id: string): Promise<JobStatus<ArtifactPayload>> {
    return requestJson<JobStatus<ArtifactPayload>>(this.url(`/images/jobs/${id}`));
  }

  async createVideoJob(req: VideoJobRequest): Promise<string> {
    const res = await requestJson<{ job_id: string }>(this.url("/videos/jobs"), {
      method: "POST",
      body: JSON.stringify(req),
    });
    return res.job_id;
  }

  async getVideoJob(id: string): Promise<JobStatus<ArtifactPayload>> {
    return requestJson<JobStatus<ArtifactPayload>>(this.url(`/videos/jobs/${id}`));
  }
}

export class HttpImageModel implements ImageModel {
  name = "backend:image";
  available = true;
  private readonly backend: GenerationBackend;
  private readonly opts: { width: number; height: number; steps: number; sampler: string };

  constructor(
    backend: GenerationBackend,
    opts: { width: number; height: number; steps: number; sampler: string },
  ) {
    this.backend = backend;
    this.opts = opts;
  }

  async generate(req: ImageRequest): Promise<GeneratedMedia> {
    const jobId = await this.backend.createImageJob({
      prompt: req.prompt,
      negative_prompt: req.negativePrompt,
      width: req.width || this.opts.width,
      height: req.height || this.opts.height,
      seed: req.seed,
      steps: this.opts.steps,
      sampler: this.opts.sampler,
      reference_images: refs(req.referenceImages),
    });

    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(1500);
      const status = await this.backend.getImageJob(jobId);
      if (status.state === "failed") throw new Error(status.error ?? "image job failed");
      if (status.state === "succeeded" && status.artifact) {
        return {
          assetId: status.artifact.asset_id || uid("img"),
          storageKey: status.artifact.storage_key,
          mediaType: "image",
          width: status.artifact.width,
          height: status.artifact.height,
          durationS: 0,
          seed: status.artifact.seed ?? req.seed,
          remoteUrl: this.backend.resolveArtifact(status.artifact.url),
        };
      }
    }
    throw new Error("image job timeout");
  }
}

export class HttpVideoModel implements VideoModel {
  name = "backend:video";
  available = true;
  private readonly backend: GenerationBackend;
  private readonly opts: { width: number; height: number; length: number };

  constructor(
    backend: GenerationBackend,
    opts: { width: number; height: number; length: number },
  ) {
    this.backend = backend;
    this.opts = opts;
  }

  async render(req: RenderRequest): Promise<RenderHandle> {
    const jobId = await this.backend.createVideoJob({
      prompt: req.promptSpec.positive,
      negative_prompt: req.promptSpec.negative,
      width: req.width || this.opts.width,
      height: req.height || this.opts.height,
      length: req.length || this.opts.length,
      seed: req.seed,
      steps: req.steps,
      sampler: req.sampler,
      reference_images: refs(req.referenceImages),
    });
    return { promptId: jobId, clientId: "backend" };
  }

  async poll(handle: RenderHandle): Promise<RenderProgress> {
    const status = await this.backend.getVideoJob(handle.promptId);
    if (status.state === "failed") return { state: "failed", error: status.error };
    if (status.state === "succeeded" && status.artifact) {
      return {
        state: "generated",
        progress: status.progress,
        artifact: {
          assetId: status.artifact.asset_id || uid("vid"),
          storageKey: status.artifact.storage_key,
          mediaType: "video",
          width: status.artifact.width,
          height: status.artifact.height,
          durationS: status.artifact.duration_s,
          seed: status.artifact.seed,
          remoteUrl: this.backend.resolveArtifact(status.artifact.url),
        },
      };
    }
    return { state: status.state === "queued" ? "queued" : "running", progress: status.progress };
  }
}
