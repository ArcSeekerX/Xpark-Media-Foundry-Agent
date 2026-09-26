import { useMemo, useRef, useState } from 'react'
import {
  Check,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Layers,
  RefreshCw,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { Asset, DiscardReason, Run, Shot } from '@/foundry/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { assetUrl } from './ReferenceAssets'

const DISCARD_REASONS: { value: DiscardReason; label: string }[] = [
  { value: 'identity_drift', label: '身份漂移' },
  { value: 'action_incomplete', label: '动作不全' },
  { value: 'composition_mismatch', label: '构图不符' },
  { value: 'flicker', label: '闪烁' },
  { value: 'deformation', label: '形变' },
  { value: 'audio_issue', label: '音频问题' },
  { value: 'other', label: '其他' },
]

type TypeFilter = 'all' | 'image' | 'video' | 'derived'
type StatusFilter = 'all' | 'candidate' | 'accepted' | 'discarded'

function Thumb({ asset }: { asset: Asset }) {
  const url = assetUrl(asset)
  if (asset.mediaType === 'video' && url) {
    return <video src={url} muted className="h-full w-full object-cover" />
  }
  if (url) return <img src={url} alt="" className="h-full w-full object-cover" />
  return (
    <div className="grid h-full w-full place-items-center bg-muted/60 text-muted-foreground">
      {asset.mediaType === 'video' ? <Film size={14} /> : <ImageIcon size={14} />}
    </div>
  )
}

function statusVariant(status: Asset['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'accepted') return 'default'
  if (status === 'discarded') return 'destructive'
  return 'outline'
}

const STATUS_LABEL: Record<string, string> = {
  accepted: '已采用',
  discarded: '已弃用',
  candidate: '候选',
}

export function DigitalAssets({
  assets,
  shots,
  runs,
  busy,
  onAccept,
  onDiscard,
  onRestore,
  onRegenerate,
  onSelectShot,
}: {
  assets: Asset[]
  shots: Shot[]
  runs: Run[]
  busy: boolean
  onAccept: (shotId: string, assetId: string) => void
  onDiscard: (assetId: string, reason: DiscardReason, note?: string) => void
  onRestore: (assetId: string) => void
  onRegenerate: (shotId: string) => void
  onSelectShot?: (shotId: string) => void
}) {
  const reasonRef = useRef<HTMLSelectElement>(null)
  const [type, setType] = useState<TypeFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')

  const shotTitle = useMemo(() => {
    const map = new Map<string, string>()
    shots.forEach((s) => map.set(s.shotId, s.title))
    return map
  }, [shots])

  const scoreOf = (asset: Asset): number | undefined => {
    const runId = typeof asset.metadata.runId === 'string' ? asset.metadata.runId : undefined
    const run = runId ? runs.find((r) => r.runId === runId) : undefined
    const scores = run?.score?.scores
    if (!scores) return undefined
    const vals = Object.values(scores)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined
  }

  const summary = useMemo(() => {
    const imported = assets.filter((a) => a.source === 'imported').length
    const generated = assets.filter((a) => a.source === 'generated').length
    const accepted = assets.filter((a) => a.status === 'accepted').length
    const discarded = assets.filter((a) => a.status === 'discarded').length
    const finals = assets.filter((a) => a.mediaType === 'video' && a.source === 'derived').length
    return { total: assets.length, imported, generated, accepted, discarded, finals }
  }, [assets])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assets
      .filter((a) => {
        if (type === 'image' && a.mediaType !== 'image') return false
        if (type === 'video' && a.mediaType !== 'video') return false
        if (type === 'derived' && a.source !== 'derived') return false
        if (status !== 'all' && (a.status ?? 'candidate') !== status) return false
        if (q) {
          const shotId = typeof a.metadata.shotId === 'string' ? a.metadata.shotId : ''
          const title = shotTitle.get(shotId) ?? ''
          const hay = `${title} ${a.storageKey} ${a.assetId}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .reverse()
  }, [assets, type, status, query, shotTitle])

  const chips: { key: string; label: string; value: number }[] = [
    { key: 'total', label: '资产总数', value: summary.total },
    { key: 'imported', label: '导入', value: summary.imported },
    { key: 'generated', label: '生成', value: summary.generated },
    { key: 'accepted', label: '已采用', value: summary.accepted },
    { key: 'discarded', label: '已弃用', value: summary.discarded },
    { key: 'finals', label: '成片', value: summary.finals },
  ]

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {chips.map((c) => (
          <div key={c.key} className="xp-metric">
            <div className="text-base font-semibold">{c.value}</div>
            <div className="text-[11px] text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {(['all', 'image', 'video', 'derived'] as TypeFilter[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={
                'rounded-md px-2.5 py-1 text-[11px] transition-colors ' +
                (type === t ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted')
              }
            >
              {t === 'all' ? '全部' : t === 'image' ? '图片' : t === 'video' ? '视频' : '成片'}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {(['all', 'candidate', 'accepted', 'discarded'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={
                'rounded-md px-2.5 py-1 text-[11px] transition-colors ' +
                (status === s ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted')
              }
            >
              {s === 'all' ? '全部状态' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索镜头 / 存储键…"
          className="h-7 min-w-[140px] flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring"
        />
        <select
          ref={reasonRef}
          disabled={busy}
          defaultValue="identity_drift"
          title="弃用原因"
          className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring"
        >
          {DISCARD_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          暂无数字资产。导入参考图或生成关键帧 / 视频后，会在这里统一管理。
        </div>
      ) : (
        <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
          {filtered.map((asset) => {
            const shotId = typeof asset.metadata.shotId === 'string' ? asset.metadata.shotId : ''
            const title = shotId ? (shotTitle.get(shotId) ?? shotId) : asset.storageKey
            const url = assetUrl(asset)
            const score = scoreOf(asset)
            const isMedia = asset.mediaType === 'image' || asset.mediaType === 'video'
            return (
              <div
                key={asset.assetId}
                className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-1.5 transition-colors hover:bg-muted/40"
              >
                <span className="size-9 shrink-0 overflow-hidden rounded-md bg-muted/60">
                  <Thumb asset={asset} />
                </span>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => shotId && onSelectShot?.(shotId)}
                  title={asset.storageKey}
                >
                  <div className="truncate text-[12.5px] font-medium">{title}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">
                    {asset.mediaType} · {asset.source}
                    {score !== undefined ? ` · ${score.toFixed(2)}` : ''}
                  </div>
                </button>
                <Badge variant={statusVariant(asset.status)} className="h-4 shrink-0 px-1.5 text-[9px]">
                  {STATUS_LABEL[asset.status ?? 'candidate']}
                </Badge>
                <div className="flex shrink-0 items-center gap-1">
                  {url && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="打开"
                      onClick={() => window.open(url, '_blank', 'noopener')}
                    >
                      <ExternalLink />
                    </Button>
                  )}
                  {isMedia && asset.status !== 'accepted' && shotId && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="采用"
                      disabled={busy}
                      onClick={() => onAccept(shotId, asset.assetId)}
                    >
                      <Check />
                    </Button>
                  )}
                  {isMedia && asset.status !== 'discarded' && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="弃用"
                      disabled={busy}
                      onClick={() =>
                        onDiscard(
                          asset.assetId,
                          (reasonRef.current?.value ?? 'other') as DiscardReason,
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  )}
                  {asset.status === 'discarded' && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="恢复"
                      disabled={busy}
                      onClick={() => onRestore(asset.assetId)}
                    >
                      <Undo2 />
                    </Button>
                  )}
                  {isMedia && shotId && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="重新生成"
                      disabled={busy}
                      onClick={() => onRegenerate(shotId)}
                    >
                      <RefreshCw />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <Layers size={11} /> 共 {filtered.length} / {assets.length} 项；采用版本参与成片，弃用版本保留在回收站。
      </div>
    </div>
  )
}
