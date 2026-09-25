import { useEffect, useRef } from "react";
import type { AgentMessage } from "../types";

export function AgentChat({ messages }: { messages: AgentMessage[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages.length]);

  return (
    <div className="chat" ref={ref}>
      {messages.length === 0 && (
        <p className="muted">
          输入一句话需求，Agent 会补全场景、匹配技能、生成提示词，并在生产过程中汇报每一步。
        </p>
      )}
      {messages.map((m) => (
        <div key={m.messageId} className={`msg ${m.role}`}>
          {m.role === "decision" ? "⚖ " : ""}
          {m.text}
        </div>
      ))}
    </div>
  );
}
