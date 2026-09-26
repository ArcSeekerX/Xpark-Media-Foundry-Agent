import { useRef } from 'react'
import { ImagePlus, Sparkles, Trash2, Upload, Link2 } from 'lucide-react'
import type { Asset, AssetBinding, Shot } from '@/foundry/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const BINDING_ROLES: AssetBinding['role'][] = [
  'character',
  'scene',
  'first_frame',
  'last_frame',
  'reuse_clip',
  'audio',
]

const ROLE_LABEL: Record<AssetBinding['role'], string> = {
  character: '角色',
  scene: '场景',
  first_frame: '首帧',
  last_frame: '尾帧',
  reuse_clip: '复用片段',
  audio: '音频',
}

export function assetUrl(asset: Asset | undefined): string | undefined {
  if (!asset) return undefined
  const url = asset.metadata.remoteUrl ?? asset.metadata.dataUrl
  return typeof url === 'string' ? url : undefined
}

function Thumb({ asset }: { asset: Asset | undefined }) {
  const url = assetUrl(asset)
  if (asset?.mediaType === 'video' && url) {
    return <video src={url} muted className="h-full w-full object-cover" />
  }
  if (url) {
    return <img src={url} alt="" className="h-full w-full object-cover" />
  }
  return (
    <div className="grid h-full w-full place-items-center bg-muted/60 text-muted-foreground">
      <ImagePlus size={16} />
    </div>
  )
}

export function ReferenceAssets({
  shot,
  assets,
  busy,
  imageReady,
  imageName,
  onImport,
  onBind,
  onUnbind,
  onGenerate,
}: {
  shot: Shot
  assets: Asset[]
  busy: boolean
  imageReady: boolean
  imageName: string
  onImport: (file: File, role: AssetBinding['role']) => void
  onBind: (assetId: string, role: AssetBinding['role']) => void
  onUnbind: (bindingId: string) => void
  onGenerate: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const roleRef = useRef<HTMLSelectElement>(null)

  const boundIds = new Set(shot.bindings.map((b) => b.assetId))
  const bound = shot.bindings
    .map((b) => ({ binding: b, asset: assets.find((a) => a.assetId === b.assetId) }))
    .filter((x) => x.asset)
  const available = assets.filter(
    (a) => a.mediaType === 'image' && !boundIds.has(a.assetId),
  )

  const currentRole = () => (roleRef.current?.value ?? 'character') as AssetBinding['role']

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          ref={roleRef}
          disabled={busy}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring"
          defaultValue="character"
        >
          {BINDING_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onImport(file, currentRole())
            e.target.value = ''
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload /> 上传参考图
        </Button>
        <Button
          size="sm"
          disabled={busy || !imageReady}
          onClick={onGenerate}
          title={imageReady ? `调用 ${imageName} 生成关键帧` : '生图适配器未启用'}
        >
          <Sparkles /> 生成关键帧
        </Button>
        <span className="ml-auto flex items-center gap-1.5">
          <Badge variant={imageReady ? 'default' : 'outline'} className="text-[10px]">
            生图 {imageReady ? 'ready' : 'off'}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            已绑定 {bound.length}
          </Badge>
        </span>
      </div>

      {bound.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          尚无参考素材。上传角色 / 场景参考图，或直接生成关键帧；生产时优先复用导入素材。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {bound.map(({ binding, asset }) => (
            <div
              key={binding.bindingId}
              className="group relative aspect-[4/5] overflow-hidden rounded-lg border border-border bg-muted/40"
            >
              <Thumb asset={asset} />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-5">
                <span className="text-[10px] font-medium text-white/90">
                  {ROLE_LABEL[binding.role]}
                </span>
                <Badge
                  variant={asset?.source === 'imported' ? 'secondary' : 'default'}
                  className="h-4 px-1.5 text-[9px]"
                >
                  {asset?.source === 'imported' ? '导入' : '生成'}
                </Badge>
              </div>
              <button
                onClick={() => onUnbind(binding.bindingId)}
                title="解除绑定"
                className="absolute right-1 top-1 rounded-md bg-black/55 p-1 text-white/90 opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">素材库</div>
          <div className="flex flex-wrap gap-2">
            {available.map((asset) => {
              const url = assetUrl(asset)
              return (
                <button
                  key={asset.assetId}
                  disabled={busy}
                  onClick={() => onBind(asset.assetId, currentRole())}
                  className={cn(
                    'group flex items-center gap-2 rounded-lg border border-border bg-background p-1.5 pr-2 text-left transition-colors',
                    'hover:border-primary/60 hover:bg-muted disabled:opacity-50',
                  )}
                  title="点击绑定到当前镜头"
                >
                  <span className="size-8 overflow-hidden rounded-md bg-muted/60">
                    {url ? (
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-muted-foreground">
                        <ImagePlus size={12} />
                      </span>
                    )}
                  </span>
                  <span className="max-w-[96px] truncate text-[11px]">
                    {typeof asset.metadata.name === 'string'
                      ? asset.metadata.name
                      : asset.assetId}
                  </span>
                  <Link2 size={12} className="text-muted-foreground group-hover:text-primary" />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
