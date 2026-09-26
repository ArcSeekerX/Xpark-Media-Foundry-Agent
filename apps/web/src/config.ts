// Runtime configuration. Defaults to "mock" so the Agent page runs with no
// backend. Set VITE_MODE=live to exercise the real adapters.

export type RuntimeMode = "mock" | "live";

const env = import.meta.env as Record<string, string | undefined>;

export const config = {
  mode: (env.VITE_MODE as RuntimeMode) ?? "mock",

  // Business API (FastAPI) — used by the "live" mode backend adapter.
  backendUrl: env.VITE_BACKEND_URL ?? "/api",

  // ComfyUI. In dev, /comfy is proxied by vite.config.ts.
  comfyUrl: env.VITE_COMFY_URL ?? "/comfy",

  // Local text model (Qwen) served over an OpenAI-compatible endpoint.
  textModel: {
    baseUrl: env.VITE_TEXT_MODEL_URL ?? "",
    apiKey: env.VITE_TEXT_MODEL_KEY ?? "none",
    model: env.VITE_TEXT_MODEL_NAME ?? "qwen",
  },

  // Local decision port (Laya) or remote Jev.
  decision: {
    engine: (env.VITE_DECISION_ENGINE as "laya" | "jev" | "mock") ?? "mock",
    url: env.VITE_DECISION_URL ?? "",
  },

  video: {
    width: Number(env.VITE_VIDEO_WIDTH ?? 512),
    height: Number(env.VITE_VIDEO_HEIGHT ?? 512),
    length: Number(env.VITE_VIDEO_LENGTH ?? 22),
    steps: Number(env.VITE_VIDEO_STEPS ?? 4),
    sampler: env.VITE_VIDEO_SAMPLER ?? "res_multistep",
  },

  // Text-to-image keyframe / character-reference generation (Qwen Image 2.1 7B
  // by default) executed as a ComfyUI API workflow.
  image: {
    enabled: (env.VITE_IMAGE_ENABLED ?? "1") !== "0",
    workflowUrl: env.VITE_IMAGE_WORKFLOW ?? "/workflows/qwen_image_t2i.api.json",
    width: Number(env.VITE_IMAGE_WIDTH ?? 768),
    height: Number(env.VITE_IMAGE_HEIGHT ?? 1024),
    steps: Number(env.VITE_IMAGE_STEPS ?? 20),
    sampler: env.VITE_IMAGE_SAMPLER ?? "euler",
    cfg: Number(env.VITE_IMAGE_CFG ?? 4),
  },

  quality: {
    acceptThreshold: Number(env.VITE_QC_ACCEPT ?? 0.85),
    maxRepairs: Number(env.VITE_QC_MAX_REPAIRS ?? 2),
  },
} as const;

export function isLive(): boolean {
  return config.mode === "live";
}
