import type { Scene, ShotSpec, Skill, SkillSelection } from "../types";
import { SKILLS } from "./registry";

// Intelligent skill routing: score every skill against the scene text and
// metadata, then return ranked candidates. Rules stay deterministic; an LLM
// (DecisionPort) can re-rank the top candidates when available.

function norm(s: string): string {
  return s.toLowerCase();
}

export function scoreSkill(skill: Skill, text: string, timeOfDay?: Scene["timeOfDay"]): SkillSelection {
  const hay = norm(text);
  const reasons: string[] = [];
  let score = 0;
  for (const kw of skill.match.keywords) {
    if (hay.includes(norm(kw))) {
      score += 2;
      reasons.push(`关键词命中「${kw}」`);
    }
  }
  if (timeOfDay && skill.match.timeOfDay) {
    if (skill.match.timeOfDay === timeOfDay) {
      score += 1.5;
      reasons.push(`时段匹配 ${timeOfDay}`);
    } else {
      score -= 0.5;
    }
  }
  return { skill, score, reasons };
}

export function routeSkills(
  text: string,
  timeOfDay?: Scene["timeOfDay"],
  limit = 3,
): SkillSelection[] {
  return SKILLS.map((s) => scoreSkill(s, text, timeOfDay))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function bestSkill(text: string, timeOfDay?: Scene["timeOfDay"]): SkillSelection {
  return routeSkills(text, timeOfDay, 1)[0];
}

export interface SkillApplication {
  spec: ShotSpec;
  params: Skill["params"];
  prompt: string;
  negativePrompt: string;
  qcRubric: string;
}

export function applySkill(spec: ShotSpec, skill: Skill): SkillApplication {
  const merged: ShotSpec = {
    ...spec,
    camera: { ...spec.camera, ...skill.cameraPreset },
  };
  return {
    spec: merged,
    params: skill.params,
    prompt: skill.promptTemplate(merged),
    negativePrompt: skill.negativePrompt,
    qcRubric: skill.qcRubric,
  };
}

export function inferTimeOfDay(text: string): Scene["timeOfDay"] {
  if (/夜|晚|night|雨夜|凌晨/.test(text)) return "night";
  if (/黄昏|傍晚|dusk|日落/.test(text)) return "dusk";
  if (/清晨|黎明|dawn/.test(text)) return "dawn";
  if (/室内|演播|客厅|studio|indoor/.test(text)) return "indoor";
  return "day";
}
