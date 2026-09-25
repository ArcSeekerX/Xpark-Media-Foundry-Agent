import { ArcGauge } from '@/components/gauges/ArcGauge'
import { CoreHeatmap } from '@/components/charts/CoreHeatmap'
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart'
import { formatBytes, formatGiB, formatMhz, formatRate } from '@/lib/format'
import { THRESHOLDS } from '@/lib/theme'
import type { RemoteNodeStatus } from '@/types/metrics'

interface ChartPoint {
  timestamp: number
  value: number
}

interface NodeDetailViewProps {
  node: RemoteNodeStatus
  /** Chart history accessor using uniform metric keys (gpuUtil/gpuTemp/
   *  gpuPower/gpuClock/cpuAggregate/memoryUsedPercent/diskRead/diskWrite/
   *  networkRx/networkTx). */
  chartData: (metric: string) => ChartPoint[]
  /** Fill the available vertical space (cluster-mode layout): the card grid
   *  stretches and rows share the height equally. */
  fill?: boolean
}

/** Shared responsive height for the detail mini-charts and gauges. */
const DETAIL_CHART_HEIGHT = 'clamp(28px, 7vh, 140px)'
const DETAIL_GAUGE_PX = 'clamp(36px, 5vw, 96px)'

const DISK_READ_COLOR = '#76B900'
const DISK_WRITE_COLOR = '#F59E0B'
const TOTAL_COLOR = '#A1A1AA'
const NET_RX_COLOR = '#3B82F6'
const NET_TX_COLOR = '#A855F7'

function sumSeries(
  a: ChartPoint[],
  b: ChartPoint[],
): ChartPoint[] {
  const map = new Map<number, number>()
  for (const p of a) map.set(p.timestamp, p.value)
  for (const p of b) map.set(p.timestamp, (map.get(p.timestamp) ?? 0) + p.value)
  return Array.from(map.entries())
    .sort((x, y) => x[0] - y[0])
    .map(([timestamp, value]) => ({ timestamp, value }))
}

function DetailCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-[#111115] rounded-md sm:rounded-lg border border-white/[0.04] px-1.5 pt-1 pb-0.5 lg:px-2 lg:pt-1.5 lg:pb-1 flex flex-col min-h-0 min-w-0 overflow-hidden transition-colors duration-200 hover:border-[#76B900]/10">
      <div className="mb-0.5 2xl:mb-1 flex items-baseline gap-1.5 min-w-0 shrink-0">
        <span className="text-[10px] lg:text-[11px] 2xl:text-xs font-semibold text-zinc-200 tracking-tight shrink-0">{title}</span>
        {subtitle && <span className="hidden lg:inline text-[10px] text-zinc-400 truncate min-w-0" title={subtitle}>{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

/** Detailed system-metrics view for one node (本机 or remote), mirroring the
 *  local hardware overview cards: gauge + time-series chart per metric. */
export function NodeDetailView({ node, chartData, fill }: NodeDetailViewProps) {
  const gpu = node.gpus[0]
  const powerHistory = chartData('gpuPower')

  const memTotal = node.memory_total_bytes ?? 0
  const memUsed = node.memory_used_bytes ?? 0
  const memPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0

  const diskRead = chartData('diskRead')
  const diskWrite = chartData('diskWrite')
  const diskTotal = sumSeries(diskRead, diskWrite)
  const networkRx = chartData('networkRx')
  const networkTx = chartData('networkTx')
  const networkTotal = sumSeries(networkRx, networkTx)

  const diskTotalBytes = node.disk_total_bytes ?? 0
  const diskUsedBytes = node.disk_used_bytes ?? 0
  const diskUsedPercent = diskTotalBytes > 0 ? (diskUsedBytes / diskTotalBytes) * 100 : 0

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 gap-1 lg:gap-1.5 ${fill ? 'flex-1 auto-rows-fr' : ''}`}>
      {/* GPU Utilization */}
      <DetailCard title="GPU Utilization">
        <div className="flex items-center gap-2 min-w-0 min-h-0 flex-1 overflow-hidden">
          <ArcGauge value={gpu?.utilization_percent ?? 0} label="" unit="%" size={DETAIL_GAUGE_PX} />
          <div className="flex-1 min-w-0">
            <TimeSeriesChart data={chartData('gpuUtil')} yDomain={[0, 100]} unit="%" height={DETAIL_CHART_HEIGHT} />
          </div>
        </div>
      </DetailCard>

      {/* GPU Temperature */}
      <DetailCard title="GPU Temp">
        <div className="flex items-center gap-2 min-w-0 min-h-0 flex-1 overflow-hidden">
          <ArcGauge value={gpu?.temperature_celsius ?? 0} label="" unit="°C" thresholds={THRESHOLDS.gpuTemp} size={DETAIL_GAUGE_PX} />
          <div className="flex-1 min-w-0">
            <TimeSeriesChart data={chartData('gpuTemp')} yDomain={[0, 100]} unit="°C" height={DETAIL_CHART_HEIGHT} />
          </div>
        </div>
      </DetailCard>

      {/* GPU Power */}
      <DetailCard title="GPU Power">
        <div className="flex items-center gap-2 min-w-0 min-h-0 flex-1 overflow-hidden">
          <div className="flex flex-col items-center justify-center shrink-0" style={{ width: DETAIL_GAUGE_PX, height: DETAIL_GAUGE_PX }}>
            <span className="text-sm 2xl:text-base font-bold text-zinc-100 font-mono tabular-nums">
              {gpu?.power_watts !== null && gpu?.power_watts !== undefined ? `${Math.round(gpu.power_watts)} W` : '--'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <TimeSeriesChart data={powerHistory} unit="W" height={DETAIL_CHART_HEIGHT} />
          </div>
        </div>
      </DetailCard>

      {/* GPU Clock */}
      <DetailCard title="GPU Clock">
        <div className="flex items-center gap-2 min-w-0 min-h-0 flex-1 overflow-hidden">
          <div className="flex flex-col items-center justify-center shrink-0" style={{ width: DETAIL_GAUGE_PX, height: DETAIL_GAUGE_PX }}>
            <span className="text-sm 2xl:text-base font-bold text-zinc-100 font-mono">{formatMhz(gpu?.clock_graphics_mhz ?? null)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <TimeSeriesChart data={chartData('gpuClock')} unit="MHz" height={DETAIL_CHART_HEIGHT} />
          </div>
        </div>
      </DetailCard>

      {/* CPU */}
      <DetailCard title="CPU">
        <div className="flex items-center gap-2 min-w-0 min-h-0 flex-1 overflow-hidden">
          <ArcGauge value={node.cpu_percent ?? 0} label="" unit="%" thresholds={THRESHOLDS.cpuUsage} size={DETAIL_GAUGE_PX} />
          <div className="flex-1 min-w-0">
            <TimeSeriesChart data={chartData('cpuAggregate')} yDomain={[0, 100]} unit="%" height={DETAIL_CHART_HEIGHT} />
          </div>
        </div>
        {node.per_core && node.per_core.length > 0 && <CoreHeatmap cores={node.per_core} />}
      </DetailCard>

      {/* Memory */}
      <DetailCard title="Memory" subtitle={memTotal > 0 ? `${formatGiB(memTotal)} Unified` : undefined}>
        <div className="flex items-center justify-center min-h-0 flex-1 overflow-hidden">
          <ArcGauge value={memPercent} label="" unit="%" thresholds={THRESHOLDS.memoryUsage} size={DETAIL_GAUGE_PX} />
        </div>
        <div className="text-[9px] text-zinc-500 font-mono tabular-nums truncate">
          {memTotal > 0 ? `${formatBytes(memUsed)} / ${formatBytes(memTotal)}` : '--'}
        </div>
      </DetailCard>

      {/* Disk I/O */}
      <DetailCard title="Disk I/O" subtitle={node.disk_target_name ?? undefined}>
        <div className="flex items-center gap-2 min-w-0 min-h-0 flex-1 overflow-hidden">
          <div className="flex flex-col items-center justify-center gap-0.5 shrink-0" style={{ width: DETAIL_GAUGE_PX, height: DETAIL_GAUGE_PX }}>
            <div className="flex items-baseline gap-1">
              <span className="text-[9px] 2xl:text-[10px] text-zinc-500">R</span>
              <span className="text-xs 2xl:text-sm font-bold text-zinc-100 font-mono">{formatRate(node.disk_read_bytes_per_sec ?? 0)}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[9px] 2xl:text-[10px] text-zinc-500">W</span>
              <span className="text-xs 2xl:text-sm font-bold text-zinc-100 font-mono">{formatRate(node.disk_write_bytes_per_sec ?? 0)}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <TimeSeriesChart
              series={[
                { data: diskTotal, label: 'Total', color: TOTAL_COLOR },
                { data: diskRead, label: 'Read', color: DISK_READ_COLOR },
                { data: diskWrite, label: 'Write', color: DISK_WRITE_COLOR },
              ]}
              unit="B/s"
              height={DETAIL_CHART_HEIGHT}
            />
          </div>
        </div>
        {diskTotalBytes > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-white/[0.04]">
            <div className="flex justify-between text-[10px] text-zinc-600 mb-1">
              <span>{node.disk_target_name ?? 'Disk'}</span>
              <span className="tabular-nums">
                已使用 {diskUsedPercent.toFixed(1)}%
                <span className="ml-2 text-zinc-700">{formatBytes(diskUsedBytes)}<span className="mx-2 text-zinc-700">/</span>{formatBytes(diskTotalBytes)}</span>
              </span>
            </div>
            <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.min(diskUsedPercent, 100)}%`,
                  backgroundColor: diskUsedPercent > 85 ? '#EF4444' : diskUsedPercent > 70 ? '#F59E0B' : '#76B900',
                }}
              />
            </div>
          </div>
        )}
      </DetailCard>

      {/* Network */}
      <DetailCard title="Network">
        <div className="flex items-center gap-2 min-w-0 min-h-0 flex-1 overflow-hidden">
          <div className="flex flex-col items-center justify-center gap-0.5 shrink-0" style={{ width: DETAIL_GAUGE_PX, height: DETAIL_GAUGE_PX }}>
            <div className="flex items-baseline gap-1">
              <span className="text-[9px] 2xl:text-[10px] text-zinc-500">RX</span>
              <span className="text-xs 2xl:text-sm font-bold text-zinc-100 font-mono">{formatRate(node.network_rx_bytes_per_sec ?? 0)}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[9px] 2xl:text-[10px] text-zinc-500">TX</span>
              <span className="text-xs 2xl:text-sm font-bold text-zinc-100 font-mono">{formatRate(node.network_tx_bytes_per_sec ?? 0)}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <TimeSeriesChart
              series={[
                { data: networkTotal, label: 'Total', color: TOTAL_COLOR },
                { data: networkRx, label: 'RX', color: NET_RX_COLOR },
                { data: networkTx, label: 'TX', color: NET_TX_COLOR },
              ]}
              unit="B/s"
              height={DETAIL_CHART_HEIGHT}
            />
          </div>
        </div>
      </DetailCard>
    </div>
  )
}
