import type {
  Asset,
  DecisionAdvice,
  Progress,
  ReferenceImage,
  RenderRequest,
  ScoreReport,
  ShotSpec,
} from "../types";

export interface GeneratedMedia {
  assetId: string;
  storageKey: string;
  previewKey?: string;
  mediaType: "image" | "video";
  width: number;
  height: number;
  durationS: number;
  seed: number;
  remoteUrl?: string;
}

export interface TextModel {
  name: string;
  available: boolean;
  complete(system: string, user: string): Promise<string>;
}

export interface ImageRequest {
  shot: ShotSpec;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  skillId?: string;
  referenceImages?: ReferenceImage[];
  onProgress?: (progress: Progress) => void;
}

export interface ImageModel {
  name: string;
  available: boolean;
  generate(req: ImageRequest): Promise<GeneratedMedia>;
}

export type RenderState =
  | "queued"
  | "running"
  | "generated"
  | "failed";

export interface RenderHandle {
  promptId: string;
  clientId: string;
}

export interface RenderProgress {
  state: RenderState;
  progress?: Progress;
  artifact?: GeneratedMedia;
  error?: string;
}

export interface VideoModel {
  name: string;
  available: boolean;
  render(req: RenderRequest): Promise<RenderHandle>;
  poll(handle: RenderHandle): Promise<RenderProgress>;
}

export interface JudgeInput {
  runId: string;
  shot: ShotSpec;
  asset: GeneratedMedia;
}

export interface VisionJudge {
  name: string;
  available: boolean;
  evaluate(input: JudgeInput): Promise<ScoreReport>;
}

export interface DecisionInput {
  stateHash: string;
  allowedActions: string[];
  summary: string;
  evidenceIds: string[];
}

export interface DecisionPort {
  name: string;
  available: boolean;
  propose(input: DecisionInput): Promise<DecisionAdvice>;
}

export interface ArchiveRecord {
  archiveId: string;
  projectId: string;
  createdAt: string;
  manifestKey: string;
  assetIds: string[];
  totalBytes: number;
}

export interface AssetStore {
  name: string;
  available: boolean;
  archive(projectId: string, assets: Asset[], extra?: unknown): Promise<ArchiveRecord>;
}

export interface Capabilities {
  image?: { model?: string; max_reference_images?: number; inputs?: string[] };
  video?: { model?: string; max_reference_images?: number; fps?: number; inputs?: string[] };
  compose?: { available?: boolean; tool?: string };
  storage?: { data_dir?: string; imports_dir?: string; generated_dir?: string; exports_dir?: string };
}

export interface ComposeResult {
  url: string;
  storage_key: string;
  size_bytes?: number;
  clips?: number;
}

export interface BackendPort {
  name: string;
  available: boolean;
  health(): Promise<{ ok: boolean }>;
  capabilities?(): Promise<Capabilities>;
  compose?(clips: string[], projectId: string): Promise<ComposeResult>;
  eventsUrl?(projectId: string, since: number): string;
}

export interface Adapters {
  text: TextModel;
  image: ImageModel;
  video: VideoModel;
  judge: VisionJudge;
  decision: DecisionPort;
  store: AssetStore;
  // Present only when the business generation backend is configured.
  backend?: BackendPort;
}
