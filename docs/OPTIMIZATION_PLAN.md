# Xpark Media Foundry · 优化规划与架构完善

> 配套图：总体架构 [`architecture.svg`](architecture.svg) · 主 Agent 流程 [`agent-flow.svg`](agent-flow.svg) · 模块图标 [`icons.svg`](icons.svg)

本文先给出当前代码仓的体检结论，再给出以「交互体验、废图/废视频重生成、智能路由」为核心的完善规划。

---

## 1. 现状体检（可优化点）

| # | 问题 | 位置 | 影响 | 优先级 |
|---|---|---|---|---|
| 1 | **前端双份代码**：`apps/web/src` 与 `apps/console/src/foundry` 逐文件重复（`useAgentFlow.ts` 980 行、`types.ts` 354、adapters 各 100–244 行） | `apps/web/src`、`apps/console/src/foundry` | 改一处要改两处，极易漂移 | P0 |
| 2 | **无持久化**：状态只存在 React reducer / 内存，刷新即丢失 | `flow/store.ts` | 无法恢复、无法审计 | P0 |
| 3 | **事件流未接通**：有 `connectSse` 但后端无 `/events`，`EventLog` 仅内存 | `flow/events.ts`、`apps/api/server.py` | 断线无法回放，无法多端同步 | P0 |
| 4 | **无暂停/取消/续跑**：仅有 `reset`，无 `command_id`/`attempt_id` 语义 | `useAgentFlow.ts` | 无法中断长任务、无法幂等重发 | P1 |
| 5 | **质检为 mock**：`MockJudge` 固定分数；无真实 VLM | `adapters/mock.ts` | 验收不可信 | P1 |
| 6 | **修复仅轮换 prompt 变体**，未按证据差异化 | `useAgentFlow.ts` repair 分支 | 无效重试多 | P1 |
| 7 | **无废图/废视频概念**：产物直接入库/绑定，不能弃用或重生成 | `flow/store.ts`、`AgentView.tsx` | 无法择优、无法回收 | P0 |
| 8 | **路由偏弱**：技能靠关键词打分，决策端口只决定 `materialPolicy` | `skills/router.ts`、`useAgentFlow.ts` | 未真正“智能路由” | P1 |
| 9 | **资产无去重/版本**：导入以 dataURL 存内存，无 sha256/版本 | `useAgentFlow.ts` | 重复生成、难追溯 | P1 |
| 10 | **合成是模拟**：`compose()` 仅取最后片段 URL 预览 | `useAgentFlow.ts` | 无真实成片 | P1 |
| 11 | **后端无鉴权、CORS `*`** | `apps/api/server.py` | 暴露风险 | P0 |
| 12 | **无能力表**：模型输入能力硬编码 | `config.ts`、`adapters/comfy*.ts` | 易产生不支持的工作流 | P1 |
| 13 | **打包体积大**：console 单 chunk ~800KB | `apps/console` | 首屏慢 | P2 |
| 14 | **测试覆盖窄**：仅 `smoke:plan`、后端 4 用例、`DistributionTests` | `apps/web/scripts`、`apps/api/test_server.py` | 回归风险 | P1 |
| 15 | **无 i18n / 无障碍** | 全前端 | 可访问性差 | P3 |

---

## 2. 目标架构

见 [`architecture.svg`](architecture.svg)。五层职责：

1. **Web 体验层**：主 Agent、一键出片、系统监控、在线对话/候选审阅。
2. **编排与智能路由**：Orchestrator（状态机/预算/幂等）、智能路由 Router、Decision Port（Laya/Jev）、Skill Router、能力表/预算。
3. **创作与资产**：素材摄取/导入、Asset Store（去重/版本/绑定）、分镜 Planner、提示词 Agent。
4. **生成与质检**：关键帧生图（Qwen Image）、视频生成（MiniMax H3）、ComfyUI Adapter、质检 Judge、修复 Agent。
5. **交付与恢复**：剪辑合成、成片/归档、人审/恢复、**废图/废视频回收站**。

共享底座：业务后端（FastAPI/REST/SSE）、ComfyUI、状态持久化、事件总线、指标与追踪。

主流程见 [`agent-flow.svg`](agent-flow.svg)：输入 → 分镜 → 素材准备 → **智能路由** → 生成 → 质检 → **采用 / 弃用 / 重新生成** → 剪辑成片。

---

## 3. 重点能力设计

### 3.1 废图 / 废视频与重新生成

**数据模型**

```ts
type CandidateStatus = "candidate" | "accepted" | "discarded";

interface Candidate {
  assetId: Id;
  shotId: Id;
  runId: Id;
  attemptId: Id;
  status: CandidateStatus;
  score?: ScoreReport;
  parentAssetId?: Id;        // 重生成来源，形成谱系
}

interface DiscardRecord {
  assetId: Id;
  reasonTag: "identity_drift" | "action_incomplete" | "composition_mismatch"
           | "flicker" | "deformation" | "other";
  note?: string;
  at: string;
  by: "auto" | "human";
}
```

**交互（[`agent-flow.svg`](agent-flow.svg) 候选管理区）**

- 每个镜头展示候选网格：缩略图/视频 + 分数 + 证据时间点。
- 单项操作：**采用**（进入合成清单）、**弃用**（写入原因 → 回收站）、**重新生成**。
- 重新生成参数：`seed` 增量、`prompt` 变体、替换参考图、参数档位（steps/sampler）。
- 回收站：默认不参与合成；支持恢复比较与“从回收站重生成”。

**规则**

- 仅 `accepted` 候选参与合成；`discarded` 留证并保留旧版本。
- 重生成创建新 `attemptId`，记录 `parentAssetId`，不覆盖历史。
- 弃用不删除文件，审计可追溯。

**事件**：`candidate.created` / `candidate.accepted` / `candidate.discarded` / `candidate.regenerated`。

### 3.2 智能路由

**输入状态**：素材可用性（导入/复用/缺口）、素材哈希、历史 QC、预算（重试/时长）、技能候选、模型能力表。

**动作集合**：`reuse_imported`、`reuse_clip`、`image_conditioned`、`generate`、`repair`、`human_review`。

**流程**（[`agent-flow.svg`](agent-flow.svg) 路由区）

```
规则排除不可执行项 → 压缩状态 + 候选集合 → Laya/Jev 结构化建议
→ 校验/阈值校准 → 执行或回退（规则/Qwen）
```

**落地策略**

- **影子模式**：先记录建议不影响执行，用中文镜头样本校准后逐步启用。
- **回退**：低置信、超上下文、异常时回退规则或 Qwen。
- **指标**：路由命中率、回退率、决策耗时、每条合格视频总耗时与重试次数。

**事件**：`decision.proposed` / `decision.applied` / `decision.fallback`。

---

## 4. 交互体验优化

- **候选对比**：并排图片/视频 + 分数 + 失败证据时间点，一键采用/弃用/重生成。
- **真实进度**：ComfyUI 采样步进（WebSocket），无进度显示“执行中 + 已耗时”，不伪造百分比。
- **控制语义**：暂停（停止后续调度）/取消（`CANCEL_REQUESTED` → 确认）/续跑（从可复用步骤恢复）。
- **素材体验**：拖拽上传、批量标记用途、去重提示、版本切换。
- **回收站与历史**：弃用产物与旧版本可视化对比。
- **主题与响应式**：console 支持亮/暗主题，窄屏可用。
- **快捷键**：⌘/Ctrl+Enter 提交、J/K 切换镜头、A/D 采用/弃用。

---

## 5. 分阶段路线图

### P0 · 地基（1–2 天）
1. 抽取共享包 `packages/foundry`（types/config/adapters/flow/skills），web 与 console 复用。
2. 候选 + 回收站数据模型与 reducer 动作。
3. 后端：SSE `/events`（snapshot_seq + 游标 + 去重）、Token 鉴权、CORS 白名单。
4. 前端打包代码分割。

### P1 · 核心（3–5 天）
5. 智能路由 v1（规则 + 影子记录 + 回退）。
6. 废图/废视频 UI + 重新生成（seed/prompt/参考图/参数变体）。
7. 持久化与恢复（后端 Project/Run/StepRun + 前端快照恢复）。
8. 暂停/取消/续跑命令（`command_id`/`attempt_id`/幂等）。
9. 差异化修复 + 重试预算。

### P2 · 生产化（1–2 周）
10. 真实质检（VLM + 确定性检测 + rubric 版本化）。
11. 后端 ffmpeg 合成端点（仅采用版本）。
12. 能力表 + 工作流模板校验。
13. 路由自动启用与校准；指标看板（路由命中、通过率、耗时）。
14. 测试：状态机、路由、恢复、候选生命周期。

### P3 · 规模化
15. 队列/GPU 租约/多机 Worker。
16. i18n、无障碍、审计与合规。

---

## 6. 验收标准（节选）

- **重生成**：同一镜头可保留 ≥2 个候选；弃用不删除文件；仅采用版本进入成片；重生成形成 `parentAssetId` 谱系。
- **智能路由**：影子模式下不影响产出；启用后质量不降低，且重试次数/总耗时下降；低置信与服务故障可回退。
- **事件流**：断线重连后按游标补齐、按 `event_id` 去重；刷新后恢复到相同任务视图。
- **持久化**：重启后端后项目/运行/步骤可恢复；重复命令不产生重复执行。

---

## 7. 实现状态

已落地（`apps/console` + `apps/web` 同步）：

| 能力 | 状态 | 说明 |
|---|---|---|
| 废图/废视频与重生成 | ✅ | `CandidateStatus`/`DiscardRecord`、采用/弃用/恢复/重生成、回收站、`parentAssetId` 谱系（候选面板 + 指标） |
| 智能路由 v1 | ✅ | `routing/router.ts`：规则优先 + 模型建议 + 影子模式 + 回退；`decision.proposed/applied/fallback` 事件 |
| 持久化 | ✅ | 流程快照写入 localStorage（超配额自动降级，丢弃内联大图） |
| 取消 | ✅ | `cancel()` 停止后续调度，运行中任务在安全边界停止 |
| 交互体验 | ✅ | 候选对比网格、弃用原因、重生成变体（种子/提示词/步数）、回收站、路由/弃用/重生成指标 |
| 新事件 | ✅ | `candidate.created/accepted/discarded/regenerated`、`decision.applied/fallback` |
| SSE 事件流 | ✅ | 后端 `EventBus` + `GET /api/events`（seq 游标、id 去重、keep-alive）；前端 `sseStatus` 接入 |
| 后端鉴权 / CORS | ✅ | `API_TOKEN`（Bearer 或 SSE `?token=`）+ `ALLOWED_ORIGINS` 白名单；`/api/health` 公开 |
| 能力表 | ✅ | `GET /api/capabilities`（参考图上限、fps、ffmpeg）；前端校验超限参考图 |
| ffmpeg 合成 | ✅ | `POST /api/productions/compose` + `GET /api/exports/{name}`；无 ffmpeg 时 503 降级为片段预览 |
| 路由自动启用 / 校准 | ✅ | `VITE_ROUTING_AUTO` 关闭影子；新增“路由采纳 / 影子分歧”指标用于校准 |
| 测试扩展 | ✅ | 后端 9 用例（含 SSE/鉴权/能力/合成降级）；前端 smoke 新增 7 条路由用例 |

待办：共享包抽取（消除 web/console 重复）、真实质检（VLM）、多机/队列/GPU 租约、i18n/无障碍。

---

## 8. 在应用中呈现

可将三张图复制到前端静态目录并在控制台新增“架构”页引用：

```bash
cp docs/architecture.svg docs/agent-flow.svg docs/icons.svg apps/console/public/
```

图标集以 `<symbol>` 定义，可直接复用：

```html
<svg width="20" height="20" style="color:#76B900"><use href="/icons.svg#ic-router"/></svg>
```
