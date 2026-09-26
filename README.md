> **实验分支 / Experimental branch:** 新增正式实验方法 **009jev**：普通模型 + native SLA，从首次起即用 Jev 进行逐层控制. 无需 W4A4 转换. See [中文](009JEV.md) / [English](009JEV.en.md). 采用对比为 366.72→213.89 秒（SLA + Jev 的整体效果，各测 1 次）. 旧的 W4A4/VSA 控制见 [旧方式的记录](JEV_ADAPTIVE.md).

[简体中文](#xpark-media-foundry-agent) | [English](#english-documentation)

---

# Xpark Media Foundry Agent

Xpark Media Foundry Agent（`Xpark-Media-Foundry-Agent`）是一条视频数字资产流水线：把文档与图片素材批量制作成 1080P 动画解说视频资产，流程为 素材摄取 → 分镜脚本 → 逐片段生成 → 质检 → ffmpeg 拼接成片。生成层集成 MiniMax-H3 与 009jev native SLA / W4A4+VSA 两条加速路径，决策引擎 Laya（本地）/ OpenJev（llama.cpp）/ Jev（远程 API）逐层动态分配注意力 keep 率，显著降低算力与显存开销。

## 数字资产流水线

```
源素材 (docx / 图片集)
  │ ① 素材摄取   抽取 word/media 与段落结构，按章节主线选图
  ▼
分镜脚本 (每图：旁白 + 动效脚本)
  │ ② 脚本编排   1080P 模板、逐片段种子、顺序浮现动效
  ▼
片段生成 (H3 + 009jev/laya 决策加速)
  │ ③ 批量生成   learning_video_1080p.api.json · gen_learning_video.py
  ▼
片段资产 (5 秒 · 1920×1080 · 24fps · 中文旁白)
  │ ④ 质检/后期  抽帧 + ffprobe + 去水印 + ffmpeg concat
  ▼
成片 (数字资产)
```

| 阶段 | 载体 | 产物 |
|---|---|---|
| ① 素材摄取 | docx `word/media/`（`unzip`/`zipfile`）、段落结构 | 图片素材集（6–10 张示意图） |
| ② 脚本编排 | 每图 `旁白`(≤45 字) + `动效脚本`，`PROMPT_TMPL` | 分镜脚本 `CLIPS` |
| ③ 逐片段生成 | [learning_video_1080p.api.json](examples/learning_video_1080p.api.json)、[gen_learning_video.py](skills/learning-video/scripts/gen_learning_video.py) | 5 秒 1080P 动画片段 |
| ④ 质检 | 抽头/中/尾 3 帧、`ffprobe` | 通过质检的片段 |
| ⑤ 后期/交付 | `dewatermark.sh`（可选）、`concat_learn.sh` | 成片 mp4（1920×1080 · CRF 18） |

### 快速开始（学习视频工厂）

1. 部署 ComfyUI + MiniMax-H3（Docker / GB10 见 [DEPLOYMENT.zh.md](DEPLOYMENT.zh.md)）。
2. 安装本仓库到 `custom_nodes/Xpark-Media-Foundry-Agent`，并准备决策引擎（默认本地 Laya，见 [LAYA.md](LAYA.md)）。
3. 将文档图片放入 ComfyUI `input/`，填写三要素后运行 `python3 skills/learning-video/scripts/gen_learning_video.py 1 2 3`。
4. 抽帧质检后，用 `skills/learning-video/scripts/concat_learn.sh` 拼接成片。
5. 详细步骤、动效写法与质检清单见 [docs/LEARNING_VIDEO.md](docs/LEARNING_VIDEO.md) 与 [学习视频 Skill](skills/learning-video/SKILL.md)。

### 流水线的生成引擎

生成层由 MiniMax H3 + 决策引擎驱动的自适应稀疏注意力构成，按硬件与需求二选一：

| 路径 | 节点 | 说明 | 文档 |
|---|---|---|---|
| **009jev native SLA（推荐）** | `H3JevNativeSLAPatch` | 普通模型 + native SLA，无需 W4A4 转换，逐层动态 keep | [009JEV.md](009JEV.md) |
| W4A4 + Streaming VSA | `H3V2PreconvertedLoader` / `H3V2StreamingVSAPatch` | FC1 W4A4 预转换 + 固定/自适应 VSA | [JEV_ADAPTIVE.md](JEV_ADAPTIVE.md) |

决策引擎三选一，契约一致、可热切换（环境变量 `H3_DECISION_ENGINE`）：

| 引擎 | 部署 | 说明 | 文档 |
|---|---|---|---|
| Laya（默认） | 进程内本地模型 | 322M 本地决策模型，离线免费 | [LAYA.md](LAYA.md) |
| OpenJev | 本地 llama-server | GGUF 生成式决策，一问一答 | [OPENJEV.md](OPENJEV.md) |
| Jev | 远程 TypeSafe API | 需 `TYPESAFE_API_KEY` | [JEV_ADAPTIVE.md](JEV_ADAPTIVE.md) |

实测性能（GB10，5 秒 4 步视频，热缓存）：

| 引擎 | 耗时 | vs 基线 | SSIM vs 基线 |
|---|---:|---:|---:|
| 基线 | 530.2s | — | 1.0 |
| Laya | 340.1s | −35.9% | 0.761 |
| OpenJev | 400.1s | −24.5% | 0.760 |

### 控制台：主 Agent 流程页（新增主模块）

`apps/console/` 复用 Xpark-AI-Perf 前端框架，仅保留白天模式，含三个模块：

| 模块 | 说明 |
|---|---|
| **主 Agent（默认）** | 一句话智能引导 → 场景/分镜 + 技能匹配 → 参考图导入/绑定 → 关键帧生图 → 视频生成与质检 → 修复闭环 → 剪辑拼接 → 素材归档 |
| **一键出片** | 输入 `.md`/`.txt` 文本与图片素材，设定比例/帧数/步数/采样器/种子/风格/旁白等参数，一键完成 分镜 → 逐镜生成 → 质检 → 自动剪辑 并输出成片 |
| 系统监控 | GPU/CPU/内存/磁盘/网络与推理引擎指标、图表、远程节点面板 |
| 在线对话 | 多会话、模型选择、思考块、图片上传、流式回复、生成参数 |

监控与对话接口可暂不接入：内置 mock 层（`src/mock/metrics.ts` 合成指标、`src/mock/chat.ts` 合成 SSE 回复）。接入真实监控后端时设 `VITE_MOCK=0` 与 `VITE_BACKEND_URL`。

```bash
cd apps/console
PATH=/opt/node22/bin:$PATH npm install   # Vite 8 / rolldown 需 Node >= 20
PATH=/opt/node22/bin:$PATH npm run build
PATH=/opt/node22/bin:$PATH npm run preview   # http://0.0.0.0:5000
```

### 生成后端与前后端对接（apps/api）

`apps/api/server.py` 是一个**零依赖**（仅 Python 标准库）的业务后端，为控制台/前端提供生图与生视频任务接口，浏览器不再直连 ComfyUI：

| 接口 | 说明 |
|---|---|
| `GET /api/health` | 后端与 ComfyUI 健康状态 |
| `GET /api/comfy/view?filename=&subfolder=&type=` | 代理 ComfyUI 产物（图片/视频） |
| `POST /api/images/jobs` | 提交文生图（默认 Qwen Image 2.1 7B 模板），可携带参考图 |
| `GET /api/images/jobs/{id}` | 查询生图任务与产物 |
| `POST /api/videos/jobs` | 提交 MiniMax H3 参考生视频任务 |
| `GET /api/videos/jobs/{id}` | 查询生视频任务与产物 |

```bash
# 启动生成后端（默认连接 http://127.0.0.1:8188 的 ComfyUI）
python3 apps/api/server.py --port 8080
# 零依赖自测（内置假 ComfyUI，无需 GPU / 模型）
python3 apps/api/test_server.py
```

前端在 `live` 模式下默认通过 `VITE_BACKEND_URL`（默认 `/api`）调用该后端。把 `VITE_BACKEND_URL` 设为空字符串时回退为浏览器直连 ComfyUI（走 `VITE_COMFY_URL`，开发服务器已代理 `/comfy`）。

生图 / 视频相关环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_MODE` | `mock` | 设为 `live` 启用真实后端适配器；`mock` 下生图返回内联 SVG 占位图，便于无 GPU 演示 |
| `VITE_BACKEND_URL` | `/api` | 业务后端地址；留空则直连 ComfyUI |
| `VITE_COMFY_URL` | `/comfy` | ComfyUI 地址（直连模式） |
| `VITE_IMAGE_WORKFLOW` | `/workflows/qwen_image_t2i.api.json` | ComfyUI 生图 API 工作流 |
| `VITE_IMAGE_WIDTH` / `VITE_IMAGE_HEIGHT` | 768 / 1024 | 关键帧尺寸 |
| `VITE_IMAGE_STEPS` | 20 | 生图采样步数 |
| `VITE_IMAGE_SAMPLER` | `euler` | 生图采样器 |
| `VITE_IMAGE_CFG` | 4 | 生图 CFG |
| `VITE_IMAGE_ENABLED` | `1` | 设为 `0` 关闭生图步骤 |

主 Agent 流程：一句话 → 场景 / 分镜 / 技能 → **参考图导入与绑定（优先复用）→ 缺素材时生成关键帧** → 视频生成（携带参考图）→ 质检 → 修复 → 剪辑 → 归档。导入的参考图会随渲染请求上传到后端 / ComfyUI，用作文生视频的角色条件；被决策端口判定为 `prefer_imported` 时优先复用导入素材、跳过生图。

### 一键出片

`一键出片` 是控制台的新模块，面向「已有素材直接成片」的场景：

1. 导入 `.md` / `.markdown` / `.txt` 文本素材与图片素材（可多选、可拖拽；图片按顺序对应镜头）。
2. 设定参数：画面比例（9:16 / 16:9 / 1:1）、片段帧数、采样步数、采样器、随机种子、最多镜头数、风格描述、是否生成旁白、是否自动剪辑。
3. 点击「一键出片」：后端/前端将文本切分为分镜节拍、按图绑定首帧、逐镜生成并质检，最后自动剪辑输出成片（`state.finalAsset`）。
4. 无素材时可点「载入示例素材」快速体验。

参数会覆盖技能与配置默认值，贯穿关键帧生图与视频渲染（分辨率、帧数、步数、采样器、种子、风格/旁白提示词）。

### 媒体渲染说明

- mock 模式下，生图返回内联 SVG 占位图；生视频返回内置示例 `public/mock/sample.mp4`，因此**无需后端与 GPU 也能看到图片/视频正确渲染**。
- live 模式下，后端产物的相对地址（`/api/comfy/view?...`）会按 `VITE_BACKEND_URL` 解析为可访问 URL；`VITE_BACKEND_URL` 配为绝对地址（如 `http://host:8080/api`）时会自动补全后端 origin，避免预览 404。
- 前端预览对图片/视频自动切换 `<img>` / `<video>`，并在成片面板提供「打开成片」入口。

---

## 生成引擎详解：W4A4 + Streaming VSA

以下为 FC1 W4A4 + Streaming VSA 路径的安装、一次性转换、工作流与验证说明。**在 Windows 上使用 `setup.bat` 即可轻松安装. 已在 ComfyUI v0.36.0 上完成安装与实际生成的确认.** 只要准备好兼容的 ComfyUI 和所需模型，即可一次性完成 Python 选择，兼容性检查，节点配置与预转换. 不会自动下载模型.

### 安装前需要了解的事项

| 项目 | 要点 |
|---|---|
| SSD 额外容量 | 转换缓存 **约 5.79 GB（5.39 GiB）**. 原始模型，Text Encoder，VAE，输出视频等还需另行占用空间. |
| 复用已有缓存 | 指定 `-CacheSource`. 同一卷内的硬链接几乎不会为缓存增加额外占用；跨卷则会复制. |
| 本仓库新增的节点 | **4 个（本实验分支）**：`H3V2PreconvertedLoader`，`H3V2StreamingVSAPatch`，`H3V2JevAdaptiveVSAPatch`，`H3JevNativeSLAPatch`（009jev）. |
| 外部节点依赖 | KJNodes 和 MotionCache-FastVAE **共 2 个包**. 未安装时可用 `-InstallDependencies` 补齐缺失部分. 各包中还包含本工作流以外的节点. |

### ComfyUI v0.36.0 上的实测结果

2026-09-20，GB10 DGX Spark，单次运行. 参数为 1024×1792，124 帧，24fps，4 steps，seed 43，res_multistep/simple，Sigma Shift 12/3，ChunkFFN 4，VSA keep 5%，FastVAE batch 2.

| 指标 | 实测结果 |
|---|---:|
| 生成时间（含模型加载） | **209.233 秒（约 3 分 29 秒）** |
| GPU 使用量最大观测值 | **11,479 MiB** |
| 进程 RAM 峰值（峰值 RSS） | **11,610.7 MiB** |
| 输出验证 | 含音频，124 帧，24fps，FFmpeg 全部解码成功 |
| 中断/重跑 | 无 |

GPU 使用量为每 60 秒间隔及完成时的采样值，并非瞬时峰值. 本次为单次兼容性确认，不是与其他方式的速度对比或画质评估. 由于复用了已通过全部 SHA-256 校验的已有缓存，本次确认未执行全新的 50 层转换和依赖节点的全新安装. 详情请参阅 [VALIDATION.md](VALIDATION.md).

本目录的内容可以直接作为 GitHub 仓库的根目录发布.
其他评估文件夹，对旧版本的引用，实验/失败方案以及 profiling 用代码均非运行所需.
不附带模型，已转换权重，参考图像和输出视频.

## 构成

- `H3V2PreconvertedLoader`：在原始 INT8 模型的 CPU state_dict 上叠加 50 层 FC1 W4A4 shard，构建标准 ModelPatcher. 输出 MODEL 和 cache 连接.
- `H3V2StreamingVSAPatch`：将预先保存的 INT8 Gate 保留在 CPU，仅把当前 block 的 Gate 传输到 GPU. 固定 plan 的 padding 判定只在 CPU 上计算一次.
- `convert.py`：将现有 INT8 ConvRot FC1 → 还原为 native ConvRot 兼容的 BF16 → Plain W4A4. 同时预先保存 Gate.
- GUI/API workflow：相同的节点，设置与引用顺序. GUI 版可直接拖放到 ComfyUI.

FC2 保持 INT8 不变. 不修改 QKV，Attention kernel，Gate 的 INT8 计算公式，ChunkFFN，FastVAE，sampler / scheduler. 不使用 SVDQuant.
不会全局替换 ComfyUI 原生类或现有 custom node. 节点 ID 与旧版不同，因此可以共存. 但请勿在同一个 MODEL 上重复叠加旧版 VSA 和 v2 VSA.

## 所需环境

2026-09-20：已在 **ComfyUI 0.36.0，Python 3.13.13，PyTorch 2.14.0+cu130，comfy-kitchen 0.2.34，comfy-aimdo 0.5.5** 上确认安装和 1024×1792 的实际生成. GB10 DGX Spark 上含模型加载共 209.233 秒（单次）. 详情请参阅 [VALIDATION.md](VALIDATION.md).

首次验证环境：GB10 DGX Spark，Python 3.13.14，PyTorch 2.13.0+cu130，comfy-kitchen 0.2.33，comfy-aimdo 0.5.2.
ComfyUI 验证 commit 为 `15eb748b3ec5f8a0a2d470b7fb280e2d7579f916`.
详细的文件指纹记录在 [compatibility.json](compatibility.json) 中.
仅凭相同的版本号显示无法保证 GPU 二进制兼容性，因此请运行后述的 `--check`.

所需 API：

- ComfyUI：`comfy.quant_ops.QUANT_ALGOS['convrot_w4a4']`，native quantized state_dict loader，`comfy_extras.nodes_sparse_attention`.
- comfy-kitchen：`TensorCoreConvRotW4A4Layout`，CUDA `cutlass_int4_dequant`，`sol_attn_chunked`，`int8_linear`.
- 在该验证版 kitchen 中，native ConvRot INT4 的执行路径取决于架构；不受支持的设置会被排除在支持范围之外并停止. **实测对象仅限 GB10 DGX Spark**. 其他 GPU 请在 `--check` 之外再通过实际生成确认.
- [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes)：`MiniMaxChunkFeedForward`.
- [ComfyUI-MiniMax-H3-MotionCache-FastVAE](https://github.com/Mozer/ComfyUI-MiniMax-H3-MotionCache-FastVAE)：`MiniMaxH3FastVAEDecode`.
- `torch` / `safetensors` 使用与 ComfyUI 相同 Python 环境中的版本.

附带 Windows 用的 `setup.bat`. 它使用现有 ComfyUI 的专用 Python 进行检查，安装和仅执行一次的转换. 不会自动更新 ComfyUI 本体，PyTorch，comfy-kitchen，也不会下载模型. 存在缺失 API 时会停止.

### Windows 简易安装

请先结束 ComfyUI 中的生成任务，然后获取并解压仓库，运行 `setup.bat`. 如果已放置在 `custom_nodes` 内，会自动检测 ComfyUI；否则需要输入 ComfyUI 文件夹路径. 也可以通过命令行按如下方式指定：

```bat
setup.bat -ComfyRoot "C:\ComfyUI_windows_portable\ComfyUI"
```

- 会查找 portable 的 `python_embeded\python.exe`，或 ComfyUI 内/上级文件夹的 `.venv\Scripts\python.exe`，以及 ComfyUI 内的 `venv\Scripts\python.exe`. 有多个候选时请用 `-Python "...\python.exe"` 指定. 拒绝使用全局 Python.
- 会从 ComfyUI 的 `models` 和 `extra_model_paths.yaml` 中搜索现有模型. 原始 Diffusion 模型和 Gate 也可以用 `-Model "...safetensors" -Gate "...safetensors"` 指定. 请提前让 Text encoder 和 VAE 在 ComfyUI 中可用.
- 缺少外部节点时，加上 `-InstallDependencies` 会仅获取缺失的 KJNodes / MotionCache-FastVAE，并将其 requirements 安装到专用 Python. 不会更新已有节点. 常规安装不会执行 pip.
- 确认所需 API，native INT4，CPU offload/重新加载之后，将 FC1 和 Gate 预转换到 `ComfyUI\models\h3_preconverted\fc1_gate`. 原始 Diffusion 模型在生成时同样需要.
- 已有的本项目格式缓存可用 `-CacheSource "...\cache"` 指定. 会对原始模型，Gate 和全部 shard 进行 SHA-256 校验；同一卷内使用硬链接，跨卷则复制. 请勿直接编辑硬链接源/目标的权重.
- `-CheckOnly` 仅执行 GPU 检查和模型/已有缓存的验证，不创建任何文件. 没有缓存时会显示相应提示. 对于不完整或不一致的已有缓存，不会覆盖，而是停止.
- 从其他位置重新安装时，如果已安装的代码不同会停止. 确认差异后指定 `-Update`，将仅替换本仓库的发布文件.

完成后请重启 ComfyUI，并将附带 GUI 工作流中的参考图像换成自己的图像. 如果模型放在子文件夹中，也请同时在各 loader 中选择.

## 模型

以下是附带 workflow 中使用的文件名. Gate 不作为普通 LoRA 应用.

| 用途 | 文件 | ComfyUI 内的存放位置 / 发布来源 |
|---|---|---|
| Diffusion | `minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors` | `models/diffusion_models/` · [MATLOWAI](https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot) |
| VSA Gate | `fasth3_vsa_gate.safetensors` | 转换时通过路径指定，[barelymining](https://huggingface.co/barelymining/ComfyUI-MiniMax-H3-FastVideo) |
| Text encoder | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `models/text_encoders/` · [Comfy-Org](https://huggingface.co/Comfy-Org/MiniMax-H3) |
| Video VAE | `minimax_h3_video_vae_int8_convrot.safetensors` | `models/vae/` · [Kijai](https://huggingface.co/Kijai/MiniMax-H3-experimental) |
| Audio VAE | `minimax_h3_audio_vae_fp32.safetensors` | `models/vae/` · [Comfy-Org](https://huggingface.co/Comfy-Org/MiniMax-H3) |

不需要 BF16/FP16 原始模型. 转换工具以上述 INT8 ConvRot 的 50 层，形状和键名为前提，结构不同则拒绝.
原始 Diffusion 模型在生成时仍然需要，用于读取 FC1 以外的权重. 仅靠转换后的缓存无法运行.
附带 workflow 中不使用额外的 Turbo/FastH3 LoRA.

## 安装与一次性转换

通常**只需使用上述 `setup.bat`** 即可完成检查与转换. 以下是希望手动执行时的步骤.

1. 将本仓库整体放置到 `ComfyUI/custom_nodes/Xpark-Media-Foundry-Agent/`.
2. 使上述模型和外部节点可用. 为避免正在运行的生成任务与转换争抢 GPU，请在生成结束后再进行转换.
3. 使用 **ComfyUI 自带的 Python** 进行确认与转换. 以下是从 Windows portable 根目录执行的 PowerShell 示例.

```powershell
$h3Python = '.\python_embeded\python.exe'
$h3Root = '.\ComfyUI'
$h3Convert = '.\ComfyUI\custom_nodes\Xpark-Media-Foundry-Agent\convert.py'

# 耗时数秒的 native INT4 / CPU offload / 重新加载到 GPU 确认. 不生成文件.
& $h3Python -B -X utf8 $h3Convert --comfy-root $h3Root --check --gpu 0

# 依次预转换 50 层. 输出目录请指定一个不存在的新目录.
& $h3Python -B -X utf8 $h3Convert `
  --comfy-root $h3Root `
  --model '.\ComfyUI\models\diffusion_models\minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors' `
  --gate '.\ComfyUI\models\loras\fasth3_vsa_gate.safetensors' `
  --output '.\ComfyUI\models\h3_preconverted\fc1_gate' --gpu 0

# 复制后或怀疑损坏时，对全部缓存进行 SHA-256 验证.
& $h3Python -B -X utf8 $h3Convert --comfy-root $h3Root `
  --verify '.\ComfyUI\models\h3_preconverted\fc1_gate'
```

`--gpu` 仅用于转换进程的 CUDA 选择. 不会改变 ComfyUI 通常的 GPU 设置.
venv 环境下请将 `$h3Python` 替换为该 venv 的 Python. Linux 可以用相同参数在一行内执行，但本版本尚未验证.

所需的额外磁盘空间约为 **5.8 GB**（FC1 约 3.86 GB + Gate 约 1.93 GB）. 由于内存还要用于整个模型，Text Encoder 和 VAE，需要足够的统一内存承载全部权重. GB10 DGX Spark 的统一内存可满足该需求，运行时模型 staging 约为 16GiB.
转换时不会让全部 50 层常驻 GPU，而是逐层进行保存和 GPU 往返验证.

完成时会显示 `COMPLETE: FC1 50/50 + Gate 50/50`，并在最后写入 `manifest.json`.
不会覆盖或删除已有输出目录. 中途失败时，会保留未完成的目录并停止. 请修复原因后，使用另一个新的输出目录重新执行.

## 运行 Workflow

### 更改稀疏率

修改 **“H3 v2 Streaming VSA (Preconverted Gate)”节点的 `keep_percent`**. 该值不是削减率，而是稀疏 attention 中保留的比例.

| `keep_percent` | 保留率 | 目标区域的估算削减率 |
|---:|---:|---:|
| 5（初始值） | 5% | 95% |
| 10 | 10% | 90% |
| 20 | 20% | 80% |

值越小越稀疏. 设置范围为 0.1–100. 文本，参考图等 prefix 保护区域会单独处理，因此表中的比例并非整个模型计算量的削减率. **更改时无需重新转换权重**. 修改数值后重新生成即可.

- **GUI:** [workflows/H3_Streaming_v2.json](workflows/H3_Streaming_v2.json)
- **API:** [workflows/H3_Streaming_v2.api.json](workflows/H3_Streaming_v2.api.json)

重启 ComfyUI，加载 GUI 版工作流，将 Reference 1/2/3 替换为自己的图像（按全身，上半身，脸部的顺序）.
`cache_directory=h3_preconverted/fc1_gate` 是**相对于 ComfyUI/models 的相对路径**. 也可以指定绝对路径.
将 Loader 的 `cache` 输出连接到 VSA 节点的 `cache` 输入. 请将模型名，缓存，workflow 作为一组进行管理.

推荐启动选项为 `--disable-comfy-compiler`. 测量环境中还使用了 `--disable-pinned-memory`.
即使在该选项下，本节点的 Gate 也会显式尝试 pin；失败时保留普通 CPU tensor.

附带设置：**832×1408，124 frames，24 fps，seed 43，4 steps，res_multistep / simple，Sigma Shift 12/3，ChunkFFN 4，VSA keep 5%，FastVAE batch 2**.
输出位置为 ComfyUI 标准的 `output/H3_Streaming_v2_*.mp4`.

API 版与 GUI 用 JSON 不同，需要以 `{"prompt": <API JSON>, "client_id": "..."}` 的形式提交给标准的 ComfyUI `/prompt` 接口.
使用 API 时，也需要提前将图像放入 ComfyUI 的 input 目录，并修改 3 个 LoadImage 的文件名.
示例使用的是通用的参考说明. 由于评估时使用的个人参考图像未附带，无法保证第三方输入会得到相同像素或相同耗时.

## 确认与限制

- 控制台 `[H3 v2]` 中会显示 FC1 50 层，Gate 50 层，runtime weight conversion 0s.
- 通过 `verbose=True` 确认 `H3 v2 sparse producer`. 如果 CUDA/BF16/head_dim 或 token 数，sigma 范围不匹配，会回退到 ComfyUI 现有的 dense 路径. 仅跑完流程并不能证明使用了 VSA.
- prefix 始终是 exact KV / dense-query sink. 未生效的 `sink_conditioning` 以及未采用的 padding 行省略等切换开关不予公开.
- 如果更改了原始 Diffusion 模型或 Gate，请重新创建缓存. 与额外 LoRA 或模型编辑的组合尚未验证.
- runtime 执行快速的 header/大小/shape/metadata 检查，不会每次都对所有文件计算 SHA-256. 在 `--verify` 中加上 `--model` / `--gate` 还可以校验原始权重的全部内容. 不依赖 mtime，用户名或绝对路径.
- 遇到 `ModuleNotFoundError` / API 缺失时，请先准备其他兼容环境再重新确认. 仅仅放入本发布物并不会让旧版 ComfyUI 变得兼容.
- 出现 `ModelMMAP` 访问错误时，请检查原始模型和缓存的读取权限与共享状态. 本工具不会修改权限或终止其他进程.

性能与验证范围请参阅 [VALIDATION.md](VALIDATION.md). 视频的主观画质，角色还原度和音频质量未做评估.
源代码采用 [GPL-3.0](LICENSE)，来源与修改点见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). 权重适用各自发布方的许可证.

## 文档索引

| 主题 | 文档 |
|---|---|
| 数字资产流水线（学习视频） | [docs/LEARNING_VIDEO.md](docs/LEARNING_VIDEO.md) · [Skill](skills/learning-video/SKILL.md) |
| 控制台（主 Agent / 系统监控 / 在线对话） | [apps/console](apps/console) · [apps/web](apps/web) |
| 部署（ComfyUI / GB10 / Docker） | [DEPLOYMENT.zh.md](DEPLOYMENT.zh.md) |
| 009jev native SLA（推荐） | [009JEV.md](009JEV.md) |
| Laya 本地决策引擎（默认） | [LAYA.md](LAYA.md) |
| OpenJev 本地决策引擎 | [OPENJEV.md](OPENJEV.md) |
| Jev Adaptive VSA（旧 W4A4 路径） | [JEV_ADAPTIVE.md](JEV_ADAPTIVE.md) |
| 验证记录 | [VALIDATION.md](VALIDATION.md) |
| 第三方来源 | [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |

---

# English Documentation

**Xpark Media Foundry Agent (`Xpark-Media-Foundry-Agent`)** is a video digital-asset pipeline: it forges documents and image sets into 1080p animated explainer video assets through ingest → storyboard → per-clip generation → QC → ffmpeg concat. The generation layer combines MiniMax-H3 with two acceleration paths, 009jev native SLA and W4A4+VSA, while the decision engines Laya (local) / OpenJev (llama.cpp) / Jev (remote API) allocate per-layer attention keep rates to cut compute and VRAM.

## The Digital-Asset Pipeline

```
source assets (docx / image set)
  │ 1. ingest     extract word/media + paragraph structure, pick figures by chapter
  ▼
storyboard (narration + motion script per figure)
  │ 2. scripting  1080p template, per-clip seeds, sequential reveal motion
  ▼
clip generation (H3 + 009jev/laya decision acceleration)
  │ 3. batch      learning_video_1080p.api.json · gen_learning_video.py
  ▼
clip assets (5 s · 1920×1080 · 24fps · Chinese narration)
  │ 4. QC / post  frame sampling + ffprobe + dewatermark + ffmpeg concat
  ▼
final cut (digital asset)
```

| Stage | Carrier | Artifact |
|---|---|---|
| 1. Ingest | docx `word/media/` (`unzip`/`zipfile`), paragraph structure | image set (6–10 figures) |
| 2. Scripting | per-figure `narration` (≤45 chars) + `motion script`, `PROMPT_TMPL` | storyboard `CLIPS` |
| 3. Per-clip generation | [learning_video_1080p.api.json](examples/learning_video_1080p.api.json), [gen_learning_video.py](skills/learning-video/scripts/gen_learning_video.py) | 5 s 1080p animated clip |
| 4. QC | head/mid/tail frame sampling, `ffprobe` | clips that pass QC |
| 5. Post / delivery | `dewatermark.sh` (optional), `concat_learn.sh` | final mp4 (1920×1080 · CRF 18) |

See [docs/LEARNING_VIDEO.md](docs/LEARNING_VIDEO.md) and the [learning-video skill](skills/learning-video/SKILL.md) for the full walkthrough.

### Pipeline generation engines

| Path | Node | Notes | Doc |
|---|---|---|---|
| **009jev native SLA (recommended)** | `H3JevNativeSLAPatch` | plain model + native SLA, no W4A4 conversion, per-layer dynamic keep | [009JEV.en.md](009JEV.en.md) |
| W4A4 + Streaming VSA | `H3V2PreconvertedLoader` / `H3V2StreamingVSAPatch` | FC1 W4A4 preconversion + fixed/adaptive VSA | [JEV_ADAPTIVE.en.md](JEV_ADAPTIVE.en.md) |

Decision engine, one of three, identical contract and hot-swappable via `H3_DECISION_ENGINE`:

| Engine | Deployment | Notes | Doc |
|---|---|---|---|
| Laya (default) | in-process local model | 322M local decision model, offline & free | [LAYA.md](LAYA.md) |
| OpenJev | local llama-server | GGUF generative decisions, one Q&A at a time | [OPENJEV.md](OPENJEV.md) |
| Jev | remote TypeSafe API | requires `TYPESAFE_API_KEY` | [JEV_ADAPTIVE.en.md](JEV_ADAPTIVE.en.md) |

Measured on GB10, 5-second 4-step video, warm cache:

| Engine | Time | vs baseline | SSIM vs baseline |
|---|---:|---:|---:|
| baseline | 530.2s | — | 1.0 |
| Laya | 340.1s | −35.9% | 0.761 |
| OpenJev | 400.1s | −24.5% | 0.760 |

---

## Engine detail: W4A4 + Streaming VSA

The sections below cover installation, one-time conversion, workflows and validation for the FC1 W4A4 + Streaming VSA path. Accelerates MiniMax H3 Ref2VA on GB10 DGX Spark using FC1 W4A4 + Streaming VSA, validated through full generation at 832×1408 / 124 frames / 4 steps.
Combines **FC1 Plain ConvRot W4A4, preconverted INT8 Gate, and fixed padding decision cache**.
Weight conversion is executed once offline; during generation, weights are loaded from CPU using ComfyUI's Dynamic VRAM / offload path.

**Easy Windows installation with `setup.bat`; setup and full generation verified on ComfyUI v0.36.0.** With a compatible ComfyUI installation and the required models available, it handles Python selection, compatibility checks, node installation, and preconversion. Model weights are never downloaded automatically.

### Installation at a glance

| Item | Summary |
|---|---|
| Additional SSD space | **About 5.79 GB (5.39 GiB)** for the converted cache. Source models, text encoder, VAEs, and generated videos require separate space. |
| Reusing a cache | Pass `-CacheSource`. Same-volume hard links consume almost no additional space for the cache; another volume requires a copy. |
| Nodes added by this repository | **Two**: `H3V2PreconvertedLoader` and `H3V2StreamingVSAPatch`. |
| External node dependencies | **Two packages**, KJNodes and MotionCache-FastVAE. `-InstallDependencies` installs only missing packages. These packages also contain nodes unrelated to this workflow. |

### Measured results on ComfyUI v0.36.0

One run on 2026-09-20, GB10 DGX Spark: 1024×1792, 124 frames, 24 fps, 4 steps, seed 43, res_multistep/simple, Sigma Shift 12/3, ChunkFFN 4, VSA keep 5%, and FastVAE batch 2.

| Metric | Measured result |
|---|---:|
| Generation time, including model loading | **209.233 seconds (about 3 min 29 sec)** |
| Maximum observed GPU memory usage | **11,479 MiB** |
| Process RAM peak (peak RSS) | **11,610.7 MiB** |
| Output validation | Audio present, 124 frames, 24 fps, full FFmpeg decode passed |
| Interruptions / retries | None |

GPU usage was sampled every 60 seconds and on completion; it is not an instantaneous peak. This is a single compatibility run, not a speed comparison or quality assessment. A fully SHA-256-verified existing cache was reused, so fresh 50-block conversion and fresh dependency installation were not exercised in this run. See [VALIDATION.md](VALIDATION.md) for details.

This directory can be distributed directly as the root of a GitHub repository.
No external benchmark folders, references to older releases, experimental/discarded designs, or profiling code are required for execution.
Model weights, converted caches, reference images, and generated output videos are not included.

## 1. Overview / What This Project Does

- `H3V2PreconvertedLoader`: Overlays 50 FC1 W4A4 shards onto the original INT8 diffusion model state_dict in CPU memory to build a standard ComfyUI ModelPatcher. Outputs `MODEL` and `cache` connection.
- `H3V2StreamingVSAPatch`: Retains the preconverted INT8 Gate in CPU memory and streams only the current block's Gate to GPU. Evaluates per-plan padding decisions once on CPU.
- `convert.py`: Converts existing INT8 ConvRot FC1 → native ConvRot BF16 recovery → Plain W4A4. Simultaneously preconverts and saves the INT8 Gate.
- GUI / API workflows: Identical node layout, parameter settings, and reference order. The GUI version can be dragged & dropped directly into ComfyUI.

FC2 remains INT8. QKV, Attention kernel, Gate INT8 arithmetic, ChunkFFN, FastVAE, and sampler / scheduler are unchanged. SVDQuant is not used.
Standard ComfyUI classes and existing custom nodes are not globally monkey-patched. Unique node IDs prevent collisions with previous versions. Do not apply both legacy VSA and v2 VSA to the same MODEL simultaneously.

## 2. Tested Environment

On 2026-09-20, setup and a complete 1024×1792 generation passed with **ComfyUI 0.36.0, Python 3.13.13, PyTorch 2.14.0+cu130, comfy-kitchen 0.2.34, and comfy-aimdo 0.5.5**. The single GB10 DGX Spark run took 209.233 seconds including model loading. See [VALIDATION.md](VALIDATION.md) for conditions and measurement limits. The original validation environment follows:

- **OS**: DGX OS (Linux, aarch64)
- **GPU**: GB10 DGX Spark
- **Python**: 3.13.14
- **PyTorch**: 2.13.0+cu130
- **comfy-kitchen**: 0.2.33
- **comfy-aimdo**: 0.5.2
- **ComfyUI commit**: `15eb748b3ec5f8a0a2d470b7fb280e2d7579f916`
- Exact file fingerprints are recorded in [compatibility.json](compatibility.json).
- A matching version string alone does not guarantee GPU binary compatibility; run `--check` before conversion.

## 3. Requirements & Dependencies

Required APIs:

- **ComfyUI**: `comfy.quant_ops.QUANT_ALGOS['convrot_w4a4']`, native quantized state_dict loader, `comfy_extras.nodes_sparse_attention`.
- **comfy-kitchen**: `TensorCoreConvRotW4A4Layout`, CUDA `cutlass_int4_dequant`, `sol_attn_chunked`, `int8_linear`.
  - In this tested kitchen build, the native ConvRot INT4 execution path depends on the architecture; unsupported modes are rejected. **Measured target is GB10 DGX Spark only**. Other GPUs must verify via `--check` and actual generation.
- **External Custom Nodes** (required by workflows):
  - [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes): `MiniMaxChunkFeedForward`.
  - [ComfyUI-MiniMax-H3-MotionCache-FastVAE](https://github.com/Mozer/ComfyUI-MiniMax-H3-MotionCache-FastVAE): `MiniMaxH3FastVAEDecode`.
- `torch` and `safetensors` must come from the same Python environment used by ComfyUI.

The Windows `setup.bat` installer uses an existing isolated ComfyUI Python. It does not update ComfyUI, PyTorch, or comfy-kitchen, and never downloads model weights. Missing runtime APIs cause a clear failure.

### Windows setup

Finish any active generation, then run `setup.bat` from the downloaded repository. Inside `custom_nodes`, it detects ComfyUI automatically; otherwise it asks for the ComfyUI directory. You can also specify it directly:

```bat
setup.bat -ComfyRoot "C:\ComfyUI_windows_portable\ComfyUI"
```

- Selects the portable `python_embeded` interpreter, a `.venv` in ComfyUI or its parent, or a `venv` inside ComfyUI. Use `-Python "...\python.exe"` when multiple candidates exist. Global Python is rejected.
- Searches existing `models` and `extra_model_paths.yaml`. Use `-Model "...safetensors" -Gate "...safetensors"` for explicit source paths. The text encoder and VAEs must already be available to ComfyUI.
- `-InstallDependencies` clones only missing KJNodes / MotionCache-FastVAE repositories and installs their requirements into the selected isolated Python. Existing nodes are not updated. Without this option, setup never runs pip.
- Checks required APIs, native INT4 execution, and CPU offload/reload, then converts FC1 and the gate once into `ComfyUI\models\h3_preconverted\fc1_gate`. The original diffusion model remains necessary for generation.
- Use `-CacheSource "...\cache"` to reuse an existing cache in this project's format. All shards, the source model, and gate are SHA-256 verified. Same-volume files are hard-linked; cross-volume files are copied. Do not edit hard-linked weights in place.
- `-CheckOnly` checks the GPU, models, and any existing cache without writing files. It reports when conversion is still needed. Incomplete or mismatched caches are rejected and never overwritten.
- When installing from another directory, differing installed code is preserved unless you pass `-Update` after reviewing the differences. Only this repository's distribution files are replaced.

Restart ComfyUI when setup finishes. Open the bundled GUI workflow, select your reference images, and adjust loader model names if your weights are in subdirectories.

## 4. Required Models and Download Sources

File names matching the bundled workflows. The Gate is not applied as a standard LoRA.

| Role | File | ComfyUI Directory / Source |
|---|---|---|
| Diffusion | `minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors` | `models/diffusion_models/` · [MATLOWAI](https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot) |
| VSA Gate | `fasth3_vsa_gate.safetensors` | Specified via path during conversion · [barelymining](https://huggingface.co/barelymining/ComfyUI-MiniMax-H3-FastVideo) |
| Text encoder | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `models/text_encoders/` · [Comfy-Org](https://huggingface.co/Comfy-Org/MiniMax-H3) |
| Video VAE | `minimax_h3_video_vae_int8_convrot.safetensors` | `models/vae/` · [Kijai](https://huggingface.co/Kijai/MiniMax-H3-experimental) |
| Audio VAE | `minimax_h3_audio_vae_fp32.safetensors` | `models/vae/` · [Comfy-Org](https://huggingface.co/Comfy-Org/MiniMax-H3) |

No BF16/FP16 base model is required. The conversion script specifically targets the 50 layers, shapes, and keys of the INT8 ConvRot model above; differing architectures will be rejected.
The original diffusion model is still required during inference to read non-FC1 weights. The converted cache cannot run on its own.
No additional Turbo/FastH3 LoRAs are used in the bundled workflows.

## 5. Simple 4-Step Quick Start

Follow these 4 steps to get up and running:

1. **Place this repository in custom_nodes**
   - Place this repository under `ComfyUI/custom_nodes/Xpark-Media-Foundry-Agent/`.
   - Ensure external nodes [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) and [ComfyUI-MiniMax-H3-MotionCache-FastVAE](https://github.com/Mozer/ComfyUI-MiniMax-H3-MotionCache-FastVAE) are installed.
2. **Make required models available**
   - Place diffusion, text encoder, and VAE weights into their corresponding `ComfyUI/models/` subdirectories as listed in the table above.
   - Place `fasth3_vsa_gate.safetensors` in an accessible path (e.g., `ComfyUI/models/loras/fasth3_vsa_gate.safetensors`).
3. **Run setup.bat**
   - Run `setup.bat` to select ComfyUI's isolated Python, check native INT4 compatibility, and generate or verify `h3_preconverted/fc1_gate`. Add `-InstallDependencies` if the external node packages are missing. Existing models are reused.
4. **Open workflow and generate**
   - Start ComfyUI (recommended: `--disable-comfy-compiler`) and drag & drop [workflows/H3_Streaming_v2.json](workflows/H3_Streaming_v2.json).
   - In the 3 `LoadImage` nodes, select your reference images (Full-body, Upper-body, Face close-up).
   - Verify that the loader's `cache_directory` points to `h3_preconverted/fc1_gate` and click **Queue Prompt**.

## 6. One-Time Conversion Procedure

**`setup.bat` performs these checks and conversion automatically.** The commands below are an alternative for manual operation.

Run conversion using **ComfyUI's own Python environment**. The example below uses PowerShell from the root of a Windows portable ComfyUI setup:

```powershell
$h3Python = '.\python_embeded\python.exe'
$h3Root = '.\ComfyUI'
$h3Convert = '.\ComfyUI\custom_nodes\Xpark-Media-Foundry-Agent\convert.py'

# 1. Smoke check native INT4 / CPU offload / GPU reload (takes seconds, writes no files)
& $h3Python -B -X utf8 $h3Convert --comfy-root $h3Root --check --gpu 0

# 2. Convert all 50 layers. Output directory must be a new, non-existing path.
& $h3Python -B -X utf8 $h3Convert `
  --comfy-root $h3Root `
  --model '.\ComfyUI\models\diffusion_models\minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors' `
  --gate '.\ComfyUI\models\loras\fasth3_vsa_gate.safetensors' `
  --output '.\ComfyUI\models\h3_preconverted\fc1_gate' --gpu 0

# 3. Verify SHA-256 integrity of all cache shards (useful after copying or suspected corruption)
& $h3Python -B -X utf8 $h3Convert --comfy-root $h3Root `
  --verify '.\ComfyUI\models\h3_preconverted\fc1_gate'
```

- `--gpu` selects the CUDA device exclusively for the conversion process. It does not affect ComfyUI's general settings.
- In a venv environment, replace `$h3Python` with your venv's Python executable.
- Required additional disk space is approximately **5.8 GB** (FC1 ~3.86 GB + Gate ~1.93 GB). Memory requirement: because the full model, text encoder, and VAEs are utilized, enough unified memory is needed to hold all weights. GB10 DGX Spark's unified memory satisfies this, with ~16GiB staging during runtime.
- Layers are converted and roundtrip-verified one by one; all 50 layers are never resident in GPU memory simultaneously.
- Successful completion outputs `COMPLETE: FC1 50/50 + Gate 50/50` and writes `manifest.json`. Existing output directories are never overwritten or deleted. If conversion fails partway, the partial directory is left intact; resolve the issue and specify a new directory.

## 7. Workflow Usage

### Changing sparsity

Change **`keep_percent` in the “H3 v2 Streaming VSA (Preconverted Gate)” node**. This is the percentage retained by sparse attention, not the percentage removed.

| `keep_percent` | Retained | Approximate reduction in the sparse region |
|---:|---:|---:|
| 5 (default) | 5% | 95% |
| 10 | 10% | 90% |
| 20 | 20% | 80% |

Lower values are sparser. The accepted range is 0.1–100. Protected prefix regions, including text and references, are handled separately; these percentages do not describe the reduction in total model computation. **No weight reconversion is needed.** Change the value and generate again.

- **GUI Workflow**: [workflows/H3_Streaming_v2.json](workflows/H3_Streaming_v2.json)
- **API Workflow**: [workflows/H3_Streaming_v2.api.json](workflows/H3_Streaming_v2.api.json)

1. Restart ComfyUI, load the GUI workflow, and swap Reference 1 / 2 / 3 with your own images (full-body, upper-body, face, in that order).
2. `cache_directory=h3_preconverted/fc1_gate` is **relative to `ComfyUI/models`** (absolute paths are also supported).
3. Connect the Loader's `cache` output to the VSA node's `cache` input. Manage model names, caches, and workflows as a unified set.
4. Recommended launch flag is `--disable-comfy-compiler`. The benchmark environment also used `--disable-pinned-memory`. Even under this option, the node explicitly attempts to pin Gate memory (falling back to standard CPU tensors if pinning fails).
5. Default parameters: **832×1408, 124 frames, 24 fps, seed 43, 4 steps, res_multistep / simple, Sigma Shift 12/3, ChunkFFN 4, VSA keep 5%, FastVAE batch 2**.
6. Output videos are saved to ComfyUI's default output directory: `output/H3_Streaming_v2_*.mp4`.
7. For the API workflow, submit `{"prompt": <API JSON>, "client_id": "..."}` to ComfyUI's standard `/prompt` endpoint. Images must be placed in `ComfyUI/input` with matching filenames in LoadImage nodes. Sample workflows use generic prompts; user inputs will produce distinct pixels and timings.

## 8. Validation / Benchmark Results

From [VALIDATION.md](VALIDATION.md), measured on GB10 DGX Spark:

### Benchmark Metrics (832×1408 / 124 frames / 4 steps)

| Metric | Result |
|---|---:|
| Resolution / Frames / FPS | 832×1408 / 124 / 24 |
| Steps / Seed | 4 / 43 |
| FC1 Layers Applied | 50/50 layers |
| FC1 Native INT4 Calls | 800 (16 per layer, all succeeded) |
| FC1 Backing Data / Scale | CPU resident, Dynamic VRAM active |
| Runtime FC1 / Gate Weight Conversion | 0s |
| FC1 Shard Load | 0.0197s |
| Manifest Check + Model Build & Load | 0.1875s |
| Gate CPU Load / Pin | 1.221s |
| Sampler Wall-Clock Time | 99.858s |
| Step Times (1 / 2 / 3 / 4) | 32.067s / 22.496s / 22.601s / 22.673s |
| Steady Step Time (avg steps 2–4) | **22.590s/step** |
| Progress Bar Corrected Display | 90s |
| **Prompt Total (End-to-End)** | **149.704s** *(approx. 2m 30s)* |
| FastVAE Decode (batch 2) | 24.90s |
| Model Staged CPU | 16,320 MiB |
| Video / Audio Latents | Exact finite match with FC1 Preconverted reference |
| Output Media | 832×1408, 124 frames with audio, FFmpeg decoded fully |

### Comparison Across Approaches (Prompt Total)

- **This Configuration (v2 Preconverted FC1 W4A4 + Streaming VSA)**: **149.70s** *(Candidate eval: 146.26s)*
- **Baseline INT8**: **168.44s** *(v2 is ~19s / 11% faster)*
- **Runtime-Convert FC1 W4A4**: **213.28s** *(v2 is ~64s / 30% faster due to elimination of runtime quantization overhead)*

*Note: Measurements are single-run values influenced by OS file cache, load order, and measurement overhead. Small variations should not be interpreted as guaranteed improvements or regressions. Do not compare the progress bar display time (90s) directly with wall-clock time (99.858s).*

## 9. Limitations / Compatibility Notes

- The console displays `[H3 v2]` confirming 50 FC1 layers, 50 Gate layers, and runtime weight conversion of 0s.
- `verbose=True` confirms `H3 v2 sparse producer`. If CUDA, BF16, head_dim, token count, or sigma ranges are incompatible, ComfyUI falls back to the existing dense path. A completed run alone does not prove VSA activation.
- Prefix tokens are permanently exact KV / dense-query sinks. Experimental switches such as alternate `sink_conditioning` or omitted padding rows are not included.
- If the base diffusion model or Gate is modified, create a new cache. Combinations with additional LoRAs or model edits are unverified.
- Runtime uses fast header/size/shape/metadata verification and does not compute SHA-256 for all files on every load. Passing `--model` / `--gate` to `--verify` allows full source hash verification. It does not depend on file modification times, usernames, or absolute paths.
- `ModuleNotFoundError` or missing APIs must be addressed by using a compatible environment; this custom node does not monkey-patch older ComfyUI versions.
- If `ModelMMAP` access errors occur, verify read permissions and sharing state of base models and caches. This tool does not alter permissions or terminate third-party processes.
- Subjective visual quality, character fidelity, and audio quality are not evaluated.

## 10. License / Third-Party Notices

- Distributed source code is licensed under [GPL-3.0](LICENSE).
- Upstream origins and modifications are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Model weights remain subject to their respective upstream licenses, including applicable MiniMax H3 terms. This repository does not distribute or grant redistribution rights for model weights.


## 实验：Jev Adaptive VSA

在保留固定 keep 率的现有节点的同时，新增了实验节点，可在每个 step 通过 Choice 选择下一步的 keep 率. 使用方法，通信上限，fallback，支持的 sampler 请参阅 [JEV_ADAPTIVE.md](JEV_ADAPTIVE.md).
