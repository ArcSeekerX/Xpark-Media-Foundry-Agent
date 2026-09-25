import type { ArchiveRecord } from "../adapters/types";
import type { Asset, Shot } from "../types";

export function ExportPanel({
  shots,
  finalAsset,
  archive,
  busy,
  onCompose,
  onArchive,
}: {
  shots: Shot[];
  finalAsset?: Asset;
  archive?: ArchiveRecord;
  busy: boolean;
  onCompose: () => void;
  onArchive: () => void;
}) {
  const accepted = shots.filter((s) => s.phase === "ACCEPTED").length;
  const ready = accepted === shots.length && shots.length > 0;

  return (
    <div>
      <div className="row">
        <span className={`badge ${ready ? "green" : "amber"}`}>
          已验收 {accepted}/{shots.length}
        </span>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={busy || !ready} onClick={onCompose}>
          剪辑拼接成片
        </button>
        <button className="btn" disabled={busy || !finalAsset} onClick={onArchive}>
          素材归档
        </button>
      </div>
      {finalAsset && (
        <div style={{ marginTop: 10 }}>
          <div className="muted">成片</div>
          <div>{finalAsset.storageKey}</div>
          {typeof finalAsset.metadata.remoteUrl === "string" && (
            <a href={finalAsset.metadata.remoteUrl} target="_blank" rel="noreferrer">
              打开成片
            </a>
          )}
          <div className="muted">清单：{String(finalAsset.metadata.manifest ?? "-")}</div>
        </div>
      )}
      {archive && (
        <div style={{ marginTop: 10 }}>
          <div className="muted">归档记录</div>
          <div>{archive.manifestKey}</div>
          <div className="muted">
            资产 {archive.assetIds.length} 个 · 约 {(archive.totalBytes / 1048576).toFixed(1)} MB
          </div>
        </div>
      )}
    </div>
  );
}
