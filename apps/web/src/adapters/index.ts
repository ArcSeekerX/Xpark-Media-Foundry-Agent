import { config, isLive } from "../config";
import { createMockAdapters } from "./mock";
import { ComfyVideoModel } from "./comfy";
import { HttpAssetStore, HttpDecisionPort, OpenAITextModel } from "./live";
import type { Adapters } from "./types";

export function createAdapters(): Adapters {
  const base = createMockAdapters(config.quality.acceptThreshold);
  if (!isLive()) return base;

  const text = new OpenAITextModel(
    config.textModel.baseUrl,
    config.textModel.apiKey,
    config.textModel.model,
  );
  const video = new ComfyVideoModel({
    baseUrl: config.comfyUrl,
    workflowUrl: "/workflows/h3_ref2va.api.json",
    defaultLength: config.video.length,
    defaultSteps: config.video.steps,
    defaultSampler: config.video.sampler,
  });
  const store = new HttpAssetStore(config.backendUrl);
  const decision = new HttpDecisionPort(config.decision.url, config.decision.engine);

  return {
    ...base,
    text: text.available ? text : base.text,
    video,
    // Image generation stays a declared-but-unavailable adapter until a local
    // text-to-image checkpoint is installed.
    image: base.image,
    store: store.available ? store : base.store,
    decision: decision.available ? decision : base.decision,
  };
}

export type { Adapters };
