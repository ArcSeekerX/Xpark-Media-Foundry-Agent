// Intelligent routing: rules narrow the allowed actions, an optional small
// model (Laya/Jev) proposes one, and a threshold decides whether to trust it.
// In shadow mode the rule action still runs while the proposal is recorded.
import type {
  RouteAction,
  RouteDecision,
  ShotSpec,
  Verdict,
} from "../types";

export interface RouteInput {
  materialPolicy: ShotSpec["materialPolicy"];
  hasImportedImage: boolean;
  hasGeneratedImage: boolean;
  hasReuseClip: boolean;
  imageAvailable: boolean;
  imageEnabled: boolean;
  priorVerdict?: Verdict;
  repairs: number;
  maxRepairs: number;
  advice?: { selectedAction: string; modelId: string } | null;
}

export interface RouteOptions {
  shadow: boolean;
  minConfidence: number;
}

const MODEL_ACTION_MAP: Record<string, RouteAction> = {
  prefer_imported: "reuse_imported",
  reuse_imported: "reuse_imported",
  reuse_clip: "reuse_clip",
  image_conditioned: "image_conditioned",
  generate: "generate",
  repair: "repair",
  human_review: "human_review",
};

export function mapModelAction(action: string | undefined): RouteAction | undefined {
  if (!action) return undefined;
  return MODEL_ACTION_MAP[action];
}

export function allowedActions(input: RouteInput): RouteAction[] {
  const actions: RouteAction[] = [];
  if (input.hasReuseClip) actions.push("reuse_clip");
  if (input.hasImportedImage) actions.push("reuse_imported");
  if (input.hasGeneratedImage) actions.push("image_conditioned");
  if (input.imageAvailable && input.imageEnabled && !input.hasGeneratedImage) {
    actions.push("image_conditioned");
  }
  actions.push("generate");
  actions.push("repair");
  actions.push("human_review");
  return actions;
}

interface RulePick {
  action: RouteAction;
  reason: string;
  confidence: number;
}

function pickRule(input: RouteInput): RulePick {
  if (input.priorVerdict === "human_review") {
    return { action: "human_review", reason: "上一轮质检不确定", confidence: 0.95 };
  }
  if (input.priorVerdict === "repair" && input.repairs >= input.maxRepairs) {
    return { action: "human_review", reason: "修复预算耗尽", confidence: 0.95 };
  }
  if (input.hasReuseClip) {
    return { action: "reuse_clip", reason: "存在可复用视频片段", confidence: 0.95 };
  }
  if (input.hasImportedImage) {
    return { action: "reuse_imported", reason: "存在导入参考素材，优先复用", confidence: 0.9 };
  }
  if (input.hasGeneratedImage) {
    return { action: "image_conditioned", reason: "已有生成关键帧", confidence: 0.8 };
  }
  if (input.imageAvailable && input.imageEnabled && input.materialPolicy === "prefer_imported") {
    return { action: "image_conditioned", reason: "缺素材，生成关键帧后视频", confidence: 0.72 };
  }
  return { action: "generate", reason: "直接文本条件生成", confidence: 0.6 };
}

export function routeShot(input: RouteInput, opts: RouteOptions): RouteDecision {
  const rule = pickRule(input);
  const modelAction = mapModelAction(input.advice?.selectedAction);
  const reasons = [rule.reason];
  if (input.advice) reasons.push(`模型建议 ${input.advice.selectedAction}（${input.advice.modelId}）`);

  if (!opts.shadow && modelAction && modelAction !== rule.action) {
    // Trust the model only when it proposes a currently allowed action.
    const allowed = allowedActions(input);
    if (allowed.includes(modelAction)) {
      return {
        action: modelAction,
        reasons: [...reasons, `模型动作被采纳（阈值 ${opts.minConfidence}）`],
        confidence: Math.max(opts.minConfidence, rule.confidence),
        source: "model",
        shadow: false,
        modelAction,
        fallback: rule.action,
      };
    }
    reasons.push("模型动作不可执行，回退规则");
  }

  return {
    action: rule.action,
    reasons,
    confidence: rule.confidence,
    source: "rules",
    shadow: opts.shadow,
    modelAction,
    fallback: modelAction && modelAction !== rule.action ? rule.action : null,
  };
}
