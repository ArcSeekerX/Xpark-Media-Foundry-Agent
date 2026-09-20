# SPDX-License-Identifier: GPL-3.0-only
"""One bounded Choice call in an existing SDK interpreter; never installs packages."""
import json
import os
from pathlib import Path
import subprocess
import sys

CRITERIA = {
    "5": "Most aggressive speed: strongly concentrated gate proxy, stable recent statistics, low uncertainty.",
    "7.5": "Moderate speed: concentrated gate proxy and small changes; some caution remains.",
    "10": "Balanced default: mixed or insufficient evidence without a clear diffuse/changing signal.",
    "15": "Conservative: diffuse gate proxy, noticeable change, or a detail-sensitive final step.",
    "20": "Most conservative available: very diffuse proxy together with large changes or high uncertainty about sparse coverage.",
}
INSTRUCTIONS = (
    "Select the attention keep percentage for the NEXT diffusion step from the five choices. "
    "Higher keeps more attention tiles, costs more compute, and reduces sparsification risk. "
    "Use current_step, next_step, total_steps, sigma, next_sigma, current_keep_percent and gate_stats. "
    "gate_stats is a small sample of absolute gate activations, NOT attention probabilities or measured quality. "
    "top10_mass near 0.1 is diffuse; larger values indicate concentration. relative_mean_change "
    "measures activation change, not motion. Favor safety for diffuse/changing observations. "
    "Final-step detail preservation can justify 15. Do not change values merely to demonstrate variation. "
    "This is an experimental heuristic, with no calibrated quality predictor."
)

V2_CRITERIA = {
    "1":"Maximum speed; both modalities stable across all depths, with no strong warning signal. This is an exploratory choice, not guaranteed safe.",
    "2":"Very sparse; mostly stable, with small localized uncertainty.",
    "3":"Speed-oriented balance; modest changes or no prior-step comparison yet, and no major anomaly.",
    "5":"Baseline coverage; moderate uncertainty or mixed signals across modalities or depths.",
    "7.5":"Extra coverage for noticeable changes in one modality or depth.",
    "10":"Conservative coverage for substantial changes across several measurements.",
    "15":"Strong precaution for large cross-step changes in both modalities or late-step instability.",
    "20":"Maximum available precaution for broad severe instability in the supplied observations.",
}
V2_INSTRUCTIONS = (
    "Choose the smallest NEXT-step attention keep percentage supported by observations, balancing compute and preservation. "
    "Inspect gate_stats.blocks for separate target video and audio samples at blocks 0,24,49. "
    "relative_l2_change compares signed activations at the same sampled positions against the preceding step. "
    "As a provisional uncalibrated heuristic, changes below .05 are small, .05-.2 moderate, above .2 substantial. "
    "Check the worst modality/depth, not only the average. A null change is unknown, not zero. "
    "Do not assume the gate activation concentration equals retained attention mass or perceptual quality. "
    "Starting at 5 already gave baseline coverage for scene formation. Prefer 3 or 5 if initial observations are ordinary "
    "but lack a previous-step comparison; consider 1 or 2 when subsequent observations are stable across both modalities. "
    "Do not force a high final-step keep solely due to step number, or force variation for demonstration. "
    "There is NO human quality label or known degradation threshold in this state. This is a hypothesis-driven policy test."
)

def ask(state, python, timeout):
    if not os.environ.get("TYPESAFE_API_KEY", "").strip():
        raise RuntimeError("missing_api_key")
    result = subprocess.run(
        [python or sys.executable, "-B", "-X", "utf8", str(Path(__file__).resolve()), "--worker"],
        input=json.dumps({"state": state, "timeout": timeout}), capture_output=True,
        text=True, encoding="utf-8", timeout=timeout + 3,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode:
        raise RuntimeError("sdk_worker_failed")
    answer = json.loads(result.stdout)
    if "error" in answer:
        raise RuntimeError(answer["error"])
    return answer

def worker():
    request = json.load(sys.stdin)
    try:
        from typesafe_sdk import Choice, RetryPolicy, TypeSafeClient
        if request["state"].get("policy") in ("layer_v4","layer_v5"):
            questions={f'b{b:02d}':Choice(instructions=f"Select attention budget tier for layer {b}, NEXT step; read blocks['{b}'] including candidate_keep. This never skips the block. Judge audio and video separately. Reduce for relatively low residual ranks in BOTH modalities, especially interior layers. Baseline for mixed/medium effects. Protect for top-ranked effects in EITHER modality, or a large cross-step change compared with peer layers at similar depth. Gate statistics are secondary context, NOT retained attention mass. First measurement lacks temporal history, but relative ranks still support an exploratory reduce on low-effect layers. Do not interpret missing history as a reason to protect everything. Changes may reflect normal denoising, so compare peers and current keep. Human prefers fixed5 quality; avoid uniform extreme sparsity. Layer-specific percentages are provided in candidate_keep. Spend selectively; don't impose a quota or claim quality guarantee.",criteria={"reduce":"Lower-than5 attention budget: low impact in both modalities relative to peers, acceptable exploratory risk.","baseline":"Keep5: mixed or ordinary layer importance, conflicting observations or unclear risk.","protect":"Above5: especially important to audio OR video relative to peers, extra coverage justified."}) for b in range(1,50)}
            if request["state"]["policy"]=="layer_v5":
                questions['budget']=Choice(instructions="Choose NEXT-step global mean attention keep budget. First step already preserved5 throughout. All blocks execute. Read both modalities across layers and budget_rule; per-layer answers represent importance priorities. Aim preserve fixed5 speech and identity while genuinely reducing attention work. 2.5 is aggressive,3 balanced,3.5 cautious. Normal denoising produces broad cross-step changes; compare layer peers rather than treating every change as damage. No quality guarantee. Choose3 for mixed ordinary observations,3.5 for unusually concentrated high-risk evidence in many layers,2.5 when effects concentrate in a few layers and most appear low risk.",criteria={"2.5":"Aggressive allocation; important effects limited to a few layers.","3":"Balanced allocation; mixed ordinary importance and uncertainty.","3.5":"Cautious allocation; unusually widespread relative risk."})
            with TypeSafeClient(model="jev-1.13.0",retry=RetryPolicy(max_retries=0),timeout=request["timeout"],base_url="https://api.typesafe.ai") as client:
                response=client.system_one(state=request["state"],questions=questions)
            payload={"decisions":{k:{"choice":v.choice,"confidence":v.confidence,"probabilities":v.probabilities} for k,v in response.choices.items() if k!="budget"},"model":response.model,"usage":response.usage.model_dump(mode="json") if response.usage else None}
            if "budget" in response.choices:
                a=response.choices["budget"];payload["budget"]={"choice":a.choice,"confidence":a.confidence,"probabilities":a.probabilities}
            print(json.dumps(payload))
            return
        if request["state"].get("policy")=="block_v3":
            questions={f'b{b:02d}':Choice(instructions=f"Choose execute or skip for transformer block {b} at next_step. Read blocks['{b}']. Smaller BOTH audio/video relative_residual_l2 and lower relative_rank suggest less change. These are uncalibrated proxies, not quality. Prefer skipping relatively low-effect blocks up to the max_skip_blocks budget when both modalities are modest compared with others. The budget is a cap, not a quota. Execute high-effect or uncertain blocks. A previously skipped block has stale measured_step: consider this uncertainty; execute when consecutive_skips reaches max_consecutive_skips, otherwise a previously low effect may justify a second skip. Host enforces these caps and always executes block0. Do not reuse cached output. Quality target is fixed5 4step. No guarantee; this is an experimental identity bypass.",criteria={"execute":"Compute block to preserve transformations; high effect, stale or uncertain evidence.","skip":"Identity bypass for a relatively low-effect, recently measured block; speed candidate."}) for b in range(1,50)}
            with TypeSafeClient(model="jev-1.13.0",retry=RetryPolicy(max_retries=0),timeout=request["timeout"],base_url="https://api.typesafe.ai") as client:
                response=client.system_one(state=request["state"],questions=questions)
            print(json.dumps({"decisions":{k:{"choice":v.choice,"confidence":v.confidence,"probabilities":v.probabilities} for k,v in response.choices.items()},"model":response.model,"usage":response.usage.model_dump(mode="json") if response.usage else None}))
            return
        v2 = request["state"].get("gate_stats", {}).get("policy") == "av_v2"
        with TypeSafeClient(model="jev-1.13.0" if v2 else "jev-latest", retry=RetryPolicy(max_retries=0),
                            timeout=request["timeout"], base_url="https://api.typesafe.ai") as client:
            response = client.system_one(state=request["state"], questions={
                "keep": Choice(instructions=V2_INSTRUCTIONS if v2 else INSTRUCTIONS, criteria=V2_CRITERIA if v2 else CRITERIA)})
        a = response.choices["keep"]
        usage = getattr(response, "usage", None)
        print(json.dumps({"choice": a.choice, "confidence": a.confidence,
                          "probabilities": a.probabilities, "model": response.model,
                          "usage": usage.model_dump(mode="json") if usage is not None else None}))
    except Exception as exc:
        # Never log exception text, request headers, environment, or credentials.
        print(json.dumps({"error": type(exc).__name__}))

if __name__ == "__main__":
    worker()
