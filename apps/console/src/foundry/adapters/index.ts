import { config, isLive } from "../config";
import { createMockAdapters } from "./mock";
import { ComfyVideoModel } from "./comfy";
import { ComfyImageModel } from "./comfy-image";
import { GenerationBackend, HttpImageModel, HttpVideoModel } from "./backend";
import {
  HttpAssetStore,
  HttpDecisionPort,
  HttpVisionJudge,
  OpenAITextModel,
  UncertainJudge,
  UnavailableImageModel,
} from "./live";
import type { Adapters } from "./types";

export function createAdapters(): Adapters {
  // Mock adapters are only used when explicitly selected (VITE_MODE=mock) for
  // offline UI demos. The default path uses real interfaces end to end.
  if (!isLive()) return createMockAdapters(config.quality.acceptThreshold);

  const text = new OpenAITextModel(
    config.textModel.baseUrl,
    config.textModel.apiKey,
    config.textModel.model,
  );
  const backend = new GenerationBackend(config.backendUrl, config.backendToken);
  const store = new HttpAssetStore(config.backendUrl);
  const decision = new HttpDecisionPort(config.decision.url, config.decision.engine);
  const judge = backend.available
    ? new HttpVisionJudge(config.backendUrl, config.backendToken)
    : new UncertainJudge();

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

  const image = config.image.enabled
    ? backend.available
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
        })
    : new UnavailableImageModel();

  return {
    text,
    video,
    image,
    judge,
    store,
    decision,
    backend: backend.available ? backend : undefined,
  };
}

export type { Adapters };
