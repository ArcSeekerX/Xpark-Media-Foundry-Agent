// Synthetic metrics snapshot for the console demo. Lets the System monitoring
// and Chat views render with no backend; replace with the real /ws feed later.
import type {
  CoreMetrics,
  EngineMetrics,
  EngineSnapshot,
  MetricsSnapshot,
} from '@/types/metrics'

const GPU = {
  index: 0,
  name: 'NVIDIA GB10',
  memory_total_bytes: 128 * 1024 ** 3,
}

function jitter(base: number, amp: number): number {
  return Math.max(0, base + (Math.random() - 0.5) * amp)
}

function coreMetrics(n: number, base: number): CoreMetrics[] {
  return Array.from({ length: n }, (_, id) => ({
    id,
    usage_percent: Math.round(jitter(base, 25)),
  }))
}

function engineMetrics(): EngineMetrics {
  const tps = jitter(820, 180)
  return {
    tokens_per_sec: tps,
    avg_tokens_per_sec: tps,
    per_request_tps: jitter(48, 10),
    ttft_ms: jitter(180, 40),
    active_requests: Math.round(jitter(4, 3)),
    queued_requests: Math.round(jitter(1, 2)),
    kv_cache_percent: jitter(42, 6),
    kv_cache_is_estimated: false,
    total_requests: 1284,
    e2e_latency_ms: jitter(2600, 400),
    prompt_tokens_per_sec: jitter(3100, 500),
    avg_prompt_tokens_per_sec: jitter(3100, 500),
    per_request_prompt_tps: jitter(1800, 300),
    swapped_requests: 0,
    prefix_cache_hit_rate: jitter(0.62, 0.1),
    queue_time_ms: jitter(20, 10),
    inter_token_latency_ms: jitter(21, 4),
    preemptions_total: 0,
    total_prompt_tokens: 1_920_000,
    total_generation_tokens: 3_410_000,
    prefix_cache_queries_total: 880_000,
    avg_batch_size: jitter(3.4, 1),
    ttft_percentiles: { p50_ms: 165, p95_ms: 280, p99_ms: 420 },
    itl_percentiles: { p50_ms: 20, p95_ms: 28, p99_ms: 40 },
    e2e_percentiles: { p50_ms: 2400, p95_ms: 3600, p99_ms: 5100 },
    ttft_goodput_pct: jitter(96, 3),
    itl_goodput_pct: jitter(94, 4),
    e2e_goodput_pct: jitter(92, 5),
    ttft_buckets: null,
    itl_buckets: null,
    e2e_buckets: null,
    tpot_ms: jitter(21, 3),
    tpot_percentiles: { p50_ms: 20, p95_ms: 29, p99_ms: 41 },
    tpot_goodput_pct: jitter(95, 3),
    tpot_buckets: null,
    spec_decode_draft_tokens_total: null,
    spec_decode_accepted_tokens_total: null,
    spec_decode_drafts_total: null,
    spec_decode_acceptance_rate: null,
    spec_decode_acceptance_rate_live: null,
    spec_decode_mean_acceptance_length: null,
  }
}

function engineSnapshot(): EngineSnapshot {
  return {
    engine_type: 'Vllm',
    endpoint: 'http://127.0.0.1:8000/v1',
    status: { type: 'Running' },
    model: {
      name: 'Qwen3.8-27B',
      parameter_size: '27B',
      quantization: 'FP8',
      precision: 'fp8',
      tensor_type: 'BF16',
      model_type: 'qwen3',
      pipeline_tag: 'text-generation',
    },
    metrics: engineMetrics(),
    recent_requests: Array.from({ length: 6 }, (_, i) => ({
      start_ms: Date.now() - (i + 1) * 4200,
      end_ms: Date.now() - (i + 1) * 4200 + jitter(2400, 500),
      tokens_per_sec: jitter(46, 12),
      ttft_ms: jitter(175, 40),
    })),
    deployment_mode: 'Docker',
    gpu_indexes: [0],
  }
}

let tick = 0

export function generateMockMetrics(): MetricsSnapshot {
  tick += 1
  const now = Date.now()
  const gpuUtil = Math.round(jitter(58, 30))
  const memUsed = 52 * 1024 ** 3
  return {
    timestamp_ms: now,
    hostname: 'xpark-gb10',
    gpu: {
      ...GPU,
      utilization_percent: gpuUtil,
      memory_used_bytes: 41 * 1024 ** 3,
      temperature_celsius: Math.round(jitter(61, 6)),
      power_watts: jitter(72, 12),
      power_limit_watts: 140,
      clock_graphics_mhz: 1830,
      clock_sm_mhz: 1830,
      clock_memory_mhz: 3200,
      fan_speed_percent: null,
    },
    gpus: [
      {
        ...GPU,
        utilization_percent: gpuUtil,
        memory_used_bytes: 41 * 1024 ** 3,
        temperature_celsius: Math.round(jitter(61, 6)),
        power_watts: jitter(72, 12),
        power_limit_watts: 140,
        clock_graphics_mhz: 1830,
        clock_sm_mhz: 1830,
        clock_memory_mhz: 3200,
        fan_speed_percent: null,
      },
    ],
    cpu: {
      name: 'ARM Cortex-X925',
      aggregate_percent: Math.round(jitter(34, 20)),
      per_core: coreMetrics(20, 34),
    },
    memory: {
      total_bytes: 128 * 1024 ** 3,
      display_total_bytes: 128 * 1024 ** 3,
      used_bytes: memUsed,
      available_bytes: 128 * 1024 ** 3 - memUsed,
      cached_bytes: 9 * 1024 ** 3,
      gpu_estimated_bytes: 41 * 1024 ** 3,
      gpu_memory_total_bytes: 128 * 1024 ** 3,
      gpu_memory_used_bytes: 41 * 1024 ** 3,
      is_unified: true,
    },
    disk: {
      name: 'nvme0n1',
      read_bytes_per_sec: jitter(120 * 1024 ** 2, 60 * 1024 ** 2),
      write_bytes_per_sec: jitter(40 * 1024 ** 2, 30 * 1024 ** 2),
      target_name: '/',
      total_bytes: 1.8 * 1024 ** 4,
      used_bytes: 1.5 * 1024 ** 4,
    },
    network: {
      name: 'eth0',
      rx_bytes_per_sec: jitter(8 * 1024 ** 2, 4 * 1024 ** 2),
      tx_bytes_per_sec: jitter(3 * 1024 ** 2, 2 * 1024 ** 2),
    },
    engines: [engineSnapshot()],
    gpu_events:
      tick % 5 === 0
        ? [{ timestamp_ms: now, gpu_index: 0, event_type: 'info', detail: 'mock heartbeat' }]
        : [],
    remote_nodes: [],
  }
}

export const MOCK_ENABLED = (import.meta.env.VITE_MOCK ?? '1') !== '0'
