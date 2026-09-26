// Live runtime config backed by the editable settings store. Existing call
// sites keep using `config.*`; values now reflect user settings immediately.
import { getSettings } from "./settings";
import type { AppSettings } from "./settings";

export type { RuntimeMode, AppSettings } from "./settings";
export type RuntimeConfig = AppSettings;

export const config: RuntimeConfig = new Proxy({} as RuntimeConfig, {
  get(_target, prop: string | symbol) {
    return (getSettings() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export function isLive(): boolean {
  return getSettings().mode === "live";
}
