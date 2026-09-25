import type { FlowEvent } from "../types";

export function EventLogView({ events }: { events: FlowEvent[] }) {
  const shown = events.slice(-80).reverse();
  return (
    <div className="events">
      {shown.length === 0 && <p className="muted">事件流为空（SSE 契约：seq 游标 + event_id 去重）。</p>}
      {shown.map((e) => (
        <div key={e.eventId}>
          <span className="t">#{e.seq}</span> <b>{e.type}</b> {e.summary}
          {e.progress ? ` (${e.progress.current}/${e.progress.total})` : ""}
        </div>
      ))}
    </div>
  );
}
