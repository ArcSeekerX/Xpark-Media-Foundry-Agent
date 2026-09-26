import { useMemo, useState } from "react";
import { useAgentFlow } from "../flow/useAgentFlow";
import { DigitalAssets } from "./DigitalAssets";

export function AssetsView() {
  const flow = useAgentFlow();
  const { state } = flow;
  const [activeShotId, setActiveShotId] = useState<string | undefined>();

  const storage = flow.capabilities?.storage;
  const counts = useMemo(
    () => ({
      images: state.assets.filter((a) => a.mediaType === "image").length,
      videos: state.assets.filter((a) => a.mediaType === "video").length,
      accepted: state.assets.filter((a) => a.status === "accepted").length,
    }),
    [state.assets],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="card">
        <header>
          <h2>数字资产</h2>
          <span className="spacer" style={{ marginLeft: "auto" }} />
          <span className="badge">图片 {counts.images}</span>
          <span className="badge">视频 {counts.videos}</span>
          <span className="badge green">已采用 {counts.accepted}</span>
        </header>
        <div className="body">
          <DigitalAssets
            assets={state.assets}
            shots={state.shots}
            runs={state.runs}
            busy={state.busy}
            onAccept={(shotId, assetId) => flow.acceptCandidate(shotId, assetId)}
            onDiscard={(assetId, reason, note) => flow.discardCandidate(assetId, reason, note)}
            onRestore={(assetId) => flow.restoreCandidate(assetId)}
            onRegenerate={(shotId) => void flow.regenerateShot(shotId)}
            onSelectShot={setActiveShotId}
          />
        </div>
      </section>

      {storage && (
        <section className="card">
          <header>
            <h2>存储路径</h2>
          </header>
          <div className="body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <div>
              <div className="muted">导入素材</div>
              <div className="muted" style={{ fontFamily: "monospace" }}>{storage.imports_dir}</div>
            </div>
            <div>
              <div className="muted">生成产物</div>
              <div className="muted" style={{ fontFamily: "monospace" }}>{storage.generated_dir}</div>
            </div>
            <div>
              <div className="muted">成片导出</div>
              <div className="muted" style={{ fontFamily: "monospace" }}>{storage.exports_dir}</div>
            </div>
          </div>
        </section>
      )}

      {activeShotId && (
        <div className="muted">已选择镜头 {activeShotId}，可在「主 Agent」中查看其进度与产物。</div>
      )}
    </div>
  );
}
