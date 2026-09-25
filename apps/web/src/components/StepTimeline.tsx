import type { StepRun } from "../types";

export function StepTimeline({ steps }: { steps: StepRun[] }) {
  const ordered = [...steps].reverse();
  if (ordered.length === 0) return <p className="muted">暂无步骤。点击「生成并质检」开始生产。</p>;
  return (
    <ul className="timeline">
      {ordered.map((s) => (
        <li key={s.stepId}>
          <span className={`dot ${s.state}`} />
          <div>
            <div>
              <b>{s.kind}</b> · {s.actor} · <span className="muted">{s.state}</span>
            </div>
            {s.progress && (
              <div>
                <div className="progressbar">
                  <i style={{ width: `${(s.progress.current / s.progress.total) * 100}%` }} />
                </div>
                <span className="muted">
                  {s.progress.unit} {s.progress.current}/{s.progress.total}
                </span>
              </div>
            )}
            {s.summary && <span className="muted">{s.summary}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
