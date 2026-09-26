import { useState } from "react";
import { AgentPage } from "./components/AgentPage";
import { OneClickStudio } from "./components/OneClickStudio";
import { SettingsView } from "./components/SettingsView";

type Mode = "agent" | "studio" | "settings";

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
