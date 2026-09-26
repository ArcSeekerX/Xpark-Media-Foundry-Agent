import { useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_SETTINGS, useSettings } from "../settings";
import type { AppSettings } from "../settings";

const inputCls = "settings-input";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field-wrap">
      <span className="field">
        {label}
        {hint ? ` · ${hint}` : ""}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="row" style={{ gap: 6, fontSize: 12 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function SettingsView() {
  const { settings, update, reset } = useSettings();
  const [test, setTest] = useState<Record<string, string>>({});
  const [syncMsg, setSyncMsg] = useState<string>();

  const setText = (patch: Partial<AppSettings["textModel"]>) =>
    update({ textModel: { ...settings.textModel, ...patch } });
  const setDecision = (patch: Partial<AppSettings["decision"]>) =>
    update({ decision: { ...settings.decision, ...patch } });
  const setImage = (patch: Partial<AppSettings["image"]>) =>
    update({ image: { ...settings.image, ...patch } });
  const setVideo = (patch: Partial<AppSettings["video"]>) =>
    update({ video: { ...settings.video, ...patch } });
  const setQuality = (patch: Partial<AppSettings["quality"]>) =>
    update({ quality: { ...settings.quality, ...patch } });
  const setRouting = (patch: Partial<AppSettings["routing"]>) =>
    update({ routing: { ...settings.routing, ...patch } });
  const setStorage = (patch: Partial<AppSettings["storage"]>) =>
    update({ storage: { ...settings.storage, ...patch } });

  const runTest = async () => {
    const results: Record<string, string> = {};
    const base = settings.backendUrl || "/api";
    try {
      results.backend = (await fetch(`${base}/health`)).ok ? "ok" : "fail";
    } catch {
      results.backend = "fail";
    }
    try {
      results.comfy = (await fetch(`${settings.comfyUrl}/system_stats`)).ok ? "ok" : "fail";
    } catch {
      results.comfy = "fail";
    }
    results.text = settings.textModel.baseUrl ? "已配置" : "未配置";
    results.decision = settings.decision.url ? "已配置" : "未配置";
    setTest(results);
  };

  const syncStorage = async () => {
    const base = settings.backendUrl || "/api";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.backendToken) headers.Authorization = `Bearer ${settings.backendToken}`;
    try {
      const r = await fetch(`${base}/settings`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          imports_dir: settings.storage.importsDir,
          generated_dir: settings.storage.generatedDir,
          exports_dir: settings.storage.exportsDir,
        }),
      });
      setSyncMsg(r.ok ? "已同步到后端" : `同步失败 HTTP ${r.status}`);
    } catch {
      setSyncMsg("同步失败：后端不可达");
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="badge">模式 {settings.mode}</span>
        <span className="badge">后端 {settings.backendUrl || "未配置"}</span>
        <span className="spacer" />
        <button className="btn small" onClick={() => void runTest()}>
          测试连接
        </button>
        <button className="btn small" onClick={() => reset()}>
          重置默认
        </button>
      </div>

      {Object.keys(test).length > 0 && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {Object.entries(test).map(([k, v]) => (
            <span key={k} className={`badge ${v === "ok" || v === "已配置" ? "green" : "amber"}`}>
              {k}: {v}
            </span>
          ))}
        </div>
      )}

      <div className="settings-grid">
        <section className="card">
          <header>
            <h2>运行模式与接口</h2>
          </header>
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="运行模式">
              <select
                className={inputCls}
                value={settings.mode}
                onChange={(e) => update({ mode: e.target.value as AppSettings["mode"] })}
              >
                <option value="mock">mock 演示</option>
                <option value="live">live 真实</option>
              </select>
            </Field>
            <Field label="业务后端地址">
              <input
                className={inputCls}
                value={settings.backendUrl}
                onChange={(e) => update({ backendUrl: e.target.value })}
              />
            </Field>
            <Field label="后端 Token">
              <input
                className={inputCls}
                type="password"
                value={settings.backendToken}
                onChange={(e) => update({ backendToken: e.target.value })}
              />
            </Field>
            <Field label="ComfyUI 地址">
              <input
                className={inputCls}
                value={settings.comfyUrl}
                onChange={(e) => update({ comfyUrl: e.target.value })}
              />
            </Field>
            <div className="row" style={{ gap: 18 }}>
              <Toggle label="SSE 事件流" checked={settings.sse} onChange={(v) => update({ sse: v })} />
              <Toggle
                label="本地持久化"
                checked={settings.persist}
                onChange={(v) => update({ persist: v })}
              />
            </div>
          </div>
        </section>

        <section className="card">
          <header>
            <h2>文本与决策模型</h2>
          </header>
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="文本模型地址" hint="OpenAI 兼容">
              <input
                className={inputCls}
                value={settings.textModel.baseUrl}
                onChange={(e) => setText({ baseUrl: e.target.value })}
              />
            </Field>
            <Field label="文本模型名">
              <input
                className={inputCls}
                value={settings.textModel.model}
                onChange={(e) => setText({ model: e.target.value })}
              />
            </Field>
            <Field label="API Key">
              <input
                className={inputCls}
                type="password"
                value={settings.textModel.apiKey}
                onChange={(e) => setText({ apiKey: e.target.value })}
              />
            </Field>
            <Field label="决策引擎">
              <select
                className={inputCls}
                value={settings.decision.engine}
                onChange={(e) =>
                  setDecision({ engine: e.target.value as AppSettings["decision"]["engine"] })
                }
              >
                <option value="mock">mock</option>
                <option value="laya">Laya</option>
                <option value="jev">Jev</option>
              </select>
            </Field>
            <Field label="决策端口地址">
              <input
                className={inputCls}
                value={settings.decision.url}
                onChange={(e) => setDecision({ url: e.target.value })}
              />
            </Field>
          </div>
        </section>

        <section className="card">
          <header>
            <h2>生图默认参数</h2>
          </header>
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Toggle
              label="启用生图步骤"
              checked={settings.image.enabled}
              onChange={(v) => setImage({ enabled: v })}
            />
            <Field label="生图工作流 (API JSON)">
              <input
                className={inputCls}
                value={settings.image.workflowUrl}
                onChange={(e) => setImage({ workflowUrl: e.target.value })}
              />
            </Field>
            <div className="param-grid">
              <Field label="宽">
                <input
                  className={inputCls}
                  type="number"
                  value={settings.image.width}
                  onChange={(e) => setImage({ width: Number(e.target.value) })}
                />
              </Field>
              <Field label="高">
                <input
                  className={inputCls}
                  type="number"
                  value={settings.image.height}
                  onChange={(e) => setImage({ height: Number(e.target.value) })}
                />
              </Field>
              <Field label="步数">
                <input
                  className={inputCls}
                  type="number"
                  value={settings.image.steps}
                  onChange={(e) => setImage({ steps: Number(e.target.value) })}
                />
              </Field>
              <Field label="采样器">
                <input
                  className={inputCls}
                  value={settings.image.sampler}
                  onChange={(e) => setImage({ sampler: e.target.value })}
                />
              </Field>
              <Field label="CFG">
                <input
                  className={inputCls}
                  type="number"
                  value={settings.image.cfg}
                  onChange={(e) => setImage({ cfg: Number(e.target.value) })}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="card">
          <header>
            <h2>生视频默认参数</h2>
          </header>
          <div className="body param-grid">
            <Field label="宽">
              <input
                className={inputCls}
                type="number"
                value={settings.video.width}
                onChange={(e) => setVideo({ width: Number(e.target.value) })}
              />
            </Field>
            <Field label="高">
              <input
                className={inputCls}
                type="number"
                value={settings.video.height}
                onChange={(e) => setVideo({ height: Number(e.target.value) })}
              />
            </Field>
            <Field label="帧数">
              <input
                className={inputCls}
                type="number"
                value={settings.video.length}
                onChange={(e) => setVideo({ length: Number(e.target.value) })}
              />
            </Field>
            <Field label="步数">
              <input
                className={inputCls}
                type="number"
                value={settings.video.steps}
                onChange={(e) => setVideo({ steps: Number(e.target.value) })}
              />
            </Field>
            <Field label="采样器">
              <input
                className={inputCls}
                value={settings.video.sampler}
                onChange={(e) => setVideo({ sampler: e.target.value })}
              />
            </Field>
          </div>
        </section>

        <section className="card">
          <header>
            <h2>质检与路由</h2>
          </header>
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="param-grid">
              <Field label="验收阈值">
                <input
                  className={inputCls}
                  type="number"
                  step="0.01"
                  value={settings.quality.acceptThreshold}
                  onChange={(e) => setQuality({ acceptThreshold: Number(e.target.value) })}
                />
              </Field>
              <Field label="最大修复次数">
                <input
                  className={inputCls}
                  type="number"
                  value={settings.quality.maxRepairs}
                  onChange={(e) => setQuality({ maxRepairs: Number(e.target.value) })}
                />
              </Field>
              <Field label="路由最小置信度">
                <input
                  className={inputCls}
                  type="number"
                  step="0.05"
                  value={settings.routing.minConfidence}
                  onChange={(e) => setRouting({ minConfidence: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="row" style={{ gap: 18 }}>
              <Toggle
                label="影子模式"
                checked={settings.routing.shadow}
                onChange={(v) => setRouting({ shadow: v })}
              />
              <Toggle
                label="自动采用模型动作"
                checked={settings.routing.auto}
                onChange={(v) => setRouting({ auto: v })}
              />
            </div>
          </div>
        </section>

        <section className="card">
          <header>
            <h2>素材与成片存储路径</h2>
          </header>
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="导入素材目录">
              <input
                className={inputCls}
                value={settings.storage.importsDir}
                onChange={(e) => setStorage({ importsDir: e.target.value })}
              />
            </Field>
            <Field label="生成产物目录">
              <input
                className={inputCls}
                value={settings.storage.generatedDir}
                onChange={(e) => setStorage({ generatedDir: e.target.value })}
              />
            </Field>
            <Field label="成片导出目录">
              <input
                className={inputCls}
                value={settings.storage.exportsDir}
                onChange={(e) => setStorage({ exportsDir: e.target.value })}
              />
            </Field>
            <div className="row">
              <button className="btn small" onClick={() => void syncStorage()}>
                同步存储路径到后端
              </button>
              {syncMsg && <span className="muted">{syncMsg}</span>}
            </div>
            <p className="muted">
              默认 {DEFAULT_SETTINGS.image.width}×{DEFAULT_SETTINGS.image.height} 生图、
              {DEFAULT_SETTINGS.video.length} 帧生视频。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
