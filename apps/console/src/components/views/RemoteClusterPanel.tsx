import { useState } from 'react'
import { RemoteCredentialDialog } from './RemoteCredentialDialog'
import { AddNodeDialog } from './AddNodeDialog'
import { NodeDetailView } from './NodeDetailView'
import type { MetricsSnapshot, RemoteNodeStatus } from '@/types/metrics'

interface ChartPoint {
  timestamp: number
  value: number
}

interface RemoteClusterPanelProps {
  nodes: RemoteNodeStatus[]
  /** Local machine snapshot — rendered as the first ("本机") node card and
   *  included in every cluster aggregate. */
  metrics: MetricsSnapshot | null
  /** Local node chart history (getChartData from useMetricsHistory). */
  getLocalChartData: (metric: string) => ChartPoint[]
  /** Per-remote-node chart history (getRemoteChartData). */
  getRemoteChartData: (ip: string, metric: string) => ChartPoint[]
  /** Fill the parent viewport. Used in cluster mode, where this panel
   *  replaces the local hardware overview and becomes the main view. */
  fill?: boolean
}

const GIB = 1024 * 1024 * 1024
/** Sentinel for the local node dropdown option. */
const LOCAL_ID = '__local__'
/** Loopback IP used to identify the local node in the cluster panel. */
const LOCAL_IP = '127.0.0.1'

/** True when `node` is the local machine (its IP is the loopback address). */
function isLocal(node: { ip: string }): boolean {
  return node.ip === LOCAL_IP
}

/** Format bytes as compact GiB, labelled GB to match OS conventions:
 *  108.0 GB → "108 GB", 110.6 GB → "110.6 GB". */
function formatGb(bytes: number): string {
  const gb = bytes / GIB
  const s = gb.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** Wrap the local snapshot as a pseudo remote-node so it flows through the
 *  same aggregate + card rendering as the SSH-polled peers. Shows the machine
 *  hostname (from the backend) and the 127.0.0.1 loopback address. */
function localNode(metrics: MetricsSnapshot | null): RemoteNodeStatus | null {
  if (!metrics) return null
  return {
    ip: LOCAL_IP,
    hostname: metrics.hostname ?? '本机',
    online: true,
    error: null,
    timestamp_ms: metrics.timestamp_ms,
    cpu_percent: metrics.cpu?.aggregate_percent ?? null,
    per_core: metrics.cpu?.per_core ?? [],
    cpu_cores: metrics.cpu?.per_core?.length || null,
    memory_total_bytes: metrics.memory?.total_bytes ?? null,
    memory_used_bytes: metrics.memory?.used_bytes ?? null,
    disk_read_bytes_per_sec: metrics.disk?.read_bytes_per_sec ?? null,
    disk_write_bytes_per_sec: metrics.disk?.write_bytes_per_sec ?? null,
    network_rx_bytes_per_sec: metrics.network?.rx_bytes_per_sec ?? null,
    network_tx_bytes_per_sec: metrics.network?.tx_bytes_per_sec ?? null,
    disk_target_name: metrics.disk?.target_name ?? metrics.disk?.name ?? null,
    disk_total_bytes: metrics.disk?.total_bytes ?? null,
    disk_used_bytes: metrics.disk?.used_bytes ?? null,
    gpus: metrics.gpus && metrics.gpus.length > 0 ? metrics.gpus : (metrics.gpu ? [metrics.gpu] : []),
    has_credentials: false,
  }
}

/** Progress-bar fill color by utilization. */
function barColor(percent: number): string {
  return percent > 85 ? '#EF4444' : percent > 70 ? '#F59E0B' : '#76B900'
}

/** One metric line inside a node card: 标签左、数值右、下方一条进度条. */
function MetricRow({
  label,
  value,
  percent,
}: {
  label: string
  value: string
  percent: number | null
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <span className="text-[10px] text-zinc-500 truncate">{label}</span>
        <span className="shrink-0 text-[11px] font-mono font-semibold text-zinc-100 tabular-nums">{value}</span>
      </div>
      {percent !== null && (
        <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${Math.min(Math.max(percent, 0), 100)}%`, backgroundColor: barColor(percent) }}
          />
        </div>
      )}
    </div>
  )
}

/** Compact per-node cluster card:
 *  头部行 — 节点名（粗体）+ 下方 IP + 右侧「在线/离线」标识（非本机带删除入口）
 *  设备行 — 左 GPU 名称，右 GPU 张数
 *  指标行 — GPU 利用率 / 统一内存 / CPU，各带一条进度条. */
function NodeSummaryCard({
  node,
  onDelete,
}: {
  node: RemoteNodeStatus
  /** Open the remove-node confirmation (non-local nodes only). */
  onDelete?: (ip: string) => void
}) {
  const gpu = node.gpus[0]
  const memTotal = node.memory_total_bytes ?? 0
  const memUsed = node.memory_used_bytes ?? 0
  const memPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : null
  const cpuPercent = node.cpu_percent ?? null

  return (
    <div className="min-w-0 rounded-md border border-white/[0.04] bg-[#111115] px-2.5 py-2 flex flex-col gap-1.5 transition-colors duration-200 hover:border-[#76B900]/10">
      {/* 头部行 */}
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold text-zinc-100 leading-tight truncate">{node.hostname ?? node.ip}</span>
          <span className="text-[10px] text-zinc-500 font-mono truncate" title={node.ip}>{node.ip}</span>
        </div>
        <span
          className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
            node.online
              ? 'border-[#76B900]/30 bg-[#76B900]/[0.08] text-[#76B900]'
              : 'border-red-500/30 bg-red-500/[0.08] text-red-400'
          }`}
        >
          {node.online ? '在线' : '离线'}
        </span>
        {!isLocal(node) && (
          <button
            type="button"
            title="停止监控该节点"
            aria-label={`删除节点 ${node.hostname ?? node.ip}`}
            onClick={() => onDelete?.(node.ip)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-600 hover:text-red-400 hover:bg-red-500/[0.08] cursor-pointer transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      {/* 设备行 */}
      <div className="flex items-baseline justify-between gap-2 min-w-0 border-t border-white/[0.04] pt-1.5">
        <span className="text-[11px] text-zinc-300 truncate">{gpu?.name ?? 'N/A'}</span>
        <span className="shrink-0 text-[11px] font-mono text-zinc-400 tabular-nums">{node.gpus.length} 张</span>
      </div>

      {/* 指标行 */}
      <MetricRow
        label="GPU 利用率"
        value={gpu?.utilization_percent !== null && gpu?.utilization_percent !== undefined ? `${gpu.utilization_percent}%` : '--'}
        percent={gpu?.utilization_percent ?? null}
      />
      <MetricRow
        label="统一内存"
        value={memTotal > 0 ? `${formatGb(memUsed)} / ${formatGb(memTotal)} GB` : '--'}
        percent={memPercent}
      />
      <MetricRow
        label={`CPU (${node.cpu_cores ?? '?'} 核)`}
        value={cpuPercent !== null ? `${cpuPercent.toFixed(1)}%` : '--'}
        percent={cpuPercent}
      />
    </div>
  )
}

/** Remote xpark cluster panel — 本机 + 远端节点汇总统计条，节点详细信息
 *  (同一时间仅显示所选节点的详情), 下拉列表选择查看本机或其他节点. */
export function RemoteClusterPanel({
  nodes,
  metrics,
  getLocalChartData,
  getRemoteChartData,
  fill,
}: RemoteClusterPanelProps) {
  const [credIp, setCredIp] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  // Default selection: 本机 (its detailed view is shown first).
  const [selectedId, setSelectedId] = useState<string>(LOCAL_ID)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmIp, setConfirmIp] = useState<string | null>(null)

  const local = localNode(metrics)
  const allNodes: RemoteNodeStatus[] = local ? [local, ...nodes] : [...nodes]
  const onlineNodes = allNodes.filter((n) => n.online)
  // Cluster summary / node selector only make sense once peers are monitored;
  // a 本机-only host just gets the slim toolbar (its details live in the
  // dashboard hardware overview below).
  const hasRemote = nodes.length > 0
  const lastTs = Math.max(...allNodes.map((n) => n.timestamp_ms))
  const lastSeen = lastTs > 0 ? new Date(lastTs).toLocaleTimeString() : null

  const confirmNode = confirmIp !== null
    ? allNodes.find((n) => n.ip === confirmIp) ?? null
    : null

  /** Remove a node from monitoring via the API; the next snapshot (≤5s)
   *  drops it from the panel. */
  const removeNode = async (ip: string) => {
    try {
      await fetch(`/api/remote/nodes/${encodeURIComponent(ip)}`, { method: 'DELETE' })
    } catch { /* snapshot refresh reflects the change */ }
  }

  // Selected node (dropdown) — drives the detail view below.
  const selectedNode =
    allNodes.find((n) => (selectedId === LOCAL_ID ? isLocal(n) : n.ip === selectedId)) ?? null

  // Uniform chart keys: local history uses `gpuClockGraphics` for the clock;
  // remote buffers use `gpuClock`. Everything else matches.
  const nodeChartData = (node: RemoteNodeStatus) => (metric: string) => {
    if (isLocal(node)) {
      const key = metric === 'gpuClock' ? 'gpuClockGraphics' : metric
      return getLocalChartData(key)
    }
    return getRemoteChartData(node.ip, metric)
  }

  return (
    <div className={`${fill ? 'flex-1 min-h-0' : 'shrink-0'} mb-1.5 bg-[#0a0a0d]/80 rounded-xl border border-white/[0.03] p-1.5 lg:p-2 flex flex-col gap-1.5`}>
      {/* Panel header */}
      <div className="flex items-center gap-1.5 min-w-0 shrink-0">
        <span className="text-[10px] lg:text-[11px] 2xl:text-xs min-[1920px]:text-sm font-semibold text-zinc-200 tracking-tight shrink-0">
          Xpark 集群
        </span>
        <span className="text-zinc-600 shrink-0 hidden lg:inline">·</span>
        <span className="hidden lg:inline text-[10px] 2xl:text-[11px] min-[1920px]:text-xs text-zinc-400 truncate min-w-0">
          {allNodes.length} 节点 · {onlineNodes.length} 在线
        </span>

        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="ml-auto shrink-0 rounded-md border border-[#76B900]/30 bg-[#76B900]/[0.06] px-2 py-0.5 text-[10px] text-[#76B900] hover:bg-[#76B900]/[0.12] cursor-pointer transition-colors"
        >
          + 添加节点
        </button>

        <span className="shrink-0 text-[9px] lg:text-[10px] text-zinc-600 font-mono tabular-nums">
          更新于 {lastSeen ?? '--'}
        </span>
        {hasRemote && (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] cursor-pointer transition-colors"
          >
            {collapsed ? '展开' : '收起'}
          </button>
        )}
      </div>

      {!collapsed && hasRemote && (
        <>
          {/* 集群信息: 每个节点一张紧凑卡片，并列展示 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-1 lg:gap-1.5 shrink-0">
            {allNodes.map((node) => (
              <NodeSummaryCard key={isLocal(node) ? LOCAL_ID : node.ip} node={node} onDelete={(ip) => setConfirmIp(ip)} />
            ))}
          </div>

          {/* 节点详细信息 title row — node selector dropdown on its right */}
          <div className="flex items-center gap-1.5 min-w-0 shrink-0">
            <span className="text-[10px] lg:text-[11px] 2xl:text-xs font-semibold text-zinc-200 tracking-tight shrink-0">
              节点详细信息
            </span>
            <select
              value={selectedNode ? selectedId : LOCAL_ID}
              onChange={(e) => setSelectedId(e.target.value)}
              aria-label="选择查看节点"
              className="ml-auto shrink-0 rounded-md bg-[#151519] border border-white/[0.08] px-1.5 py-0.5 text-[10px] lg:text-[11px] text-zinc-200 focus:outline-none focus:border-[#76B900]/50 cursor-pointer max-w-[45%]"
            >
              {allNodes.map((n) => (
<option key={isLocal(n) ? LOCAL_ID : n.ip} value={isLocal(n) ? LOCAL_ID : n.ip}>
                  {n.hostname ?? n.ip}
                  {' · '}{n.ip}
                </option>
              ))}
            </select>
          </div>

          {/* One node's detailed system metrics at a time (default 本机) */}
          {(() => {
            const detailNode = selectedNode ?? local ?? nodes[0]
            if (!detailNode) return null
            return (
              <div className={`flex flex-col gap-1.5 min-w-0 ${fill ? 'flex-1 min-h-0' : ''}`}>
                {/* Node identity header: name/IP + status + actions */}
                <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                  <span
                    className={`inline-block size-1.5 rounded-full shrink-0 ${detailNode.online ? 'bg-[#76B900]' : 'bg-red-500'}`}
                    aria-hidden
                  />
                  <span className="text-xs lg:text-sm font-bold text-zinc-100 truncate min-w-0">
                    {detailNode.hostname ?? detailNode.ip}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono shrink-0 truncate" title={detailNode.ip}>
                    {detailNode.ip}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      detailNode.online
                        ? 'border-[#76B900]/30 bg-[#76B900]/[0.08] text-[#76B900]'
                        : 'border-red-500/30 bg-red-500/[0.08] text-red-400'
                    }`}
                  >
                    {detailNode.online ? '在线' : '离线'}
                  </span>
                  {!detailNode.online && (
                    <button
                      type="button"
                      onClick={() => setCredIp(detailNode.ip)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[#76B900]/90 hover:text-[#76B900] hover:bg-[#76B900]/[0.08] cursor-pointer transition-colors"
                    >
                      配置凭据
                    </button>
                  )}
                  {!isLocal(detailNode) && (
                    <button
                      type="button"
                      title="停止监控该节点"
                      aria-label={`删除节点 ${detailNode.hostname ?? detailNode.ip}`}
                      onClick={() => setConfirmIp(detailNode.ip)}
                      className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-red-400 hover:bg-red-500/[0.08] cursor-pointer transition-colors"
                    >
                      ✕ 停止监控
                    </button>
                  )}
                </div>

                {detailNode.online ? (
                  <NodeDetailView node={detailNode} chartData={nodeChartData(detailNode)} fill={fill} />
                ) : (
                  <div className="shrink-0 rounded-md border border-red-500/20 bg-red-500/[0.04] px-2 py-1.5 text-[10px] text-red-400/90 truncate min-w-0">
                    {detailNode.error ?? '无法连接'} — 点击右侧「配置凭据」导入 SSH 认证
                  </div>
                )}
              </div>
            )
          })()}
        </>
      )}

      {credIp !== null && (
        <RemoteCredentialDialog
          ip={credIp}
          onClose={() => setCredIp(null)}
          onSaved={() => setCredIp(null)}
        />
      )}

      {addOpen && (
        <AddNodeDialog onClose={() => setAddOpen(false)} />
      )}

      {/* Second-confirmation modal for removing a remote node (本机 excluded) */}
      {confirmNode !== null && !isLocal(confirmNode) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmIp(null)} />
          <div className="relative bg-[#0c0c10] border border-white/[0.1] rounded-xl p-5 w-[380px] max-w-[92vw] shadow-2xl">
            <h3 className="text-sm font-semibold text-zinc-100 mb-1">停止监控节点</h3>
            <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
              确定停止监控节点{' '}
              <span className="text-zinc-100 font-semibold">{confirmNode.hostname ?? confirmNode.ip}</span>
              {!isLocal(confirmNode) && (
                <span className="text-zinc-500 font-mono">（{confirmNode.ip}）</span>
              )}
              ？该节点将从系统资源监控中移除，已存储的 SSH 密钥会保留。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmIp(null)}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void removeNode(confirmNode.ip)
                  setConfirmIp(null)
                }}
                className="rounded-md bg-red-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-400 cursor-pointer transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
