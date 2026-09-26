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

const REGEN_PRESETS = [
  { id: "seed", label: "新种子", seedDelta: 1000 as number | undefined, promptVariant: undefined as number | undefined, steps: undefined as number | undefined },
  { id: "prompt1", label: "提示词变体 1", seedDelta: undefined, promptVariant: 1, steps: undefined },
  { id: "prompt2", label: "提示词变体 2", seedDelta: undefined, promptVariant: 2, steps: undefined },
  { id: "steps", label: "步数 +2", seedDelta: undefined, promptVariant: undefined, steps: 6 },
];

function Thumb({ asset }: { asset: Asset }) {
  const url = assetUrl(asset);
  if (asset.mediaType === "video" && url) return <video src={url} muted />;
  if (url) return <img src={url} alt="" />;
  return <span className="asset-placeholder">{asset.mediaType === "video" ? "视频" : "图"}</span>;
}

export function CandidatePanel({
  shot,
  assets,
  runs,
  busy,
  onAccept,
  onDiscard,
  onRestore,
  onRegenerate,
}: {
  shot: Shot;
  assets: Asset[];
  runs: Run[];
  busy: boolean;
  onAccept: (assetId: string) => void;
  onDiscard: (assetId: string, reason: DiscardReason, note?: string) => void;
  onRestore: (assetId: string) => void;
  onRegenerate: (options?: {
    seedDelta?: number;
    promptVariant?: number;
    steps?: number;
    sampler?: string;
  }) => void;
}) {
  const reasonRef = useRef<HTMLSelectElement>(null);
  const [preset, setPreset] = useState("seed");

  const shotAssets = useMemo(
    () =>
      assets.filter(
        (a) =>
          a.metadata.shotId === shot.shotId &&
          (a.mediaType === "image" || a.mediaType === "video"),
      ),
    [assets, shot.shotId],
  );
  const candidates = shotAssets.filter((a) => a.status !== "discarded");
  const recycled = shotAssets.filter((a) => a.status === "discarded");

  const scoreOf = (asset: Asset): number | undefined => {
    const runId = typeof asset.metadata.runId === "string" ? asset.metadata.runId : undefined;
    const run = runId ? runs.find((r) => r.runId === runId) : undefined;
    const scores = run?.score?.scores;
    if (!scores) return undefined;
    const vals = Object.values(scores);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
  };

  const regen = () => {
    const found = REGEN_PRESETS.find((p) => p.id === preset);
    onRegenerate({
      seedDelta: found?.seedDelta,
      promptVariant: found?.promptVariant,
      steps: found?.steps,
    });
  };

  return (
    <div className="cand-panel">
      <div className="row cand-toolbar">
        <select value={preset} disabled={busy} onChange={(e) => setPreset(e.target.value)} title="重生成变体策略">
          {REGEN_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="btn small primary" disabled={busy} onClick={regen}>
          重新生成
        </button>
        <select ref={reasonRef} disabled={busy} defaultValue="identity_drift" title="弃用原因">
          {DISCARD_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <span className="badge">候选 {candidates.length}</span>
        {recycled.length > 0 && <span className="badge red">回收 {recycled.length}</span>}
      </div>

      {candidates.length === 0 ? (
        <div className="asset-empty">
          尚无候选产物。生成后会出现在这里，可对比、采用、弃用或重新生成。
        </div>
      ) : (
        <div className="cand-grid">
          {candidates.map((asset) => {
            const score = scoreOf(asset);
            return (
              <div
                key={asset.assetId}
                className={`cand-tile ${asset.status === "accepted" ? "accepted" : ""}`}
              >
                <div className="cand-media">
                  <Thumb asset={asset} />
                </div>
                <div className="cand-badges">
                  <span className={`badge ${asset.status === "accepted" ? "green" : ""}`}>
                    {asset.status === "accepted" ? "已采用" : "候选"}
                  </span>
                  {score !== undefined && <span className="badge">{score.toFixed(2)}</span>}
                </div>
                <div className="cand-actions">
                  <button
                    className="btn small green"
                    disabled={busy || asset.status === "accepted"}
                    onClick={() => onAccept(asset.assetId)}
                  >
                    采用
                  </button>
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() =>
                      onDiscard(asset.assetId, (reasonRef.current?.value ?? "other") as DiscardReason)
                    }
                  >
                    弃用
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {recycled.length > 0 && (
        <div className="cand-recycle">
          <div className="field">废图 / 废视频回收站</div>
          {recycled.map((asset) => (
            <div key={asset.assetId} className="cand-row">
              <span className="cand-thumb">
                <Thumb asset={asset} />
              </span>
              <span className="muted">
                {asset.mediaType} · {asset.discard?.reasonTag ?? "other"}
              </span>
              <span className="spacer" />
              <button className="btn small" disabled={busy} onClick={() => onRestore(asset.assetId)}>
                恢复
              </button>
              <button
                className="btn small primary"
                disabled={busy}
                onClick={() => {
                  onRestore(asset.assetId);
                  onRegenerate({ seedDelta: 1000 });
                }}
              >
                重生成
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
