// Offline smoke test for the agent planner + skill router (no browser, no GPU).
// Run: npm run smoke:plan
import { planFromMaterials, planProject, splitScript } from "../src/agent/planner";
import { routeSkills } from "../src/skills/router";
import type { ProductionParams } from "../src/types";

const cases = [
  "做一个雨夜天台短剧：女主停步回头看向红色信号灯，5 秒",
  "夏日公园里动漫少女微笑挥手打招呼，两镜头",
  "把这张手绘流程图做成 5 秒图解动画，元素按顺序浮现",
  "演播室口播特写：讲师强调关键结论",
];

let failures = 0;
for (const sentence of cases) {
  const plan = planProject(sentence, "proj_smoke");
  const top = routeSkills(sentence)[0];
  const ok = plan.scenes.length >= 1 && plan.shots.length >= 1 && top.score > 0;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"} | scenes=${plan.scenes.length} shots=${plan.shots.length} ` +
      `skill=${top.skill.skillId} score=${top.score} | ${sentence}`,
  );
  for (const shot of plan.shots) {
    console.log(`   - ${shot.title} [${shot.skillId}] ${shot.spec.action.slice(0, 40)}…`);
  }
}

// One-click production: markdown + images -> storyboard with bound first frames.
const params: ProductionParams = {
  aspectRatio: "9:16",
  frames: 22,
  steps: 4,
  sampler: "res_multistep",
  seed: 20260926,
  style: "cinematic",
  narrate: true,
  maxShots: 6,
  autoCompose: true,
};
const script = `# 雨夜来信
## 开场
女主角推门走上雨夜天台。
## 转折
她停下脚步，缓缓回头。
## 结尾
她握紧手机，眼神坚定。`;
const segments = splitScript(script);
const materialPlan = planFromMaterials(
  { title: "雨夜来信", script, imageCount: 3, params },
  "proj_smoke",
);
const materialOk =
  segments.length === 3 &&
  materialPlan.shots.length === 3 &&
  materialPlan.shots.every((s) => s.spec.aspectRatio === "9:16" && s.spec.durationS > 0);
if (!materialOk) failures += 1;
console.log(
  `${materialOk ? "PASS" : "FAIL"} | materials segments=${segments.length} ` +
    `shots=${materialPlan.shots.length} aspect=${materialPlan.brief.aspectRatio}`,
);
for (const shot of materialPlan.shots) {
  console.log(`   - ${shot.title}: ${shot.spec.action}`);
}

if (failures > 0) {
  console.error(`${failures} case(s) failed`);
  process.exit(1);
}
console.log("all plan smoke cases passed");
