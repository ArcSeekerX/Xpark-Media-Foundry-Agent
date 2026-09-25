import type { PromptSpec, Scene, Shot, Skill } from "../types";
import type { TextModel } from "../adapters/types";

const SYSTEM = [
  "你是短视频工厂的提示词优化 Agent。",
  "只修改提示词，不改变镜头规格与必需元素。",
  "输出 H3 结构化提示词：subject_definitions / integrated_multimodal_description / [Shot 1] / overall_soundscape / non_diegetic_music。",
  "不要输出解释，只输出提示词正文。",
].join("\n");

export async function refinePrompt(
  textModel: TextModel,
  shot: Shot,
  scene: Scene,
  skill?: Skill,
): Promise<PromptSpec> {
  let positive = shot.prompt;
  if (textModel.available) {
    try {
      const user = [
        `场景：${scene.title}（${scene.location}/${scene.timeOfDay}，氛围 ${scene.mood}）`,
        `镜头动作：${shot.spec.action}`,
        `技能：${skill?.name ?? shot.skillId ?? "无"}`,
        textModel.name === "local-qwen" ? "" : "",
        "请在不删减关键元素的前提下润色以下提示词：",
        shot.prompt,
      ].join("\n");
      const out = await textModel.complete(SYSTEM, user);
      if (out.trim()) positive = out.trim();
    } catch {
      // fall back to the skill template
    }
  }
  return {
    shotId: shot.shotId,
    positive,
    negative: shot.negativePrompt,
    dialogue: shot.spec.action,
    variants: buildVariants(positive),
  };
}

function buildVariants(positive: string): string[] {
  const suffix = [
    "Emphasize stable camera and consistent identity.",
    "Emphasize subtle natural motion and clean background.",
    "Emphasize longer hold at the decisive action beat.",
  ];
  return [positive, ...suffix.map((s) => `${positive}\n${s}`)];
}
