import { useRef } from "react";
import type { Asset, AssetBinding, Shot } from "../types";

export const BINDING_ROLES: AssetBinding["role"][] = [
  "character",
  "scene",
  "first_frame",
  "last_frame",
  "reuse_clip",
  "audio",
];

const ROLE_LABEL: Record<AssetBinding["role"], string> = {
  character: "角色",
  scene: "场景",
  first_frame: "首帧",
  last_frame: "尾帧",
  reuse_clip: "复用片段",
  audio: "音频",
};

export function assetUrl(asset: Asset | undefined): string | undefined {
  if (!asset) return undefined;
  const url = asset.metadata.remoteUrl ?? asset.metadata.dataUrl;
  return typeof url === "string" ? url : undefined;
}

function Thumb({ asset }: { asset: Asset | undefined }) {
  const url = assetUrl(asset);
  if (asset?.mediaType === "video" && url) {
    return <video src={url} muted />;
  }
  if (url) return <img src={url} alt="" />;
  return <span className="asset-placeholder">图</span>;
}

export function ReferenceAssets({
  shot,
  assets,
  busy,
  imageReady,
  imageName,
  onImport,
  onBind,
  onUnbind,
  onGenerate,
}: {
  shot: Shot;
  assets: Asset[];
  busy: boolean;
  imageReady: boolean;
  imageName: string;
  onImport: (file: File, role: AssetBinding["role"]) => void;
  onBind: (assetId: string, role: AssetBinding["role"]) => void;
  onUnbind: (bindingId: string) => void;
  onGenerate: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLSelectElement>(null);

  const boundIds = new Set(shot.bindings.map((b) => b.assetId));
  const bound = shot.bindings
    .map((binding) => ({ binding, asset: assets.find((a) => a.assetId === binding.assetId) }))
    .filter((x) => x.asset);
  const available = assets.filter((a) => a.mediaType === "image" && !boundIds.has(a.assetId));
  const currentRole = () =>
    (roleRef.current?.value ?? "character") as AssetBinding["role"];

  return (
    <div className="asset-panel">
      <div className="row asset-toolbar">
        <select ref={roleRef} disabled={busy} defaultValue="character" aria-label="绑定用途">
          {BINDING_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImport(file, currentRole());
            e.target.value = "";
          }}
        />
        <button className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>
          上传参考图
        </button>
        <button
          className="btn small primary"
          disabled={busy || !imageReady}
          title={imageReady ? `调用 ${imageName} 生成关键帧` : "生图适配器未启用"}
          onClick={onGenerate}
        >
          生成关键帧
        </button>
        <span className="spacer" />
        <span className={`badge ${imageReady ? "green" : "amber"}`}>
          生图 {imageReady ? "ready" : "off"}
        </span>
        <span className="badge">已绑定 {bound.length}</span>
      </div>

      {bound.length === 0 ? (
        <div className="asset-empty">
          尚无参考素材。上传角色 / 场景参考图，或直接生成关键帧；生产时优先复用导入素材。
        </div>
      ) : (
        <div className="asset-grid">
          {bound.map(({ binding, asset }) => (
            <div key={binding.bindingId} className="asset-tile">
              <Thumb asset={asset} />
              <div className="asset-tile-tag">
                <span>{ROLE_LABEL[binding.role]}</span>
                <span className={`badge ${asset?.source === "imported" ? "" : "green"}`}>
                  {asset?.source === "imported" ? "导入" : "生成"}
                </span>
              </div>
              <button
                className="asset-del"
                title="解除绑定"
                onClick={() => onUnbind(binding.bindingId)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <div className="asset-lib">
          <span className="field">素材库</span>
          {available.map((asset) => {
            const url = assetUrl(asset);
            return (
              <button
                key={asset.assetId}
                className="asset-chip"
                disabled={busy}
                title="点击绑定到当前镜头"
                onClick={() => onBind(asset.assetId, currentRole())}
              >
                {url ? <img src={url} alt="" /> : <span className="asset-placeholder">图</span>}
                <span className="asset-chip-name">
                  {typeof asset.metadata.name === "string" ? asset.metadata.name : asset.assetId}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
