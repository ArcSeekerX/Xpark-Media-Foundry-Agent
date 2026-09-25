// Mock OpenAI-compatible streaming completion. Lets the Chat view work with no
// backend by returning a ReadableStream of SSE frames in the exact shape the
// real /api/chat/completions proxy emits.
import type { ChatMessage } from '@/types/chat'

const MOCK_REPLIES = [
  '这是 Xpark Media Foundry 控制台的在线对话（演示模式）。后端接口尚未接入，我在这里返回一条模拟回复。',
  '收到。当前处于 mock 模式：系统监控与在线对话都已渲染，真实推理服务接入后即可替换此回复。',
  '你好，我是媒体工厂助手。可以让我帮你规划分镜、撰写提示词或检查成片质量。',
]

function pickReply(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  if (last?.content.includes('分镜') || last?.content.includes('提示词')) {
    return '可以。请告诉我主题、时长与画幅（如 9:16 / 5 秒），我会拆成镜头、匹配场景技能并生成 H3 结构化提示词。'
  }
  return MOCK_REPLIES[messages.length % MOCK_REPLIES.length]
}

function sse(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`)
}

export async function mockChatCompletion(
  messages: ChatMessage[],
): Promise<Response> {
  const reasoning = '（mock）正在理解上下文并组织回答…'
  const reply = pickReply(messages)
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        sse({ choices: [{ delta: { reasoning_content: reasoning } }] }),
      )
      await new Promise((r) => setTimeout(r, 250))
      const chunks = reply.match(/.{1,6}/g) ?? [reply]
      for (const chunk of chunks) {
        controller.enqueue(sse({ choices: [{ delta: { content: chunk } }] }))
        await new Promise((r) => setTimeout(r, 40))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

export const MOCK_ENABLED = (import.meta.env.VITE_MOCK ?? '1') !== '0'
