let counter = 0;

export function uid(prefix = "id"): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function clamp(v: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, v));
}

export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function secondsToTimecode(s: number, fps = 24): string {
  const frames = Math.round(s * fps);
  const mm = Math.floor(frames / (fps * 60));
  const ss = Math.floor((frames / fps) % 60);
  const ff = frames % fps;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}:${String(ff).padStart(2, "0")}`;
}
