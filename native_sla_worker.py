# SPDX-License-Identifier: GPL-3.0-only
import json, sys
from typesafe_sdk import Choice, RetryPolicy, TypeSafeClient
state = json.load(sys.stdin)
questions = {str(b): Choice(instructions=f"Choose NEXT-step SLA keep percent for layer {b}. Read blocks['{b}'] audio and video separately. Low residual ranks in BOTH support1 or3; mixed ordinary effects support5; high effects in either or unusually large cross-step drift support10. Compare peers; drift includes normal denoising. Preserve worst modality. Missing temporal history is not proof of danger. No quality guarantee; no forced change. Read host protection rules in state.", criteria={'1': 'Aggressive: low impact in both modalities', '3': 'Moderate reduction: relatively low effect or stable', '5': 'Baseline: mixed/ordinary evidence', '10': 'Protect: unusually high importance or risk'}) for b in range(1, 50)}
if state.get('initialization'):
    questions = {str(b): Choice(instructions=f'Choose FIRST-step SLA keep for layer {b}. Read the full prompt, historical pilot block statistics and limitations. This pass establishes scene, identity and any details requested in the supplied prompt. Read historical source and human_feedback as supplied; do not assume a text-rendering requirement or invent a prior failure. The pilot used5%; its residuals do not establish causation or localize safe removal. Current-run residuals do not exist yet. Prefer broad coverage for potentially important transformations, reduce only with a specific defensible low-impact signal. Historical low residual does not establish safe removal. Block0 can only5 or10. Do not force differences from10 for demonstration.', criteria={'5': 'Moderate coverage', '10': 'Highest allowed coverage'} if b == 0 else {'1': 'Strong reduction with compelling low-impact evidence', '3': 'Moderate reduction with supporting evidence', '5': 'Intermediate coverage', '10': 'Highest allowed coverage for formation, text or uncertainty'}) for b in range(50)}
try:
    with TypeSafeClient(model='jev-1.13.0', retry=RetryPolicy(max_retries=0), timeout=20, base_url='https://api.typesafe.ai') as client:
        r = client.system_one(state=state, questions=questions)
    print(json.dumps({'decisions': {k: {'choice': v.choice, 'confidence': v.confidence, 'probabilities': v.probabilities} for k, v in r.choices.items()}, 'model': r.model, 'usage': r.usage.model_dump(mode='json') if r.usage else None}))
except Exception as e:
    print(json.dumps({'error': type(e).__name__}))
    sys.exit(1)
