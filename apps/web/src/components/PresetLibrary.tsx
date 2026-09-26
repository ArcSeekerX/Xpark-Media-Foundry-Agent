import { useRef, useState } from "react";
import { usePresets } from "../skills/presets";
import type { PromptPreset } from "../skills/presets";

export function PresetLibrary({
  activeShotId,
  onApply,
}: {
  activeShotId?: string;
  onApply: (preset: PromptPreset) => void;
}) {
  const { presets, importPresets, removeUserPreset, clearUserPresets, exportPresets } = usePresets();
  const [category, setCategory] = useState<PromptPreset["category"]>("character");
  const [msg, setMsg] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = presets.filter((p) => p.category === category);

  const handleImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const { added, skipped } = importPresets(data);
      setMsg(`导入完成：新增 ${added}，跳过 ${skipped}`);
    } catch (e) {
      setMsg(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleExport = () => {
    const blob = new Blob([exportPresets()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prompt-presets.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="preset-lib">
      <div className="row">
        <div className="seg">
          {(["character", "scene"] as const).map((c) => (
            <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>
              {c === "character" ? "角色创作" : "场景提示词"}
            </button>
          ))}
        </div>
        <span className="muted">{shown.length} 个预设</span>
        <span className="spacer" />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImport(f);
            e.target.value = "";
          }}
        />
        <button className="btn small" onClick={() => fileRef.current?.click()}>
          导入
        </button>
        <button className="btn small" onClick={handleExport}>
          导出
        </button>
        <button
          className="btn small"
          onClick={() => {
            clearUserPresets();
            setMsg("已清除自定义预设");
          }}
        >
          清空自定义
        </button>
      </div>

      {msg && <div className="muted">{msg}</div>}

      <div className="preset-grid">
        {shown.map((preset) => {
          const isUser = preset.id.startsWith("user.");
          return (
            <div key={preset.id} className="preset-card">
              <div className="row" style={{ gap: 6 }}>
                <b>{preset.name}</b>
                {preset.validated && <span className="badge green">已验证</span>}
                {isUser && <span className="badge">自定义</span>}
              </div>
              <p className="muted">{preset.description}</p>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <button
                  className="btn small primary"
                  disabled={!activeShotId}
                  title={activeShotId ? "应用到当前镜头" : "请先选择一个镜头"}
                  onClick={() => onApply(preset)}
                >
                  应用
                </button>
                {isUser && (
                  <button className="btn small" onClick={() => removeUserPreset(preset.id)}>
                    删除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 10.5 }}>
        预设会追加到镜头提示词；自定义预设保存在本地，可通过 JSON 导入/导出。
      </div>
    </div>
  );
}
