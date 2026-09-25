import type {
  AgentMessage,
  Asset,
  Brief,
  FlowEvent,
  Project,
  Run,
  Scene,
  Shot,
  ShotPhase,
  SkillSelection,
  StepRun,
} from "../types";
import type { ArchiveRecord } from "../adapters/types";

export interface Metrics {
  totalShots: number;
  acceptedShots: number;
  renderAttempts: number;
  repairCount: number;
  humanReview: number;
  firstPassAccepted: number;
}

export interface State {
  project?: Project;
  brief?: Brief;
  scenes: Scene[];
  shots: Shot[];
  assets: Asset[];
  runs: Run[];
  steps: StepRun[];
  events: FlowEvent[];
  messages: AgentMessage[];
  routings: Record<string, SkillSelection[]>;
  phase: "idle" | "planning" | "planned" | "producing" | "composing" | "done";
  busy: boolean;
  finalAsset?: Asset;
  archive?: ArchiveRecord;
  metrics: Metrics;
}

export const initialState: State = {
  scenes: [],
  shots: [],
  assets: [],
  runs: [],
  steps: [],
  events: [],
  messages: [],
  routings: {},
  phase: "idle",
  busy: false,
  metrics: {
    totalShots: 0,
    acceptedShots: 0,
    renderAttempts: 0,
    repairCount: 0,
    humanReview: 0,
    firstPassAccepted: 0,
  },
};

export type Action =
  | { type: "reset" }
  | { type: "set_busy"; busy: boolean }
  | {
      type: "set_plan";
      project: Project;
      brief: Brief;
      scenes: Scene[];
      shots: Shot[];
      routings: Record<string, SkillSelection[]>;
    }
  | { type: "add_message"; message: AgentMessage }
  | { type: "add_event"; event: FlowEvent }
  | { type: "patch_shot"; shotId: string; patch: Partial<Shot> }
  | { type: "patch_scene"; sceneId: string; patch: Partial<Scene> }
  | { type: "add_run"; run: Run }
  | { type: "patch_run"; runId: string; patch: Partial<Run> }
  | { type: "set_run_phase"; shotId: string; phase: ShotPhase }
  | { type: "add_step"; step: StepRun }
  | { type: "patch_step"; stepId: string; patch: Partial<StepRun> }
  | { type: "add_asset"; asset: Asset }
  | { type: "set_phase"; phase: State["phase"] }
  | { type: "set_final"; asset: Asset }
  | { type: "set_archive"; archive: ArchiveRecord }
  | { type: "bump"; key: keyof Metrics; by?: number };

function metricsWith(state: State, run: Run, accepted: boolean): Metrics {
  const firstAttempt = state.runs.filter((r) => r.shotId === run.shotId).length <= 1;
  return {
    ...state.metrics,
    renderAttempts: state.metrics.renderAttempts + 1,
    acceptedShots: state.metrics.acceptedShots + (accepted ? 1 : 0),
    firstPassAccepted:
      state.metrics.firstPassAccepted + (accepted && firstAttempt ? 1 : 0),
  };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { ...initialState };
    case "set_busy":
      return { ...state, busy: action.busy };
    case "set_plan":
      return {
        ...state,
        project: action.project,
        brief: action.brief,
        scenes: action.scenes,
        shots: action.shots,
        routings: action.routings,
        phase: "planned",
        metrics: { ...state.metrics, totalShots: action.shots.length },
      };
    case "add_message":
      return { ...state, messages: [...state.messages, action.message] };
    case "add_event":
      return { ...state, events: [...state.events, action.event].slice(-500) };
    case "patch_shot":
      return {
        ...state,
        shots: state.shots.map((s) =>
          s.shotId === action.shotId ? { ...s, ...action.patch } : s,
        ),
      };
    case "patch_scene":
      return {
        ...state,
        scenes: state.scenes.map((s) =>
          s.sceneId === action.sceneId ? { ...s, ...action.patch } : s,
        ),
      };
    case "add_run":
      return {
        ...state,
        runs: [...state.runs, action.run],
        metrics: metricsWith(state, action.run, false),
      };
    case "patch_run":
      return {
        ...state,
        runs: state.runs.map((r) =>
          r.runId === action.runId ? { ...r, ...action.patch } : r,
        ),
      };
    case "set_run_phase":
      return {
        ...state,
        shots: state.shots.map((s) =>
          s.shotId === action.shotId ? { ...s, phase: action.phase } : s,
        ),
      };
    case "add_step":
      return { ...state, steps: [...state.steps, action.step] };
    case "patch_step":
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.stepId === action.stepId ? { ...s, ...action.patch } : s,
        ),
      };
    case "add_asset":
      return { ...state, assets: [...state.assets, action.asset] };
    case "set_phase":
      return { ...state, phase: action.phase };
    case "set_final":
      return { ...state, finalAsset: action.asset, phase: "done" };
    case "set_archive":
      return { ...state, archive: action.archive };
    case "bump":
      return {
        ...state,
        metrics: {
          ...state.metrics,
          [action.key]: state.metrics[action.key] + (action.by ?? 1),
        },
      };
    default:
      return state;
  }
}
