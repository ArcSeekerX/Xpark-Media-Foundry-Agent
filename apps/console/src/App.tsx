import { useCallback, useMemo, useState } from 'react'
import { Clapperboard, Layers, Settings as SettingsIcon, Sparkles } from 'lucide-react'
import { useMetrics } from './hooks/useMetrics'
import { useMetricsHistory } from './hooks/useMetricsHistory'
import { AgentView } from './components/views/AgentView'
import { AssetsView } from './components/views/AssetsView'
import { OneClickStudio } from './components/views/OneClickStudio'
import { SettingsView } from './components/views/SettingsView'
import { SystemView } from './components/views/SystemView'
import { ChatView } from './components/views/ChatView'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { GpuEvent, InferenceRequest } from './types/events'

const VIEW_TAB_KEY = 'xpark-media-foundry:view-tab'
const APP_VERSION = '0.1.0'

function App() {
  const { metrics, connectionStatus, isStale } = useMetrics()
  const history = useMetricsHistory(metrics)
  const { getEvents, getRequests } = history

  const events = useMemo((): GpuEvent[] =>
    getEvents().map((e) => ({
      timestamp_ms: e.timestamp_ms,
      gpu_index: e.gpu_index,
      event_type: e.event_type as GpuEvent['event_type'],
      detail: e.detail,
    })),
    [getEvents],
  )

  const requests = useMemo((): InferenceRequest[] =>
    getRequests().map((r) => ({
      start_ms: r.start_ms,
      end_ms: r.end_ms,
      tps: r.tokens_per_sec,
      ttft_ms: r.ttft_ms,
    })),
    [getRequests],
  )

  const defaultTab = useMemo(() => {
    try {
      return window.localStorage.getItem(VIEW_TAB_KEY) ?? 'agent'
    } catch {
      return 'agent'
    }
  }, [])
  const [activeTab, setActiveTab] = useState(defaultTab)

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value)
    try {
      window.localStorage.setItem(VIEW_TAB_KEY, value)
    } catch { /* ignore */ }
  }, [])

  return (
    <ErrorBoundary>
      <div className="h-dvh flex flex-col bg-[#08080a] overflow-hidden">
        {/* Top header bar */}
        <header className="shrink-0 border-b border-white/[0.04] px-4 py-1.5 flex justify-between items-center z-10">
          <div className="flex items-center gap-2.5">
            {/* Logo icon — stylized media processor chip with neural mesh */}
            <svg className="size-7 shrink-0" viewBox="0 0 28 28" fill="none">
              <rect x="3" y="5" width="22" height="18" rx="3" stroke="#76B900" strokeWidth="1.5"/>
              <rect x="9" y="10" width="10" height="8" rx="1" stroke="#76B900" strokeWidth="1" opacity="0.6"/>
              <circle cx="14" cy="14" r="2" fill="#76B900"/>
              <circle cx="8" cy="7" r="1.2" fill="#76B900" opacity="0.7"/>
              <circle cx="20" cy="7" r="1.2" fill="#76B900" opacity="0.7"/>
              <circle cx="8" cy="21" r="1.2" fill="#76B900" opacity="0.7"/>
              <circle cx="20" cy="21" r="1.2" fill="#76B900" opacity="0.7"/>
              <line x1="8" y1="7" x2="14" y2="14" stroke="#76B900" strokeWidth="0.6" opacity="0.4"/>
              <line x1="20" y1="7" x2="14" y2="14" stroke="#76B900" strokeWidth="0.6" opacity="0.4"/>
              <line x1="8" y1="21" x2="14" y2="14" stroke="#76B900" strokeWidth="0.6" opacity="0.4"/>
              <line x1="20" y1="21" x2="14" y2="14" stroke="#76B900" strokeWidth="0.6" opacity="0.4"/>
            </svg>
            <h1 className="text-lg font-semibold text-zinc-100 tracking-tight flex items-baseline gap-1" style={{ fontFamily: 'Inter, sans-serif' }}>
              <span className="text-[#76B900]">Xpark</span>
              <span className="text-zinc-500 font-normal">Media Foundry</span>
            </h1>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-0.5">数字资产流水线</span>
          </div>
        </header>

        {/* Body: sidebar + content */}
        <div className="flex-1 min-h-0 flex">
          <Tabs
            orientation="vertical"
            value={activeTab}
            onValueChange={handleTabChange}
            className="flex-1 min-h-0 flex"
          >
            <nav className="w-16 shrink-0 border-r border-white/[0.04] bg-[#0c0c10] flex flex-col items-center gap-3 py-4 px-1">
              <TabsList variant="line" className="flex flex-col bg-transparent gap-3 w-full">
                <TabsTrigger
                  value="agent"
                  className="relative flex flex-col items-center justify-center gap-1 w-full rounded-lg text-zinc-400 data-active:text-[#76B900] data-active:bg-[#76B900]/[0.12] transition-colors hover:text-zinc-200 hover:bg-white/[0.03] text-[10px] leading-tight"
                >
                  <Sparkles className="size-5" />
                  <span>主 Agent</span>
                </TabsTrigger>
                <TabsTrigger
                  value="studio"
                  className="relative flex flex-col items-center justify-center gap-1 w-full rounded-lg text-zinc-400 data-active:text-[#76B900] data-active:bg-[#76B900]/[0.12] transition-colors hover:text-zinc-200 hover:bg-white/[0.03] text-[10px] leading-tight"
                >
                  <Clapperboard className="size-5" />
                  <span>一键出片</span>
                </TabsTrigger>
                <TabsTrigger
                  value="assets"
                  className="relative flex flex-col items-center justify-center gap-1 w-full rounded-lg text-zinc-400 data-active:text-[#76B900] data-active:bg-[#76B900]/[0.12] transition-colors hover:text-zinc-200 hover:bg-white/[0.03] text-[10px] leading-tight"
                >
                  <Layers className="size-5" />
                  <span>数字资产</span>
                </TabsTrigger>
                <TabsTrigger
                  value="system"
                  className="relative flex flex-col items-center justify-center gap-1 w-full rounded-lg text-zinc-400 data-active:text-[#76B900] data-active:bg-[#76B900]/[0.12] transition-colors hover:text-zinc-200 hover:bg-white/[0.03] text-[10px] leading-tight"
                >
                  <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                    <line x1="8" y1="21" x2="16" y2="21"/>
                    <line x1="12" y1="17" x2="12" y2="21"/>
                  </svg>
                  <span>系统监控</span>
                </TabsTrigger>
                <TabsTrigger
                  value="chat"
                  className="relative flex flex-col items-center justify-center gap-1 w-full rounded-lg text-zinc-400 data-active:text-[#76B900] data-active:bg-[#76B900]/[0.12] transition-colors hover:text-zinc-200 hover:bg-white/[0.03] text-[10px] leading-tight"
                >
                  <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span>在线对话</span>
                </TabsTrigger>
                <TabsTrigger
                  value="settings"
                  className="relative flex flex-col items-center justify-center gap-1 w-full rounded-lg text-zinc-400 data-active:text-[#76B900] data-active:bg-[#76B900]/[0.12] transition-colors hover:text-zinc-200 hover:bg-white/[0.03] text-[10px] leading-tight"
                >
                  <SettingsIcon className="size-5" />
                  <span>设置</span>
                </TabsTrigger>
              </TabsList>

              <div className="mt-auto flex flex-col items-center" title={`版本 v${APP_VERSION}`}>
                <span className="text-[9px] font-mono text-[#76B900]/70 font-normal leading-none px-1.5 py-0.5 rounded border border-[#76B900]/15 bg-[#76B900]/[0.05]">
                  v{APP_VERSION}
                </span>
              </div>
            </nav>

            <main className={`flex-1 min-h-0 flex flex-col p-3 lg:p-4 2xl:p-5 min-[1920px]:p-6 ${isStale ? 'opacity-50' : ''}`}>
              {!metrics && connectionStatus !== 'connected' && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-zinc-50 mb-2">Waiting for metrics</h2>
                    <p className="text-zinc-400">
                      Connecting to the metrics server at {window.location.origin}. Make sure Xpark Media Foundry is running.
                    </p>
                  </div>
                </div>
              )}

              <TabsContent value="agent" className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                <AgentView />
              </TabsContent>

              <TabsContent value="assets" className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                <AssetsView />
              </TabsContent>

              <TabsContent value="studio" className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                <OneClickStudio />
              </TabsContent>

              <TabsContent value="system" className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                <SystemView
                  metrics={metrics}
                  history={history}
                  events={events}
                  requests={requests}
                />
              </TabsContent>

              <TabsContent value="settings" className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                <SettingsView />
              </TabsContent>

              <TabsContent value="chat" className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                <ChatView engines={metrics?.engines ?? []} />
              </TabsContent>
            </main>
          </Tabs>
        </div>
      </div>
    </ErrorBoundary>
  )
}

export default App
