// Live adapters that talk to local services. Each degrades to `available=false`
// when its endpoint is not configured, so the UI can surface missing pieces
// instead of silently faking them.
import type {
  AssetStore,
  ArchiveRecord,
  DecisionPort,
  TextModel,
} from "./types";
import type { Asset, DecisionAdvice } from "../types";
import type { DecisionInput } from "./types";

export class OpenAITextModel implements TextModel {
  name = "local-qwen";
  available: boolean;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    this.available = baseUrl.length > 0;
  }

  async complete(system: string, user: string): Promise<string> {
    const r = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.7,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) throw new Error(`text model ${r.status}`);
    const data = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  }
}

export class HttpDecisionPort implements DecisionPort {
  name: string;
  available: boolean;

  constructor(private readonly url: string, engine: string) {
    this.name = engine;
    this.available = url.length > 0;
  }

  async propose(input: DecisionInput): Promise<DecisionAdvice> {
    const r = await fetch(`${this.url}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) throw new Error(`decision ${r.status}`);
    return (await r.json()) as DecisionAdvice;
  }
}

export class HttpAssetStore implements AssetStore {
  name = "http-asset-store";
  available: boolean;

  constructor(private readonly url: string) {
    this.available = url.length > 0;
  }

  async archive(
    projectId: string,
    assets: Asset[],
    extra?: unknown,
  ): Promise<ArchiveRecord> {
    const r = await fetch(`${this.url}/projects/${projectId}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset_ids: assets.map((a) => a.assetId), extra }),
    });
    if (!r.ok) throw new Error(`archive ${r.status}`);
    return (await r.json()) as ArchiveRecord;
  }
}
