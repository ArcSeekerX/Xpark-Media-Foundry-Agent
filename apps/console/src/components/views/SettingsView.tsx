import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Cpu,
  Database,
  Film,
  Image as ImageIcon,
  Plug,
  RotateCcw,
  Route,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  Wand2,
} from 'lucide-react'
import { DEFAULT_SETTINGS, useSettings } from '@/foundry/settings'
import type { AppSettings } from '@/foundry/settings'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type TestState = { backend?: string; comfy?: string; text?: string; decision?: string }

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {label}
        {hint && <span className="text-muted-foreground/60">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring'

function Num({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className={inputCls}
    />
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

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={
            'rounded-lg border px-3 py-1.5 text-xs transition-colors ' +
            (value === o.value
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border hover:bg-muted')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsView() {
  const { settings, update, reset } = useSettings()
  const [test, setTest] = useState<TestState>({})
  const [testing, setTesting] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string>()

  const syncStorage = async () => {
    const base = settings.backendUrl || '/api'
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (settings.backendToken) headers.Authorization = `Bearer ${settings.backendToken}`
    try {
      const r = await fetch(`${base}/settings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          imports_dir: settings.storage.importsDir,
          generated_dir: settings.storage.generatedDir,
          exports_dir: settings.storage.exportsDir,
        }),
      })
      setSyncMsg(r.ok ? '已同步到后端' : `同步失败 HTTP ${r.status}`)
    } catch {
      setSyncMsg('同步失败：后端不可达')
    }
  }

  const setText = (patch: Partial<AppSettings['textModel']>) =>
    update({ textModel: { ...settings.textModel, ...patch } })
  const setDecision = (patch: Partial<AppSettings['decision']>) =>
    update({ decision: { ...settings.decision, ...patch } })
  const setImage = (patch: Partial<AppSettings['image']>) =>
    update({ image: { ...settings.image, ...patch } })
  const setVideo = (patch: Partial<AppSettings['video']>) =>
    update({ video: { ...settings.video, ...patch } })
  const setQuality = (patch: Partial<AppSettings['quality']>) =>
    update({ quality: { ...settings.quality, ...patch } })
  const setRouting = (patch: Partial<AppSettings['routing']>) =>
    update({ routing: { ...settings.routing, ...patch } })
  const setStorage = (patch: Partial<AppSettings['storage']>) =>
    update({ storage: { ...settings.storage, ...patch } })

  const runTest = async () => {
    setTesting(true)
    const results: TestState = {}
    const base = settings.backendUrl || '/api'
    try {
      const r = await fetch(`${base}/health`)
      results.backend = r.ok ? 'ok' : `HTTP ${r.status}`
    } catch {
      results.backend = 'fail'
    }
    try {
      const r = await fetch(`${settings.comfyUrl}/system_stats`)
      results.comfy = r.ok ? 'ok' : `HTTP ${r.status}`
    } catch {
      results.comfy = 'fail'
    }
    if (settings.textModel.baseUrl) {
      try {
        const r = await fetch(`${settings.textModel.baseUrl}/models`, {
          headers: settings.textModel.apiKey
            ? { Authorization: `Bearer ${settings.textModel.apiKey}` }
            : {},
        })
        results.text = r.ok ? 'ok' : `HTTP ${r.status}`
      } catch {
        results.text = 'fail'
      }
    } else {
      results.text = '未配置'
    }
    results.decision = settings.decision.url ? '已配置' : '未配置'
    setTest(results)
    setTesting(false)
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant={settings.mode === 'live' ? 'default' : 'secondary'} className="text-[10px]">
          模式 {settings.mode}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          后端 {settings.backendUrl || '未配置'}
        </Badge>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={testing} onClick={() => void runTest()}>
            <Plug /> {testing ? '测试中…' : '测试连接'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => reset()}>
            <RotateCcw /> 重置默认
          </Button>
        </span>
      </div>

      {Object.keys(test).length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {(['backend', 'comfy', 'text', 'decision'] as const).map((k) => (
            <Badge
              key={k}
              variant={test[k] === 'ok' || test[k] === '已配置' ? 'default' : 'outline'}
              className="text-[10px]"
            >
              {k}: {test[k]}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Runtime & endpoints */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SettingsIcon size={16} className="text-[#76B900]" /> 运行模式与接口
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="运行模式" hint="mock 无需后端/GPU">
              <Seg
                value={settings.mode}
                options={[
                  { value: 'mock', label: 'mock 演示' },
                  { value: 'live', label: 'live 真实' },
                ]}
                onChange={(v) => update({ mode: v })}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="业务后端地址">
                <input
                  className={inputCls}
                  value={settings.backendUrl}
                  placeholder="/api 或 http://host:8080/api"
                  onChange={(e) => update({ backendUrl: e.target.value })}
                />
              </Field>
              <Field label="后端 Token">
                <input
                  className={inputCls}
                  type="password"
                  value={settings.backendToken}
                  placeholder="对应后端 API_TOKEN"
                  onChange={(e) => update({ backendToken: e.target.value })}
                />
              </Field>
              <Field label="ComfyUI 地址">
                <input
                  className={inputCls}
                  value={settings.comfyUrl}
                  placeholder="/comfy 或 http://127.0.0.1:8188"
                  onChange={(e) => update({ comfyUrl: e.target.value })}
                />
              </Field>
              <div className="flex items-end gap-4 pb-1">
                <Toggle label="SSE 事件流" checked={settings.sse} onChange={(v) => update({ sse: v })} />
                <Toggle
                  label="本地持久化"
                  checked={settings.persist}
                  onChange={(v) => update({ persist: v })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Text & decision models */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu size={16} className="text-[#76B900]" /> 文本与决策模型
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="文本模型地址" hint="OpenAI 兼容">
                <input
                  className={inputCls}
                  value={settings.textModel.baseUrl}
                  placeholder="http://127.0.0.1:8000/v1"
                  onChange={(e) => setText({ baseUrl: e.target.value })}
                />
              </Field>
              <Field label="文本模型名">
                <input
                  className={inputCls}
                  value={settings.textModel.model}
                  onChange={(e) => setText({ model: e.target.value })}
                />
              </Field>
              <Field label="API Key">
                <input
                  className={inputCls}
                  type="password"
                  value={settings.textModel.apiKey}
                  onChange={(e) => setText({ apiKey: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="决策引擎" hint="Laya 本地 / Jev 远程">
                <Seg
                  value={settings.decision.engine}
                  options={[
                    { value: 'mock', label: 'mock' },
                    { value: 'laya', label: 'Laya' },
                    { value: 'jev', label: 'Jev' },
                  ]}
                  onChange={(v) => setDecision({ engine: v })}
                />
              </Field>
              <Field label="决策端口地址">
                <input
                  className={inputCls}
                  value={settings.decision.url}
                  placeholder="http://127.0.0.1:8090"
                  onChange={(e) => setDecision({ url: e.target.value })}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Image defaults */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon size={16} className="text-[#76B900]" /> 生图默认参数
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <Toggle
                label="启用生图步骤"
                checked={settings.image.enabled}
                onChange={(v) => setImage({ enabled: v })}
              />
            </div>
            <Field label="生图工作流 (API JSON)">
              <input
                className={inputCls}
                value={settings.image.workflowUrl}
                onChange={(e) => setImage({ workflowUrl: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="宽">
                <Num value={settings.image.width} min={64} onChange={(v) => setImage({ width: v })} />
              </Field>
              <Field label="高">
                <Num value={settings.image.height} min={64} onChange={(v) => setImage({ height: v })} />
              </Field>
              <Field label="步数">
                <Num value={settings.image.steps} min={1} onChange={(v) => setImage({ steps: v })} />
              </Field>
              <Field label="采样器">
                <input
                  className={inputCls}
                  value={settings.image.sampler}
                  onChange={(e) => setImage({ sampler: e.target.value })}
                />
              </Field>
              <Field label="CFG">
                <Num value={settings.image.cfg} min={0} onChange={(v) => setImage({ cfg: v })} />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Video defaults */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Film size={16} className="text-[#76B900]" /> 生视频默认参数
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="宽">
              <Num value={settings.video.width} min={64} onChange={(v) => setVideo({ width: v })} />
            </Field>
            <Field label="高">
              <Num value={settings.video.height} min={64} onChange={(v) => setVideo({ height: v })} />
            </Field>
            <Field label="帧数">
              <Num value={settings.video.length} min={1} onChange={(v) => setVideo({ length: v })} />
            </Field>
            <Field label="步数">
              <Num value={settings.video.steps} min={1} onChange={(v) => setVideo({ steps: v })} />
            </Field>
            <Field label="采样器">
              <input
                className={inputCls}
                value={settings.video.sampler}
                onChange={(e) => setVideo({ sampler: e.target.value })}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Quality */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-[#76B900]" /> 质检参数
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="验收阈值" hint="0–1">
              <input
                className={inputCls}
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={settings.quality.acceptThreshold}
                onChange={(e) => setQuality({ acceptThreshold: Number(e.target.value) })}
              />
            </Field>
            <Field label="最大自动修复次数">
              <Num value={settings.quality.maxRepairs} min={0} onChange={(v) => setQuality({ maxRepairs: v })} />
            </Field>
          </CardContent>
        </Card>

        {/* Routing */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Route size={16} className="text-[#76B900]" /> 智能路由
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <Toggle
                label="影子模式（只记录建议）"
                checked={settings.routing.shadow}
                onChange={(v) => setRouting({ shadow: v })}
              />
              <Toggle
                label="自动采用模型动作"
                checked={settings.routing.auto}
                onChange={(v) => setRouting({ auto: v })}
              />
            </div>
            <Field label="模型动作最小置信度" hint="0–1">
              <input
                className={inputCls}
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={settings.routing.minConfidence}
                onChange={(e) => setRouting({ minConfidence: Number(e.target.value) })}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Storage */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database size={16} className="text-[#76B900]" /> 素材与成片存储路径
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="导入素材目录" hint="后端">
                <input
                  className={inputCls}
                  value={settings.storage.importsDir}
                  onChange={(e) => setStorage({ importsDir: e.target.value })}
                />
              </Field>
              <Field label="生成产物目录" hint="后端">
                <input
                  className={inputCls}
                  value={settings.storage.generatedDir}
                  onChange={(e) => setStorage({ generatedDir: e.target.value })}
                />
              </Field>
              <Field label="成片导出目录" hint="后端 ffmpeg">
                <input
                  className={inputCls}
                  value={settings.storage.exportsDir}
                  onChange={(e) => setStorage({ exportsDir: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void syncStorage()}>
                <Plug /> 同步存储路径到后端
              </Button>
              {syncMsg && <span className="text-[11px] text-muted-foreground">{syncMsg}</span>}
            </div>
            <p className="text-[11px] text-muted-foreground">
              存储路径由业务后端解释（`apps/api` 的 `XPARK_DATA_DIR` / `XPARK_IMPORTS_DIR` /
              `XPARK_EXPORTS_DIR`）。点击同步会通过 `POST /api/settings` 更新后端路径。
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Save size={13} /> 设置自动保存到浏览器本地；重启后端请用环境变量设置路径默认值。
        <span className="ml-auto flex items-center gap-1">
          <Wand2 size={12} /> 默认：{DEFAULT_SETTINGS.image.width}×{DEFAULT_SETTINGS.image.height} 生图，
          {DEFAULT_SETTINGS.video.length} 帧生视频
        </span>
      </div>
    </div>
  )
}
