import { useState } from "react";
import { AgentPage } from "./components/AgentPage";
import { AssetsView } from "./components/AssetsView";
import { OneClickStudio } from "./components/OneClickStudio";
import { SettingsView } from "./components/SettingsView";

type Mode = "agent" | "assets" | "studio" | "settings";

export function App() {
  const [mode, setMode] = useState<Mode>("agent");
  return (
    <>
      <div className="modebar">
        <button
          className={`btn small ${mode === "agent" ? "primary" : ""}`}
          onClick={() => setMode("agent")}
        >
          主 Agent
        </button>
        <button
          className={`btn small ${mode === "assets" ? "primary" : ""}`}
          onClick={() => setMode("assets")}
        >
          数字资产
        </button>
        <button
          className={`btn small ${mode === "studio" ? "primary" : ""}`}
          onClick={() => setMode("studio")}
        >
          一键出片
        </button>
        <button
          className={`btn small ${mode === "settings" ? "primary" : ""}`}
          onClick={() => setMode("settings")}
        >
          设置
        </button>
      </div>
      {mode === "agent" ? (
        <AgentPage />
      ) : mode === "assets" ? (
        <div className="app">
          <AssetsView />
        </div>
      ) : mode === "studio" ? (
        <div className="app">
          <OneClickStudio />
        </div>
      ) : (
        <div className="app">
          <SettingsView />
        </div>
      )}
    </>
  );
}
