import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAgentFlow } from "../flow/useAgentFlow";
import type { ProductionParams } from "../types";
import { assetUrl } from "./ReferenceAssets";

const DEFAULT_PARAMS: ProductionParams = {
  aspectRatio: "9:16",
  frames: 22,
  steps: 4,
  sampler: "res_multistep",
  seed: 20260926,
  style: "cinematic short-form, natural lighting",
  narrate: true,
  maxShots: 6,
  autoCompose: true,
};

const ASPECTS: ProductionParams["aspectRatio"][] = ["9:16", "16:9", "1:1"];
const SAMPLERS = ["res_multistep", "euler", "dpmpp_2m", "lcm"];

const DEMO_SCRIPT = `# 雨夜来信 · 预告
## 开场
女主角推门走上雨夜天台，风衣被风吹起。
## 转折
她停下脚步，缓缓回头，看向远处的红色信号灯。
## 结尾
雨滴落在手机屏幕上，她握紧手机，眼神坚定。`;

function svgImageFile(name: string, label: string, hue: number): File {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},55%,40%)"/>` +
    `<stop offset="1" stop-color="hsl(${(hue + 45) % 360},60%,18%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/>` +
    `<text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="34" text-anchor="middle">${label}</text>` +
    `</svg>`;
  return new File([svg], name, { type: "image/svg+xml" });
}

function FileDrop({
  label,
  accept,
  files,
  onPick,
  onRemove,
}: {
  label: string;
  accept: string;
  files: File[];
  onPick: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop ${over ? "over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onPick(Array.from(e.dataTransfer.files));
      }}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          onPick(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button type="button" className="drop-head" onClick={() => ref.current?.click()}>
        <span>{label}</span>
        <span className="muted">点击或拖拽</span>
      </button>
      {files.length > 0 && (
        <ul className="drop-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span>{f.name}</span>
              <button onClick={() => onRemove(i)} title="移除">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OneClickStudio() {
  const flow = useAgentFlow();
  const { state } = flow;
  const [title, setTitle] = useState("一键出片项目");
  const [mdFiles, setMdFiles] = useState<File[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [params, setParams] = useState<ProductionParams>(DEFAULT_PARAMS);

  const accepted = state.shots.filter((s) => s.phase === "ACCEPTED").length;
  const total = state.shots.length;
  const running = state.busy;
  const progress = total > 0 ? Math.round((accepted / total) * 100) : 0;
  const stageIndex =
    state.finalAsset || state.phase === "composing"
      ? 4
      : state.shots.length > 0
        ? running
          ? accepted > 0
            ? 3
            : 2
          : accepted === total
            ? 3
            : 1
        : 0;
  const latestEvent = state.events.at(-1)?.summary ?? "";

  const shotPreviews = useMemo(
    () =>
      state.shots.map((shot) => {
        const run = [...state.runs].reverse().find((r) => r.shotId === shot.shotId);
        const id = run?.artifactIds.at(-1);
        const asset = id ? state.assets.find((a) => a.assetId === id) : undefined;
        const refId = shot.bindings[0]?.assetId;
        const ref = refId ? state.assets.find((a) => a.assetId === refId) : undefined;
        const step = [...state.steps]
          .reverse()
          .find((st) => st.shotId === shot.shotId && st.state === "running");
        const done = shot.phase === "ACCEPTED";
        const ratio = step?.progress
          ? Math.min(1, step.progress.current / step.progress.total)
          : done
            ? 1
            : shot.phase === "PLANNED"
              ? 0
              : 0.12;
        return {
          shot,
          url: assetUrl(asset) ?? assetUrl(ref),
          mediaType: asset?.mediaType ?? ref?.mediaType,
          ratio,
          running: Boolean(step),
        };
      }),
    [state.shots, state.runs, state.assets, state.steps],
  );

  const finalUrl =
    typeof state.finalAsset?.metadata.remoteUrl === "string"
      ? state.finalAsset.metadata.remoteUrl
      : undefined;

  const set = <K extends keyof ProductionParams>(key: K, value: ProductionParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }));

  const addDemo = () => {
    setTitle("雨夜来信 · 预告");
    setMdFiles([new File([DEMO_SCRIPT], "雨夜来信.md", { type: "text/markdown" })]);
    setImages([
      svgImageFile("shot-01.svg", "雨夜天台", 220),
      svgImageFile("shot-02.svg", "回头", 265),
      svgImageFile("shot-03.svg", "特写", 300),
    ]);
  };

  const run = () => {
    if (running || images.length === 0) return;
    void flow.produceFromMaterials({ title, mdFiles, images, params });
  };

  return (
    <div className="layout" style={{ marginTop: 16 }}>
      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section className="card">
          <header>
            <h2>一键出片 · 素材</h2>
            <span className="spacer" style={{ marginLeft: "auto" }} />
            <button className="btn small" disabled={running} onClick={addDemo}>
              载入示例素材
            </button>
          </header>
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="项目标题"
              style={{
                width: "100%",
                border: "1px solid var(--line)",
                borderRadius: 9,
                padding: "8px 10px",
              }}
            />
            <FileDrop
              label="文本素材（.md / .txt）"
              accept=".md,.markdown,.txt,text/*"
              files={mdFiles}
              onPick={(f) => setMdFiles((p) => [...p, ...f])}
              onRemove={(i) => setMdFiles((p) => p.filter((_, idx) => idx !== i))}
            />
            <FileDrop
              label="图片素材（按顺序对应镜头）"
              accept="image/*"
              files={images}
              onPick={(f) =>
                setImages((p) => [...p, ...f.filter((x) => x.type.startsWith("image/"))])
              }
              onRemove={(i) => setImages((p) => p.filter((_, idx) => idx !== i))}
            />
          </div>
        </section>

        <section className="card">
          <header>
            <h2>出片参数</h2>
          </header>
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Collapsible title="基础参数" defaultOpen>
              <div>
                <label className="field">画面比例</label>
                <div className="row">
                  {ASPECTS.map((a) => (
                    <button
                      key={a}
                      className={`btn small ${params.aspectRatio === a ? "primary" : ""}`}
                      onClick={() => set("aspectRatio", a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <div className="param-grid">
                <Field label="片段帧数">
                  <input
                    type="number"
                    value={params.frames}
                    min={1}
                    onChange={(e) => set("frames", Number(e.target.value) || 1)}
                  />
                </Field>
                <Field label="最多镜头">
                  <input
                    type="number"
                    value={params.maxShots}
                    min={1}
                    max={24}
                    onChange={(e) => set("maxShots", Number(e.target.value) || 1)}
                  />
                </Field>
              </div>
              <Toggle
                label="自动剪辑成片"
                checked={params.autoCompose}
                onChange={(v) => set("autoCompose", v)}
              />
            </Collapsible>

            <Collapsible title="生成参数" defaultOpen>
              <div className="param-grid">
                <Field label="采样步数">
                  <input
                    type="number"
                    value={params.steps}
                    min={1}
                    onChange={(e) => set("steps", Number(e.target.value) || 1)}
                  />
                </Field>
                <Field label="采样器">
                  <select value={params.sampler} onChange={(e) => set("sampler", e.target.value)}>
                    {SAMPLERS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="随机种子">
                  <input
                    type="number"
                    value={params.seed}
                    onChange={(e) => set("seed", Number(e.target.value) || 0)}
                  />
                </Field>
              </div>
              <Field label="风格描述">
                <textarea
                  value={params.style}
                  onChange={(e) => set("style", e.target.value)}
                  style={{ minHeight: 52 }}
                />
              </Field>
              <Toggle label="生成旁白" checked={params.narrate} onChange={(v) => set("narrate", v)} />
            </Collapsible>

            <button className="btn primary" disabled={running || images.length === 0} onClick={run}>
              {running ? "正在一键出片…" : "一键出片"}
            </button>
            {images.length === 0 && (
              <span className="muted">至少导入一张图片素材；可点「载入示例素材」快速体验。</span>
            )}
          </div>
        </section>
      </div>

      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section className="card">
          <header>
            <h2>阶段进度</h2>
            <span className="spacer" style={{ marginLeft: "auto" }} />
            <span className={`badge ${running ? "green" : ""}`}>
              {running ? "执行中" : state.finalAsset ? "已完成" : "待开始"}
            </span>
          </header>
          <div className="body">
            <StageProgress
              stageIndex={stageIndex}
              progress={progress}
              running={running}
              message={latestEvent}
            />
          </div>
        </section>

        <section className="card">
          <header>
            <h2>出片进度</h2>
            <span className="spacer" style={{ marginLeft: "auto" }} />
            <span className="badge">已验收 {accepted}/{total}</span>
          </header>
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="progressbar">
              <i style={{ width: `${progress}%` }} />
            </div>
            <div className="preview-frame">
              {finalUrl ? (
                <video key={finalUrl} src={finalUrl} controls muted />
              ) : (
                <span className="preview-note">
                  成片将在这里播放：材料 → 分镜 → 逐镜生成 → 质检 → 自动剪辑
                </span>
              )}
              {state.finalAsset && (
                <div className="preview-tags">
                  <span className="badge green">成片</span>
                  <span className="badge">{String(state.finalAsset.metadata.shots ?? 0)} 镜头</span>
                </div>
              )}
            </div>
            {state.finalAsset && (
              <div className="muted">
                成片：{state.finalAsset.storageKey}
                {finalUrl && (
                  <>
                    {" · "}
                    <a href={finalUrl} target="_blank" rel="noreferrer">
                      打开
                    </a>
                  </>
                )}
              </div>
            )}
            {state.archive && (
              <div className="muted">
                归档：{state.archive.manifestKey}（{state.archive.assetIds.length} 个资产）
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <header>
            <h2>镜头列表</h2>
          </header>
          <div className="body">
            {shotPreviews.length === 0 && (
              <p className="muted">
                还没有镜头。导入素材并点击「一键出片」后，这里会显示每个镜头的生成状态。
              </p>
            )}
            {shotPreviews.map(({ shot, url, mediaType, ratio, running: shotRunning }, i) => (
              <div key={shot.shotId} className="studio-shot">
                <span className="studio-index">{i + 1}</span>
                <span className="studio-thumb">
                  {url && mediaType === "video" ? (
                    <video src={url} muted />
                  ) : url ? (
                    <img src={url} alt="" />
                  ) : null}
                </span>
                <span className="studio-info">
                  <b>
                    {shot.title}
                    {shotRunning ? " ·" : ""}
                  </b>
                  <span className="muted">{shot.spec.action}</span>
                  <span className="shot-progress">
                    <i
                      className={shotRunning ? "running" : ""}
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </span>
                </span>
                <span className={`phase ${shot.phase.toLowerCase()}`}>{shot.phase}</span>
                {shot.phase !== "ACCEPTED" && (
                  <button
                    className="btn small"
                    disabled={running}
                    onClick={() => void flow.generateShot(shot.shotId)}
                  >
                    重试
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <header>
            <h2>事件流</h2>
          </header>
          <div className="body">
            <div className="events">
              {state.events.length === 0 && <p className="muted">事件流为空。</p>}
              {state.events
                .slice(-60)
                .reverse()
                .map((e) => (
                  <div key={e.eventId}>
                    <span className="t">#{e.seq}</span> <b>{e.type}</b> {e.summary}
                  </div>
                ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Collapsible({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible ${open ? "open" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)}>
        {title}
        <span className="chev">▾</span>
      </button>
      <div className="collapsible-body">
        <div>
          <div className="collapsible-inner">{children}</div>
        </div>
      </div>
    </div>
  );
}

const STAGES = ["素材解析", "分镜编排", "逐镜生成", "质检修复", "剪辑成片"];

function StageProgress({
  stageIndex,
  progress,
  running,
  message,
}: {
  stageIndex: number;
  progress: number;
  running: boolean;
  message: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="stage-row">
        {STAGES.map((stage, i) => {
          const done = i < stageIndex;
          const active = i === stageIndex;
          return (
            <div key={stage} style={{ display: "flex", alignItems: "flex-start", flex: i < STAGES.length - 1 ? 1 : undefined }}>
              <span className="stage">
                <span className={`stage-dot ${done ? "done" : active ? "active" : ""}`}>
                  {done ? "✓" : i + 1}
                </span>
                <span className={`stage-name ${active ? "active" : ""}`}>{stage}</span>
              </span>
              {i < STAGES.length - 1 && (
                <span className="stage-link">
                  <i style={{ width: done ? "100%" : active ? "50%" : "0%" }} />
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="progressbar">
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="muted" style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 16 }}>
        {running && <span className="dot running" />}
        {message || "等待开始…"}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field-wrap">
      <span className="field">{label}</span>
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
