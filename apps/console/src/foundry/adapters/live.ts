// Live adapters that talk to local services. Each degrades to `available=false`
// when its endpoint is not configured, so the UI can surface missing pieces
// instead of silently faking them.
import type {
  AssetStore,
  ArchiveRecord,
  DecisionPort,
  GeneratedMedia,
  ImageModel,
  ImageRequest,
  JudgeInput,
  TextModel,
  VisionJudge,
} from "./types";
import type { Asset, DecisionAdvice, ScoreReport } from "../types";
import type { DecisionInput } from "./types";

export class OpenAITextModel implements TextModel {
  name = "local-qwen";
  available: boolean;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
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
  private readonly url: string;

  constructor(url: string, engine: string) {
    this.url = url;
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
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
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

// Real vision judge: calls the backend, which runs deterministic technical
// checks (ffprobe) and reports semantic uncertainty instead of faking scores.
export class HttpVisionJudge implements VisionJudge {
  name = "backend:judge";
  available: boolean;
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token = "") {
    this.url = url.replace(/\/$/, "");
    this.token = token;
    this.available = this.url.length > 0;
  }

  async evaluate(input: JudgeInput): Promise<ScoreReport> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const r = await fetch(`${this.url}/judge`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        run_id: input.runId,
        shot: input.shot,
        asset: input.asset,
      }),
    });
    if (!r.ok) throw new Error(`judge ${r.status}`);
    return (await r.json()) as ScoreReport;
  }
}

// No visual-understanding model wired: honestly report uncertainty so the run
// routes to human review instead of accepting on fabricated scores.
export class UncertainJudge implements VisionJudge {
  name = "unverified-judge";
  available = true;

  async evaluate(input: JudgeInput): Promise<ScoreReport> {
    return {
      runId: input.runId,
      verdict: "human_review",
      hardChecks: {},
      scores: {},
      evidence: [
        { tag: "semantic_unavailable", note: "未接入视觉理解模型，转人工复核" },
      ],
      uncertain: true,
      rubricVersion: "unverified",
    };
  }
}

export class UnavailableImageModel implements ImageModel {
  name = "image-disabled";
  available = false;

  async generate(_req: ImageRequest): Promise<GeneratedMedia> {
    throw new Error("image generation is disabled or unconfigured");
  }
}
