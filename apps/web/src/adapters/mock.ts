// Mock adapters: make the Agent page fully interactive with no backend or GPU.
import type {
  Adapters,
  ArchiveRecord,
  DecisionInput,
  GeneratedMedia,
  ImageRequest,
  JudgeInput,
  RenderHandle,
  RenderProgress,
  RenderState,
  TextModel,
} from "./types";
import type { DecisionAdvice, ScoreReport } from "../types";
import { clamp, shortHash, sleep, uid } from "../lib/util";
import type { Asset, RenderRequest } from "../types";

class MockTextModel implements TextModel {
  name = "mock-text";
  available = false;

  async complete(system: string, user: string): Promise<string> {
    await sleep(120);
    // Deterministic "polish": keep the user's intent, add production language.
    return user.trim();
  }
}

class MockImageModel {
  name = "placeholder-image";
  available = false; // no local text-to-image checkpoint on this host
  private seq = 0;

  async generate(req: ImageRequest): Promise<GeneratedMedia> {
    await sleep(600);
    this.seq += 1;
    return {
      assetId: uid("img"),
      storageKey: `generated/images/${req.shot.shotId}_${this.seq}.png`,
      previewKey: `previews/${req.shot.shotId}_${this.seq}.jpg`,
      mediaType: "image",
      width: req.width,
      height: req.height,
      durationS: 0,
      seed: req.seed,
    };
  }
}

class MockVideoModel {
  name = "mock-video";
  available = true;
  private polls = new Map<string, number>();

  async render(req: RenderRequest): Promise<RenderHandle> {
    await sleep(250);
    const promptId = uid("prompt");
    this.polls.set(promptId, 0);
    return { promptId, clientId: "mock" };
  }

  async poll(handle: RenderHandle): Promise<RenderProgress> {
    await sleep(450);
    const n = (this.polls.get(handle.promptId) ?? 0) + 1;
    this.polls.set(handle.promptId, n);
    const total = 4;
    if (n < total) {
      const state: RenderState = "running";
      return {
        state,
        progress: { unit: "sampling_step", current: n, total },
      };
    }
    this.polls.delete(handle.promptId);
    return {
      state: "generated",
      progress: { unit: "sampling_step", current: total, total },
      artifact: {
        assetId: uid("vid"),
        storageKey: `generated/videos/${handle.promptId}.mp4`,
        previewKey: `previews/${handle.promptId}.jpg`,
        mediaType: "video",
        width: 512,
        height: 512,
        durationS: 1,
        seed: 20260925,
        remoteUrl: undefined,
      },
    };
  }
}

class MockJudge {
  name = "mock-vision-judge";
  available = true;

  constructor(private readonly acceptThreshold: number) {}

  async evaluate(input: JudgeInput): Promise<ScoreReport> {
    await sleep(700);
    const h = parseInt(shortHash(input.runId + input.shot.shotId), 16);
    const jitter = (seed: number) => ((h >> seed) % 100) / 1000;
    const identity = clamp(0.78 + jitter(0));
    const action = clamp(0.8 + jitter(2));
    const temporal = clamp(0.78 + jitter(4));
    const hard = {
      decodable: true,
      duration_ok: true,
      no_watermark: true,
    };
    const pass =
      hard.decodable &&
      hard.duration_ok &&
      identity >= this.acceptThreshold &&
      action >= this.acceptThreshold;
    const verdict: ScoreReport["verdict"] = pass ? "accept" : "repair";
    const report: ScoreReport = {
      runId: input.runId,
      verdict,
      hardChecks: hard,
      scores: { identity, action, temporal },
      evidence: pass
        ? []
        : [
            {
              tag: identity < action ? "identity_drift" : "action_incomplete",
              timeS: [0.2, 0.8],
              note: identity < action
                ? "面部身份与参考图存在漂移"
                : "动作未完全完成",
            },
          ],
      uncertain: false,
      rubricVersion: "shortdrama-v1",
    };
    if (!pass) {
      report.repair = {
        target: identity < action ? "reference_assets" : "prompt",
        action:
          identity < action
            ? "replace_with_approved_closeup"
            : "simplify_action_sequence",
        invalidateFrom: identity < action ? "ASSET_READY" : "PROMPT_READY",
        rationale: "mock judge: 关键项未达阈值，生成修复计划",
      };
    }
    return report;
  }
}

class MockDecisionPort {
  name = "mock-decision";
  available = true;

  async propose(input: {
    stateHash: string;
    allowedActions: string[];
    summary: string;
    evidenceIds: string[];
  }): Promise<DecisionAdvice> {
    await sleep(180);
    const selected = input.allowedActions[0] ?? "replan";
    return {
      decisionId: uid("dec"),
      stateHash: input.stateHash,
      allowedActions: input.allowedActions,
      selectedAction: selected,
      modelId: "configured-local-laya",
      modelRevision: "mock",
      calibrationVersion: "routing-zh-v1",
      evidenceIds: input.evidenceIds,
      acceptedByPolicy: true,
      fallback: null,
    };
  }
}

class MockAssetStore {
  name = "mock-asset-store";
  available = true;
  records: ArchiveRecord[] = [];

  async archive(
    projectId: string,
    assets: Asset[],
    _extra?: unknown,
  ): Promise<ArchiveRecord> {
    await sleep(300);
    const rec: ArchiveRecord = {
      archiveId: uid("arc"),
      projectId,
      createdAt: new Date().toISOString(),
      manifestKey: `archives/${projectId}/manifest.json`,
      assetIds: assets.map((a) => a.assetId),
      totalBytes: assets.length * 1024 * 1024,
    };
    this.records.push(rec);
    return rec;
  }
}

export function createMockAdapters(acceptThreshold: number): Adapters {
  return {
    text: new MockTextModel(),
    image: new MockImageModel(),
    video: new MockVideoModel(),
    judge: new MockJudge(acceptThreshold),
    decision: new MockDecisionPort(),
    store: new MockAssetStore(),
  };
}
