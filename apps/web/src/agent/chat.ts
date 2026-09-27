// Agent chat orchestration. Prefers the configured text model with function
// calling; falls back to deterministic skill routing so the chat still works
// offline. Every capability is executed through the tool registry.
import { executeTool, systemPrompt, toolsAsJson } from "./tools";
import type { ToolContext } from "./tools";
import type { TextModel } from "../adapters/types";

export interface ChatDecision {
  tool?: string;
  args?: Record<string, unknown>;
  reply?: string;
}

function shotIndex(text: string): number | undefined {
  const m = text.match(/第\s*(\d+)\s*(?:个)?\s*镜头/) ?? text.match(/镜头\s*(\d+)/);
  return m ? Number(m[1]) : undefined;
}

function latestCandidateId(ctx: ToolContext, index?: number): string | undefined {
  const shot =
    index !== undefined
      ? ctx.state.shots[index - 1] ?? ctx.state.shots[index]
      : ctx.state.shots.find((s) => s.phase !== "ACCEPTED") ?? ctx.state.shots[0];
  if (!shot) return undefined;
  return [...ctx.state.assets]
    .reverse()
    .find(
      (a) =>
        a.metadata.shotId === shot.shotId &&
        (a.mediaType === "image" || a.mediaType === "video") &&
        a.status !== "discarded",
    )?.assetId;
}

export function routeIntent(text: string, ctx: ToolContext): ChatDecision | undefined {
  const index = shotIndex(text);
  const hasShot = (): Record<string, unknown> =>
    index !== undefined ? { shot_index: index } : {};

  if (/规划|分镜|一句话|脚本|storyboard/.test(text)) {
    return { tool: "plan_video", args: { sentence: text }, reply: "我来根据需求生成分镜。" };
  }
  // Listing verbs win over action verbs (e.g. "列出已弃用的资产" is a listing).
  if (/列出|查看|有哪些|列表|清单|盘点/.test(text)) {
    return { tool: "list_assets", args: {}, reply: "" };
  }
  if (/(全部|所有|一键|批量).*(生成|生产|出片)|(生成|生产|出片).*(全部|所有|一键|批量)/.test(text)) {
    return { tool: "generate_all", args: {}, reply: "开始一键生产全部镜头。" };
  }
  if (/重新生成|重做|再生成|换一版/.test(text)) {
    return { tool: "regenerate_shot", args: hasShot(), reply: "重新生成该镜头。" };
  }
  if (/关键帧|生图|出图|首帧|配图/.test(text)) {
    return { tool: "generate_keyframe", args: hasShot(), reply: "生成关键帧图像。" };
  }
  if (/合成|剪辑|拼接|成片|出片/.test(text)) {
    return { tool: "compose_video", args: { allow_partial: /部分|尽力/.test(text) }, reply: "开始剪辑合成。" };
  }
  if (/归档|存档/.test(text)) {
    return { tool: "archive_assets", args: {}, reply: "归档素材与成片清单。" };
  }
  if (/采用|接受|通过|选用/.test(text)) {
    const assetId = latestCandidateId(ctx, index);
    return assetId
      ? { tool: "accept_asset", args: { asset_id: assetId }, reply: "采用最新候选。" }
      : { reply: "没有可采用的候选，请先生成。" };
  }
  if (/弃用|删除|不要|作废/.test(text)) {
    const assetId = latestCandidateId(ctx, index);
    return assetId
      ? { tool: "discard_asset", args: { asset_id: assetId, reason: "other" }, reply: "弃用最新候选。" }
      : { reply: "没有可弃用的候选。" };
  }
  if (/资产|素材|列表|有哪些|查看|状态/.test(text)) {
    return { tool: "list_assets", args: {}, reply: "" };
  }
  if (/镜头|分镜/.test(text)) {
    return { tool: "list_shots", args: {}, reply: "" };
  }
  if (/视频/.test(text)) {
    return { tool: "generate_video", args: hasShot(), reply: "生成该镜头视频。" };
  }
  return undefined;
}

function history(ctx: ToolContext): { role: "user" | "assistant"; content: string }[] {
  return ctx.state.messages
    .filter((m) => m.role === "user" || m.role === "agent")
    .slice(-8)
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
}

export async function runAgentChat(
  text: string,
  ctx: ToolContext,
  textModel: TextModel,
): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  ctx.actions.say(clean, "user");

  const model = textModel as TextModel & {
    chatWithTools?: (
      system: string,
      messages: { role: string; content: string }[],
      tools: unknown[],
    ) => Promise<{ content?: string; toolCalls?: { name: string; args: Record<string, unknown> }[] }>;
  };

  if (textModel.available && typeof model.chatWithTools === "function") {
    try {
      const res = await model.chatWithTools(systemPrompt(ctx.state), history(ctx), toolsAsJson());
      if (res.toolCalls && res.toolCalls.length > 0) {
        if (res.content) ctx.actions.say(res.content, "agent");
        for (const call of res.toolCalls) {
          const result = await executeTool(call.name, call.args ?? {}, ctx);
          ctx.actions.say(result, "tool");
        }
        return;
      }
      if (res.content) {
        ctx.actions.say(res.content, "agent");
        return;
      }
    } catch {
      // fall through to deterministic routing
    }
  }

  const decision = routeIntent(clean, ctx);
  if (decision?.tool) {
    if (decision.reply) ctx.actions.say(decision.reply, "agent");
    const result = await executeTool(decision.tool, decision.args ?? {}, ctx);
    ctx.actions.say(result, "tool");
    return;
  }
  if (decision?.reply) {
    ctx.actions.say(decision.reply, "agent");
    return;
  }
  ctx.actions.say(
    "我可以帮你：生图（关键帧）、生视频、剪辑合成、数字资产管理。例如：『生成全部镜头』『把第 2 个镜头重新生成』『合成成片』『列出已弃用的资产』。",
    "agent",
  );
}
