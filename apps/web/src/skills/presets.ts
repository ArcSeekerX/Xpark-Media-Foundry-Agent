// Validated character-creation and scene prompt presets. Built-ins ship with
// the app; users can import their own JSON (merged + persisted locally).
import { useSyncExternalStore } from "react";

export type PresetCategory = "character" | "scene";

export interface PromptPreset {
  id: string;
  name: string;
  category: PresetCategory;
  description: string;
  prompt: string;
  negative?: string;
  tags?: string[];
  validated?: boolean;
}

export const BUILTIN_PRESETS: PromptPreset[] = [
  // ---- Character creation ----
  {
    id: "char.anime.girl",
    name: "动漫少女",
    category: "character",
    description: "2D 动漫风，黑发盘发、灰紫色眼睛、白皙皮肤、纤细比例",
    prompt:
      "角色：年轻动漫少女，黑色盘发配柔和刘海与侧发，灰紫色眼睛，白皙皮肤，纤细比例。保持面部身份、发型与比例一致，clean line art, flat cel shading。",
    negative: "extra people, watermark, cyan lighting, deformation",
    tags: ["anime", "2d", "identity"],
    validated: true,
  },
  {
    id: "char.realistic.heroine",
    name: "写实女主",
    category: "character",
    description: "电影感写实，东亚面孔、黑长直发、自然妆、约 25 岁",
    prompt:
      "角色：约 25 岁东亚女性，黑色长直发，自然裸妆，柔和五官，修长身形。电影感写实打光，肤色自然，保持身份一致性，shallow depth of field。",
    negative: "extra people, watermark, cartoon, overexposure",
    tags: ["realistic", "cinematic", "identity"],
    validated: true,
  },
  {
    id: "char.studio.host",
    name: "演播室主播",
    category: "character",
    description: "干净演播室，正装、整洁发型、亲和表情",
    prompt:
      "角色：专业主播，深色正装，整洁利落发型，亲和自信的表情，面对镜头口播。柔和均匀布光，低背景细节，保持身份一致。",
    negative: "echo, reverb, extra people, flicker",
    tags: ["studio", "presenter"],
    validated: true,
  },
  {
    id: "char.period.role",
    name: "古装角色",
    category: "character",
    description: "古典气质，汉服、发髻、淡雅妆容",
    prompt:
      "角色：古典气质的古装人物，淡雅汉服，精致发髻配发簪，淡妆，姿态端庄。柔和的自然光，东方古典美学，保持服饰与身份一致。",
    negative: "extra people, watermark, modern objects, deformation",
    tags: ["period", "hanfu"],
    validated: true,
  },
  // ---- Scene prompts ----
  {
    id: "scene.rainy.rooftop",
    name: "雨夜天台",
    category: "scene",
    description: "湿润地面反光、远处红色信号灯、电影感夜景",
    prompt:
      "场景：夜晚天台，持续降雨，湿润地面与栏杆反射城市灯光，远处有红色信号灯，冷色调电影感夜景，浅景深，film grain。",
    negative: "extra people, cartoon, overexposure, duplication",
    tags: ["night", "rain", "rooftop"],
    validated: true,
  },
  {
    id: "scene.summer.park",
    name: "夏日公园",
    category: "scene",
    description: "绿树花坛、阳光步道、明亮通透",
    prompt:
      "场景：明亮夏日公园，郁郁葱葱的绿树与花坛，阳光洒落的步道，温暖通透的自然光，清新季节氛围，中性白平衡。",
    negative: "extra people, cyan cast, flicker",
    tags: ["day", "park", "summer"],
    validated: true,
  },
  {
    id: "scene.studio.neutral",
    name: "演播室",
    category: "scene",
    description: "柔和均匀布光、低背景细节",
    prompt:
      "场景：干净中性的室内演播室，柔和均匀的布光，背景简洁低细节，主体突出，色彩中性。",
    negative: "clutter, harsh shadows, watermark",
    tags: ["indoor", "studio"],
    validated: true,
  },
  {
    id: "scene.neon.city",
    name: "都市霓虹夜景",
    category: "scene",
    description: "湿地面、霓虹反光、浅景深",
    prompt:
      "场景：都市街道夜景，霓虹招牌与湿润地面的彩色反光，车灯拖影，浅景深，电影感高对比色调。",
    negative: "extra people, watermark, overexposure",
    tags: ["night", "city", "neon"],
    validated: true,
  },
];

const STORAGE_KEY = "xpark-foundry:prompt-presets:v1";
const listeners = new Set<() => void>();

function normalize(item: unknown): PromptPreset | undefined {
  if (!item || typeof item !== "object") return undefined;
  const o = item as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
  if (!name || !prompt) return undefined;
  const category: PresetCategory = o.category === "character" ? "character" : "scene";
  return {
    id:
      typeof o.id === "string" && o.id
        ? o.id
        : `user.${name}.${Math.random().toString(36).slice(2, 8)}`,
    name,
    category,
    description: typeof o.description === "string" ? o.description : "",
    prompt,
    negative: typeof o.negative === "string" ? o.negative : undefined,
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : undefined,
    validated: o.validated === true,
  };
}

function load(): PromptPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.map(normalize).filter((p): p is PromptPreset => Boolean(p));
  } catch {
    return [];
  }
}

let userPresets: PromptPreset[] = load();
let snapshot: PromptPreset[] = [...BUILTIN_PRESETS, ...userPresets];

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userPresets));
  } catch {
    /* best-effort */
  }
}

function rebuild(): void {
  snapshot = [...BUILTIN_PRESETS, ...userPresets];
}

function emit(): void {
  rebuild();
  listeners.forEach((fn) => fn());
}

export function listPresets(): PromptPreset[] {
  return snapshot;
}

export function importPresets(data: unknown): { added: number; skipped: number } {
  if (!Array.isArray(data)) throw new Error("预设文件必须是 JSON 数组");
  const existing = new Set(snapshot.map((p) => p.id));
  let added = 0;
  let skipped = 0;
  for (const item of data) {
    const preset = normalize(item);
    if (!preset || existing.has(preset.id)) {
      skipped += 1;
      continue;
    }
    userPresets.push(preset);
    existing.add(preset.id);
    added += 1;
  }
  if (added > 0) {
    save();
    emit();
  }
  return { added, skipped };
}

export function removeUserPreset(id: string): void {
  userPresets = userPresets.filter((p) => p.id !== id);
  save();
  emit();
}

export function clearUserPresets(): void {
  userPresets = [];
  save();
  emit();
}

export function exportPresets(): string {
  return JSON.stringify(snapshot, null, 2);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePresets() {
  const presets = useSyncExternalStore(subscribe, listPresets, listPresets);
  return { presets, importPresets, removeUserPreset, clearUserPresets, exportPresets };
}
