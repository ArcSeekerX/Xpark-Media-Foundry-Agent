import type { ScoreReport } from "../types";

export function QCPanel({ report }: { report?: ScoreReport }) {
  if (!report) return <p className="muted">尚未质检。每个候选都会生成可追溯的 ScoreReport。</p>;
  const verdictCls =
    report.verdict === "accept" ? "green" : report.verdict === "repair" ? "amber" : "red";
  return (
    <div>
      <div className="row">
        <span className={`badge ${verdictCls}`}>verdict: {report.verdict}</span>
        <span className="muted">rubric {report.rubricVersion}</span>
        {report.uncertain && <span className="badge amber">不确定</span>}
      </div>

      <table style={{ width: "100%", marginTop: 8, fontSize: 13 }}>
        <tbody>
          <tr>
            <td className="muted">身份 identity</td>
            <td>{report.scores.identity?.toFixed(2)}</td>
          </tr>
          <tr>
            <td className="muted">动作 action</td>
            <td>{report.scores.action?.toFixed(2)}</td>
          </tr>
          <tr>
            <td className="muted">时间一致性 temporal</td>
            <td>{report.scores.temporal?.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <div className="row" style={{ marginTop: 6 }}>
        {Object.entries(report.hardChecks).map(([k, v]) => (
          <span key={k} className={`badge ${v ? "green" : "red"}`}>
            {k}: {v ? "通过" : "失败"}
          </span>
        ))}
      </div>

      {report.evidence.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted">失败证据</div>
          {report.evidence.map((e, i) => (
            <div key={i} className="muted">
              · {e.tag}
              {e.timeS ? ` @${e.timeS[0]}–${e.timeS[1]}s` : ""} {e.note ?? ""}
            </div>
          ))}
        </div>
      )}

      {report.repair && (
        <div style={{ marginTop: 8 }}>
          <div className="muted">修复计划</div>
          <div>
            {report.repair.target} → {report.repair.action}（从 {report.repair.invalidateFrom} 起失效）
          </div>
        </div>
      )}
    </div>
  );
}
