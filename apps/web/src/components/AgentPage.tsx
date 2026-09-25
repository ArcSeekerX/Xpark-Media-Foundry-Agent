import { useMemo, useState } from "react";
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

function Availability({ flow }: { flow: ReturnType<typeof useAgentFlow> }) {
  const { text, image, video, judge, decision, store } = flow.adapters;
  const items: [string, boolean][] = [
    ["text", text.available],
    ["image", image.available],
    ["video", video.available],
    ["judge", judge.available],
    ["decision", decision.available],
    ["store", store.available],
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card">
            <header>
              <h2>4 · 生产指标</h2>
            </header>
            <div className="body">
              <MetricsBar metrics={state.metrics} />
            </div>
          </section>

          <section className="card">
            <header>
              <h2>5 · 提示词与镜头规格</h2>
            </header>
            <div className="body">
              <PromptEditor shot={activeShot} asset={activeAsset} onSave={flow.editShotPrompt} />
            </div>
          </section>

          <section className="card">
            <header>
              <h2>6 · 质检报告</h2>
            </header>
            <div className="body">
              <QCPanel report={activeRun?.score} />
            </div>
          </section>

          <section className="card">
            <header>
              <h2>7 · 剪辑拼接与归档</h2>
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
              <h2>8 · 步骤时间线</h2>
            </header>
            <div className="body">
              <StepTimeline
                steps={state.steps.filter((s) => !activeShot || s.shotId === activeShot.shotId)}
              />
            </div>
          </section>

          <section className="card">
            <header>
              <h2>9 · 事件流 (SSE)</h2>
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
