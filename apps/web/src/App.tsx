import { useState } from "react";
import { AgentPage } from "./components/AgentPage";
import { OneClickStudio } from "./components/OneClickStudio";

type Mode = "agent" | "studio";

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
      </div>
      {mode === "agent" ? (
        <AgentPage />
      ) : (
        <div className="app">
          <OneClickStudio />
        </div>
      )}
    </>
  );
}
