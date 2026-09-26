import { useMemo, useRef, useState } from "react";
import type { Asset, DiscardReason, Run, Shot } from "../types";
import { assetUrl } from "./ReferenceAssets";

const DISCARD_REASONS: { value: DiscardReason; label: string }[] = [
  { value: "identity_drift", label: "身份漂移" },
  { value: "action_incomplete", label: "动作不全" },
  { value: "composition_mismatch", label: "构图不符" },
  { value: "flicker", label: "闪烁" },
  { value: "deformation", label: "形变" },
  { value: "audio_issue", label: "音频问题" },
  { value: "other", label: "其他" },
];

type TypeFilter = "all" | "image" | "video" | "derived";
type StatusFilter = "all" | "candidate" | "accepted" | "discarded";

const STATUS_LABEL: Record<string, string> = {
  accepted: "已采用",
  discarded: "已弃用",
  candidate: "候选",
};

function Thumb({ asset }: { asset: Asset }) {
  const url = assetUrl(asset);
  if (asset.mediaType === "video" && url) return <video src={url} muted />;
  if (url) return <img src={url} alt="" />;
  return <span className="asset-placeholder">{asset.mediaType === "video" ? "视频" : "图"}</span>;
}

export function DigitalAssets({
  assets,
  shots,
  runs,
  busy,
  onAccept,
  onDiscard,
  onRestore,
  onRegenerate,
  onSelectShot,
}: {
  assets: Asset[];
  shots: Shot[];
  runs: Run[];
  busy: boolean;
  onAccept: (shotId: string, assetId: string) => void;
  onDiscard: (assetId: string, reason: DiscardReason, note?: string) => void;
  onRestore: (assetId: string) => void;
  onRegenerate: (shotId: string) => void;
  onSelectShot?: (shotId: string) => void;
}) {
  const reasonRef = useRef<HTMLSelectElement>(null);
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const shotTitle = useMemo(() => {
    const map = new Map<string, string>();
    shots.forEach((s) => map.set(s.shotId, s.title));
    return map;
  }, [shots]);

  const scoreOf = (asset: Asset): number | undefined => {
    const runId = typeof asset.metadata.runId === "string" ? asset.metadata.runId : undefined;
    const run = runId ? runs.find((r) => r.runId === runId) : undefined;
    const scores = run?.score?.scores;
    if (!scores) return undefined;
    const vals = Object.values(scores);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
  };

  const summary = useMemo(
    () => ({
      total: assets.length,
      imported: assets.filter((a) => a.source === "imported").length,
      generated: assets.filter((a) => a.source === "generated").length,
      accepted: assets.filter((a) => a.status === "accepted").length,
      discarded: assets.filter((a) => a.status === "discarded").length,
      finals: assets.filter((a) => a.mediaType === "video" && a.source === "derived").length,
    }),
    [assets],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets
      .filter((a) => {
        if (type === "image" && a.mediaType !== "image") return false;
        if (type === "video" && a.mediaType !== "video") return false;
        if (type === "derived" && a.source !== "derived") return false;
        if (status !== "all" && (a.status ?? "candidate") !== status) return false;
        if (q) {
          const shotId = typeof a.metadata.shotId === "string" ? a.metadata.shotId : "";
          const hay = `${shotTitle.get(shotId) ?? ""} ${a.storageKey} ${a.assetId}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .reverse();
  }, [assets, type, status, query, shotTitle]);

  const chips = [
    ["资产总数", summary.total],
    ["导入", summary.imported],
    ["生成", summary.generated],
    ["已采用", summary.accepted],
    ["已弃用", summary.discarded],
    ["成片", summary.finals],
  ] as const;

  return (
    <div className="dassets">
      <div className="dassets-summary">
        {chips.map(([label, value]) => (
          <div key={label} className="metric">
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="dassets-filters">
        <div className="seg">
          {(["all", "image", "video", "derived"] as TypeFilter[]).map((t) => (
            <button key={t} className={type === t ? "active" : ""} onClick={() => setType(t)}>
              {t === "all" ? "全部" : t === "image" ? "图片" : t === "video" ? "视频" : "成片"}
            </button>
          ))}
        </div>
        <div className="seg">
          {(["all", "candidate", "accepted", "discarded"] as StatusFilter[]).map((s) => (
            <button key={s} className={status === s ? "active" : ""} onClick={() => setStatus(s)}>
              {s === "all" ? "全部状态" : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索镜头 / 存储键…"
          className="settings-input"
          style={{ flex: 1, minWidth: 140 }}
        />
        <select ref={reasonRef} disabled={busy} defaultValue="identity_drift" title="弃用原因">
          {DISCARD_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="asset-empty">暂无数字资产。导入参考图或生成关键帧 / 视频后，会在这里统一管理。</div>
      ) : (
        <div className="dassets-list">
          {filtered.map((asset) => {
            const shotId = typeof asset.metadata.shotId === "string" ? asset.metadata.shotId : "";
            const title = shotId ? (shotTitle.get(shotId) ?? shotId) : asset.storageKey;
            const url = assetUrl(asset);
            const score = scoreOf(asset);
            const isMedia = asset.mediaType === "image" || asset.mediaType === "video";
            return (
              <div key={asset.assetId} className="dassets-row">
                <span className="cand-thumb">
                  <Thumb asset={asset} />
                </span>
                <button
                  className="dassets-main"
                  onClick={() => shotId && onSelectShot?.(shotId)}
                  title={asset.storageKey}
                >
                  <b>{title}</b>
                  <span className="muted">
                    {asset.mediaType} · {asset.source}
                    {score !== undefined ? ` · ${score.toFixed(2)}` : ""}
                  </span>
                </button>
                <span className={`badge ${asset.status === "accepted" ? "green" : asset.status === "discarded" ? "red" : ""}`}>
                  {STATUS_LABEL[asset.status ?? "candidate"]}
                </span>
                <span className="dassets-actions">
                  {url && (
                    <button className="btn small" onClick={() => window.open(url, "_blank", "noopener")}>
                      打开
                    </button>
                  )}
                  {isMedia && asset.status !== "accepted" && shotId && (
                    <button className="btn small green" disabled={busy} onClick={() => onAccept(shotId, asset.assetId)}>
                      采用
                    </button>
                  )}
                  {isMedia && asset.status !== "discarded" && (
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() =>
                        onDiscard(asset.assetId, (reasonRef.current?.value ?? "other") as DiscardReason)
                      }
                    >
                      弃用
                    </button>
                  )}
                  {asset.status === "discarded" && (
                    <button className="btn small" disabled={busy} onClick={() => onRestore(asset.assetId)}>
                      恢复
                    </button>
                  )}
                  {isMedia && shotId && (
                    <button className="btn small" disabled={busy} onClick={() => onRegenerate(shotId)}>
                      重生成
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="muted" style={{ fontSize: 10.5 }}>
        共 {filtered.length} / {assets.length} 项；采用版本参与成片，弃用版本保留在回收站。
      </div>
    </div>
  );
}
