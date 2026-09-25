import { useRef, useState } from 'react'

export interface AddNodeResult {
  added: boolean
  online: boolean
  hostname: string | null
  error: string | null
}

interface AddNodeDialogProps {
  onClose: () => void
}

/** Modal for adding a node to remote monitoring: node IP plus an optional
 *  root password. The backend persists the node and verifies connectivity
 *  with a live probe. */
export function AddNodeDialog({ onClose }: AddNodeDialogProps) {
  const [nodeIp, setNodeIp] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AddNodeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ipRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!nodeIp.trim()) {
      setError('请填写节点 IP')
      return
    }
    setBusy(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/remote/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: nodeIp.trim(),
          password: password || null,
        }),
      })
      const data = (await res.json()) as AddNodeResult & { added: boolean }
      if (!res.ok || !data.added) {
        setError((data as { error?: string }).error ?? '添加失败')
        return
      }
      setResult(data)
    } catch (e) {
      setError(`请求失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-md bg-[#151519] border border-white/[0.08] px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#76B900]/50'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-[#0c0c10] border border-white/[0.1] rounded-xl p-5 w-[480px] max-w-[92vw] max-h-[85vh] overflow-y-auto shadow-2xl">
        <h3 className="text-sm font-semibold text-zinc-100 mb-1">添加监控节点</h3>
        <p className="text-xs text-zinc-500 mb-4">
          输入节点 IP 加入系统资源监控（可同时导入 SSH 凭据，留空则使用共享密钥）。
          添加后立即校验连通性。
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">节点 IP</label>
            <input
              ref={ipRef}
              autoFocus
              className={inputCls}
              value={nodeIp}
              onChange={(e) => setNodeIp(e.target.value)}
              placeholder="10.0.0.2 或 169.254.x.x"
              spellCheck={false}
            />
          </div>

          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">SSH 用户</label>
            <input
              className={inputCls}
              value="root"
              disabled
            />
          </div>

          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">root 密码（可选）</label>
            <input
              type="password"
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="留空使用共享密钥"
            />
          </div>

          {result && (
            <div
              className={`rounded-md border px-2.5 py-2 text-xs ${
                result.online
                  ? 'border-[#76B900]/30 bg-[#76B900]/[0.06] text-[#76B900]'
                  : 'border-red-500/30 bg-red-500/[0.06] text-red-400'
              }`}
            >
              {result.online
                ? `添加成功 — 已连接 ${result.hostname ?? nodeIp}，开始监控`
                : `已添加，但校验失败: ${result.error ?? '无法连接'}`}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/[0.06] px-2.5 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-md bg-[#76B900] px-4 py-1.5 text-xs font-semibold text-black hover:bg-[#8FD21F] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {busy ? '添加中…' : '添加并校验'}
          </button>
        </div>
      </div>
    </div>
  )
}
