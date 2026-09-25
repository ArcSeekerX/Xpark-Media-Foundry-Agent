import { useEffect, useState } from "react";
import type { Asset, Shot } from "../types";

export function PromptEditor({
  shot,
  asset,
  onSave,
}: {
  shot?: Shot;
  asset?: Asset;
  onSave: (shotId: string, positive: string, negative: string) => void;
}) {
  const [positive, setPositive] = useState("");
  const [negative, setNegative] = useState("");

  useEffect(() => {
    setPositive(shot?.prompt ?? "");
    setNegative(shot?.negativePrompt ?? "");
  }, [shot?.shotId, shot?.prompt, shot?.negativePrompt]);

  if (!shot) {
    return <p className="muted">选择左侧一个镜头以查看/编辑提示词与镜头规格。</p>;
  }

  const url = asset?.metadata?.remoteUrl as string | undefined;

  return (
    <div>
      <div className="thumb">
        {asset?.mediaType === "video" && url ? (
          <video src={url} controls muted />
        ) : asset?.mediaType === "image" && url ? (
          <img src={url} alt="candidate" />
        ) : (
          <span>候选预览（渲染完成后显示）</span>
        )}
      </div>

      <div className="row" style={{ gap: 6 }}>
        <span className="badge">{shot.spec.camera.size}</span>
        <span className="badge">{shot.spec.camera.movement}</span>
        <span className="badge">{shot.spec.aspectRatio}</span>
        <span className="badge">{shot.spec.durationS}s</span>
        {shot.skillId && <span className="chip skill">{shot.skillId}</span>}
      </div>

      <p className="muted" style={{ marginTop: 8 }}>
        动作：{shot.spec.action}
      </p>
      <p className="muted">
        验收必需：{shot.spec.acceptance.required.join("、")}｜禁止：
        {shot.spec.acceptance.forbidden.join("、")}｜rubric {shot.spec.acceptance.rubricVersion}
      </p>

      <div className="prompt-edit">
        <label className="field">正向提示词</label>
        <textarea value={positive} onChange={(e) => setPositive(e.target.value)} />
        <label className="field">负向提示词</label>
        <textarea
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
          style={{ minHeight: 48 }}
        />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small primary" onClick={() => onSave(shot.shotId, positive, negative)}>
          保存提示词
        </button>
        <span className="muted">保存后该镜头进入 PROMPT_READY</span>
      </div>
    </div>
  );
}
