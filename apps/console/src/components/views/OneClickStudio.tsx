import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Film,
  ImagePlus,
  Loader2,
  Play,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useAgentFlow } from '@/foundry/flow/useAgentFlow'
import type { ProductionParams } from '@/foundry/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { assetUrl } from './ReferenceAssets'

const DEFAULT_PARAMS: ProductionParams = {
  aspectRatio: '9:16',
  frames: 22,
  steps: 4,
  sampler: 'res_multistep',
  seed: 20260926,
  style: 'cinematic short-form, natural lighting',
  narrate: true,
  maxShots: 6,
  autoCompose: true,
}

const ASPECTS: ProductionParams['aspectRatio'][] = ['9:16', '16:9', '1:1']
const SAMPLERS = ['res_multistep', 'euler', 'dpmpp_2m', 'lcm']

const DEMO_SCRIPT = `# 雨夜来信 · 预告
## 开场
女主角推门走上雨夜天台，风衣被风吹起。
## 转折
她停下脚步，缓缓回头，看向远处的红色信号灯。
## 结尾
雨滴落在手机屏幕上，她握紧手机，眼神坚定。`

function svgImageFile(name: string, label: string, hue: number): File {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="hsl(${hue},55%,40%)"/>`,
    `<stop offset="1" stop-color="hsl(${(hue + 45) % 360},60%,18%)"/>`,
    `</linearGradient></defs>`,
    `<rect width="100%" height="100%" fill="url(#g)"/>`,
    `<text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="34" text-anchor="middle">${label}</text>`,
    `</svg>`,
  ].join('')
  return new File([svg], name, { type: 'image/svg+xml' })
}

function FileDrop({
  label,
  icon,
  accept,
  files,
  onPick,
  onRemove,
}: {
  label: string
  icon: ReactNode
  accept: string
  files: File[]
  onPick: (files: File[]) => void
  onRemove: (index: number) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onPick(Array.from(e.dataTransfer.files))
      }}
      className={
        'rounded-xl border border-dashed p-3 transition-colors ' +
        (over ? 'border-primary bg-primary/5' : 'border-border bg-muted/20')
      }
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          onPick(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-background text-[#76B900] ring-1 ring-border">
          {icon}
        </span>
        <span className="text-sm font-medium">{label}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">点击或拖拽</span>
      </button>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded-md bg-background px-2 py-1 text-[11px] ring-1 ring-border"
            >
              <span className="truncate">{f.name}</span>
              <button
                className="ml-auto text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(i)}
                title="移除"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function OneClickStudio() {
  const flow = useAgentFlow()
  const { state } = flow
  const [title, setTitle] = useState('一键出片项目')
  const [mdFiles, setMdFiles] = useState<File[]>([])
  const [images, setImages] = useState<File[]>([])
  const [params, setParams] = useState<ProductionParams>(DEFAULT_PARAMS)

  const accepted = state.shots.filter((s) => s.phase === 'ACCEPTED').length
  const total = state.shots.length
  const running = state.busy
  const progress = total > 0 ? Math.round((accepted / total) * 100) : 0
  const stageIndex =
    state.finalAsset || state.phase === 'composing'
      ? 4
      : state.shots.length > 0
        ? running
          ? accepted > 0
            ? 3
            : 2
          : accepted === total
            ? 3
            : 1
        : 0
  const latestEvent = state.events.at(-1)?.summary ?? ''

  const shotPreviews = useMemo(() => {
    return state.shots.map((shot) => {
      const run = [...state.runs].reverse().find((r) => r.shotId === shot.shotId)
      const id = run?.artifactIds.at(-1)
      const asset = id ? state.assets.find((a) => a.assetId === id) : undefined
      const refId = shot.bindings[0]?.assetId
      const ref = refId ? state.assets.find((a) => a.assetId === refId) : undefined
      const step = [...state.steps]
        .reverse()
        .find((st) => st.shotId === shot.shotId && st.state === 'running')
      const done = shot.phase === 'ACCEPTED'
      const ratio = step?.progress
        ? Math.min(1, step.progress.current / step.progress.total)
        : done
          ? 1
          : shot.phase === 'PLANNED'
            ? 0
            : 0.12
      return {
        shot,
        url: assetUrl(asset) ?? assetUrl(ref),
        mediaType: asset?.mediaType ?? ref?.mediaType,
        ratio,
        running: Boolean(step),
      }
    })
  }, [state.shots, state.runs, state.assets, state.steps])

  const finalUrl =
    typeof state.finalAsset?.metadata.remoteUrl === 'string'
      ? state.finalAsset.metadata.remoteUrl
      : undefined

  const set = <K extends keyof ProductionParams>(key: K, value: ProductionParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }))

  const addDemo = () => {
    setTitle('雨夜来信 · 预告')
    setMdFiles([new File([DEMO_SCRIPT], '雨夜来信.md', { type: 'text/markdown' })])
    setImages([
      svgImageFile('shot-01.svg', '雨夜天台', 220),
      svgImageFile('shot-02.svg', '回头', 265),
      svgImageFile('shot-03.svg', '特写', 300),
    ])
  }

  const run = () => {
    if (running || images.length === 0) return
    void flow.produceFromMaterials({ title, mdFiles, images, params })
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4">
        {/* Inputs */}
        <div className="flex flex-col gap-4 xp-stagger">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Wand2 size={16} className="text-[#76B900]" /> 一键出片 · 素材
              </CardTitle>
              <Button size="sm" variant="outline" onClick={addDemo} disabled={running}>
                <Sparkles /> 载入示例素材
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="项目标题"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
              />
              <FileDrop
                label="文本素材（.md / .txt）"
                icon={<FileText size={15} />}
                accept=".md,.markdown,.txt,text/*"
                files={mdFiles}
                onPick={(f) => setMdFiles((prev) => [...prev, ...f])}
                onRemove={(i) => setMdFiles((p) => p.filter((_, idx) => idx !== i))}
              />
              <FileDrop
                label="图片素材（按顺序对应镜头）"
                icon={<ImagePlus size={15} />}
                accept="image/*"
                files={images}
                onPick={(f) =>
                  setImages((prev) => [...prev, ...f.filter((x) => x.type.startsWith('image/'))])
                }
                onRemove={(i) => setImages((p) => p.filter((_, idx) => idx !== i))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 size={16} className="text-[#76B900]" /> 出片参数
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Collapsible title="基础参数" icon={<Settings2 size={13} />} defaultOpen>
                <div>
                  <div className="mb-1.5 text-[11px] text-muted-foreground">画面比例</div>
                  <div className="flex gap-2">
                    {ASPECTS.map((a) => (
                      <button
                        key={a}
                        onClick={() => set('aspectRatio', a)}
                        className={
                          'rounded-lg border px-3 py-1.5 text-xs transition-colors ' +
                          (params.aspectRatio === a
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:bg-muted')
                        }
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="片段帧数">
                    <input
                      type="number"
                      min={1}
                      value={params.frames}
                      onChange={(e) => set('frames', Number(e.target.value) || 1)}
                      className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none"
                    />
                  </Field>
                  <Field label="最多镜头">
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={params.maxShots}
                      onChange={(e) => set('maxShots', Number(e.target.value) || 1)}
                      className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none"
                    />
                  </Field>
                </div>
                <Toggle
                  label="自动剪辑成片"
                  checked={params.autoCompose}
                  onChange={(v) => set('autoCompose', v)}
                />
              </Collapsible>

              <Collapsible title="生成参数" icon={<SlidersHorizontal size={13} />} defaultOpen>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="采样步数">
                    <input
                      type="number"
                      min={1}
                      value={params.steps}
                      onChange={(e) => set('steps', Number(e.target.value) || 1)}
                      className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none"
                    />
                  </Field>
                  <Field label="采样器">
                    <select
                      value={params.sampler}
                      onChange={(e) => set('sampler', e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none"
                    >
                      {SAMPLERS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="随机种子">
                    <input
                      type="number"
                      value={params.seed}
                      onChange={(e) => set('seed', Number(e.target.value) || 0)}
                      className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none"
                    />
                  </Field>
                </div>
                <Field label="风格描述">
                  <textarea
                    value={params.style}
                    onChange={(e) => set('style', e.target.value)}
                    className="min-h-[52px] w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus-visible:border-ring"
                  />
                </Field>
                <Toggle label="生成旁白" checked={params.narrate} onChange={(v) => set('narrate', v)} />
              </Collapsible>

              <Button className="w-full" disabled={running || images.length === 0} onClick={run}>
                {running ? <Loader2 className="animate-spin" /> : <Wand2 />}
                {running ? '正在一键出片…' : '一键出片'}
              </Button>
              {images.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  至少导入一张图片素材；可点「载入示例素材」快速体验。
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Output */}
        <div className="flex flex-col gap-4 xp-stagger">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Activity size={16} className="text-[#76B900]" /> 阶段进度
              </CardTitle>
              <Badge variant={running ? 'default' : 'outline'} className="text-[10px]">
                {running ? '执行中' : state.finalAsset ? '已完成' : '待开始'}
              </Badge>
            </CardHeader>
            <CardContent>
              <StageProgress
                stageIndex={stageIndex}
                progress={progress}
                running={running}
                message={latestEvent}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Film size={16} className="text-[#76B900]" /> 出片进度
              </CardTitle>
              <Badge variant={total > 0 && accepted === total ? 'default' : 'outline'}>
                已验收 {accepted}/{total}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="xp-progress h-full rounded-full bg-[#76B900]"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-muted/50 to-muted/10">
                <div className="grid min-h-[240px] place-items-center">
                  {finalUrl ? (
                    <video
                      key={finalUrl}
                      src={finalUrl}
                      controls
                      muted
                      className="max-h-[340px] w-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-xs text-muted-foreground">
                      <Film size={26} className="opacity-60" />
                      成片将在这里播放：材料 → 分镜 → 逐镜生成 → 质检 → 自动剪辑
                    </div>
                  )}
                </div>
                {state.finalAsset && (
                  <div className="absolute left-2 top-2 flex gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      成片
                    </Badge>
                    <Badge variant="outline" className="bg-background/70 text-[10px]">
                      {String(state.finalAsset.metadata.shots ?? 0)} 镜头
                    </Badge>
                  </div>
                )}
              </div>

              {state.finalAsset && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Download size={13} />
                  <span className="font-mono">{state.finalAsset.storageKey}</span>
                  {finalUrl && (
                    <a
                      className="text-primary underline-offset-4 hover:underline"
                      href={finalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开成片
                    </a>
                  )}
                </div>
              )}
              {state.archive && (
                <div className="text-xs text-muted-foreground">
                  归档：{state.archive.manifestKey}（{state.archive.assetIds.length} 个资产）
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-[#76B900]" /> 镜头列表
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {shotPreviews.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  还没有镜头。导入素材并点击「一键出片」后，这里会显示每个镜头的生成状态。
                </p>
              )}
              {shotPreviews.map(({ shot, url, mediaType, ratio, running: shotRunning }, i) => (
                <div
                  key={shot.shotId}
                  className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-2"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-background text-[11px] font-medium ring-1 ring-border">
                    {i + 1}
                  </span>
                  <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-muted/60">
                    {url ? (
                      mediaType === 'video' ? (
                        <video src={url} muted className="h-full w-full object-cover" />
                      ) : (
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      )
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">{shot.title}</span>
                      {shotRunning && (
                        <Loader2 size={11} className="shrink-0 animate-spin text-[#76B900]" />
                      )}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {shot.spec.action}
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={
                          'h-full rounded-full bg-[#76B900] transition-all duration-500 ' +
                          (shotRunning ? 'xp-progress' : '')
                        }
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                      />
                    </div>
                  </div>
                  <PhaseBadge phase={shot.phase} />
                  {shot.phase !== 'ACCEPTED' && (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={running}
                      onClick={() => void flow.generateShot(shot.shotId)}
                    >
                      <Play /> 重试
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>事件流</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-44 overflow-y-auto font-mono text-[11px] leading-relaxed">
                {state.events.length === 0 && (
                  <p className="font-sans text-sm text-muted-foreground">事件流为空。</p>
                )}
                {state.events
                  .slice(-60)
                  .reverse()
                  .map((e) => (
                    <div key={e.eventId} className="border-b border-border/60 py-0.5">
                      <span className="text-muted-foreground">#{e.seq}</span> <b>{e.type}</b>{' '}
                      {e.summary}
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Collapsible({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string
  icon?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-border bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {icon}
        <span className="text-xs font-medium">{title}</span>
        <ChevronDown
          size={14}
          className={
            'ml-auto text-muted-foreground transition-transform duration-300 ' +
            (open ? 'rotate-180' : '')
          }
        />
      </button>
      <div
        className={
          'grid transition-all duration-300 ease-out ' +
          (open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')
        }
      >
        <div className="overflow-hidden">
          <div className="space-y-3 px-3 pb-3 pt-1">{children}</div>
        </div>
      </div>
    </div>
  )
}

const STAGES = ['素材解析', '分镜编排', '逐镜生成', '质检修复', '剪辑成片']

function StageProgress({
  stageIndex,
  progress,
  running,
  message,
}: {
  stageIndex: number
  progress: number
  running: boolean
  message: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start">
        {STAGES.map((stage, i) => {
          const done = i < stageIndex
          const active = i === stageIndex
          return (
            <div key={stage} className={'flex items-start ' + (i < STAGES.length - 1 ? 'flex-1' : '')}>
              <div className="flex flex-col items-center gap-1">
                <span
                  className={
                    'grid size-6 place-items-center rounded-full border text-[10px] transition-all duration-300 ' +
                    (done
                      ? 'border-[#76B900] bg-[#76B900] text-black'
                      : active
                        ? 'border-[#76B900] text-[#76B900] xp-live'
                        : 'border-border text-muted-foreground')
                  }
                >
                  {done ? <Check size={12} /> : i + 1}
                </span>
                <span
                  className={
                    'whitespace-nowrap text-[10px] ' +
                    (active ? 'text-foreground' : 'text-muted-foreground')
                  }
                >
                  {stage}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <div className="mx-1 mt-3 h-0.5 flex-1 overflow-hidden rounded bg-muted">
                  <i
                    className={
                      'block h-full bg-[#76B900] transition-all duration-500 ' +
                      (done ? 'w-full' : active ? 'w-1/2' : 'w-0')
                    }
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="xp-progress h-full rounded-full bg-[#76B900]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex min-h-[16px] items-center gap-2 text-[11px] text-muted-foreground">
        {running && <Loader2 size={12} className="animate-spin text-[#76B900]" />}
        <span className="xp-fade-in truncate">{message || '等待开始…'}</span>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[#76B900]"
      />
      {label}
    </label>
  )
}

const PHASE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  ACCEPTED: 'default',
  HUMAN_REVIEW: 'secondary',
  FAILED: 'destructive',
}

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <Badge variant={PHASE_VARIANT[phase] ?? 'outline'} className="shrink-0 text-[10px]">
      {phase}
    </Badge>
  )
}
