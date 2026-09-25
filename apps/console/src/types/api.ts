// ── Recipe ─────────────────────────────────────────────────────────────────

export interface RecipeInfo {
  name: string
  file: string
  description: string
  recipe_version: string
  model: string | null
  additional_models: string[]
  container: string
  nodes: number
  tensor_parallel: number
  gpu_memory_utilization: number
  max_model_len: number
  max_num_batched_tokens: number
  max_num_seqs: number
  served_model_name: string
  cluster_only: boolean
  solo_only: boolean
  mods: string[]
  env: Record<string, string>
  docker_args: string | null
  command_summary: string
  parameter_size: string | null
  weight_size: string | null
  model_mount_path?: string | null
  /** First release date of the model on the ModelScope community (e.g. "2026-08-30"). */
  release_date: string | null
}

// ── Download ────────────────────────────────────────────────────────────────

export type DownloadStatus =
  | { status: 'not_cached' }
  | { status: 'downloading'; progress: number; speed_mbps: number; eta_secs: number; elapsed_secs: number; current_file: string }
  | { status: 'cached'; snapshot_id: string; size_bytes: number }
  | { status: 'failed'; error: string }

export interface DownloadResponse {
  accepted: boolean
  message: string
}

// ── Deployment ──────────────────────────────────────────────────────────────

export type DeploymentState =
  | 'warming'
  | 'healthy'
  | { error: string }
  | 'stopped'

export interface Deployment {
  id: string
  recipe_name: string
  model: string
  port: number
  container_name: string
  /** Cluster node IPs the deployment was launched on (head first, then workers). */
  nodes?: string[]
  status: DeploymentState
  started_at: string
  throughput_tok_s: number
  memory_gb: number
  logs?: string[]
}

export interface DeployRequest {
  recipe: string
  port?: number
  solo?: boolean
  /** Node IPs for cluster deploys (first is head). */
  nodes?: string[]
  /** Run without Ray (--no-ray), e.g. DSpark speculative decoding. */
  no_ray?: boolean
  /** Extra Docker volume mount "host_path:container_path". */
  model_mount?: string
  /** Extra vLLM CLI arguments appended after `--`, e.g. `["--max-model-len", "1048576", "--max-num-seqs", "16"]`.
   *  These override recipe defaults via vLLM's "last wins" semantics. */
  extra_args?: string[]
}

export interface DeployResponse {
  accepted: boolean
  deployment_id: string
  message: string
}

// ── WebSocket Events ────────────────────────────────────────────────────────

export type WsEvent =
  | { type: 'download_progress'; model: string; progress: number; speed_mbps: number; eta_secs: number; current_file: string }
  | { type: 'download_complete'; model: string; snapshot_id: string }
  | { type: 'download_failed'; model: string; error: string }
  | { type: 'sync_progress'; model: string; progress: number; message: string }
  | { type: 'sync_complete'; model: string }
  | { type: 'deploy_progress'; deployment_id: string; recipe_name: string; stage: string; message: string }
  | { type: 'deploy_log'; deployment_id: string; recipe_name: string; line: string }
  | { type: 'deploy_ready'; deployment_id: string; recipe_name: string; port: number }
  | { type: 'deploy_failed'; deployment_id: string; recipe_name: string; error: string }

// ── API Keys / LiteLLM ─────────────────────────────────────────────────────

export interface ApiKey {
  id: string
  name: string
  key?: string
  masked_key: string
  created_at: string
  models: string[]
}

export interface CreateKeyResponse {
  key: ApiKey
  litellm_started: boolean
}

export interface LitellmStatus {
  running: boolean
  container_name: string
  port: number
  key_count: number
}

export interface ModelEntry {
  model_name: string
  host: string
  port: number
  node_label: string
}

export interface AvailableModels {
  models: ModelEntry[]
}

// ── LiteLLM Custom Config ───────────────────────────────────────────────────

export interface LitellmConfigInfo {
  has_custom: boolean
  content: string | null
  custom_active: boolean
  last_error: string | null
  container_running: boolean
}

export interface LitellmConfigValidateResponse {
  valid: boolean
  error: string | null
}

export interface LitellmConfigSaveResponse {
  saved: boolean
  restarted: boolean
  error?: string | null
}
