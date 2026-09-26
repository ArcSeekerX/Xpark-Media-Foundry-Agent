// Editable runtime settings. Environment variables seed the defaults; the user
// can override everything from the Settings module, persisted to localStorage.
// `config` (see config.ts) is a live Proxy over these settings, so adapters and
// the flow pick up changes without touching every call site.
import { useSyncExternalStore } from "react";

export type RuntimeMode = "mock" | "live";
export type DecisionEngine = "mock" | "laya" | "jev";

export interface AppSettings {
  mode: RuntimeMode;
  backendUrl: string;
  backendToken: string;
  sse: boolean;
  comfyUrl: string;
  textModel: { baseUrl: string; apiKey: string; model: string };
  decision: { engine: DecisionEngine; url: string };
  image: {
    enabled: boolean;
    workflowUrl: string;
    width: number;
    height: number;
    steps: number;
    sampler: string;
    cfg: number;
  };
  video: {
    width: number;
    height: number;
    length: number;
    steps: number;
    sampler: string;
  };
  quality: { acceptThreshold: number; maxRepairs: number };
  routing: { shadow: boolean; auto: boolean; minConfidence: number };
  // Storage locations (interpreted by the backend for assets and final cuts).
  storage: { importsDir: string; generatedDir: string; exportsDir: string };
  persist: boolean;
}

const env = import.meta.env as Record<string, string | undefined>;

export const DEFAULT_SETTINGS: AppSettings = {
  // Default to the real interface path; set VITE_MODE=mock only for offline UI demos.
  mode: (env.VITE_MODE as RuntimeMode) ?? "live",
  backendUrl: env.VITE_BACKEND_URL ?? "/api",
  backendToken: env.VITE_API_TOKEN ?? "",
  sse: (env.VITE_SSE ?? "1") !== "0",
  comfyUrl: env.VITE_COMFY_URL ?? "/comfy",
  textModel: {
    baseUrl: env.VITE_TEXT_MODEL_URL ?? "",
    apiKey: env.VITE_TEXT_MODEL_KEY ?? "none",
    model: env.VITE_TEXT_MODEL_NAME ?? "qwen",
  },
  decision: {
    engine: (env.VITE_DECISION_ENGINE as DecisionEngine) ?? "mock",
    url: env.VITE_DECISION_URL ?? "",
  },
  image: {
    enabled: (env.VITE_IMAGE_ENABLED ?? "1") !== "0",
    workflowUrl: env.VITE_IMAGE_WORKFLOW ?? "/workflows/qwen_image_t2i.api.json",
    width: Number(env.VITE_IMAGE_WIDTH ?? 768),
    height: Number(env.VITE_IMAGE_HEIGHT ?? 1024),
    steps: Number(env.VITE_IMAGE_STEPS ?? 20),
    sampler: env.VITE_IMAGE_SAMPLER ?? "euler",
    cfg: Number(env.VITE_IMAGE_CFG ?? 4),
  },
  video: {
    width: Number(env.VITE_VIDEO_WIDTH ?? 512),
    height: Number(env.VITE_VIDEO_HEIGHT ?? 512),
    length: Number(env.VITE_VIDEO_LENGTH ?? 22),
    steps: Number(env.VITE_VIDEO_STEPS ?? 4),
    sampler: env.VITE_VIDEO_SAMPLER ?? "res_multistep",
  },
  quality: {
    acceptThreshold: Number(env.VITE_QC_ACCEPT ?? 0.85),
    maxRepairs: Number(env.VITE_QC_MAX_REPAIRS ?? 2),
  },
  routing: {
    shadow: (env.VITE_ROUTING_SHADOW ?? "1") !== "0",
    auto: (env.VITE_ROUTING_AUTO ?? "0") !== "0",
    minConfidence: Number(env.VITE_ROUTING_MIN_CONF ?? 0.5),
  },
  storage: {
    importsDir: env.VITE_IMPORTS_DIR ?? "imports",
    generatedDir: env.VITE_GENERATED_DIR ?? "generated",
    exportsDir: env.VITE_EXPORTS_DIR ?? "exports",
  },
  persist: (env.VITE_PERSIST ?? "1") !== "0",
};

const STORAGE_KEY = "xpark-foundry:settings:v1";

function merge(base: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return {
    ...base,
    ...patch,
    textModel: { ...base.textModel, ...(patch.textModel ?? {}) },
    decision: { ...base.decision, ...(patch.decision ?? {}) },
    image: { ...base.image, ...(patch.image ?? {}) },
    video: { ...base.video, ...(patch.video ?? {}) },
    quality: { ...base.quality, ...(patch.quality ?? {}) },
    routing: { ...base.routing, ...(patch.routing ?? {}) },
    storage: { ...base.storage, ...(patch.storage ?? {}) },
  };
}

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return merge(DEFAULT_SETTINGS, JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    /* ignore corrupt settings */
  }
  return { ...DEFAULT_SETTINGS };
}

let current: AppSettings = load();
const listeners = new Set<() => void>();

export function getSettings(): AppSettings {
  return current;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  current = merge(current, patch);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* best-effort */
  }
  listeners.forEach((fn) => fn());
  return current;
}

export function resetSettings(): AppSettings {
  current = { ...DEFAULT_SETTINGS };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
  return current;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, getSettings, getSettings);
  return { settings, update: updateSettings, reset: resetSettings };
}
