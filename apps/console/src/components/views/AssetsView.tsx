import { useMemo, useState } from 'react'
import { HardDrive, Layers } from 'lucide-react'
import { useAgentFlow } from '@/foundry/flow/useAgentFlow'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DigitalAssets } from './DigitalAssets'

export function AssetsView() {
  const flow = useAgentFlow()
  const { state } = flow
  const [activeShotId, setActiveShotId] = useState<string | undefined>()

  const storage = flow.capabilities?.storage

  const counts = useMemo(
    () => ({
      images: state.assets.filter((a) => a.mediaType === 'image').length,
      videos: state.assets.filter((a) => a.mediaType === 'video').length,
      accepted: state.assets.filter((a) => a.status === 'accepted').length,
    }),
    [state.assets],
  )

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
      <div className="flex flex-col gap-4 xp-stagger">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Layers size={16} className="text-[#76B900]" /> 数字资产
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                图片 {counts.images}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                视频 {counts.videos}
              </Badge>
              <Badge variant="default" className="text-[10px]">
                已采用 {counts.accepted}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <DigitalAssets
              assets={state.assets}
              shots={state.shots}
              runs={state.runs}
              busy={state.busy}
              onAccept={(shotId, assetId) => flow.acceptCandidate(shotId, assetId)}
              onDiscard={(assetId, reason, note) => flow.discardCandidate(assetId, reason, note)}
              onRestore={(assetId) => flow.restoreCandidate(assetId)}
              onRegenerate={(shotId) => void flow.regenerateShot(shotId)}
              onSelectShot={setActiveShotId}
            />
          </CardContent>
        </Card>

        {storage && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive size={16} className="text-[#76B900]" /> 存储路径
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide">导入素材</div>
                <div className="truncate font-mono">{storage.imports_dir}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide">生成产物</div>
                <div className="truncate font-mono">{storage.generated_dir}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide">成片导出</div>
                <div className="truncate font-mono">{storage.exports_dir}</div>
              </div>
            </CardContent>
          </Card>
        )}

        {activeShotId && (
          <div className="text-[11px] text-muted-foreground">
            已选择镜头 {activeShotId}，可在「主 Agent」中查看其进度与产物。
          </div>
        )}
      </div>
    </div>
  )
}
