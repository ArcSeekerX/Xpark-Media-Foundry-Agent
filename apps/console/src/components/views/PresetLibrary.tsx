import { useRef, useState } from 'react'
import { Download, Sparkles, Star, Trash2, Upload } from 'lucide-react'
import { usePresets } from '@/foundry/skills/presets'
import type { PromptPreset } from '@/foundry/skills/presets'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function PresetLibrary({
  activeShotId,
  onApply,
}: {
  activeShotId?: string
  onApply: (preset: PromptPreset) => void
}) {
  const { presets, importPresets, removeUserPreset, clearUserPresets, exportPresets } = usePresets()
  const [category, setCategory] = useState<PromptPreset['category']>('character')
  const [msg, setMsg] = useState<string>()
  const fileRef = useRef<HTMLInputElement>(null)

  const shown = presets.filter((p) => p.category === category)

  const handleImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text())
      const { added, skipped } = importPresets(data)
      setMsg(`导入完成：新增 ${added}，跳过 ${skipped}`)
    } catch (e) {
      setMsg(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleExport = () => {
    const blob = new Blob([exportPresets()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'prompt-presets.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {(['character', 'scene'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={
                'rounded-md px-2.5 py-1 text-[11px] transition-colors ' +
                (category === c ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted')
              }
            >
              {c === 'character' ? '角色创作' : '场景提示词'}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">{shown.length} 个预设</span>
        <span className="ml-auto flex items-center gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleImport(f)
              e.target.value = ''
            }}
          />
          <Button size="xs" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload /> 导入
          </Button>
          <Button size="xs" variant="outline" onClick={handleExport}>
            <Download /> 导出
          </Button>
          <Button
            size="xs"
            variant="ghost"
            title="清除自定义预设"
            onClick={() => {
              clearUserPresets()
              setMsg('已清除自定义预设')
            }}
          >
            <Trash2 />
          </Button>
        </span>
      </div>

      {msg && <div className="text-[11px] text-muted-foreground">{msg}</div>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((preset) => {
          const isUser = preset.id.startsWith('user.')
          return (
            <div
              key={preset.id}
              className="group rounded-lg border border-border bg-muted/10 p-2.5 transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[12.5px] font-medium">{preset.name}</span>
                {preset.validated && (
                  <Badge variant="default" className="h-4 gap-0.5 px-1.5 text-[9px]">
                    <Star size={9} /> 已验证
                  </Badge>
                )}
                {isUser && (
                  <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                    自定义
                  </Badge>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                {preset.description}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <Button
                  size="xs"
                  disabled={!activeShotId}
                  onClick={() => onApply(preset)}
                  title={activeShotId ? '应用到当前镜头' : '请先选择一个镜头'}
                >
                  <Sparkles /> 应用
                </Button>
                {isUser && (
                  <Button
                    size="xs"
                    variant="ghost"
                    title="删除自定义预设"
                    onClick={() => removeUserPreset(preset.id)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-[10.5px] text-muted-foreground">
        预设会追加到镜头提示词；自定义预设保存在本地，可通过 JSON 导入/导出。
      </div>
    </div>
  )
}
