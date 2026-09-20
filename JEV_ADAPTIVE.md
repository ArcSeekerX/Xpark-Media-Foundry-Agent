> 旧W4A4/VSA制御の記録です。現在の009jevは [009JEV.md](009JEV.md) を参照してください。

# Jev Adaptive VSA 実験版

[English](JEV_ADAPTIVE.en.md)

開発ブランチ `exp/jev-adaptive-vsa`。安定版の高速化を保証するリリースではありません。このページの検証対象は **layer_v5 / 4step** です。固定5%の212.20秒に対し、最新方式は219.15秒。180秒未満・固定5%相当の品質という目標は未達です。[実測と制限](docs/experiments/README.md)。

## 必要条件と導入

1. [README](README.md) の対応ComfyUI・comfy-kitchen・モデル・Gate・事前変換手順を満たしてください。モデル、参照画像、変換済み重みは同梱しません。実験はWindows / RTX4070 12GB、ComfyUI 0.36系の指定環境で検証しました。他環境の互換性を保証しません。
2. このブランチをComfyUIの `custom_nodes` に配置するか、本ブランチの `setup.bat` で導入してください。同じノードの別コピーを同時に読み込まないでください。セットアップはJevモジュール・資料・例もコピーしますが、SDKは自動インストールしません。
3. Jevを試す場合のみ、TypeSafeのアカウント/APIキーとSDK専用venvを用意します。固定モードではSDK/APIキー不要です。

取得例（本ブランチがリモートに公開された後に利用可能）：

```powershell
git clone --branch exp/jev-adaptive-vsa --single-branch https://github.com/sepiablue-ai/ComfyUI-MiniMax-H3-W4A4-VSA.git
```

リポジトリ内でSDK専用環境を作成する例（検証時SDK用Pythonは3.10）：

```powershell
py -3.10 -m venv .venv-jev
& .\.venv-jev\Scripts\python.exe -m pip install -r requirements-jev.txt
```

ComfyUIのPythonやグローバルPythonにSDKを混在させる必要はありません。ワークフローの `sdk_python` に、このvenvの `python.exe` の絶対パスを指定します。空欄はComfyUI自身のPythonを使うため、SDKを別環境に入れた場合は必ず設定してください。

## APIキーをファイルに書かず起動する

APIキーは**ComfyUIを起動するプロセスの環境変数 `TYPESAFE_API_KEY`** から読みます。ワークフロー、スクリプト、コミット、ログにキーを書かないでください。既に起動済みのComfyUIへ後から設定した環境変数は反映されません。

同じPowerShellで非表示入力し、そこから普段のComfyUI起動コマンドを実行します。キーのリテラルはコマンド履歴に残りません。

```powershell
$jevSecret = Read-Host 'TypeSafe API key' -AsSecureString
$jevPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($jevSecret)
try {
    $env:TYPESAFE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($jevPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($jevPointer)
    $jevSecret.Dispose()
    Remove-Variable jevPointer, jevSecret
}
# このシェルから普段のComfyUI起動コマンドを実行する。
# 利用後、親シェルに残る値も削除する：
# Remove-Item Env:TYPESAFE_API_KEY
```

コードはキー・HTTPヘッダー・SDK例外本文をログに出しません。`[Jev VSA]` ログには特徴量・選択結果・usageを出します。layer_v5は集計した音声/映像活性、sigma、層番号、keep率に加え、実験目的と固定の人物/音声品質に関する説明をTypeSafeへ送信します。生の画像・音声・モデル重み・APIキーをstateに含めません。

## 比較ワークフロー

- [固定5% / 4step](examples/fixed5_4step.api.json)
- [Jev layer_v5 / 4step](examples/jev_layer_v5_4step.api.json)

これはComfyUI **API形式**です。通常のGUIワークフローとは異なります。参照画像3枚を各自用意し、LoadImageノード901〜903の名前を変更するか、`ComfyUI/input/jev_reference_01.png`〜`03.png` に配置してください。順序は全身・上半身・顔。同一人物の参照を両条件で共有します。画像配布権は利用者が確認してください。

node127のモデル・変換キャッシュ、119/120のVAE、128のText Encoderが手元の名称と一致することを確認してください。モデルを変更した結果は掲載実測の再現とは区別してください。外部ノードはKJNodesのChunkFFNとMotionCache-FastVAEのFastVAEを使用します。MotionCacheによる出力再利用は使いません。

PowerShellから稼働中の専用ComfyUIに1回投入する例：

```powershell
$jevGraph = Get-Content -Raw -Encoding UTF8 .\examples\jev_layer_v5_4step.api.json | ConvertFrom-Json
$jevGraph.'900'.inputs.sdk_python = (Resolve-Path .\.venv-jev\Scripts\python.exe).Path
$jevBody = @{ prompt = $jevGraph } | ConvertTo-Json -Depth 100
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8188/prompt' -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($jevBody))
```

ポートは利用環境に合わせて変更してください。返されたprompt_idを控え、ComfyUIで完了を確認します。この例は再試行・ポーリングしません。応答が不明なときは履歴を確認してから再投入してください。生成物の保存先は起動時の `--output-directory` で指定します。

固定版は読み込むファイルを変更するだけです。ノード900のmode=fixedなら追加統計・API通信はありません。両版で1024×1792、124f、24fps、seed43、4step、res_multistep/simple、sigma12/3を維持します。参照やプロンプトの変更は両版で揃えてください。

## 最新方策 layer_v5

全50層×4stepを実行。最初のstepは全層5%、以後もblock0とblock1を保護。Jevが層の重要度3段階と全体予算2.5/3/3.5%を選択します。確率から優先順位を作り、ホスト側で予算内に配分します。

| 層 | 低 / 基準 / 高 keep率 |
|---|---|
| 浅い層 | 2 / 5 / 7.5% |
| 中間層 | 1 / 5 / 7.5% |
| 最後5層 | 3 / 5 / 10% |

ブロック入出力差、モダリティ別順位、前stepとの差、ゲート統計を使います。注意機構を疎化した場合の誤差や品質そのものを測った値ではありません。APIはstep境界で最大3 HTTPリクエスト（各50問）、最終step後は呼びません。SDKモデルはjev-1.13.0、リトライ0回。

推奨する検証設定：policy=layer_v5、mode=jev_adaptive、keep_percent=5、api_timeout=20、min_confidence=0.4、max_requests=3、producer_chunk=4096。layer_v5では初回5%が方策に組み込まれており、keep_percentで変更できません。

予算confidenceが閾値未満なら保守的な3.5%予算。API失敗/不正回答では次stepを全5%に戻し、以降その生成中のAPIを停止。予算上限/観測不足でも全5%。confidenceは品質保証の確率ではありません。4step以外はエラーです。未対応samplerは共通wrapperの旧仕様により固定10%・API0回になるため、res_multistepを指定してください。

## 残している旧方策

| policy | 初回・判断対象 | 失敗時 |
|---|---|---|
| gate_v1 | 初回10%、最初のゲート標本からstep全体を選択 | 10% |
| av_v2 | 初回5%、3深度の音声/映像ゲートからstep全体を選択 | 10% |
| block_v3 | 設定keep、block0以外のidentity省略を選択 | 全層実行・keep維持 |
| layer_v4 | 初回5%、各層の割合を独立選択 | 全層5% |
| layer_v5 | 初回5%、層別重要度と全体予算 | 上記参照 |

block_v3は人物再現性が崩れた試作で、今回の入口ではありません。producer_chunk=8192は有意な高速化を確認できず、16384は未検証。既定4096を使ってください。

## オフラインテスト

ComfyUIのtorchがあるPythonで実行します。APIキー不要、GPU生成・有料API呼び出しなし。

```powershell
& 'C:\path\to\ComfyUI-venv\Scripts\python.exe' -B test_adaptive.py
```

test_sdk_transport.pyはSDK・httpx2・torchを同時にimportできるテスト環境が必要です。標準のSDK専用venvにtorchを追加する必要はなく、通常の導入にこの補助テストは必須ではありません。模擬503/timeoutを使い、外部API0回です。

コードのライセンスは既存GPL-3.0-only。モデル、参照素材、生成物、外部サービスの利用条件は別です。
