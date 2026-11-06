# Xpark 数字资产生成流水线 · Digital Asset Generation Pipeline

一个本地部署的「对话式数字资产生成流水线」：左边是主 Agent 对话框，右边是图片/视频数字资产查看模块。
聊清楚想法后，Agent 产出结构化英文提示词，投递到本机渲染引擎（ComfyUI + MiniMax H3，画面+声音联合生成），
成片自动入库到右侧数字资产库。

Web 端口：**http://<host>:5100**

## 功能

- **主 Agent 对话**：引导式需求澄清（每轮最多一个问题），信息足够即给方案卡；说「直接生成」自动提交渲染
- **技能调用**：对话框输入 `/` 触发技能补全（↑↓/Enter 选择），选中后进入技能芯片；
  发送时后端注入对应 SKILL.md 指令（每轮最多 3 个），消息与历史都带技能标签；
  默认只暴露「图片/视频创作 + 审美」相关 10 个技能（hypit、hypit-comfyui-video、sound-director、
  feishu-doc-glass-video、color-expert、theme-factory、design-review、frontend-design、hallmark、
  impeccable-design-polish），可用 `VA_SKILLS_ALLOW` 调整，`all` 表示全部
- **对话持久化**：会话与消息落库，刷新/重开自动恢复；「历史」面板可切换、删除对话
- **任务队列视图**：数字资产 / 任务队列双视图；按状态筛选，查看每个任务的进度、参数、提示词、耗时与结果，支持停止 / 重试
- **拖拽参考图**：从资产库把图片拖进对话框即设为参考图（图生视频）
- **参考视频重做**：视频资产可「以视频为参考重做」——锁定首帧/尾帧/首尾帧/中间帧，改描述后重新生成（锁定起止、只改变化部分）
- **飞书接入**：生成完成自动推送到飞书（视频带封面、图片成组、失败通知）；专属群「Xpark 数字资产流水线」里发消息/发图即可触发任务，回复与成片自动回传；「新对话」重置上下文
- **参考图先行**：方案卡点「先生成参考图」或对话说「先出几张图」，用 Qwen-Image 2.1 一次生成 4 张候选（每张约 3 分钟）；
  图库中打开任一参考图点「用此图生成视频」即走图生视频（H3 首帧）
- **自动质检**：每条成片/参考图生成后自动抽帧送本地视觉模型（gemma3:4b）质检，判定通过/有瑕疵/未通过并给出问题说明；
  资产卡片与灯箱展示质检结论，灯箱内可手动「质检」复检
- **完整链路**：剧本方案 → 参考图 → 视频（H3 画声同出）→ 质检 → 归档 / 飞书回传
- **数字资产查看**：视频 / 图片分栏展示（独立分区 + 计数），封面、时长、分辨率、提示词、下载；灯箱 ←/→ 按同类浏览，生成完成自动刷新
- **按会话筛选资产**：资产工具条下拉可选择「当前会话 / 指定历史对话」，每个产物（含参考帧、修复、后期、讲解片）自动归属产生它的会话；「汇总」可扫描外部目录统一登记
- **资产删除**：卡片悬浮一键删除、灯箱内删除、「管理」多选批量删除，均带应用内确认弹窗
- **图生视频**：对话里可附一张参考图作为首帧，或使用已生成的参考图
- **任务进度**：排队 / 生成进度 / 耗时 / 停止，全部在对话消息流里（参考图为「生成 N/M 张」，视频为渲染步数）
- **资产导入**：`scripts/import_samples.py` 可把已有本地视频/图片登记为示例资产
- **明暗双主题**：顶栏一键切换白昼 / 黑夜模式，首次访问跟随系统偏好，选择本地记忆

## 快速开始

```bash
cd /home/admin/xu/xfusion/video-agent
cp .env.example .env        # 填写文本模型 endpoint/key
./run.sh                    # 首次自动创建 .venv 并安装依赖
# 打开 http://127.0.0.1:5100
```

作为常驻服务（推荐）：

```bash
sudo cp deploy/video-agent.service /etc/systemd/system/
sudo cp deploy/qwen-image.service /etc/systemd/system/   # Qwen-Image 2.1 绘图引擎
sudo cp deploy/feishu-bridge.service /etc/systemd/system/ # 飞书消息触发桥
sudo cp deploy/opencode-feishu-bridge.service /etc/systemd/system/ # 私聊通用智能体桥
sudo systemctl daemon-reload
sudo systemctl enable --now video-agent qwen-image feishu-bridge opencode-feishu-bridge
```

> 飞书桥轮询专属群（`VA_FEISHU_CHAT`）及附加会话（`VA_FEISHU_EXTRA_CHATS`，
> 逗号分隔），把文字/图片转成流水线会话；任务完成由 worker 按 `job.feishu_target`
> 回传（web 触发的任务发给 `VA_FEISHU_TARGET`）。依赖 lark-cli（node），服务环境已注入 node PATH。
>
> 私聊桥（`scripts/opencode_bridge.py`）轮询机器人 P2P 会话（`VA_OPENCODE_CHAT`），
> 每条消息交给 `opencode run`（通用智能体）：转发思考/工具执行过程与最终回复，
> 「/new」开新会话。依赖 opencode CLI（`VA_OPENCODE_BIN`，默认 `/root/.opencode/bin/opencode`）。

> 绘图引擎使用宿主机 venv `/home/admin/xu/comfyui/venv`（diffusers ≥0.41 + transformers ≥5）
> 加载 `/home/admin/xu/comfyui/qwen-image-2.1`，模型 CPU offload，可与 ComfyUI 渲染共存。

## 配置（.env / 环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `VA_PORT` | `5100` | Web 端口 |
| `VA_COMFY_BASE` | `http://127.0.0.1:8188` | 本机 ComfyUI（MiniMax H3，需已加载 H3 模型与 LoRA） |
| `VA_QWEN_IMAGE_URL` | `http://127.0.0.1:8601` | Qwen-Image 2.1 绘图服务 |
| `VA_IMAGE_COUNT` / `VA_IMAGE_STEPS` | `4` / `20` | 参考图批量张数 / 采样步数 |
| `VA_TEXT_BASE` / `VA_TEXT_MODEL` / `VA_TEXT_API_KEY` | opencode-go 网关 / `deepseek-v4.1-flash` | Agent 大脑，任意 OpenAI 兼容接口 |
| `VA_TEXT_HEADERS` | `{}` | 额外请求头（JSON 对象；opencode-go 网关需要 `x-opencode-session`） |
| `VA_RENDER_TIMEOUT` | `7200` | 单条渲染超时（秒） |
| `VA_DATA_DIR` | `./data` | SQLite 与资产文件目录 |

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/chat` | 一轮对话 `{conversation_id?, content, attachment_asset_id?, skills?}` → `{conversation_id, reply, checklist, proposal, job}` |
| `GET` | `/api/skills` | 已安装技能列表（名称 + 描述，来自 `VA_SKILLS_DIR`） |
| `GET` | `/api/conversations` · `/api/conversations/{id}` | 历史对话列表 / 会话详情（含消息、清单、待确认方案） |
| `DELETE` | `/api/conversations/{id}` | 删除对话及其消息 |
| `POST` | `/api/jobs` | 直接创建渲染任务 `{title, prompt, duration_s, aspect, first_frame_asset_id}` |
| `POST` | `/api/images` | 创建参考图任务 `{title, prompt, count, aspect}`（Qwen-Image 2.1 批量） |
| `GET` | `/api/jobs` | 任务列表（`?limit=&status=queued,running`）+ 各状态计数 |
| `GET` | `/api/jobs/{id}` | 任务详情 |
| `POST` | `/api/jobs/{id}/cancel` | 排队中取消；渲染中向 ComfyUI 发 interrupt |
| `POST` | `/api/jobs/{id}/retry` | 重试失败/已取消的任务（按原参数重新入队） |
| `GET` | `/api/assets` | 资产列表（`?kind=video\|image`） |
| `POST` | `/api/assets/upload` | 上传参考图（multipart `file`） |
| `GET` | `/api/assets/{id}/file` · `/poster` | 媒体文件（支持 Range）/ 视频封面 |
| `POST` | `/api/assets/{id}/frame` | 视频抽帧 `{position: first\|last\|middle\|秒数}` → 新图片资产 |
| `POST` | `/api/assets/{id}/feishu` | 手动把资产推送到飞书（默认接收人） |
| `DELETE` | `/api/assets/{id}` | 删除资产 |
| `GET` | `/api/status` | ComfyUI 在线状态与 GPU 队列 |

## 架构

```
app/
  api.py       FastAPI 路由（chat / jobs / assets / status，Range 文件服务）
  agent.py     对话 Agent：系统提示词 + 确定性钳制（时长/画幅正则、开机意图、兜底提示词）
  llm.py       OpenAI 兼容文本模型客户端 + 健壮 JSON 提取
  worker.py    单卡串行渲染 worker：补丁 H3 工作流 → 提交 → ws 进度 → 下载 → 封面 → 入库
  comfy.py     ComfyUI HTTP/WS 客户端（submit / history / view / interrupt / progress）
  store.py     SQLite：assets / jobs；文件存 data/assets/<id>/
  config.py    环境配置
workflows/h3_t2v.api.json   MiniMax H3 文生视频（含音频）工作流模板
app/static/    index.html + style.css + app.js（无构建、无框架）
```

生成规格：24 fps，帧数贴齐 17k+5 网格（124~362，约 5~15 秒），
画幅 16:9 → 1344×768，9:16 → 768×1344，1:1 → 1024×1024；单条渲染约 10~15 分钟。

## 运维

```bash
journalctl -u video-agent -f          # 服务日志
tail -f /tmp/opencode/video-agent.log # 手动运行时的日志
sqlite3 data/video_agent.db '.tables' # 数据检查
```
