# Validation — 2026-09-08

配布用のコードと変換ツールをRTX 4070 12GBの既存ComfyUI環境で検証しました。
評価用の計測・比較コード、重み、個人用参照画像、動画は配布物に含めていません。

## 事前変換

- 配布物の `convert.py` を使い、既存INT8 ConvRotモデルからFC1を50層すべて変換。
- block 0から順に、保存→再ロード→QuantizedTensor/layout復元→GPU実行→CPU offload→再GPU実行を検証。全層で保存前と出力が完全一致。
- CUDA `cutlass_int4_dequant` の実行と成功戻り値を確認。各層3回、計150回。
- Gateも50層をCPUでINT8変換・保存し、保存前後のtensorを全照合。
- 新規変換したFC1/Gateの全tensorが、採用候補の評価で使用した既存キャッシュと完全一致。
- 完成キャッシュのSHA-256検証、対応API・native INT4の軽量 `--check` を確認。

## 配布コードによるフル生成1本

配布API workflowを使用し、参照画像3枚とpromptだけを評価時のPROMPT-Aへ揃え、キャッシュの場所を指定しました。その他の計算条件は配布workflowと同じです。
比較用のlatent保持処理は検証プロセス内だけに追加し、配布workflowには含めていません。

| 指標 | 結果 |
|---|---:|
| 解像度 / frames / fps | 832×1408 / 124 / 24 |
| steps / seed | 4 / 43 |
| FC1適用 | 50/50層 |
| FC1 native INT4 | 800回（各層16回）、全呼出し成功 |
| FC1 backing data / scale | CPU保持、Dynamic VRAM有効 |
| runtime FC1 / Gate weight変換 | 0 |
| FC1 shardロード | 0.0197秒 |
| manifest検査＋モデル構築・ロード | 0.1875秒 |
| Gate CPU load / pin | 1.221秒 |
| Sampler実壁時計 | 99.858秒 |
| step 1 / 2 / 3 / 4 | 32.067 / 22.496 / 22.601 / 22.673秒 |
| steady（step 2〜4平均） | **22.590秒/step** |
| 進捗バー補正表示 | 90秒 |
| Prompt Total | **149.704秒** |
| FastVAE batch 2 | 24.90秒 |
| モデルstaged CPU | 16,320MiB |
| 映像・音声latent | 既存FC1 Preconverted基準と双方完全一致・有限 |
| メディア | ffprobeで832×1408・124 frames・音声あり、FFmpeg全デコード成功 |

この最終確認ではVRAM/RSSの周期監視を行っていません。直前の採用候補評価ではGPU全体ピーク11,560.90MiB、RSS10,631.68MiBでしたが、最終配布コードの同時測定値としては扱いません。

## 比較の読み方

既存記録のBaseline INT8はPrompt168.44秒、runtime-convert FC1 W4A4は213.28秒でした。
採用候補評価の146.26秒に対して今回149.70秒でしたが、steadyは22.56→22.59秒でほぼ同水準です。
各値は単発測定で、OS file cache・初回ロード順・測定処理の差を含みます。小さな差を保証された改善・退化とは判断しません。

ComfyUIはDynamic VRAM時に進捗バーの初回時間を補正します。従来のSampler108秒/93秒という表示値を、今回の実壁時計99.858秒と直接比較しないでください。
ロードはlazy mmapであり、0.1875秒に全weightの実ページ読出しやGPU転送が完了するわけではありません。

完全一致は、同一の元weight・キャッシュ・入力・seed・依存実装を使用したこの比較の結果です。FC1 W4A4は元INT8モデル自体に対して非可逆変換であり、INT8との完全一致を主張していません。
主観的な画質、キャラ再現、音声の良し悪しは評価していません。
