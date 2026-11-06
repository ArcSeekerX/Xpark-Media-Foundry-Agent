# Xpark 数字资产生成流水线 — 部署文档（当前环境）

> 本文按本机 **fusionxparkgb10-e2d7** 的实际部署整理，最后核对：2026-10-10。
> 代码目录：`/home/admin/xu/xfusion/video-agent`（非 git 仓库，无远端）。

---

## 0. 环境快照

| 项 | 值 |
|---|---|
| 主机 | `fusionxparkgb10-e2d7` |
| 系统 | Ubuntu 24.04.3 LTS |
| GPU | NVIDIA GB10，驱动 `580.95.05`，CUDA 13.0 |
| Python | 3.12.3（主 venv / Qwen venv 同为 3.12.3） |
| Node | v26.4.0（nvm，`/root/.nvm/versions/node/v26.4.0/bin`） |
| 容器 | Docker（`docker.service`，开机自启） |
| 主机名解析/网络 | 见文末「网络注意」 |

---

## 1. 组件与端口

| 组件 | 形态 | 端口 | 说明 |
|---|---|---|---|
| **video-agent** | systemd `video-agent.service` | `0.0.0.0:5100` | FastAPI 主应用：对话 Agent + 任务队列 + 资产库（`python -m app`） |
| **qwen-image** | systemd `qwen-image.service` | `0.0.0.0:8601` | Qwen-Image 2.1 文生图（参考图），加载本地 diffusers 模型，CPU offload |
| **feishu-bridge** | systemd `feishu-bridge.service` | 无（轮询） | 轮询飞书专属群 `VA_FEISHU_CHAT`，转成流水线会话；依赖 `:5100` |
| **ComfyUI (MiniMax H3)** | docker `comfyui-spark` | `0.0.0.0:8188` | 视频渲染引擎（画面+声音），镜像 `xfusion.ai/oss/comfyui-xpark-minimax-h3:latest` |
| **Ollama (质检)** | docker `comfyui-llama-server` | 容器内 `172.18.0.2:11434` | 质检视觉模型 `gemma3:4b`（`VA_QC_BASE`） |
| **Agent 大脑** | 网关 API | `https://opencode.ai/zen/go/v1` | opencode-go 网关（`deepseek-v4.1-flash`） |
| **飞书发送/收信** | CLI 出站 | `api.feishu.cn / open.feishu.cn` | `lark-cli`（node），由 bridge 与 feishu.py 调用 |

> 同机其他常驻服务（与流水线无直接依赖）：`github-dashboard.service`（:3000）、`lark-opencode-bridge`（opencode serve :4096）。

链路：`聊天/飞书 → video-agent(:5100) → [Qwen-Image(:8601) 参考图 | ComfyUI(:8188) H3 视频] → 质检(Ollama) → 入库(data/assets + /srv/projects) → 飞书回传(lark-cli)`。

---

## 2. 目录与数据

| 路径 | 内容 |
|---|---|
| `/home/admin/xu/xfusion/video-agent` | 代码根（`WorkingDirectory`） |
| `…/app` | FastAPI 路由、agent、worker、comfy、store、config、static |
| `…/workflows/h3_t2v.api.json` | MiniMax H3 文生视频（含音频）工作流模板 |
| `…/scripts/feishu_bridge.py` | 飞书群轮询桥 |
| `…/scripts/qwen_image_server.py` | Qwen-Image 2.1 HTTP 服务 |
| `…/scripts/import_samples.py` | 批量登记本地样例资产 |
| `…/.venv` | 主应用虚拟环境（fastapi 0.142、uvicorn 0.54、httpx 0.28 等） |
| `…/.env` | 运行配置与密钥（**不入库**） |
| `…/data/video_agent.db` | SQLite：`assets` / `jobs` / `conversations` / `messages` |
| `…/data/assets/<id>/` | 资产本地副本与视频封面 `poster.jpg` |
| `…/data/tmp/` | 飞书发送时的压缩/拷贝临时目录 |
| `/srv/projects` | **资产汇总（汇总按钮）扫描根**，含 `default/hypit-comfyui`、`default/xfusion/{case,case2,case3,outputs}` |
| `/root/.config/opencode/skills` | 技能源目录（SKILL.md），共 49 个 |
| `/root/.local/ttsvenv` | 旁白 TTS 环境（edge-tts 7.2.8） |
| `/home/admin/xu/comfyui/venv` | Qwen-Image 运行环境（diffusers 0.41.0、transformers 5.18.0） |
| `/home/admin/xu/comfyui/qwen-image-2.1` | Qwen-Image 2.1 模型权重 |
| `/home/admin/xu/xfusion/comfyui-Xpark-minimax-h3-nomodel` | ComfyUI 的 docker compose 工程 |

---

## 3. 配置（`.env`）

`config.py` 启动时读取 `BASE_DIR/.env`（已存在的真实环境变量优先），systemd 只额外注入 `VA_PORT`。当前 `.env` 关键项：

```ini
VA_HOST=0.0.0.0
VA_PORT=5100
VA_COMFY_BASE=http://127.0.0.1:8188

# Agent 大脑：opencode-go 网关（OpenAI 兼容）
VA_TEXT_BASE=https://opencode.ai/zen/go/v1
VA_TEXT_MODEL=deepseek-v4.1-flash
VA_TEXT_API_KEY=<opencode-go-key>         # oc_sk_... 见 .env；同 opencode auth.json
VA_TEXT_HEADERS={"User-Agent": "VideoAgent/1.0", "x-opencode-session": "va-..."}

# 资产汇总扫描根（只汇总该路径下的素材）
VA_ASSET_SOURCES=/srv/projects

# 飞书
VA_FEISHU_ENABLED=1
VA_FEISHU_TARGET=ou_5f5f9b4d84768156f6fd2444bca6cfca   # web 触发任务的默认接收人
VA_FEISHU_CHAT=oc_1a2c53713f9ccb2a6be945bb897f5ba9      # 专属群（bridge 轮询）
VA_LARK_CLI=/root/.nvm/versions/node/v26.4.0/bin/lark-cli
```

未在 `.env` 中显式设置的项沿用 `app/config.py` 默认值，常用：

| 变量 | 默认 | 说明 |
|---|---|---|
| `VA_QWEN_IMAGE_URL` | `http://127.0.0.1:8601` | 参考图服务 |
| `VA_IMAGE_COUNT` / `VA_IMAGE_STEPS` | `4` / `20` | 参考图张数 / 采样步数 |
| `VA_RENDER_TIMEOUT` | `7200` | 单条视频渲染超时（秒） |
| `VA_QC_ENABLED` / `VA_QC_BASE` / `VA_QC_MODEL` | `1` / `http://172.18.0.2:11434/v1` / `gemma3:4b` | 自动质检 |
| `VA_SKILLS_DIR` | `/root/.config/opencode/skills` | 技能源 |
| `VA_SKILLS_ALLOW` | 10 个创作/审美技能（`all` 全开） | 对话里 `/` 可见技能白名单 |
| `VA_TTS_PYTHON` | `/root/.local/ttsvenv/bin/python` | 旁白 TTS |
| `VA_HYPIT_PROJECT` | `/srv/projects/default/hypit-comfyui` | 长视频/hypit |
| `VA_DATA_DIR` | `./data` | SQLite 与资产目录 |

> 模板见 `.env.example`；新增变量后需 `systemctl restart video-agent`。

---

## 4. 从零部署步骤

### 4.1 系统依赖
```bash
sudo apt-get install -y ffmpeg sqlite3          # ffmpeg/ffprobe 用于封面、抽帧、压缩
# NVIDIA 驱动 + Docker 已就绪（GB10 / CUDA 13.0）
```

### 4.2 渲染引擎 ComfyUI（MiniMax H3，:8188）
```bash
cd /home/admin/xu/xfusion/comfyui-Xpark-minimax-h3-nomodel
docker compose up -d          # 起 comfyui-spark(:8188) 与 comfyui-llama-server(Ollama, gemma3:4b)
docker ps | grep -E 'comfyui-spark|comfyui-llama-server'
curl -s http://127.0.0.1:8188/system_stats | head
```

### 4.3 Qwen-Image 2.1 服务（:8601）
依赖 `/home/admin/xu/comfyui/venv`（diffusers≥0.41）与模型 `/home/admin/xu/comfyui/qwen-image-2.1`。
```bash
sudo cp deploy/qwen-image.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now qwen-image
curl -s http://127.0.0.1:8601/ -o /dev/null -w '%{http_code}\n'   # 服务端口应可连
```

### 4.4 主应用 + 飞书桥
```bash
cd /home/admin/xu/xfusion/video-agent
cp .env.example .env          # 填 VA_TEXT_* / VA_FEISHU_* 等
./run.sh                      # 首次自动创建 .venv 并装依赖（清华源）

sudo cp deploy/video-agent.service deploy/feishu-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now video-agent feishu-bridge
```

### 4.5 飞书 CLI（node）
`lark-cli` 需已用飞书自建应用登录（凭证在 `~/.lark-cli` 等），`feishu_bridge` 与 `feishu.py` 依赖其可执行。
```bash
/root/.nvm/versions/node/v26.4.0/bin/lark-cli auth status
```

---

## 5. 启停与运维

```bash
# 状态 / 重启
systemctl status video-agent qwen-image feishu-bridge
sudo systemctl restart video-agent          # 改 .env、改后端代码后
sudo systemctl restart feishu-bridge

# 日志
journalctl -u video-agent -f
journalctl -u feishu-bridge -n 100
journalctl -u qwen-image -n 100

# 数据
sqlite3 data/video_agent.db '.tables'
sqlite3 data/video_agent.db 'select count(*) from assets;'

# 资产汇总（扫描 VA_ASSET_SOURCES 并登记新文件）
curl -s http://127.0.0.1:5100/api/assets/sources        # dry-run 概览
curl -s -X POST http://127.0.0.1:5100/api/assets/sync   # 实际登记

# 飞书发送自检
curl -s -X POST http://127.0.0.1:5100/api/assets/<id>/feishu
```

> 静态前端（`app/static/*`）改动无需重启，但需刷新浏览器；`index.html` 里 `app.js?v=` 为缓存版本号，改 JS 后应递增。

---

## 6. 已知问题与修复记录

| 现象 | 根因 | 修复 |
|---|---|---|
| 飞书发送失败：**资产文件不存在** | `feishu.send_asset` 用了 `store.asset_path()`（本地副本），汇总登记的资产多为外部 `origin_path` | 改用 `store.asset_file_path()`（本地缺失时回退 origin）；`api.py` 抽帧、`worker.py` 参考图同类修复 |
| 抽帧/参考图对汇总资产报 `file missing` | 同上 | 同上 |
| 「新对话」后刷新又回到旧对话 | `newConversation()` 清空了 `localStorage.xp-conv`，刷新回退到 `conversations[0]` | 引入哨兵 `NEW_CONV="__new__"`，刷新保持空白新对话 |
| Agent 报 `Invalid API key` | 原 opencode-go 网关 key 一度失效 | 可临时切 DeepSeek 公网 `api.deepseek.com`/`deepseek-flash`；当前已改回 opencode-go/`deepseek-v4.1-flash` |
| 汇总范围过大 | 默认扫描多个目录 | `VA_ASSET_SOURCES=/srv/projects`；并把外部 `case*` 迁入 `/srv/projects/default/xfusion/` |

---

## 7. 网络注意

- 出站访问 `api.feishu.cn` / `open.feishu.cn` / `github.com` 等若超时，按本机既有约定处理（详见 `/root/.config/opencode/AGENTS.md`）。
- 质检走的是 Ollama **容器 IP** `172.18.0.2:11434`（未映射到宿主端口）。容器重建后 IP 可能变化，如质检失败先 `docker inspect comfyui-llama-server --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'` 核对 `VA_QC_BASE`。

---

## 8. 生成规格（备忘）

- 24 fps，帧数贴齐 `17k+5` 网格（124~362 帧，约 5~15 秒）。
- 画幅：`16:9 → 1344×768`，`9:16 → 768×1344`，`1:1 → 1024×1024`。
- 参考图（Qwen-Image 2.1）：`16:9 → 1024×576`，`9:16 → 576×1024`，`1:1 → 768×768`。
- 单条视频渲染约 10~15 分钟；上传上限 40 MB。
