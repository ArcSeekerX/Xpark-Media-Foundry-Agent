// One-sentence guidance -> Brief + Scenes + Shots.
// Deterministic planning keeps the flow usable offline; the text model only
// polishes wording when it is configured (never required for structure).
import type {
  Brief,
  CameraSpec,
  Scene,
  Shot,
  ShotSpec,
  Skill,
  SkillSelection,
} from "../types";
import { applySkill, bestSkill, inferTimeOfDay, routeSkills } from "../skills/router";
import { uid } from "../lib/util";

const BEATS: Record<string, string[]> = {
  "drama.rooftop.night": [
    "女主角推门走上雨夜天台，风衣被风吹起，她放慢脚步",
    "她停下脚步，缓缓回头，看向远处的红色信号灯",
    "特写：雨滴落在她的睫毛与手机屏幕上，她握紧手机，眼神坚定",
  ],
  "anime.park.day": [
    "女主角走进明亮的夏日公园，抬头看向树影间的阳光",
    "她微笑看向镜头，轻轻挥手打招呼",
  ],
  "studio.talking.head": [
    "主播面对镜头，语气平稳地开始讲解主题",
    "特写：主播强调关键结论，轻微点头",
  ],
  "explainer.diagram": [
    "标题文字首先浮现，镜头完全锁定",
    "箭头按顺序逐段绘制出来，随后模块从左到右依次出现",
    "整体图解完整呈现，文字保持清晰不漂移",
  ],
};

function inferShotCount(sentence: string): number {
  if (/多镜头|几个镜头|分镜|多个场景|三幕|storyboard/i.test(sentence)) return 3;
  if (/两(个)?镜头|两幕|两个场景/i.test(sentence)) return 2;
  return BEATS[bestSkill(sentence, inferTimeOfDay(sentence)).skill.skillId]?.length ?? 1;
}

function inferStyle(sentence: string, skill: Skill): string {
  if (/动漫|anime|二次元/.test(sentence)) return "2d-anime";
  if (/电影|cinematic|写实/.test(sentence)) return "cinematic";
  if (/图|示意|文档|讲解/.test(sentence)) return "explainer";
  return skill.imageStyle ?? "cinematic";
}

function inferDuration(sentence: string): number {
  const m = sentence.match(/(\d+(?:\.\d+)?)\s*秒/);
  if (m) return Number(m[1]);
  return 5;
}

export function extractBrief(sentence: string, skill: Skill): Brief {
  return {
    theme: sentence.trim(),
    durationS: inferDuration(sentence),
    style: inferStyle(sentence, skill),
    aspectRatio: skill.params.aspectRatio ?? "9:16",
    audience: "short-form",
  };
}

function defaultCamera(skill: Skill): CameraSpec {
  return {
    size: skill.cameraPreset.size ?? "medium",
    movement: skill.cameraPreset.movement ?? "slow_push",
  };
}

export function buildShot(
  sceneId: string,
  index: number,
  action: string,
  skill: Skill,
): Shot {
  const shotId = uid("shot");
  const baseSpec: ShotSpec = {
    schemaVersion: "2",
    materialPolicy: "prefer_imported",
    productionMode: "generate",
    shotId,
    durationS: 5,
    aspectRatio: skill.params.aspectRatio ?? "9:16",
    characters: [{ id: "hero", assetVersion: 1 }],
    action,
    camera: defaultCamera(skill),
    continuity: {},
    referenceAssets: [],
    acceptance: {
      required: ["主体清晰", "动作完成"],
      forbidden: ["额外人物", "水印"],
      rubricVersion: skill.qcRubric,
    },
  };
  const applied = applySkill(baseSpec, skill);
  return {
    shotId,
    sceneId,
    index,
    title: `镜头 ${index + 1}`,
    spec: applied.spec,
    prompt: applied.prompt,
    negativePrompt: applied.negativePrompt,
    skillId: skill.skillId,
    phase: "PLANNED",
    runIds: [],
    bindings: [],
  };
}

export interface Plan {
  brief: Brief;
  scenes: Scene[];
  shots: Shot[];
  routings: SkillSelection[][];
}

export function planProject(sentence: string, projectId: string): Plan {
  const timeOfDay = inferTimeOfDay(sentence);
  const top = bestSkill(sentence, timeOfDay).skill;
  const brief = extractBrief(sentence, top);

  const sceneCount = /多场景|两个场景|多个场景/.test(sentence) ? 2 : 1;
  const scenes: Scene[] = [];
  const shots: Shot[] = [];
  const routings: SkillSelection[][] = [];

  const ranked = routeSkills(sentence, timeOfDay, 3);

  for (let s = 0; s < sceneCount; s += 1) {
    const sceneId = uid("scene");
    const skill = ranked[Math.min(s, ranked.length - 1)].skill;
    const beats = BEATS[skill.skillId] ?? [sentence];
    const count = Math.min(inferShotCount(sentence), beats.length);
    const sceneShots: Shot[] = [];
    for (let i = 0; i < count; i += 1) {
      const shot = buildShot(sceneId, i, beats[i], skill);
      sceneShots.push(shot);
      shots.push(shot);
    }
    scenes.push({
      sceneId,
      projectId,
      index: s,
      title: s === 0 ? "主场景" : `场景 ${s + 1}`,
      synopsis: sentence,
      location: /天台/.test(sentence) ? "天台" : /公园/.test(sentence) ? "公园" : "室内",
      timeOfDay,
      mood: /雨|夜/.test(sentence) ? "压抑 / 悬疑" : "明亮 / 轻松",
      skillIds: [skill.skillId],
      shotIds: sceneShots.map((x) => x.shotId),
    });
    routings.push(routeSkills(sentence, timeOfDay, 3));
  }

  return { brief, scenes, shots, routings };
}
