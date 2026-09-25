import { useState } from "react";

const EXAMPLES = [
  "做一个雨夜天台短剧：女主停步回头看向红色信号灯，5 秒",
  "夏日公园里动漫少女微笑挥手打招呼，两镜头",
  "把这张手绘流程图做成 5 秒图解动画，元素按顺序浮现",
  "演播室口播特写：讲师强调关键结论，对镜头清晰讲解",
];

export function Composer({
  busy,
  onGuide,
}: {
  busy: boolean;
  onGuide: (text: string) => void;
}) {
  const [text, setText] = useState("");

  const submit = () => {
    if (!text.trim() || busy) return;
    onGuide(text);
    setText("");
  };

  return (
    <div className="composer">
      <textarea
        value={text}
        placeholder="用一句话描述你想做的视频，例如：雨夜天台，女主回头看向红灯，5 秒短剧镜头…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={submit} disabled={busy || !text.trim()}>
          {busy ? "Agent 处理中…" : "智能引导并生成分镜"}
        </button>
        <span className="muted">⌘/Ctrl + Enter 提交</span>
      </div>
      <div className="chips" style={{ marginTop: 8 }}>
        {EXAMPLES.map((e) => (
          <span
            key={e}
            className="chip"
            style={{ cursor: "pointer" }}
            onClick={() => setText(e)}
          >
            {e.slice(0, 18)}…
          </span>
        ))}
      </div>
    </div>
  );
}
