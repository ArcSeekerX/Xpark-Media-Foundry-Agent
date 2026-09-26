import { useMemo, useRef, useState } from 'react'
import {
  Check,
  Film,
  Image as ImageIcon,
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

const REGEN_PRESETS = [
  { id: 'seed', label: '新种子', seedDelta: 1000 },
  { id: 'prompt1', label: '提示词变体 1', promptVariant: 1 },
  { id: 'prompt2', label: '提示词变体 2', promptVariant: 2 },
  { id: 'steps', label: '步数 +2', steps: 6 },
]

function Thumb({ asset }: { asset: Asset }) {
  const url = assetUrl(asset)
  if (asset.mediaType === 'video' && url) {
    return <video src={url} muted className="h-full w-full object-cover" />
  }
  if (url) return <img src={url} alt="" className="h-full w-full object-cover" />
  return (
    <div className="grid h-full w-full place-items-center bg-muted/60 text-muted-foreground">
      {asset.mediaType === 'video' ? <Film size={16} /> : <ImageIcon size={16} />}
    </div>
  )
}

function statusVariant(status: Asset['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'accepted') return 'default'
  if (status === 'discarded') return 'destructive'
  return 'outline'
}

export function CandidatePanel({
  shot,
  assets,
  runs,
  busy,
  onAccept,
  onDiscard,
  onRestore,
  onRegenerate,
}: {
  shot: Shot
  assets: Asset[]
  runs: Run[]
  busy: boolean
  onAccept: (assetId: string) => void
  onDiscard: (assetId: string, reason: DiscardReason, note?: string) => void
  onRestore: (assetId: string) => void
  onRegenerate: (options?: {
    seedDelta?: number
    promptVariant?: number
    steps?: number
    sampler?: string
  }) => void
}) {
  const reasonRef = useRef<HTMLSelectElement>(null)
  const [preset, setPreset] = useState('seed')

  const shotAssets = useMemo(
    () =>
      assets.filter(
        (a) =>
          a.metadata.shotId === shot.shotId &&
          (a.mediaType === 'image' || a.mediaType === 'video'),
      ),
    [assets, shot.shotId],
  )
  const candidates = shotAssets.filter((a) => a.status !== 'discarded')
  const recycled = shotAssets.filter((a) => a.status === 'discarded')

  const scoreOf = (asset: Asset): number | undefined => {
    const runId = typeof asset.metadata.runId === 'string' ? asset.metadata.runId : undefined
    const run = runId ? runs.find((r) => r.runId === runId) : undefined
    const scores = run?.score?.scores
    if (!scores) return undefined
    const vals = Object.values(scores)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={preset}
          disabled={busy}
          onChange={(e) => setPreset(e.target.value)}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring"
          title="重生成变体策略"
        >
          {REGEN_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            const found = REGEN_PRESETS.find((p) => p.id === preset)
            onRegenerate({
              seedDelta: found?.seedDelta,
              promptVariant: found?.promptVariant,
              steps: found?.steps,
            })
          }}
        >
          <RefreshCw /> 重新生成
        </Button>
        <select
          ref={reasonRef}
          disabled={busy}
          defaultValue="identity_drift"
          className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring"
          title="弃用原因"
        >
          {DISCARD_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="ml-auto flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            候选 {candidates.length}
          </Badge>
          {recycled.length > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              回收 {recycled.length}
            </Badge>
          )}
        </span>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          尚无候选产物。生成后会出现在这里，可对比、采用、弃用或重新生成。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {candidates.map((asset) => {
            const score = scoreOf(asset)
            return (
              <div
                key={asset.assetId}
                className={
                  'group relative overflow-hidden rounded-lg border bg-muted/40 ' +
                  (asset.status === 'accepted'
                    ? 'border-[#76B900] ring-1 ring-[#76B900]/50'
                    : 'border-border')
                }
              >
                <div className="aspect-[4/5]">
                  <Thumb asset={asset} />
                </div>
                <div className="absolute left-1.5 top-1.5 flex gap-1">
                  <Badge variant={statusVariant(asset.status)} className="h-4 px-1.5 text-[9px]">
                    {asset.status === 'accepted' ? '已采用' : '候选'}
                  </Badge>
                  {score !== undefined && (
                    <Badge variant="outline" className="h-4 bg-background/70 px-1.5 text-[9px]">
                      {score.toFixed(2)}
                    </Badge>
                  )}
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent p-1.5 pt-6">
                  <Button
                    size="xs"
                    variant={asset.status === 'accepted' ? 'secondary' : 'default'}
                    disabled={busy || asset.status === 'accepted'}
                    onClick={() => onAccept(asset.assetId)}
                  >
                    <Check /> 采用
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      onDiscard(
                        asset.assetId,
                        (reasonRef.current?.value ?? 'other') as DiscardReason,
                      )
                    }
                  >
                    <Trash2 /> 弃用
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {recycled.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">废图 / 废视频回收站</div>
          <div className="space-y-1">
            {recycled.map((asset) => (
              <div
                key={asset.assetId}
                className="flex items-center gap-2 rounded-md border border-border bg-muted/20 p-1.5"
              >
                <span className="size-8 shrink-0 overflow-hidden rounded bg-muted/60">
                  <Thumb asset={asset} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {asset.mediaType} · {asset.discard?.reasonTag ?? 'other'}
                  {asset.discard?.note ? ` · ${asset.discard.note}` : ''}
                </span>
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => onRestore(asset.assetId)}>
                  <Undo2 /> 恢复
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    onRestore(asset.assetId)
                    onRegenerate({ seedDelta: 1000 })
                  }}
                >
                  <RefreshCw /> 重生成
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
