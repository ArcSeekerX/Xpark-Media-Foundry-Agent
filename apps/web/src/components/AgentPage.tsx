import { useEffect, useMemo, useState } from "react";
import { useAgentFlow } from "../flow/useAgentFlow";
import { config } from "../config";
import { Composer } from "./Composer";
import { AgentChat } from "./AgentChat";
import { SceneBoard } from "./SceneBoard";
import { StepTimeline } from "./StepTimeline";
import { QCPanel } from "./QCPanel";
import { PromptEditor } from "./PromptEditor";
import { ExportPanel } from "./ExportPanel";
import { EventLogView } from "./EventLogView";
import { MetricsBar } from "./MetricsBar";
import { ReferenceAssets, assetUrl } from "./ReferenceAssets";
import { CandidatePanel } from "./CandidatePanel";
import type { Asset } from "../types";

function Availability({ flow }: { flow: ReturnType<typeof useAgentFlow> }) {
  const { text, image, video, judge, decision, store, backend } = flow.adapters;
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!backend?.available) {
      setBackendOk(false);
      return;
    }
    let alive = true;
    backend
      .health()
      .then(() => alive && setBackendOk(true))
      .catch(() => alive && setBackendOk(false));
    return () => {
      alive = false;
    };
  }, [backend]);

  const items: [string, boolean][] = [
    ["text", text.available],
    ["image", image.available],
    ["video", video.available],
    ["judge", judge.available],
    ["decision", decision.available],
    ["store", store.available],
    ["backend", Boolean(backendOk)],
    ["sse", flow.sseStatus === "open"],
    ["compose", Boolean(flow.capabilities?.compose?.available)],
  ];
  return (
    <div className="chips">
      {items.map(([name, ok]) => (
        <span key={name} className={`badge ${ok ? "green" : "amber"}`}>
          {name}: {ok ? "ready" : "placeholder"}
        </span>
      ))}
    </div>
  );
}

export function AgentPage() {
  const flow = useAgentFlow();
  const { state } = flow;
  const [activeShotId, setActiveShotId] = useState<string | undefined>();

  const activeShot = useMemo(
    () => state.shots.find((s) => s.shotId === activeShotId) ?? state.shots[0],
    [state.shots, activeShotId],
  );
  const activeRun = useMemo(
    () =>
      activeShot
        ? [...state.runs].reverse().find((r) => r.shotId === activeShot.shotId)
        : undefined,
    [state.runs, activeShot],
  );
  const activeAsset = useMemo(() => {
    const id = activeRun?.artifactIds.at(-1);
    return id ? state.assets.find((a) => a.assetId === id) : undefined;
  }, [activeRun, state.assets]);

  const boundAssets = useMemo(
    () =>
      (activeShot?.bindings ?? [])
        .map((b) => state.assets.find((a) => a.assetId === b.assetId))
        .filter((a): a is Asset => Boolean(a)),
    [activeShot, state.assets],
  );
  const previewAsset =
    activeAsset ?? [...boundAssets].reverse().find((a) => a.mediaType === "image");

  return (
    <div className="app">
      <div className="topbar">
        <h1>Xpark Media Foundry · Agent</h1>
        <span className={`pill ${config.mode === "live" ? "live" : "mock"}`}>
          {config.mode === "live" ? "LIVE" : "MOCK"}
        </span>
        <span className="pill">一句话 → 场景 → 技能 → 提示词 → 生成 → 质检 → 成片 → 归档</span>
        <span className="spacer" />
        <button className="btn small" onClick={flow.reset}>
          重置
        </button>
      </div>

      <div className="layout">
        {/* Left: conversation + storyboard */}
        <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card">
            <header>
              <h2>1 · 一句话智能引导</h2>
              <span className="spacer" />
              <Availability flow={flow} />
            </header>
            <div className="body">
              <Composer busy={state.busy} onGuide={flow.guide} />
            </div>
          </section>

          <section className="card">
            <header>
              <h2>2 · Agent 对话与决策</h2>
            </header>
            <div className="body">
              <AgentChat messages={state.messages} />
            </div>
          </section>

          <section className="card">
            <header>
              <h2>3 · 场景 / 分镜与技能</h2>
              <span className="spacer" />
              <button
                className="btn small primary"
                disabled={state.busy || state.shots.length === 0}
                onClick={flow.generateAll}
              >
                一键生产全部镜头
              </button>
              <button
                className="btn small"
                disabled={!state.busy}
                onClick={flow.cancel}
                title="停止后续调度，运行中的任务在安全边界停止"
              >
                取消
              </button>
            </header>
            <div className="body">
              <SceneBoard
                scenes={state.scenes}
                shots={state.shots}
                runs={state.runs}
                activeShotId={activeShot?.shotId}
                busy={state.busy}
                onSelectShot={setActiveShotId}
                onGenerateShot={flow.generateShot}
                onReview={flow.review}
                onChangeSkill={flow.selectSkill}
              />
            </div>
          </section>
        </div>

        {/* Right: production console */}
        <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card">
            <header>
              <h2>4 · 生产指标</h2>
            </header>
            <div className="body">
              <MetricsBar metrics={state.metrics} />
            </div>
          </section>

          {activeShot && (
            <section className="card">
              <header>
                <h2>5 · 视觉资产 · 参考图与关键帧</h2>
              </header>
              <div className="body">
                <ReferenceAssets
                  shot={activeShot}
                  assets={state.assets}
                  busy={state.busy}
                  imageReady={flow.adapters.image.available}
                  imageName={flow.adapters.image.name}
                  onImport={(file, role) => void flow.importAsset(file, activeShot.shotId, role)}
                  onBind={(assetId, role) => flow.bindAsset(activeShot.shotId, assetId, role)}
                  onUnbind={(bindingId) => flow.unbindAsset(activeShot.shotId, bindingId)}
                  onGenerate={() => void flow.generateImage(activeShot.shotId)}
                />
              </div>
            </section>
          )}

          {activeShot && (
            <section className="card">
              <header>
                <h2>6 · 候选与回收站</h2>
              </header>
              <div className="body">
                <CandidatePanel
                  shot={activeShot}
                  assets={state.assets}
                  runs={state.runs}
                  busy={state.busy}
                  onAccept={(assetId) => flow.acceptCandidate(activeShot.shotId, assetId)}
                  onDiscard={(assetId, reason, note) => flow.discardCandidate(assetId, reason, note)}
                  onRestore={(assetId) => flow.restoreCandidate(assetId)}
                  onRegenerate={(options) => void flow.regenerateShot(activeShot.shotId, options)}
                />
              </div>
            </section>
          )}

          <section className="card">
            <header>
              <h2>7 · 提示词与镜头规格</h2>
            </header>
            <div className="body">
              <PromptEditor shot={activeShot} asset={previewAsset} onSave={flow.editShotPrompt} />
            </div>
          </section>

          <section className="card">
            <header>
              <h2>8 · 质检报告</h2>
            </header>
            <div className="body">
              <QCPanel report={activeRun?.score} />
            </div>
          </section>

          <section className="card">
            <header>
              <h2>9 · 剪辑拼接与归档</h2>
            </header>
            <div className="body">
              <ExportPanel
                shots={state.shots}
                finalAsset={state.finalAsset}
                archive={state.archive}
                busy={state.busy}
                onCompose={flow.compose}
                onArchive={flow.archive}
              />
            </div>
          </section>

          <section className="card">
            <header>
              <h2>10 · 步骤时间线</h2>
            </header>
            <div className="body">
              <StepTimeline
                steps={state.steps.filter((s) => !activeShot || s.shotId === activeShot.shotId)}
              />
            </div>
          </section>

          <section className="card">
            <header>
              <h2>11 · 事件流 (SSE)</h2>
            </header>
            <div className="body">
              <EventLogView events={state.events} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
