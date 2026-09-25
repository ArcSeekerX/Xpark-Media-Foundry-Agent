import type { Run, Shot } from "../types";

const PHASE_LABEL: Record<string, { text: string; cls: string }> = {
  ACCEPTED: { text: "已验收", cls: "green" },
  HUMAN_REVIEW: { text: "待人工复核", cls: "amber" },
  FAILED: { text: "失败", cls: "red" },
  RENDERING: { text: "渲染中", cls: "" },
  SCORING: { text: "质检中", cls: "" },
  REPAIRING: { text: "修复中", cls: "amber" },
  GENERATED: { text: "已生成", cls: "" },
};

export function ShotBoard({
  shots,
  runs,
  activeShotId,
  busy,
  onSelect,
  onGenerate,
  onReview,
}: {
  shots: Shot[];
  runs: Run[];
  activeShotId?: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onGenerate: (id: string) => void;
  onReview: (id: string, v: "accept" | "reject") => void;
}) {
  return (
    <div>
      {shots.map((shot) => {
        const run = [...runs].reverse().find((r) => r.shotId === shot.shotId);
        const badge = PHASE_LABEL[shot.phase];
        return (
          <div
            key={shot.shotId}
            className={`shot ${shot.phase.toLowerCase()}`}
            onClick={() => onSelect(shot.shotId)}
            style={{ cursor: "pointer", outline: activeShotId === shot.shotId ? "2px solid #a8c1e5" : "none" }}
          >
            <div className="meta">
              <span className="shot-title">{shot.title}</span>
              <span className={`badge ${badge?.cls ?? ""}`}>{badge?.text ?? shot.phase}</span>
              {shot.skillId && <span className="chip skill">{shot.skillId}</span>}
              {run?.promptId && <span className="muted">prompt {run.promptId.slice(0, 8)}</span>}
            </div>
            <p className="muted" style={{ margin: "6px 0" }}>
              {shot.spec.action}
            </p>
            <div className="row">
              <button
                className="btn small primary"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  onGenerate(shot.shotId);
                }}
              >
                生成并质检
              </button>
              {shot.phase === "HUMAN_REVIEW" && (
                <>
                  <button
                    className="btn small green"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReview(shot.shotId, "accept");
                    }}
                  >
                    人工接受
                  </button>
                  <button
                    className="btn small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReview(shot.shotId, "reject");
                    }}
                  >
                    退回重做
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
