import type { Scene, ShotSpec, Skill } from "../types";

// Scene skills: reusable, versionable production playbooks. A skill bundles a
// prompt template, negative prompt, camera preset, render params and QC rubric
// so the Agent can invoke the right one per scene.

function h3Prompt(opts: {
  subjects: string;
  style: string;
  shot: string;
  dialogue?: string;
  soundscape: string;
}): string {
  const dialogue = opts.dialogue
    ? `\nDuring the motion, the subject clearly says:\n<d>[Chinese] ${opts.dialogue}</d>\n`
    : "";
  return [
    "subject_definitions:",
    opts.subjects,
    "",
    "summary:",
    "Single continuous shot for a short-form vertical drama.",
    "",
    "integrated_multimodal_description:",
    opts.style,
    "",
    "[Shot 1]",
    opts.shot,
    dialogue,
    "overall_soundscape:",
    opts.soundscape,
    "",
    "non_diegetic_music:",
    "None.",
  ].join("\n");
}

function shotLine(spec: ShotSpec): string {
  const cam = spec.camera.movement.replace("_", " ");
  const size = spec.camera.size.replace("_", " ");
  const continuity = spec.continuity
    ? Object.entries(spec.continuity)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
    : "";
  return [
    `${spec.characters.map((c) => `<${c.id}>`).join(", ")} in ${size} framing.`,
    spec.action,
    `Camera: ${cam}.`,
    continuity ? `Continuity: ${continuity}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export const SKILLS: Skill[] = [
  {
    skillId: "anime.park.day",
    name: "夏日公园 · 动漫问候",
    description: "明亮夏日公园，2D 动漫，自然点头问候，稳定镜头。",
    match: { keywords: ["公园", "夏日", "动漫", "问候", "park", "summer"], timeOfDay: "day" },
    promptTemplate: (spec) =>
      h3Prompt({
        subjects:
          "<Subject 1> is the same young anime-style woman defined by the reference images, keeping facial identity, hairstyle and proportions.\n<Subject 2> is a bright summer park with lush green trees and warm daylight.",
        style:
          "Polished 2D anime animation, clean line art, flat cel shading, natural summer daylight, neutral color balance. Avoid cyan cast.",
        shot: `${shotLine(spec)} The subject greets with a small friendly head nod; hair tips and clothing move gently in a light breeze.`,
        dialogue: spec.action,
        soundscape: "Only the natural female voice with faint summer park ambience.",
      }),
    negativePrompt: "extra people, watermark, text, cyan lighting, flicker, deformation",
    cameraPreset: { size: "medium_closeup", movement: "slow_push" },
    params: { steps: 4, sampler: "res_multistep", aspectRatio: "9:16" },
    qcRubric: "anime-identity-v1",
    imageStyle: "2d anime, cel shading, warm daylight",
  },
  {
    skillId: "drama.rooftop.night",
    name: "雨夜天台 · 剧情回望",
    description: "夜晚天台，电影感打光，女主停步回头看向红色信号灯。",
    match: {
      keywords: ["雨夜", "天台", "回头", "红灯", "夜景", "rooftop", "night"],
      timeOfDay: "night",
    },
    promptTemplate: (spec) =>
      h3Prompt({
        subjects:
          "<Subject 1> is the female lead defined by the reference images; keep identity and costume consistent.\n<Subject 2> is a rainy rooftop at night with distant red signal lights and wet reflections.",
        style:
          "Cinematic live-action look, moody night lighting, wet pavement reflections, shallow depth of field, film grain.",
        shot: `${shotLine(spec)} She stops walking, then slowly turns her head to look toward a red signal light. Rain falls steadily.`,
        dialogue: spec.action,
        soundscape: "Steady rain, faint city hum, no music.",
      }),
    negativePrompt: "extra people, watermark, cartoon, overexposure, duplication",
    cameraPreset: { size: "medium_closeup", movement: "slow_push" },
    params: { steps: 4, sampler: "res_multistep", aspectRatio: "9:16" },
    qcRubric: "shortdrama-v1",
    imageStyle: "cinematic, night, rain",
  },
  {
    skillId: "studio.talking.head",
    name: "演播室 · 口播特写",
    description: "干净室内演播室，人物对镜头清晰口播，语音清晰。",
    match: { keywords: ["演播室", "口播", "解说", "对镜头", "studio", "talking"], timeOfDay: "indoor" },
    promptTemplate: (spec) =>
      h3Prompt({
        subjects:
          "<Subject 1> is the presenter defined by the reference images, identity preserved.\n<Subject 2> is a clean neutral indoor studio with soft even lighting.",
        style: "Clean studio portrait, soft even lighting, low background detail.",
        shot: `${shotLine(spec)} The presenter faces the camera and articulates clearly; subtle natural head motion.`,
        dialogue: spec.action,
        soundscape: "Dry studio ambience only.",
      }),
    negativePrompt: "echo, reverb, extra people, watermark, flicker",
    cameraPreset: { size: "closeup", movement: "static" },
    params: { steps: 4, sampler: "res_multistep", aspectRatio: "16:9" },
    qcRubric: "voice-clarity-v1",
    imageStyle: "studio, neutral",
  },
  {
    skillId: "explainer.diagram",
    name: "图解动画 · 顺序浮现",
    description: "文档示意图做成动画解说：锁定镜头，元素按语义顺序逐个浮现。",
    match: { keywords: ["图解", "示意", "文档", "讲解", "流程图", "explainer", "diagram"] },
    promptTemplate: (spec) =>
      h3Prompt({
        subjects:
          "<Picture 1> is a hand-drawn watercolor diagram with title, arrows and labelled blocks.",
        style:
          "Locked-off completely static camera: no zoom, no pan. Preserve layout and text; natural hand-drawn wobble is fine.",
        shot: `${shotLine(spec)} First the title appears, then the arrows draw themselves segment by segment, then the blocks appear one by one from left to right.`,
        dialogue: spec.action,
        soundscape: "Narration only.",
      }),
    negativePrompt: "camera shake, zoom, pan, text morphing, watermark",
    cameraPreset: { size: "wide", movement: "static" },
    params: { steps: 4, sampler: "res_multistep", aspectRatio: "16:9" },
    qcRubric: "diagram-text-v3",
    imageStyle: "diagram, watercolor",
  },
];

export function skillById(id: string | undefined): Skill | undefined {
  return SKILLS.find((s) => s.skillId === id);
}

export function scenesForSkill(skillId: string, scenes: Scene[]): Scene[] {
  return scenes.filter((s) => s.skillIds.includes(skillId));
}
