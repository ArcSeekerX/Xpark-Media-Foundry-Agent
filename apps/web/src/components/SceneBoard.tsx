import { SKILLS } from "../skills/registry";
import type { Run, Scene, Shot } from "../types";
import { ShotBoard } from "./ShotBoard";

export function SceneBoard({
  scenes,
  shots,
  runs,
  activeShotId,
  busy,
  onSelectShot,
  onGenerateShot,
  onReview,
  onChangeSkill,
}: {
  scenes: Scene[];
  shots: Shot[];
  runs: Run[];
  activeShotId?: string;
  busy: boolean;
  onSelectShot: (id: string) => void;
  onGenerateShot: (id: string) => void;
  onReview: (id: string, v: "accept" | "reject") => void;
  onChangeSkill: (sceneId: string, skillId: string) => void;
}) {
  if (scenes.length === 0) {
    return <p className="muted">还没有场景。用一句话描述需求后，Agent 会在这里生成场景与镜头。</p>;
  }
  return (
    <div>
      {scenes.map((scene) => {
        const sceneShots = shots.filter((s) => s.sceneId === scene.sceneId);
        return (
          <div className="scene" key={scene.sceneId}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3>
                {scene.index + 1}. {scene.title}
              </h3>
              <span className="muted">
                {scene.location} · {scene.timeOfDay} · {scene.mood}
              </span>
            </div>
            <p className="muted" style={{ margin: "2px 0 8px" }}>
              {scene.synopsis}
            </p>
            <div className="row">
              <label className="field" style={{ margin: 0 }}>
                场景技能
              </label>
              <select
                value={scene.skillIds[0]}
                onChange={(e) => onChangeSkill(scene.sceneId, e.target.value)}
                disabled={busy}
              >
                {SKILLS.map((s) => (
                  <option key={s.skillId} value={s.skillId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <ShotBoard
              shots={sceneShots}
              runs={runs}
              activeShotId={activeShotId}
              busy={busy}
              onSelect={onSelectShot}
              onGenerate={onGenerateShot}
              onReview={onReview}
            />
          </div>
        );
      })}
    </div>
  );
}
