# 層別Jev検証 / Per-layer Jev experiment

2026-09-20 / Windows / RTX4070 12GB。全条件1024×1792、124f、24fps、4step、seed43、同じRef2VA参照・モデル・prompt。全200層実行。初回全層5%、最終版は以後の入口2層も保護。

| Condition | Mean keep % | Generation s | Later step mean s* |
|---|---:|---:|---:|
| Fixed5 |5|212.20|35.43|
| Fixed1 |1|200.71|32.68|
| run16 / layer_v4 |4.85|219.32|35.59|
| run17 / budget confidence fallback |5|222.64|36.32|
| run18 / layer_v5 |3.8675|219.15|35.22|

*Steps2–4 estimated from received progress timestamps, subtracting recorded decision durations. Includes observation overhead, not GPU kernel profiling. Single run per condition, historical controls; not statistically established speed differences. Startup of the server is excluded; model loading, generation and saving are included in generation time.

最終版は要求する非sink注意予算を22.65%削減したが、総生成時間は改善しなかった。API判断は約4.56秒。keep率は総FLOPsや実保持タイル数ではない。sink、同点による追加選択、QKV、FFN、projection、routing、転送が残る。180秒未満は未達。

The final policy reduced requested non-sink attention budget by22.65%, but did not improve total time. Keep ratio is not total FLOPs or measured retained tile count. The under180s goal remains unmet. API/decision time was about4.56s.

run17 used a low-confidence budget fallback to all5%; run18 changed that to cautious3.5%. Both failures and final results are retained in the summary. Current code corresponds to the final behavior, not the old run17 fallback. Later packaging changes do not constitute new generation tests.

ユーザーは今回以前の比較では固定5%を好評価。今回のrun16〜18について人による音質順位は未取得。最終版の1/2.5/4秒の画像ではお団子と服装を維持したが、動きは異なる。音声1〜4kHzエネルギー比率は固定5%9.344%、run18 9.495%。これは音質一致の証明ではない。

Human feedback preferred fixed5 over earlier block-skip trials. New outputs have no human audio-quality ranking. Sampled stills preserve the bun and clothing but differ in pose. Audio band-energy similarity is not proof of equal quality. Wavelet/envelope analysis has no clean reference or phoneme alignment.

[Measurement summary](layer_v5_measurements.json) / [Audio summary and method](audio_summary.json). Media, reference images, full logs, credentials and machine-specific paths are intentionally not distributed. For exact original media, local experiment evidence is retained by the author; repository examples use user-supplied reference images and therefore are trial templates, not bit-exact reproduction bundles.

この検証でJev9 HTTPリクエスト、447問、入力237982tokens、出力16586tokens。入力$0.042/M・出力無料を仮定した推計$0.009995。実請求額ではない。SDK0.7.0 / Jev1.13.0。価格・サービス仕様は変わり得る。

Next evidence needed: measured attention runtime/retained tile counts and output sensitivity when changing keep on the same layer input. Existing residual/gate proxies do not establish causal sensitivity. No main-branch merge is implied by this experiment.
