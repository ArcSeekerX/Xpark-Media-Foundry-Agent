// Event log with monotonic seq, id-based dedup, and an SSE connector.
// Mirrors the backend contract: subscribe with a cursor, fetch a snapshot
// first, replay missed events by seq, drop duplicates by event_id.
import type { FlowEvent, FlowEventType, Progress } from "../types";
import { nowIso, uid } from "../lib/util";

export interface EmitInput {
  projectId: string;
  type: FlowEventType;
  summary: string;
  actor?: string;
  runId?: string;
  stepId?: string;
  attemptId?: string;
  progress?: Progress;
  artifactIds?: string[];
  payload?: unknown;
}

export class EventLog {
  private seq = 0;
  private seen = new Set<string>();
  private listeners = new Set<(e: FlowEvent) => void>();
  private buffer: FlowEvent[] = [];

  get lastSeq(): number {
    return this.seq;
  }

  emit(input: EmitInput): FlowEvent {
    this.seq += 1;
    const event: FlowEvent = {
      eventId: uid("evt"),
      seq: this.seq,
      projectId: input.projectId,
      runId: input.runId,
      stepId: input.stepId,
      attemptId: input.attemptId,
      type: input.type,
      actor: input.actor ?? "web",
      timestamp: nowIso(),
      progress: input.progress,
      summary: input.summary,
      artifactIds: input.artifactIds ?? [],
      stateVersion: this.seq,
      payload: input.payload,
    };
    this.push(event);
    return event;
  }

  ingest(event: FlowEvent): void {
    if (this.seen.has(event.eventId)) return; // dedup by id
    if (event.seq <= this.seq) return; // stale
    this.seq = event.seq;
    this.push(event);
  }

  private push(event: FlowEvent): void {
    this.seen.add(event.eventId);
    this.buffer.push(event);
    if (this.buffer.length > 500) this.buffer.shift();
    for (const fn of this.listeners) fn(event);
  }

  subscribe(fn: (e: FlowEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  history(): FlowEvent[] {
    return [...this.buffer];
  }

  clear(): void {
    this.seq = 0;
    this.seen.clear();
    this.buffer = [];
  }
}

export function connectSse(
  url: string,
  onEvent: (e: FlowEvent) => void,
  onStatus?: (s: "open" | "closed") => void,
): () => void {
  const source = new EventSource(url);
  source.onopen = () => onStatus?.("open");
  source.onerror = () => onStatus?.("closed");
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as FlowEvent);
    } catch {
      /* ignore malformed frame */
    }
  };
  return () => source.close();
}
