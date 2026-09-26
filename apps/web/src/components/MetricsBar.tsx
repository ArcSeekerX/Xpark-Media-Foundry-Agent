import type { Metrics } from "../flow/store";

export function MetricsBar({ metrics }: { metrics: Metrics }) {
  const firstPassRate =
    metrics.acceptedShots > 0
      ? Math.round((metrics.firstPassAccepted / metrics.acceptedShots) * 100)
      : 0;
  return (
    <div className="metrics">
      <div className="metric">
        <b>
          {metrics.acceptedShots}/{metrics.totalShots}
        </b>
        <span>镜头验收</span>
      </div>
      <div className="metric">
        <b>{metrics.renderAttempts}</b>
        <span>渲染尝试</span>
      </div>
      <div className="metric">
        <b>{firstPassRate}%</b>
        <span>首轮合格率</span>
      </div>
      <div className="metric">
        <b>{metrics.repairCount}</b>
        <span>自动修复</span>
      </div>
      <div className="metric">
        <b>{metrics.humanReview}</b>
        <span>转人审</span>
      </div>
      <div className="metric">
        <b>{metrics.totalShots - metrics.acceptedShots}</b>
        <span>待完成</span>
      </div>
      <div className="metric">
        <b>{metrics.importedAssets}</b>
        <span>导入素材</span>
      </div>
      <div className="metric">
        <b>{metrics.imageGenerations}</b>
        <span>生图</span>
      </div>
      <div className="metric">
        <b>{metrics.imageReuses}</b>
        <span>复用素材</span>
      </div>
      <div className="metric">
        <b>{metrics.discardedAssets}</b>
        <span>弃用</span>
      </div>
      <div className="metric">
        <b>{metrics.regenerations}</b>
        <span>重生成</span>
      </div>
      <div className="metric">
        <b>
          {metrics.routeReuses}/{metrics.routeGenerates}
        </b>
        <span>路由 复用/生成</span>
      </div>
      <div className="metric">
        <b>{metrics.routeModelAccepted}</b>
        <span>路由采纳</span>
      </div>
      <div className="metric">
        <b>{metrics.routeShadowDisagreements}</b>
        <span>影子分歧</span>
      </div>
    </div>
  );
}
