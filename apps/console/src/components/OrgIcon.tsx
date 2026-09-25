/** Map model organization to catalog icon filename.
 *  Keys are matched flexibly: exact → lowercase → substring. */
const ORG_ICONS: Record<string, string> = {
  'google': 'google.png',
  'qwen': 'qwen.png',
  'deepseek': 'deepseek.png',
  'nvidia': 'nvidia.png',
  'openai': 'openai.png',
  'meta': 'meta.png',
  'mistral': 'mistral.png',
  'thudm': 'THUDM.png',
  'glm': 'zai.png',
  '01ai': '01ai.png',
  'alibaba': 'alibaba.png',
  'baidu': 'baidu.jpeg',
  'kimi': 'kimi.png',
  'moonshot': 'kimi.png',
  'minimax': 'minimax.png',
  'stepfun': 'stepfun.png',
  'cohere': 'cohere.png',
  'ibm': 'ibm.png',
  'microsoft': 'microsoft.png',
  'stability': 'stability.png',
  'blackforest': 'blackforestlabs.png',
  'baai': 'bge_logo.jpeg',
  'funaudiollm': 'FunAudioLLM.png',
  'hunyuan': 'hunyuan.png',
  'openbmb': 'OpenBMB.png',
  'opengvlab': 'OpenGVLab.jpeg',
  // cyankiwi redistributes various models; match by model name instead
}

function orgIconUrl(modelId: string | null): string | null {
  if (!modelId) return null
  const parts = modelId.split('/')
  const org = parts[0].toLowerCase()
  const model = parts[1]?.toLowerCase() ?? ''
  // Check model name first (more specific), then org name
  const file =
    // 1) Exact org match
    ORG_ICONS[org]
    // 2) Model name contains a key
    ?? Object.entries(ORG_ICONS).find(([k]) => model.includes(k))?.[1]
    // 3) Org name contains a key
    ?? Object.entries(ORG_ICONS).find(([k]) => org.includes(k))?.[1]
  return file ? `/catalog_icons/${file}` : null
}

interface OrgIconProps {
  modelId: string | null
  recipeName?: string
  className?: string
}

/** Organization logo for a model. Falls back to the recipe name for recipes
 *  without a `model:` field, and to a generic placeholder box otherwise. */
export function OrgIcon({ modelId, recipeName, className }: OrgIconProps) {
  // Try model ID first, then recipe name as fallback.
  const url = orgIconUrl(modelId) ?? (recipeName ? orgIconUrl(recipeName) : null)
  return (
    <span className={`w-5 h-5 rounded shrink-0 flex items-center justify-center overflow-hidden bg-white/[0.04] ${className ?? ''}`}>
      {url ? (
        <img src={url} alt="" className="w-full h-full object-contain" />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-zinc-700">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      )}
    </span>
  )
}
