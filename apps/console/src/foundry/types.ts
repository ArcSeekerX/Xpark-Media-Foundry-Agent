// Domain contracts shared by the Agent page, skills, adapters and renderer.
// Mirrors the "短视频工厂" design contracts (ShotSpec / ScoreReport / events).

export type Id = string;

export type MediaType = "text" | "image" | "video" | "audio" | "subtitle";
export type AssetSource = "imported" | "generated" | "derived";
export type AssetState =
  | "UPLOADING"
  | "VALIDATING"
  | "PROCESSING"
  | "READY"
  | "FAILED";

// Candidate lifecycle for generated/imported media. Only `accepted` assets
// participate in the final cut; `discarded` ones stay in the recycle bin with
// an auditable reason so they can be compared or regenerated later.
export type CandidateStatus = "candidate" | "accepted" | "discarded";

export type DiscardReason =
  | "identity_drift"
  | "action_incomplete"
  | "composition_mismatch"
  | "flicker"
  | "deformation"
  | "audio_issue"
  | "other";

export interface DiscardRecord {
  reasonTag: DiscardReason;
  note?: string;
  at: string;
  by: "auto" | "human";
}

export interface Asset {
  assetId: Id;
  projectId: Id;
  source: AssetSource;
  mediaType: MediaType;
  sha256?: string;
  version: number;
  storageKey: string;
  previewKey?: string;
  parentAssetIds?: Id[];
  metadata: Record<string, unknown>;
  state: AssetState;
  status?: CandidateStatus;
  discard?: DiscardRecord;
}

export interface AssetBinding {
  bindingId: Id;
  shotId: Id;
  role: "character" | "scene" | "first_frame" | "last_frame" | "reuse_clip" | "audio";
  assetId: Id;
  assetVersion: number;
  clipRange?: [number, number];
}

export interface Brief {
  theme: string;
  durationS: number;
  style: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  audience?: string;
}

export interface CameraSpec {
  size:
    | "wide"
    | "medium"
    | "medium_closeup"
    | "closeup"
    | "extreme_closeup";
  movement: "static" | "slow_push" | "slow_pull" | "pan_left" | "pan_right" | "handheld";
}

export interface AcceptanceSpec {
  required: string[];
  forbidden: string[];
  rubricVersion: string;
}

export interface ShotSpec {
  schemaVersion: "2";
  materialPolicy: "prefer_imported" | "generate";
  productionMode: "generate";
  shotId: Id;
  durationS: number;
  aspectRatio: Brief["aspectRatio"];
  characters: { id: Id; assetVersion: number }[];
  sceneAssetId?: Id;
  action: string;
  camera: CameraSpec;
  continuity?: Record<string, string>;
  referenceAssets: Id[];
  acceptance: AcceptanceSpec;
}

export interface Shot {
  shotId: Id;
  sceneId: Id;
  index: number;
  title: string;
  spec: ShotSpec;
  prompt: string;
  negativePrompt: string;
  skillId?: Id;
  phase: ShotPhase;
  acceptedRunId?: Id;
  acceptedAssetId?: Id;
  runIds: Id[];
  bindings: AssetBinding[];
}

export interface Scene {
  sceneId: Id;
  projectId: Id;
  index: number;
  title: string;
  synopsis: string;
  location: string;
  timeOfDay: "day" | "night" | "dusk" | "dawn" | "indoor";
  mood: string;
  skillIds: Id[];
  shotIds: Id[];
}

export interface Project {
  projectId: Id;
  name: string;
  brief: Brief;
  createdAt: string;
  sceneIds: Id[];
  stateVersion: number;
}

// ---------------------------------------------------------------------------
// Runs / steps / events
// ---------------------------------------------------------------------------

export type ShotPhase =
  | "PLANNED"
  | "ASSET_READY"
  | "PROMPT_READY"
  | "QUEUED"
  | "RENDERING"
  | "GENERATED"
  | "NORMALIZING"
  | "SCORING"
  | "REPAIRING"
  | "ACCEPTED"
  | "HUMAN_REVIEW"
  | "RETRY_WAIT"
  | "FAILED";

export type StepKind =
  | "plan"
  | "image"
  | "prompt"
  | "render"
  | "normalize"
  | "score"
  | "repair"
  | "compose"
  | "archive";

export interface Progress {
  unit: "sampling_step" | "frames" | "percent" | "items";
  current: number;
  total: number;
}

export interface StepRun {
  stepId: Id;
  runId: Id;
  shotId: Id;
  kind: StepKind;
  actor: string;
  state: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt?: string;
  endedAt?: string;
  progress?: Progress;
  summary?: string;
  artifactIds: Id[];
}

export interface Run {
  runId: Id;
  projectId: Id;
  shotId: Id;
  attemptId: Id;
  commandId: Id;
  state: ShotPhase;
  promptId?: string;
  seed?: number;
  params: Record<string, unknown>;
  artifactIds: Id[];
  score?: ScoreReport;
  repair?: RepairPlan;
  createdAt: string;
}

export type FlowEventType =
  | "snapshot"
  | "step.queued"
  | "agent.started"
  | "agent.message"
  | "decision.proposed"
  | "decision.applied"
  | "decision.fallback"
  | "skill.invoked"
  | "tool.progress"
  | "artifact.created"
  | "candidate.created"
  | "candidate.accepted"
  | "candidate.discarded"
  | "candidate.regenerated"
  | "quality.evaluated"
  | "step.completed"
  | "run.failed"
  | "export.completed";

export interface FlowEvent {
  eventId: Id;
  seq: number;
  projectId: Id;
  runId?: Id;
  stepId?: Id;
  attemptId?: Id;
  type: FlowEventType;
  actor: string;
  timestamp: string;
  progress?: Progress;
  summary: string;
  artifactIds: Id[];
  stateVersion: number;
  payload?: unknown;
}

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export type Verdict = "accept" | "repair" | "human_review";

export interface ScoreEvidence {
  tag: string;
  timeS?: [number, number];
  note?: string;
}

export interface ScoreReport {
  runId: Id;
  verdict: Verdict;
  hardChecks: Record<string, boolean>;
  scores: Record<string, number>;
  evidence: ScoreEvidence[];
  uncertain: boolean;
  rubricVersion: string;
  repair?: RepairPlan;
}

export interface RepairPlan {
  target:
    | "prompt"
    | "reference_assets"
    | "storyboard"
    | "render_params"
    | "audio"
    | "human";
  action: string;
  invalidateFrom: ShotPhase;
  rationale: string;
}

export interface DecisionAdvice {
  decisionId: Id;
  stateHash: string;
  allowedActions: string[];
  selectedAction: string;
  modelId: string;
  modelRevision: string;
  calibrationVersion: string;
  evidenceIds: Id[];
  acceptedByPolicy: boolean;
  fallback: string | null;
}

// ---------------------------------------------------------------------------
// Intelligent routing
// ---------------------------------------------------------------------------

export type RouteAction =
  | "reuse_imported"
  | "reuse_clip"
  | "image_conditioned"
  | "generate"
  | "repair"
  | "human_review";

export interface RouteDecision {
  action: RouteAction;
  reasons: string[];
  confidence: number;
  source: "rules" | "model";
  shadow: boolean;
  // What the decision model proposed (kept even in shadow mode for auditing).
  modelAction?: RouteAction;
  fallback?: RouteAction | null;
}

// ---------------------------------------------------------------------------
// Prompt / render request
// ---------------------------------------------------------------------------

export interface PromptSpec {
  shotId: Id;
  positive: string;
  negative: string;
  dialogue?: string;
  variants: string[];
}

// Parameters for the one-click "materials -> finished video" pipeline.
export interface ProductionParams {
  aspectRatio: Brief["aspectRatio"];
  width?: number;
  height?: number;
  frames: number;
  steps: number;
  sampler: string;
  seed: number;
  style: string;
  narrate: boolean;
  maxShots: number;
  autoCompose: boolean;
}

// A concrete image the render pipeline can upload as a ComfyUI reference.
// `dataUrl` is a browser-safe payload (imported file or generated result).
export interface ReferenceImage {
  assetId: Id;
  name: string;
  dataUrl: string;
  role?: AssetBinding["role"];
  source?: AssetSource;
}

export interface RenderRequest {
  shotId: Id;
  promptSpec: PromptSpec;
  width: number;
  height: number;
  length: number;
  seed: number;
  steps: number;
  sampler: string;
  refAssetIds: Id[];
  referenceImages?: ReferenceImage[];
  workflowHash: string;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export interface SkillMatch {
  keywords: string[];
  intents?: string[];
  timeOfDay?: Scene["timeOfDay"];
}

export interface Skill {
  skillId: Id;
  name: string;
  description: string;
  match: SkillMatch;
  promptTemplate: (spec: ShotSpec) => string;
  negativePrompt: string;
  cameraPreset: Partial<CameraSpec>;
  params: { steps: number; sampler: string; aspectRatio?: Brief["aspectRatio"] };
  qcRubric: string;
  imageStyle?: string;
}

export interface SkillSelection {
  skill: Skill;
  score: number;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Agent conversation
// ---------------------------------------------------------------------------

export type AgentRole = "user" | "agent" | "tool" | "decision";

export interface AgentMessage {
  messageId: Id;
  role: AgentRole;
  text: string;
  timestamp: string;
  refs?: Id[];
  meta?: Record<string, unknown>;
}
