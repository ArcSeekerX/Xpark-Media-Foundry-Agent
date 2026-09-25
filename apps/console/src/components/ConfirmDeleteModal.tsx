import { useEffect, useRef, useState } from 'react'

interface ConfirmDeleteModalProps {
  open: boolean
  /** Model name the operator must type verbatim to enable deletion. */
  modelName: string
  /** Optional extra detail shown under the model name. */
  detail?: string
  /** Optional label for the name display (defaults to 模型名称). */
  nameLabel?: string
  /** Optional dialog title. Defaults to instance-deletion wording. */
  title?: string
  /** Optional descriptive body text. Defaults to instance-deletion wording. */
  description?: string
  onClose: () => void
  onConfirm: () => void
}

/** Modal that requires typing the model name to confirm deleting an instance. */
export function ConfirmDeleteModal({ open, modelName, detail, nameLabel, title, description, onClose, onConfirm }: ConfirmDeleteModalProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset + focus the input each time the modal opens.
  useEffect(() => {
    if (open) {
      setValue('')
      // Focus after a tick so the overlay is mounted.
      const t = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [open])

  if (!open) return null

  const model = modelName.trim()
  const matches = model.length > 0 && value.trim().toLowerCase() === model.toLowerCase()

  const submit = () => {
    if (matches) {
      onConfirm()
      setValue('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-[#0c0c10] border border-white/[0.1] rounded-xl p-5 w-[400px] max-w-[90vw] shadow-2xl">
        <h3 className="text-sm font-semibold text-zinc-100 mb-1">{title ?? '删除模型实例'}</h3>
        <p className="text-xs text-zinc-500 mb-3">
          {description ?? '此操作将停止并移除运行中的实例。请输入容器名称以确认删除：'}
        </p>

        <div className="mb-3">
          <div className="text-[11px] text-zinc-400 mb-1">{nameLabel ?? '模型名称'}</div>
          <div className="text-sm font-mono text-[#76B900] bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5 break-all">
            {modelName}
          </div>
        </div>

        {detail && (
          <div className="text-[11px] text-zinc-600 mb-3">{detail}</div>
        )}

        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder={`输入 ${modelName} 确认`}
          className="w-full bg-[#050508] border border-white/[0.1] rounded-md px-3 py-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-red-500/60 transition-colors"
        />

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="text-xs font-medium py-1.5 px-3 rounded-md bg-white/[0.06] text-zinc-300 hover:bg-white/[0.12] transition-colors"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={!matches}
            className={`text-xs font-medium py-1.5 px-3 rounded-md transition-colors ${
              matches
                ? 'bg-red-500 text-[#fff] hover:bg-red-600'
                : 'bg-red-500/20 text-red-400/50 cursor-not-allowed'
            }`}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  )
}
