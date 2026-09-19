# Validation — 2026-09-20 / ComfyUI 0.36.0

Windows 11 / RTX 4070 12GBで、`setup.bat` による既存環境への導入と実生成を確認しました。
ComfyUI本体・venvの依存パッケージ・グローバルPythonは変更していません。元モデル・Gate・既存変換キャッシュを全SHA-256照合し、キャッシュは同一ドライブ上のハードリンクで再利用しました。モデルのダウンロード・再変換は行っていません。

- ComfyUI: **0.36.0**, commit `7a0b5eede3f9721c8faab290689893f36edc6d66`
- Python 3.13.13 / PyTorch 2.14.0+cu130 / comfy-kitchen 0.2.34 / comfy-aimdo 0.5.5
- 新規セットアップ、native INT4 GPU→CPU→GPU検査、50 FC1 shard＋Gate＋元weightのSHA-256照合が成功。
- SayakaBenchmarkの016ワークフローを1回実行。既存の標準ケースと同じ参照画像3枚・英語台詞prompt・1024×1792・124 frames・24 fps・seed 43・4 steps・res_multistep/simple・Sigma Shift 12/3・ChunkFFN 4・FastVAE batch 2。FC1 W4A4＋Streaming VSA keep 5%を適用。
- SayakaBenchmarkのスクリプトは変更せず、既存のprepare / capture_reproduction / execution_statusを読み取り利用。標準runnerの0.5秒ポーリングは使わず、外部実行で60秒ごとと完了通知時だけ監視。結果・動画もベンチマークフォルダの外へ保存。標準runnerそのものを実行した記録ではありません。
- 起動条件は標準master実行と同じくDynamic VRAM、`--disable-pinned-memory`、`--cache-none`、`--use-ck-attention`。本体・カーネル・ノードの計算コードは変更不要でした。

| 指標 | 結果 |
|---|---:|
| 生成時間（execution_start → execution_success、モデル読込を含む） | **209.233秒** |
| ComfyUIコンソールのPrompt時間 | 209.49秒 |
| GPU使用量の最大観測値（GPU全体、60秒間隔＋完了時） | 11,479 MiB |
| 実ComfyUIプロセスのWindows Peak Working Set（起動から） | 11,610.7 MiB |
| FC1 / Gate | 50/50層、runtime weight conversion 0秒 |
| Dynamic VRAM / Streaming VSA | 有効、sparse producerログ確認 |
| Video / Audio | 1024×1792、124 frames、24 fps、音声あり |
| FFmpeg全デコード | 成功 |
| 中断 / 再実行 | なし / なし |

| 生成経過 | GPU使用量 MiB | プロセスRSS MiB | システム空きRAM MiB | システムdisk read MiB/s |
|---:|---:|---:|---:|---:|
| 60秒 | 11,477 | 8,569.2 | 31,367.1 | 491.82 |
| 120秒 | 11,479 | 8,603.8 | 30,569.7 | 26.73 |
| 180秒 | 7,562 | 8,687.6 | 30,223.0 | 45.21 |
| 完了時（約209.5秒） | 5,234 | 5,720.8 | 33,283.3 | 0.35 |

GPU値は60秒標本の最大であり、瞬間ピークではありません。RAM値はOSが保持するプロセス生涯ピークです。disk値はシステム全体の前回観測からの平均で、pagefileアクセスだけを測ったものではありません。初期モデル読み込み後のディスク負荷は低下し、空きRAMは約29.5 GiB以上を維持しました。異常な長時間化やメモリ不足による継続的な停滞は観測していません。「スワップが一切なかった」という主張ではありません。

単発・初回ロード込みの検証で、他方式との速度比較ではありません。動画・音声の主観品質は未評価です。依存ノードは既存のものを利用したため、`-InstallDependencies` による新規取得／pip経路はこのPCでは実行していません。旧変換キャッシュを再利用したため、0.36.0での50層新規変換は未実施です。

English: Setup and one complete generation passed on ComfyUI 0.36.0 / RTX 4070 12GB. Existing weights and a fully SHA-256-verified cache were reused without downloads or package changes. The 1024×1792, 124-frame, 24-fps, four-step run took **209.233 seconds**, including model loading, with audio and full FFmpeg decode validation. Sampled GPU usage reached 11,479 MiB; Windows process lifetime peak working set was 11,610.7 MiB. Monitoring was every 60 seconds and on completion. SayakaBenchmark helpers were imported read-only through an external execution wrapper; its standard runner was not invoked or modified. Results were saved outside its repository. Disk reads are system-wide, not a direct pagefile measurement. There was no interruption or retry. This is a single-run compatibility validation, not a speed or quality comparison. Fresh dependency installation and a new full 50-block conversion were not performed in this validation.

---

# Original validation — 2026-09-08

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
