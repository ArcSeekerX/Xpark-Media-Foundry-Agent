// Foundry skills exposed to the Agent chat as callable tools. The system
// prompt describes the pipeline; each tool wraps a real flow action so the
// chat can generate images/videos, compose cuts and manage digital assets.
import type { State } from "../flow/store";
import type { Asset, DiscardReason } from "../types";

export interface ToolActions {
  guide: (sentence: string) => Promise<void>;
  generateImage: (shotId: string) => Promise<Asset | undefined>;
  generateShot: (shotId: string) => Promise<void>;
  generateAll: () => Promise<void>;
  regenerateShot: (
    shotId: string,
    options?: { seedDelta?: number; promptVariant?: number; steps?: number; sampler?: string },
  ) => Promise<void>;
  acceptCandidate: (shotId: string, assetId: string) => void;
  discardCandidate: (assetId: string, reason: DiscardReason, note?: string) => void;
  restoreCandidate: (assetId: string) => void;
  compose: (options?: { allowPartial?: boolean }) => Promise<void>;
  archive: () => Promise<void>;
  say: (text: string, role?: "user" | "agent" | "tool" | "decision") => void;
}

export interface ToolContext {
  state: State;
  // Optional live snapshot provider so tool results reflect post-action state.
  getState?: () => State;
  actions: ToolActions;
}

export interface ToolParam {
  type: "string" | "number" | "boolean";
  description: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, ToolParam>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function resolveShot(ctx: ToolContext, args: Record<string, unknown>) {
  const id = str(args, "shot_id");
  if (id) return ctx.state.shots.find((s) => s.shotId === id);
  const index = num(args, "shot_index");
  if (index !== undefined) return ctx.state.shots[index - 1] ?? ctx.state.shots[index];
  return ctx.state.shots.find((s) => s.phase !== "ACCEPTED") ?? ctx.state.shots[0];
}

function summarizeAssets(state: State, type?: string, status?: string): string {
  const list = state.assets.filter((a) => {
    if (type && a.mediaType !== type && a.source !== type) return false;
    if (status && (a.status ?? "candidate") !== status) return false;
    return true;
  });
  if (list.length === 0) return "没有匹配的数字资产。";
  const byStatus = list.reduce<Record<string, number>>((acc, a) => {
    const k = a.status ?? "candidate";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const lines = list
    .slice(-20)
    .map((a) => `- ${a.assetId} · ${a.mediaType} · ${a.source} · ${a.status ?? "candidate"} · ${a.storageKey}`);
  return `共 ${list.length} 项（${Object.entries(byStatus).map(([k, v]) => `${k}:${v}`).join(" ")}）：\n${lines.join("\n")}`;
}

export const FOUNDRY_TOOLS: AgentTool[] = [
  {
    name: "plan_video",
    description: "根据一句话需求生成项目、场景、分镜与提示词（智能引导）。",
    parameters: { sentence: { type: "string", description: "一句话需求" } },
    run: async (args, ctx) => {
      const sentence = str(args, "sentence");
      if (!sentence) return "缺少 sentence。";
      await ctx.actions.guide(sentence);
      return `已规划 ${ctx.state.scenes.length} 个场景 / ${ctx.state.shots.length} 个镜头。`;
    },
  },
  {
    name: "list_shots",
    description: "列出当前项目的镜头、阶段与已采用状态。",
    parameters: {},
    run: async (_args, ctx) => {
      if (ctx.state.shots.length === 0) return "当前没有镜头，请先用 plan_video 规划。";
      return ctx.state.shots
        .map((s, i) => `${i + 1}. ${s.title} [${s.phase}] ${s.spec.action.slice(0, 30)}`)
        .join("\n");
    },
  },
  {
    name: "generate_keyframe",
    description: "为某个镜头生成关键帧图像（文生图，Qwen Image）。",
    parameters: {
      shot_id: { type: "string", description: "镜头 ID（可选）" },
      shot_index: { type: "number", description: "镜头序号，从 1 开始（可选）" },
    },
    run: async (args, ctx) => {
      const shot = resolveShot(ctx, args);
      if (!shot) return "没有可用镜头。";
      const asset = await ctx.actions.generateImage(shot.shotId);
      return asset ? `已为「${shot.title}」生成关键帧 ${asset.assetId}。` : `关键帧生成失败或未启用。`;
    },
  },
  {
    name: "generate_video",
    description: "为某个镜头生成视频（MiniMax H3，含质检与修复）。",
    parameters: {
      shot_id: { type: "string", description: "镜头 ID（可选）" },
      shot_index: { type: "number", description: "镜头序号，从 1 开始（可选）" },
    },
    run: async (args, ctx) => {
      const shot = resolveShot(ctx, args);
      if (!shot) return "没有可用镜头。";
      await ctx.actions.generateShot(shot.shotId);
      const after = ctx.state.shots.find((s) => s.shotId === shot.shotId);
      return `镜头「${shot.title}」生成完成，当前阶段 ${after?.phase ?? "?"}。`;
    },
  },
  {
    name: "generate_all",
    description: "一键生产全部镜头（逐镜生图/生视频、质检、修复）。",
    parameters: {},
    run: async (_args, ctx) => {
      await ctx.actions.generateAll();
      return `已完成全部镜头生产。`;
    },
  },
  {
    name: "regenerate_shot",
    description: "重新生成某个镜头（新种子 / 提示词变体）。",
    parameters: {
      shot_id: { type: "string", description: "镜头 ID（可选）" },
      shot_index: { type: "number", description: "镜头序号（可选）" },
      seed_delta: { type: "number", description: "种子增量（可选）" },
      prompt_variant: { type: "number", description: "提示词变体序号（可选）" },
    },
    run: async (args, ctx) => {
      const shot = resolveShot(ctx, args);
      if (!shot) return "没有可用镜头。";
      await ctx.actions.regenerateShot(shot.shotId, {
        seedDelta: num(args, "seed_delta"),
        promptVariant: num(args, "prompt_variant"),
      });
      return `已重新生成「${shot.title}」。`;
    },
  },
  {
    name: "accept_asset",
    description: "采用某个候选资产（进入成片清单）。",
    parameters: {
      asset_id: { type: "string", description: "资产 ID" },
      shot_id: { type: "string", description: "镜头 ID（可选）" },
    },
    run: async (args, ctx) => {
      const assetId = str(args, "asset_id");
      if (!assetId) return "缺少 asset_id。";
      const asset = ctx.state.assets.find((a) => a.assetId === assetId);
      const shotId = str(args, "shot_id") ?? (typeof asset?.metadata.shotId === "string" ? (asset.metadata.shotId as string) : undefined);
      if (!shotId) return "无法确定所属镜头。";
      ctx.actions.acceptCandidate(shotId, assetId);
      return `已采用 ${assetId}。`;
    },
  },
  {
    name: "discard_asset",
    description: "弃用某个资产（进入回收站，不参与成片）。",
    parameters: {
      asset_id: { type: "string", description: "资产 ID" },
      reason: { type: "string", description: "弃用原因标签" },
    },
    run: async (args, ctx) => {
      const assetId = str(args, "asset_id");
      if (!assetId) return "缺少 asset_id。";
      const reason = (str(args, "reason") ?? "other") as DiscardReason;
      ctx.actions.discardCandidate(assetId, reason);
      return `已弃用 ${assetId}（${reason}）。`;
    },
  },
  {
    name: "list_assets",
    description: "列出数字资产（可按类型/状态过滤）。",
    parameters: {
      type: { type: "string", description: "image | video | derived | imported | generated" },
      status: { type: "string", description: "candidate | accepted | discarded" },
    },
    run: async (args, ctx) => summarizeAssets(ctx.state, str(args, "type"), str(args, "status")),
  },
  {
    name: "compose_video",
    description: "剪辑合成成片（仅使用已采用镜头，可允许部分）。",
    parameters: { allow_partial: { type: "boolean", description: "允许部分镜头" } },
    run: async (args, ctx) => {
      const allowPartial = args.allow_partial === true;
      await ctx.actions.compose({ allowPartial });
      const final = ctx.state.finalAsset;
      return final ? `成片已合成：${final.storageKey}` : "尚未生成成片（可能有镜头未验收）。";
    },
  },
  {
    name: "archive_assets",
    description: "归档项目素材与成片清单。",
    parameters: {},
    run: async (_args, ctx) => {
      await ctx.actions.archive();
      return ctx.state.archive ? `已归档：${ctx.state.archive.manifestKey}` : "归档未完成。";
    },
  },
];

export function systemPrompt(state: State): string {
  const accepted = state.shots.filter((s) => s.phase === "ACCEPTED").length;
  const lines = [
    "你是 Xpark Media Foundry 的主 Agent，负责短视频的智能生产与资产管理。",
    "",
    "你的能力（通过工具调用执行，不要凭空承诺）：",
    "- 生图：为镜头生成关键帧图像（Qwen Image 文生图，参考图优先复用导入素材）。",
    "- 生视频：MiniMax H3 参考生视频，含质检与自动修复。",
    "- 剪辑：用 ffmpeg 合成已采用镜头为成片，并归档清单。",
    "- 数字资产：导入/生成/采用/弃用/回收站/重新生成，按类型与状态管理。",
    "- 智能路由：在复用导入、复用片段、图像条件生成、直接生成之间选择。",
    "",
    `当前项目：${state.project?.name ?? "（未创建）"}`,
    `镜头：${state.shots.length} 个，已验收 ${accepted} 个`,
    `资产：${state.assets.length} 个（图片 ${state.assets.filter((a) => a.mediaType === "image").length}，视频 ${state.assets.filter((a) => a.mediaType === "video").length}）`,
    "",
    "回答要求：先简短说明你要做什么，再调用合适的工具；工具返回后给出简洁结果。",
  ];
  return lines.join("\n");
}

export function toolsAsJson(): { name: string; description: string; parameters: unknown }[] {
  return FOUNDRY_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }]),
      ),
      required: [] as string[],
    },
  }));
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const tool = FOUNDRY_TOOLS.find((t) => t.name === name);
  if (!tool) return `未知工具：${name}`;
  if (ctx.getState) ctx.state = ctx.getState();
  try {
    return await tool.run(args ?? {}, ctx);
  } catch (err) {
    return `工具 ${name} 执行失败：${err instanceof Error ? err.message : String(err)}`;
  }
}
