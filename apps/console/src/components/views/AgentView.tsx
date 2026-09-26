import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Bot,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Layers,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Wand2,
} from 'lucide-react'
import { useAgentFlow } from '@/foundry/flow/useAgentFlow'
import { SKILLS } from '@/foundry/skills/registry'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ReferenceAssets, assetUrl } from './ReferenceAssets'
import { CandidatePanel } from './CandidatePanel'
import type { Asset, Shot } from '@/foundry/types'

function firstImageUrl(shot: Shot, assets: Asset[]): string | undefined {
  for (const binding of shot.bindings) {
    const asset = assets.find((a) => a.assetId === binding.assetId)
    if (asset?.mediaType === 'image') {
      const url = assetUrl(asset)
      if (url) return url
    }
  }
  return undefined
}

const EXAMPLES = [
  '做一个雨夜天台短剧：女主停步回头看向红色信号灯，5 秒',
  '夏日公园里动漫少女微笑挥手打招呼，两镜头',
  '把这张手绘流程图做成 5 秒图解动画，元素按顺序浮现',
  '演播室口播特写：讲师强调关键结论',
]

const PHASE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  ACCEPTED: 'default',
  HUMAN_REVIEW: 'secondary',
  FAILED: 'destructive',
}

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <Badge variant={PHASE_VARIANT[phase] ?? 'outline'} className="text-[10px]">
      {phase}
    </Badge>
  )
}

export function AgentView() {
  const flow = useAgentFlow()
  const { state } = flow
  const [text, setText] = useState('')
  const [activeShotId, setActiveShotId] = useState<string | undefined>()
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [rightTab, setRightTab] = useState<'assets' | 'production' | 'runtime'>('assets')

  useEffect(() => {
    const backend = flow.adapters.backend
    if (!backend?.available) {
      setBackendOk(false)
      return
    }
    let alive = true
    backend
      .health()
      .then(() => alive && setBackendOk(true))
      .catch(() => alive && setBackendOk(false))
    return () => {
      alive = false
    }
  }, [flow.adapters.backend])

  const activeShot = useMemo(
    () => state.shots.find((s) => s.shotId === activeShotId) ?? state.shots[0],
    [state.shots, activeShotId],
  )
  const activeRun = useMemo(
    () => (activeShot ? [...state.runs].reverse().find((r) => r.shotId === activeShot.shotId) : undefined),
    [state.runs, activeShot],
  )
  const activeAsset = useMemo(() => {
    const id = activeRun?.artifactIds.at(-1)
    return id ? state.assets.find((a) => a.assetId === id) : undefined
  }, [activeRun, state.assets])

  const boundAssets = useMemo(
    () =>
      (activeShot?.bindings ?? [])
        .map((b) => state.assets.find((a) => a.assetId === b.assetId))
        .filter((a): a is NonNullable<typeof a> => Boolean(a)),
    [activeShot, state.assets],
  )
  // Prefer a finished video, otherwise the most recent reference/keyframe image.
  const previewAsset =
    activeAsset ?? [...boundAssets].reverse().find((a) => a.mediaType === 'image')
  const previewUrl = assetUrl(previewAsset)

  const submit = () => {
    if (!text.trim() || state.busy) return
    void flow.guide(text)
    setText('')
  }

  const accepted = state.shots.filter((s) => s.phase === 'ACCEPTED').length
  const progressPct =
    state.shots.length > 0 ? Math.round((accepted / state.shots.length) * 100) : 0
  const runningShot = state.shots.find((s) =>
    state.steps.some((st) => st.shotId === s.shotId && st.state === 'running'),
  )
  const latestArtifact = [...state.assets].reverse().find((a) => assetUrl(a))
  const latestArtifactUrl = assetUrl(latestArtifact)
  const latestEvent = state.events.at(-1)?.summary ?? ''

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-4">
        {/* Left column */}
        <div className="flex flex-col gap-4 xp-stagger">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Sparkles size={16} className="text-[#76B900]" /> 一句话智能引导
              </CardTitle>
              <div className="flex items-center gap-1.5">
                <Badge variant={flow.adapters.video.available ? 'default' : 'outline'} className="text-[10px]">
                  video {flow.adapters.video.available ? 'ready' : 'off'}
                </Badge>
                <Badge variant={flow.adapters.image.available ? 'default' : 'outline'} className="text-[10px]">
                  image {flow.adapters.image.available ? 'ready' : 'off'}
                </Badge>
                <Badge
                  variant={backendOk ? 'default' : 'outline'}
                  className="text-[10px]"
                  title={flow.adapters.backend?.name ?? '未配置业务后端'}
                >
                  backend {flow.adapters.backend ? (backendOk ? 'online' : 'offline') : 'n/a'}
                </Badge>
                <Badge
                  variant={flow.sseStatus === 'open' ? 'default' : 'outline'}
                  className="text-[10px]"
                  title="后端事件流（SSE）"
                >
                  sse {flow.sseStatus}
                </Badge>
                <Badge
                  variant={flow.capabilities?.compose?.available ? 'default' : 'outline'}
                  className="text-[10px]"
                  title="后端 ffmpeg 合成能力"
                >
                  compose {flow.capabilities?.compose?.available ? 'ready' : 'off'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
                }}
                placeholder="用一句话描述你想做的视频，例如：雨夜天台，女主回头看向红灯，5 秒短剧镜头…"
                className="w-full min-h-[76px] resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus-visible:border-ring"
              />
              <div className="flex items-center gap-2">
                <Button onClick={submit} disabled={state.busy || !text.trim()} size="sm">
                  <Wand2 /> {state.busy ? 'Agent 处理中…' : '智能引导并生成分镜'}
                </Button>
                <Button variant="ghost" size="sm" onClick={flow.reset}>
                  <RotateCcw /> 重置
                </Button>
                <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((e) => (
                  <button
                    key={e}
                    onClick={() => setText(e)}
                    className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    {e.slice(0, 16)}…
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot size={16} className="text-[#76B900]" /> Agent 对话与决策
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex max-h-[340px] flex-col gap-2 overflow-y-auto">
                {state.messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    输入一句话需求，Agent 会补全场景、匹配技能、生成提示词，并在生产过程中汇报每一步。
                  </p>
                )}
                {state.messages.map((m) => (
                  <div
                    key={m.messageId}
                    className={
                      'max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-relaxed ' +
                      (m.role === 'user'
                        ? 'self-end bg-primary text-primary-foreground'
                        : m.role === 'tool'
                          ? 'self-start bg-muted text-muted-foreground'
                          : m.role === 'decision'
                            ? 'self-start bg-secondary text-secondary-foreground'
                            : 'self-start bg-muted')
                    }
                  >
                    {m.role === 'decision' ? '⚖ ' : ''}
                    {m.text}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Clapperboard size={16} className="text-[#76B900]" /> 场景 / 分镜与技能
              </CardTitle>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  disabled={state.busy || state.shots.length === 0}
                  onClick={() => void flow.generateAll()}
                >
                  <Play /> 一键生产全部镜头
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!state.busy}
                  onClick={flow.cancel}
                  title="停止后续调度，运行中的任务在安全边界停止"
                >
                  <Square /> 取消
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {state.scenes.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  还没有场景。用一句话描述需求后，Agent 会在这里生成场景与镜头。
                </p>
              )}
              {state.scenes.map((scene) => {
                const sceneShots = state.shots.filter((s) => s.sceneId === scene.sceneId)
                return (
                  <div key={scene.sceneId} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium">
                        {scene.index + 1}. {scene.title}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {scene.location} · {scene.timeOfDay} · {scene.mood}
                        </span>
                        <select
                          value={scene.skillIds[0]}
                          disabled={state.busy}
                          onChange={(e) => flow.selectSkill(scene.sceneId, e.target.value)}
                          className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none"
                        >
                          {SKILLS.map((s) => (
                            <option key={s.skillId} value={s.skillId}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{scene.synopsis}</p>

                    <div className="mt-2 space-y-2">
                      {sceneShots.map((shot) => (
                        <div
                          key={shot.shotId}
                          onClick={() => setActiveShotId(shot.shotId)}
                          className={
                            'cursor-pointer rounded-md border-l-4 bg-muted/40 p-2.5 ' +
                            (shot.phase === 'ACCEPTED'
                              ? 'border-l-emerald-500'
                              : shot.phase === 'HUMAN_REVIEW'
                                ? 'border-l-amber-500'
                                : shot.phase === 'FAILED'
                                  ? 'border-l-red-500'
                                  : 'border-l-[#76B900]') +
                            (activeShot?.shotId === shot.shotId ? ' ring-1 ring-ring' : '')
                          }
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-medium">{shot.title}</span>
                            <PhaseBadge phase={shot.phase} />
                            {shot.skillId && (
                              <Badge variant="outline" className="text-[10px]">
                                {shot.skillId}
                              </Badge>
                            )}
                            {(() => {
                              const thumb = firstImageUrl(shot, state.assets)
                              return thumb ? (
                                <span className="size-6 overflow-hidden rounded border border-border">
                                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                                </span>
                              ) : null
                            })()}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{shot.spec.action}</p>
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              size="xs"
                              disabled={state.busy}
                              onClick={(e) => {
                                e.stopPropagation()
                                void flow.generateShot(shot.shotId)
                              }}
                            >
                              生成并质检
                            </Button>
                            {shot.phase === 'HUMAN_REVIEW' && (
                              <>
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    flow.review(shot.shotId, 'accept')
                                  }}
                                >
                                  人工接受
                                </Button>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    flow.review(shot.shotId, 'reject')
                                  }}
                                >
                                  退回重做
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4 xp-stagger">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Activity size={16} className="text-[#76B900]" /> 当前进度与产物
              </CardTitle>
              <Badge variant={accepted === state.shots.length && state.shots.length > 0 ? 'default' : 'outline'}>
                已验收 {accepted}/{state.shots.length}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={'h-full rounded-full bg-[#76B900] transition-all duration-500 ' + (state.busy ? 'xp-progress' : '')}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex items-center gap-3">
                <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-muted/60">
                  {latestArtifact?.mediaType === 'video' && latestArtifactUrl ? (
                    <video src={latestArtifactUrl} muted className="h-full w-full object-cover" />
                  ) : latestArtifactUrl ? (
                    <img src={latestArtifactUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 text-xs">
                  <div className="truncate">
                    {runningShot ? `正在生成：${runningShot.title}` : latestEvent || '等待开始…'}
                  </div>
                  <div className="truncate text-muted-foreground">
                    {latestArtifact ? `最新产物：${latestArtifact.storageKey}` : '暂无产物'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-1">
            {(
              [
                ['assets', '镜头'],
                ['production', '制作'],
                ['runtime', '运行'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setRightTab(id)}
                className={
                  'flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ' +
                  (rightTab === id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                {label}
              </button>
            ))}
          </div>

          {rightTab === 'assets' && (
            <>
          {activeShot && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon size={16} className="text-[#76B900]" /> 视觉资产 · 参考图与关键帧
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ReferenceAssets
                  shot={activeShot}
                  assets={state.assets}
                  busy={state.busy}
                  imageReady={flow.adapters.image.available}
                  imageName={flow.adapters.image.name}
                  onImport={(file, role) => void flow.importAsset(file, activeShot.shotId, role)}
                  onBind={(assetId, role) => flow.bindAsset(activeShot.shotId, assetId, role)}
                  onUnbind={(bindingId) => flow.unbindAsset(activeShot.shotId, bindingId)}
                  onGenerate={() => void flow.generateImage(activeShot.shotId)}
                />
              </CardContent>
            </Card>
          )}

          {activeShot && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers size={16} className="text-[#76B900]" /> 候选与回收站
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CandidatePanel
                  shot={activeShot}
                  assets={state.assets}
                  runs={state.runs}
                  busy={state.busy}
                  onAccept={(assetId) => flow.acceptCandidate(activeShot.shotId, assetId)}
                  onDiscard={(assetId, reason, note) => flow.discardCandidate(assetId, reason, note)}
                  onRestore={(assetId) => flow.restoreCandidate(assetId)}
                  onRegenerate={(options) => void flow.regenerateShot(activeShot.shotId, options)}
                />
              </CardContent>
            </Card>
          )}
            </>
          )}

          {rightTab === 'production' && (
            <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Film size={16} className="text-[#76B900]" /> 提示词与镜头规格
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!activeShot && <p className="text-sm text-muted-foreground">选择左侧一个镜头以编辑。</p>}
              {activeShot && (
                <>
                  <div className="relative overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted/60 to-muted/20">
                    <div className="grid min-h-[220px] place-items-center">
                      {previewAsset?.mediaType === 'video' && previewUrl ? (
                        <video src={previewUrl} controls muted className="max-h-[320px] w-full object-contain" />
                      ) : previewUrl ? (
                        <img src={previewUrl} alt="" className="max-h-[320px] w-full object-contain" />
                      ) : (
                        <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center text-xs text-muted-foreground">
                          <ImageIcon size={22} className="opacity-60" />
                          候选预览：导入参考图或生成关键帧后显示
                        </div>
                      )}
                    </div>
                    {previewAsset && (
                      <div className="absolute left-2 top-2 flex gap-1.5">
                        <Badge variant="secondary" className="text-[10px]">
                          {previewAsset.source === 'imported' ? '导入' : '生成'}
                        </Badge>
                        <Badge variant="outline" className="bg-background/70 text-[10px]">
                          {previewAsset.mediaType}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {activeShot.spec.materialPolicy}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{activeShot.spec.camera.size}</Badge>
                    <Badge variant="outline" className="text-[10px]">{activeShot.spec.camera.movement}</Badge>
                    <Badge variant="outline" className="text-[10px]">{activeShot.spec.aspectRatio}</Badge>
                    <Badge variant="outline" className="text-[10px]">{activeShot.spec.durationS}s</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">动作：{activeShot.spec.action}</p>
                  <p className="text-xs text-muted-foreground">
                    验收：{activeShot.spec.acceptance.required.join('、')}｜禁止：
                    {activeShot.spec.acceptance.forbidden.join('、')}
                  </p>
                  <PromptFields
                    key={activeShot.shotId}
                    shotId={activeShot.shotId}
                    positive={activeShot.prompt}
                    negative={activeShot.negativePrompt}
                    onSave={flow.editShotPrompt}
                  />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>质检报告</CardTitle>
            </CardHeader>
            <CardContent>
              {!activeRun?.score && <p className="text-sm text-muted-foreground">尚未质检。</p>}
              {activeRun?.score && (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        activeRun.score.verdict === 'accept'
                          ? 'default'
                          : activeRun.score.verdict === 'repair'
                            ? 'secondary'
                            : 'destructive'
                      }
                    >
                      {activeRun.score.verdict}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      rubric {activeRun.score.rubricVersion}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <Metric label="身份" value={activeRun.score.scores.identity?.toFixed(2) ?? '—'} />
                    <Metric label="动作" value={activeRun.score.scores.action?.toFixed(2) ?? '—'} />
                    <Metric label="时间" value={activeRun.score.scores.temporal?.toFixed(2) ?? '—'} />
                  </div>
                  {activeRun.score.evidence.map((e, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      · {e.tag}
                      {e.timeS ? ` @${e.timeS[0]}–${e.timeS[1]}s` : ''} {e.note ?? ''}
                    </div>
                  ))}
                  {activeRun.score.repair && (
                    <div className="text-xs text-muted-foreground">
                      修复：{activeRun.score.repair.target} → {activeRun.score.repair.action}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>剪辑拼接与归档</CardTitle>
              <Badge variant={accepted === state.shots.length && state.shots.length > 0 ? 'default' : 'outline'}>
                已验收 {accepted}/{state.shots.length}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={state.busy || accepted !== state.shots.length || state.shots.length === 0}
                  onClick={() => void flow.compose()}
                >
                  <Film /> 剪辑拼接成片
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={state.busy || !state.finalAsset}
                  onClick={() => void flow.archive()}
                >
                  素材归档
                </Button>
              </div>
              {state.finalAsset && (
                <div className="text-xs text-muted-foreground">
                  成片：{state.finalAsset.storageKey}
                  <br />
                  清单：{String(state.finalAsset.metadata.manifest ?? '-')}
                </div>
              )}
              {state.archive && (
                <div className="text-xs text-muted-foreground">
                  归档：{state.archive.manifestKey}（{state.archive.assetIds.length} 个资产）
                </div>
              )}
            </CardContent>
          </Card>
            </>
          )}

          {rightTab === 'runtime' && (
            <>
          <Card>
            <CardHeader>
              <CardTitle>步骤时间线</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-1.5">
                {state.steps
                  .filter((s) => !activeShot || s.shotId === activeShot.shotId)
                  .slice()
                  .reverse()
                  .map((s) => (
                    <li key={s.stepId} className="flex items-start gap-2 text-xs">
                      <span
                        className={
                          'mt-1 size-2 shrink-0 rounded-full ' +
                          (s.state === 'done'
                            ? 'bg-emerald-500'
                            : s.state === 'failed'
                              ? 'bg-red-500'
                              : s.state === 'running'
                                ? 'bg-amber-500'
                                : 'bg-muted-foreground')
                        }
                      />
                      <div>
                        <span className="font-medium">{s.kind}</span> · {s.actor} ·{' '}
                        <span className="text-muted-foreground">{s.state}</span>
                        {s.progress && (
                          <span className="text-muted-foreground">
                            {' '}
                            ({s.progress.current}/{s.progress.total})
                          </span>
                        )}
                        {s.summary && <div className="text-muted-foreground">{s.summary}</div>}
                      </div>
                    </li>
                  ))}
                {state.steps.length === 0 && (
                  <p className="text-sm text-muted-foreground">暂无步骤。</p>
                )}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>事件流 (SSE)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-56 overflow-y-auto font-mono text-[11px] leading-relaxed">
                {state.events.length === 0 && (
                  <p className="font-sans text-sm text-muted-foreground">
                    事件流为空（seq 游标 + event_id 去重）。
                  </p>
                )}
                {state.events
                  .slice(-80)
                  .reverse()
                  .map((e) => (
                    <div key={e.eventId} className="border-b border-border/60 py-0.5">
                      <span className="text-muted-foreground">#{e.seq}</span> <b>{e.type}</b>{' '}
                      {e.summary}
                      {e.progress ? ` (${e.progress.current}/${e.progress.total})` : ''}
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="xp-metric">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

function PromptFields({
  shotId,
  positive,
  negative,
  onSave,
}: {
  shotId: string
  positive: string
  negative: string
  onSave: (shotId: string, positive: string, negative: string) => void
}) {
  const [pos, setPos] = useState(positive)
  const [neg, setNeg] = useState(negative)
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] text-muted-foreground">正向提示词</label>
      <textarea
        value={pos}
        onChange={(e) => setPos(e.target.value)}
        className="min-h-[88px] w-full rounded-md border border-border bg-background p-2 text-xs outline-none focus-visible:border-ring"
      />
      <label className="block text-[11px] text-muted-foreground">负向提示词</label>
      <textarea
        value={neg}
        onChange={(e) => setNeg(e.target.value)}
        className="min-h-[44px] w-full rounded-md border border-border bg-background p-2 text-xs outline-none focus-visible:border-ring"
      />
      <Button size="xs" onClick={() => onSave(shotId, pos, neg)}>
        保存提示词
      </Button>
    </div>
  )
}
