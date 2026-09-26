import { config, isLive } from "../config";
import { createMockAdapters } from "./mock";
import { ComfyVideoModel } from "./comfy";
import { ComfyImageModel } from "./comfy-image";
import { GenerationBackend, HttpImageModel, HttpVideoModel } from "./backend";
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
  const backend = new GenerationBackend(config.backendUrl);
  const store = new HttpAssetStore(config.backendUrl);
  const decision = new HttpDecisionPort(config.decision.url, config.decision.engine);

  // Prefer the business backend (front/back contract); fall back to talking to
  // ComfyUI directly when no backend URL is configured.
  const video = backend.available
    ? new HttpVideoModel(backend, {
        width: config.video.width,
        height: config.video.height,
        length: config.video.length,
      })
    : new ComfyVideoModel({
        baseUrl: config.comfyUrl,
        workflowUrl: "/workflows/h3_ref2va.api.json",
        defaultLength: config.video.length,
        defaultSteps: config.video.steps,
        defaultSampler: config.video.sampler,
      });

  let image = base.image;
  if (config.image.enabled) {
    image = backend.available
      ? new HttpImageModel(backend, {
          width: config.image.width,
          height: config.image.height,
          steps: config.image.steps,
          sampler: config.image.sampler,
        })
      : new ComfyImageModel({
          baseUrl: config.comfyUrl,
          workflowUrl: config.image.workflowUrl,
          defaultWidth: config.image.width,
          defaultHeight: config.image.height,
          defaultSteps: config.image.steps,
          defaultSampler: config.image.sampler,
          defaultCfg: config.image.cfg,
        });
  }

  return {
    ...base,
    text: text.available ? text : base.text,
    video,
    image,
    store: store.available ? store : base.store,
    decision: decision.available ? decision : base.decision,
    backend: backend.available ? backend : undefined,
  };
}

export type { Adapters };
