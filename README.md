# ComfyUI H3 Streaming v2

MiniMax H3 Ref2VA向け、RTX 4070 12GBで評価した高速化構成です。
RTX 4070 12GBでMiniMax H3 Ref2VAを高速化する、FC1 W4A4 + Streaming VSA構成です。832×1408 / 124f / 4stepで実生成検証済みです。
**FC1 Plain ConvRot W4A4、事前保存したINT8 Gate、固定padding判定キャッシュ**を組み合わせます。
重み変換は導入時に一度だけ行い、生成時はCPUからロードしてComfyUIのDynamic VRAM / offloadを利用します。

このディレクトリの内容を、そのままGitHubリポジトリのルートとして配布できます。
別の評価フォルダや旧リリースへの参照、実験・失敗案・profiling用コードは実行に必要ありません。
モデル、変換済み重み、参照画像、出力動画は同梱しません。

## 構成

- `H3V2PreconvertedLoader`: 元INT8モデルのCPU state_dictへ、50層のFC1 W4A4 shardを重ねて標準ModelPatcherを構築。MODELとキャッシュ接続を出力。
- `H3V2StreamingVSAPatch`: 事前保存済みINT8 GateをCPUで保持し、現在のblockのGateだけGPUへ転送。固定planのpadding判定を一度だけCPUで計算。
- `convert.py`: 既存INT8 ConvRot FC1 → ネイティブConvRot対応BF16復元 → Plain W4A4。Gateも同時に事前保存。
- GUI/API workflow: 同じノード・設定・参照順序。GUI版はComfyUIへドラッグ＆ドロップ可能。

FC2はINT8のままです。QKV、Attention kernel、GateのINT8計算式、ChunkFFN、FastVAE、sampler / schedulerを変更しません。SVDQuantは使用しません。
通常ComfyUIのクラスや既存custom nodeをグローバルに差し替えません。旧版と異なるノードIDなので同居可能です。ただし同じMODELへ旧VSAとv2 VSAを二重適用しないでください。

## 必要な環境

検証環境: Windows 11、RTX 4070 12GB、Python 3.13.14、PyTorch 2.13.0+cu130、comfy-kitchen 0.2.33、comfy-aimdo 0.5.2。
ComfyUI検証commitは `15eb748b3ec5f8a0a2d470b7fb280e2d7579f916`。
詳細なファイル指紋は [compatibility.json](compatibility.json) に記録します。
同じversion表示だけではGPU向けバイナリの互換性を保証できないため、後述の `--check` を実行してください。

必要API:

- ComfyUI: `comfy.quant_ops.QUANT_ALGOS['convrot_w4a4']`、native quantized state_dict loader、`comfy_extras.nodes_sparse_attention`。
- comfy-kitchen: `TensorCoreConvRotW4A4Layout`、CUDA `cutlass_int4_dequant`、`sol_attn_chunked`、`int8_linear`。
- この検証版kitchenではnative ConvRot INT4はSM8x（Ampere/Ada）経路です。Hopper/BlackwellやINT8 fallback強制設定は対応対象から除外して停止します。**実測対象はRTX 4070のみ**。他GPUは `--check` に加え実生成で確認してください。
- [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes): `MiniMaxChunkFeedForward`。
- [ComfyUI-MiniMax-H3-MotionCache-FastVAE](https://github.com/Mozer/ComfyUI-MiniMax-H3-MotionCache-FastVAE): `MiniMaxH3FastVAEDecode`。
- `torch` / `safetensors` はComfyUIと同じPython環境のものを使用します。

この配布物にはインストーラ、pip実行、自動アップデート、モデルダウンロード機能はありません。
不足するAPIをこのノードが勝手に追加することもありません。既存環境を保全したい場合は、対応済みの別ComfyUI環境へ配置してください。

## モデル

付属workflowのファイル名です。Gateは通常のLoRAとして適用しません。

| 用途 | ファイル | ComfyUI内の配置先 / 配布元 |
|---|---|---|
| Diffusion | `minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors` | `models/diffusion_models/`・[MATLOWAI](https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot) |
| VSA Gate | `fasth3_vsa_gate.safetensors` | 変換時にパス指定・[barelymining](https://huggingface.co/barelymining/ComfyUI-MiniMax-H3-FastVideo) |
| Text encoder | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `models/text_encoders/`・[Comfy-Org](https://huggingface.co/Comfy-Org/MiniMax-H3) |
| Video VAE | `minimax_h3_video_vae_int8_convrot.safetensors` | `models/vae/`・[Kijai](https://huggingface.co/Kijai/MiniMax-H3-experimental) |
| Audio VAE | `minimax_h3_audio_vae_fp32.safetensors` | `models/vae/`・[Comfy-Org](https://huggingface.co/Comfy-Org/MiniMax-H3) |

BF16/FP16元モデルは不要です。変換ツールは上記INT8 ConvRotの50層・形状・キーを前提にし、異なる構造は拒否します。
元Diffusionモデルは、FC1以外の重みを読み込むため生成時にも必要です。変換したキャッシュだけでは動きません。
追加のTurbo/FastH3 LoRAは付属workflowでは使用しません。

## 導入と一度だけの変換

1. このリポジトリ全体を `ComfyUI/custom_nodes/ComfyUI-H3-Streaming-v2/` に配置します。
2. 上記モデルと外部ノードを利用可能にします。起動中の生成と変換がGPUを競合しないよう、生成の終了後に変換してください。
3. **ComfyUI自身のPython**で確認・変換します。以下はWindows portableのルートから実行するPowerShell例です。

```powershell
$h3Python = '.\python_embeded\python.exe'
$h3Root = '.\ComfyUI'
$h3Convert = '.\ComfyUI\custom_nodes\ComfyUI-H3-Streaming-v2\convert.py'

# 数秒のnative INT4 / CPU offload / 再GPUロード確認。ファイル生成なし。
& $h3Python -B -X utf8 $h3Convert --comfy-root $h3Root --check --gpu 0

# 50層を順番に事前変換。出力先は存在しない新しいディレクトリを指定。
& $h3Python -B -X utf8 $h3Convert `
  --comfy-root $h3Root `
  --model '.\ComfyUI\models\diffusion_models\minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors' `
  --gate '.\ComfyUI\models\loras\fasth3_vsa_gate.safetensors' `
  --output '.\ComfyUI\models\h3_preconverted\fc1_gate' --gpu 0

# コピー後・破損が疑われるときの全キャッシュSHA-256検証。
& $h3Python -B -X utf8 $h3Convert --comfy-root $h3Root `
  --verify '.\ComfyUI\models\h3_preconverted\fc1_gate'
```

`--gpu` は変換プロセスだけのCUDA選択です。通常ComfyUIのGPU設定は変えません。
venv環境では `$h3Python` をそのvenvのPythonへ置換します。Linuxは同じ引数を1行で実行できますが、このリリースでは未検証です。

必要な追加ディスク容量は約 **5.8 GB**（FC1約3.86 GB＋Gate約1.93 GB）。RAMはモデル全体・Text Encoder・VAEも使うため、12GB VRAMだけでは容量条件を満たしません。検証PCのRAMは約49GB、実行時モデルstagingは約16GiBでした。
変換時に全50層をGPU常駐させず、1層ずつ保存とGPU往復検証を行います。

完了時は `COMPLETE: FC1 50/50 + Gate 50/50` と表示され、最後に `manifest.json` を書きます。
既存出力先の上書き・削除はしません。途中で失敗した場合、未完了ディレクトリを残して停止します。原因を直し、別の新しい出力先で実行してください。

## Workflowを実行

- **GUI:** [workflows/H3_Streaming_v2.json](workflows/H3_Streaming_v2.json)
- **API:** [workflows/H3_Streaming_v2.api.json](workflows/H3_Streaming_v2.api.json)

ComfyUIを再起動してGUI版を読み込み、Reference 1/2/3を自分の画像へ差し替えます（全身・上半身・顔の順）。
`cache_directory=h3_preconverted/fc1_gate` は **ComfyUI/modelsからの相対パス**です。絶対パスも指定できます。
Loaderの `cache` 出力をVSAノードの `cache` 入力へ接続します。モデル名・キャッシュ・workflowをひと組で管理してください。

推奨起動オプションは `--disable-comfy-compiler`。計測環境では `--disable-pinned-memory` も使用しました。
このオプション下でも、本ノードのGateは明示的にpinを試みます。失敗時は通常のCPU tensorを保持します。

付属設定: **832×1408、124 frames、24 fps、seed 43、4 steps、res_multistep / simple、Sigma Shift 12/3、ChunkFFN 4、VSA keep 5%、FastVAE batch 2**。
出力先はComfyUI標準の `output/H3_Streaming_v2_*.mp4` です。

API版はGUI用JSONと異なり、`{"prompt": <API JSON>, "client_id": "..."}` として通常のComfyUI `/prompt` に渡します。
APIでも画像は事前にComfyUIのinputへ配置し、3つのLoadImageのファイル名を変更してください。
サンプルは汎用の参照説明を使っています。評価時の個人用参照画像は非同梱のため、第三者の入力で同一画素や同じ秒数になる保証はありません。

## 確認と制限

- consoleの `[H3 v2]` にFC1 50層、Gate 50層、runtime weight conversion 0sが表示されます。
- `verbose=True` で `H3 v2 sparse producer` を確認します。CUDA/BF16/head_dimやtoken数・sigma範囲が不適合なら、ComfyUIの既存dense経路になります。完走だけではVSA使用の証明にはなりません。
- prefixは常にexact KV / dense-query sinkです。効果のなかった `sink_conditioning` や不採用のpadding行省略の切替は公開していません。
- 元DiffusionモデルまたはGateを変更した場合はキャッシュを新規作成してください。追加LoRAやモデル編集との組合せは未検証です。
- runtimeは高速なheader/サイズ/shape/metadata検査を行い、全ファイルのSHA-256は毎回計算しません。`--verify` に `--model` / `--gate` を追加すると元weightの全内容も照合できます。mtime・ユーザー名・絶対パスに依存しません。
- `ModuleNotFoundError` / API不足は別の対応環境を用意してから再確認してください。この配布物を入れただけで古いComfyUIが対応するわけではありません。
- `ModelMMAP`のアクセスエラーは元モデルとキャッシュの読取権限・共有状態を確認してください。ツールは権限変更や他プロセスの停止を行いません。

性能・検証範囲は [VALIDATION.md](VALIDATION.md) を参照してください。動画の主観的な画質・キャラ再現・音声品質は評価していません。
ソースは [GPL-3.0](LICENSE)、由来と改変点は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。重みには各配布元のライセンスが適用されます。

## English quick start

Place this repository under `ComfyUI/custom_nodes/ComfyUI-H3-Streaming-v2` in a compatible existing ComfyUI environment. Run `convert.py --check` with that environment's Python, then convert your existing INT8 ConvRot diffusion model and BF16 VSA gate once, using the arguments above. Nothing is installed or downloaded automatically.

Load the GUI workflow, replace all three reference images, select the matching diffusion model, and set the cache directory (relative to `ComfyUI/models`, or absolute). Connect the loader's cache output to the VSA cache input. FC1 weights use native INT4 through ComfyUI's standard CPU-backed quantized loader and offload path; INT8 gates stream one block at a time. FC2 remains INT8. No runtime weight quantization is performed.

The conversion format is 50 native FC1 safetensors shards plus one INT8 Gate file and a completion manifest. It contains portable source identities and SHA-256 digests. Existing directories are never overwritten or deleted. Partial conversions are rejected. Weights and reference images are not distributed. Only the RTX 4070 Windows configuration was measured; inputs and hardware affect performance.
