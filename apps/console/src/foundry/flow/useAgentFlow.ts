import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createAdapters } from "../adapters";
import type { Adapters, Capabilities, GeneratedMedia, RenderHandle } from "../adapters/types";
import { refinePrompt } from "../agent/refine";
import { planProject, planFromMaterials } from "../agent/planner";
import { applySkill, bestSkill } from "../skills/router";
import { skillById } from "../skills/registry";
import { allowedActions, routeShot } from "../routing/router";
import { config } from "../config";
import { useSettings } from "../settings";
import { EventLog } from "./events";
import { initialState, reducer } from "./store";
import type { Metrics, State } from "./store";
import { nowIso, resolutionFor, shortHash, sleep, uid } from "../lib/util";
import type {
  AgentMessage,
  Asset,
  AssetBinding,
  CandidateStatus,
  DiscardReason,
  DiscardRecord,
  FlowEvent,
  ProductionParams,
  PromptSpec,
  ReferenceImage,
  RenderRequest,
  RouteDecision,
  Run,
  Shot,
} from "../types";

const STORAGE_KEY = "xpark-foundry:flow:v1";

export interface GenerateOverrides {
  seedDelta?: number;
  promptVariant?: number;
  steps?: number;
  sampler?: string;
}

export type SseStatus = "off" | "connecting" | "open" | "closed";

interface BackendEvent {
  event_id: string;
  seq: number;
  project_id: string;
  type: string;
  summary: string;
  timestamp: number;
  run_id?: string;
  artifact_ids?: string[];
  state_version?: number;
  payload?: unknown;
}

function toFlowEvent(e: BackendEvent): FlowEvent {
  return {
    eventId: e.event_id,
    seq: e.seq,
    projectId: e.project_id,
    runId: e.run_id,
    type: e.type as FlowEvent["type"],
    actor: "backend",
    timestamp: new Date((e.timestamp ?? 0) * 1000).toISOString(),
    summary: e.summary,
    artifactIds: e.artifact_ids ?? [],
    stateVersion: e.state_version ?? e.seq,
    payload: e.payload,
  };
}

function makeAsset(
  media: GeneratedMedia,
  projectId: string,
  source: Asset["source"],
  metadata: Record<string, unknown> = {},
  status: CandidateStatus = "candidate",
): Asset {
  return {
    assetId: media.assetId,
    projectId,
    source,
    mediaType: media.mediaType,
    version: 1,
    storageKey: media.storageKey,
    previewKey: media.previewKey,
    metadata: { ...metadata, remoteUrl: media.remoteUrl },
    state: "READY",
    status,
  };
}

// Persist a size-bounded snapshot so a refresh keeps the task. Large inline
// data URLs are dropped from the snapshot when the payload would exceed quota.
function loadPersisted(): State | undefined {
  if (!config.persist) return undefined;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as State;
    if (!parsed || !Array.isArray(parsed.shots)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function persist(state: State): void {
  if (!config.persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded: retry without heavy inline payloads.
    try {
      const light: State = {
        ...state,
        assets: state.assets.map((a) => {
          const metadata = { ...a.metadata };
          delete metadata.dataUrl;
          if (typeof metadata.remoteUrl === "string" && metadata.remoteUrl.startsWith("data:")) {
            delete metadata.remoteUrl;
          }
          return { ...a, metadata };
        }),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(light));
    } catch {
      /* give up silently; persistence is best-effort */
    }
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

function assetImage(asset: Asset | undefined): string | undefined {
  if (!asset || asset.mediaType !== "image") return undefined;
  const url = asset.metadata.remoteUrl ?? asset.metadata.dataUrl;
  return typeof url === "string" ? url : undefined;
}

function assetReference(asset: Asset): ReferenceImage | undefined {
  const dataUrl = assetImage(asset);
  if (!dataUrl) return undefined;
  const name =
    typeof asset.metadata.name === "string"
      ? asset.metadata.name
      : `${asset.assetId}.png`;
  return { assetId: asset.assetId, name, dataUrl, source: asset.source };
}

function collectBoundReferences(state: State, shot: Shot): ReferenceImage[] {
  const refs: ReferenceImage[] = [];
  for (const binding of shot.bindings) {
    const asset = state.assets.find((a) => a.assetId === binding.assetId);
    const ref = asset ? assetReference(asset) : undefined;
    if (ref) refs.push({ ...ref, role: binding.role });
  }
  return refs;
}

export interface AgentFlow {
  state: State;
  adapters: Adapters;
  log: EventLog;
  sseStatus: SseStatus;
  capabilities?: Capabilities;
  guide: (sentence: string) => Promise<void>;
  editShotPrompt: (shotId: string, positive: string, negative: string) => void;
  selectSkill: (sceneId: string, skillId: string) => void;
  importAsset: (
    file: File,
    shotId?: string,
    role?: AssetBinding["role"],
  ) => Promise<Asset | undefined>;
  bindAsset: (shotId: string, assetId: string, role: AssetBinding["role"]) => void;
  unbindAsset: (shotId: string, bindingId: string) => void;
  generateImage: (shotId: string) => Promise<Asset | undefined>;
  generateShot: (shotId: string, overrides?: GenerateOverrides) => Promise<void>;
  generateAll: () => Promise<void>;
  regenerateShot: (
    shotId: string,
    options?: { seedDelta?: number; promptVariant?: number; steps?: number; sampler?: string },
  ) => Promise<void>;
  acceptCandidate: (shotId: string, assetId: string) => void;
  discardCandidate: (assetId: string, reason: DiscardReason, note?: string) => void;
  restoreCandidate: (assetId: string) => void;
  cancel: () => void;
  review: (shotId: string, verdict: "accept" | "reject") => void;
  compose: (options?: { allowPartial?: boolean }) => Promise<void>;
  archive: () => Promise<void>;
  produceFromMaterials: (input: {
    title: string;
    mdFiles: File[];
    images: File[];
    params: ProductionParams;
  }) => Promise<void>;
  reset: () => void;
}

export function useAgentFlow(): AgentFlow {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => loadPersisted() ?? init);
  const store = useRef<State>(state);
  store.current = state;
  const cancelRef = useRef(false);

  const log = useRef(new EventLog()).current;
  const { settings } = useSettings();
  // Adapters are rebuilt whenever settings change (endpoints, models, defaults).
  const adapters = useMemo(() => createAdapters(), [settings]);
  const [sseStatus, setSseStatus] = useState<SseStatus>("off");
  const [capabilities, setCapabilities] = useState<Capabilities | undefined>();

  const emit = useCallback(
    (input: Parameters<EventLog["emit"]>[0]): FlowEvent => {
      const event = log.emit(input);
      dispatch({ type: "add_event", event });
      return event;
    },
    [log],
  );

  const say = useCallback(
    (text: string, role: AgentMessage["role"] = "agent", meta?: Record<string, unknown>) => {
      dispatch({
        type: "add_message",
        message: { messageId: uid("msg"), role, text, timestamp: nowIso(), meta },
      });
    },
    [],
  );

  // Best-effort persistence: debounce writes so a refresh keeps the task view.
  useEffect(() => {
    const timer = setTimeout(() => persist(state), 400);
    return () => clearTimeout(timer);
  }, [state]);

  // Load model capabilities from the backend (reference limits, ffmpeg, ...).
  useEffect(() => {
    const backend = adapters.backend;
    if (!backend?.capabilities) return;
    let alive = true;
    backend
      .capabilities()
      .then((caps) => alive && setCapabilities(caps))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [adapters.backend]);

  // Replayable event stream: ingest backend events with id-based dedup.
  useEffect(() => {
    const backend = adapters.backend;
    if (!config.sse || !backend?.eventsUrl) {
      setSseStatus("off");
      return;
    }
    const projectId = state.project?.projectId ?? "default";
    const seen = new Set<string>();
    setSseStatus("connecting");
    const source = new EventSource(backend.eventsUrl(projectId, 0));
    source.onopen = () => setSseStatus("open");
    source.onerror = () => setSseStatus("closed");
    source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as BackendEvent;
        if (seen.has(event.event_id)) return;
        seen.add(event.event_id);
        dispatch({ type: "add_event", event: toFlowEvent(event) });
      } catch {
        /* ignore malformed frame */
      }
    };
    return () => source.close();
  }, [adapters.backend, state.project?.projectId]);

  // -------------------------------------------------------------------------
  // 1. One-sentence guidance -> plan
  // -------------------------------------------------------------------------
  const guide = useCallback(
    async (sentence: string) => {
      const text = sentence.trim();
      if (!text) return;
      dispatch({ type: "set_busy", busy: true });
      dispatch({ type: "set_phase", phase: "planning" });
      say(text, "user");
      const projectId = uid("proj");
      emit({ projectId, type: "agent.started", summary: "Agent 正在理解一句话需求", actor: "planner-agent" });
      say("正在解析需求，匹配场景技能并补全分镜与提示词…");

      await sleep(250);
      const plan = planProject(text, projectId);

      // Decision port: propose how to proceed (shadow mode friendly).
      let selectedAction = "generate";
      try {
        const advice = await adapters.decision.propose({
          stateHash: `sha256:${shortHash(text)}`,
          allowedActions: ["prefer_imported", "reuse_clip", "image_conditioned", "generate"],
          summary: `一句话需求：${text}`,
          evidenceIds: plan.scenes.map((s) => s.sceneId),
        });
        selectedAction = advice.selectedAction;
        say(
          `决策建议：${advice.selectedAction}（${advice.modelId}，置信已由规则校验）`,
          "decision",
          { advice },
        );
        emit({
          projectId,
          type: "decision.proposed",
          summary: `decision=${advice.selectedAction}`,
          actor: "decision-port",
          payload: advice,
        });
      } catch {
        say("决策端口不可用，回退到规则：直接生成。", "decision");
      }

      for (const scene of plan.scenes) {
        const routing = plan.routings[scene.index] ?? [];
        const picked = routing[0];
        if (picked) {
          say(
            `场景「${scene.title}」匹配技能：${picked.skill.name}（${picked.reasons.join("；") || "默认"}）`,
            "tool",
            { skillId: picked.skill.skillId, score: picked.score },
          );
          emit({
            projectId,
            type: "skill.invoked",
            summary: `skill=${picked.skill.skillId}`,
            actor: "skill-router",
            payload: routing,
          });
        }
      }

      // Apply the decision port's material policy to every shot spec. The
      // small model only proposes; rules still decide what the pipeline does.
      const preferImported = selectedAction !== "generate";
      const plannedShots = plan.shots.map((shot) => ({
        ...shot,
        spec: {
          ...shot.spec,
          materialPolicy: (preferImported ? "prefer_imported" : "generate") as
            | "prefer_imported"
            | "generate",
        },
      }));

      dispatch({
        type: "set_plan",
        project: {
          projectId,
          name: text.slice(0, 24) || "未命名项目",
          brief: plan.brief,
          createdAt: nowIso(),
          sceneIds: plan.scenes.map((s) => s.sceneId),
          stateVersion: 1,
        },
        brief: plan.brief,
        scenes: plan.scenes,
        shots: plannedShots,
        routings: Object.fromEntries(
          plan.scenes.map((s) => [s.sceneId, plan.routings[s.index] ?? []]),
        ),
      });
      say(
        `已生成 ${plan.scenes.length} 个场景、${plan.shots.length} 个镜头，技能与提示词已就绪（偏好：${selectedAction}）。可在右侧编辑后开始生产。`,
      );
      dispatch({ type: "set_busy", busy: false });
      emit({ projectId, type: "step.completed", summary: "规划完成", actor: "planner-agent" });
    },
    [adapters.decision, emit, say],
  );

  const editShotPrompt = useCallback(
    (shotId: string, positive: string, negative: string) => {
      dispatch({ type: "patch_shot", shotId, patch: { prompt: positive, negativePrompt: negative, phase: "PROMPT_READY" } });
    },
    [],
  );

  const selectSkill = useCallback(
    (sceneId: string, skillId: string) => {
      const scene = store.current.scenes.find((s) => s.sceneId === sceneId);
      if (!scene) return;
      const skill = skillById(skillId);
      if (!skill) return;
      const sceneShots = store.current.shots.filter((s) => s.sceneId === sceneId);
      sceneShots.forEach((shot) => {
        const applied = applySkill(shot.spec, skill);
        dispatch({
          type: "patch_shot",
          shotId: shot.shotId,
          patch: {
            spec: applied.spec,
            prompt: applied.prompt,
            negativePrompt: applied.negativePrompt,
            skillId: skill.skillId,
          },
        });
      });
      dispatch({ type: "patch_scene", sceneId, patch: { skillIds: [skill.skillId] } });
      say(`场景「${scene.title}」切换技能：${skill.name}，镜头提示词已重算。`, "tool");
    },
    [say],
  );

  // -------------------------------------------------------------------------
  // 1b. Asset service: import reference art, bind to shots, generate keyframes
  // -------------------------------------------------------------------------
  const bindAsset = useCallback(
    (shotId: string, assetId: string, role: AssetBinding["role"]) => {
      const shot = store.current.shots.find((s) => s.shotId === shotId);
      if (!shot) return;
      const binding: AssetBinding = {
        bindingId: uid("bind"),
        shotId,
        role,
        assetId,
        assetVersion: 1,
      };
      dispatch({ type: "add_binding", shotId, binding });
      say(`已把素材绑定到镜头「${shot.title}」（用途：${role}）。`, "tool");
    },
    [say],
  );

  const unbindAsset = useCallback((shotId: string, bindingId: string) => {
    dispatch({ type: "remove_binding", shotId, bindingId });
  }, []);

  const importAsset = useCallback(
    async (file: File, shotId?: string, role: AssetBinding["role"] = "character") => {
      const project = store.current.project;
      if (!project) {
        say("请先用一句话生成项目与分镜，再导入素材。", "agent");
        return undefined;
      }
      if (!file.type.startsWith("image/")) {
        say(`仅支持图片参考素材，已忽略「${file.name}」。`, "tool");
        return undefined;
      }
      let dataUrl: string;
      try {
        dataUrl = await readFileAsDataUrl(file);
      } catch {
        say(`读取「${file.name}」失败。`, "tool");
        return undefined;
      }
      const asset: Asset = {
        assetId: uid("asset"),
        projectId: project.projectId,
        source: "imported",
        mediaType: "image",
        version: 1,
        storageKey: `imports/${project.projectId}/${file.name}`,
        metadata: {
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          dataUrl,
          remoteUrl: dataUrl,
        },
        state: "READY",
      };
      dispatch({ type: "add_asset", asset });
      dispatch({ type: "bump", key: "importedAssets" });
      emit({
        projectId: project.projectId,
        type: "artifact.created",
        summary: `导入参考素材 ${file.name}`,
        actor: "asset-service",
        artifactIds: [asset.assetId],
      });
      if (shotId) bindAsset(shotId, asset.assetId, role);
      say(
        `已导入参考图「${file.name}」${shotId ? `并绑定到镜头（${role}）` : "到素材库"}。`,
        "tool",
      );
      return asset;
    },
    [bindAsset, emit, say],
  );

  const generateImage = useCallback(
    async (shotId: string) => {
      const snapshot = store.current;
      const shot = snapshot.shots.find((s) => s.shotId === shotId);
      const project = snapshot.project;
      if (!shot || !project) return undefined;
      if (!adapters.image.available) {
        say("生图适配器未启用，无法生成关键帧。", "tool");
        return undefined;
      }
      const scene = snapshot.scenes.find((s) => s.sceneId === shot.sceneId);
      const skill = skillById(shot.skillId) ?? bestSkill(scene?.synopsis ?? "").skill;
      const stepId = uid("step");
      const seed = 20260000 + snapshot.shots.indexOf(shot);
      dispatch({
        type: "add_step",
        step: {
          stepId,
          runId: uid("run"),
          shotId,
          kind: "image",
          actor: adapters.image.name,
          state: "running",
          startedAt: nowIso(),
          summary: `生成关键帧（${adapters.image.name}）`,
          artifactIds: [],
        },
      });
      emit({
        projectId: project.projectId,
        stepId,
        type: "step.queued",
        summary: "关键帧生图入队",
        actor: "orchestrator",
      });
      try {
        const promptSpec = scene
          ? await refinePrompt(adapters.text, shot, scene, skill)
          : {
              shotId,
              positive: shot.prompt,
              negative: shot.negativePrompt,
              variants: [shot.prompt],
            };
        const referenceImages = collectBoundReferences(snapshot, shot);
        const production = snapshot.production;
        const imageSize = production
          ? resolutionFor(production.aspectRatio, production.width, production.height)
          : null;
        const media = await adapters.image.generate({
          shot: shot.spec,
          prompt: promptSpec.positive,
          negativePrompt: promptSpec.negative,
          width: imageSize?.width ?? config.image.width,
          height: imageSize?.height ?? config.image.height,
          seed,
          skillId: shot.skillId,
          referenceImages,
        });
        const asset = makeAsset(media, project.projectId, "generated", {
          shotId,
          kind: "keyframe",
        });
        dispatch({ type: "add_asset", asset });
        const binding: AssetBinding = {
          bindingId: uid("bind"),
          shotId,
          role: "first_frame",
          assetId: asset.assetId,
          assetVersion: 1,
        };
        dispatch({ type: "add_binding", shotId, binding });
        dispatch({ type: "bump", key: "imageGenerations" });
        dispatch({
          type: "patch_step",
          stepId,
          patch: {
            state: "done",
            endedAt: nowIso(),
            summary: "关键帧已生成",
            artifactIds: [asset.assetId],
          },
        });
        dispatch({ type: "set_run_phase", shotId, phase: "ASSET_READY" });
        emit({
          projectId: project.projectId,
          stepId,
          type: "artifact.created",
          summary: `关键帧 ${asset.storageKey}`,
          actor: adapters.image.name,
          artifactIds: [asset.assetId],
        });
        say(`镜头「${shot.title}」关键帧已生成（${adapters.image.name}）。`, "agent");
        return asset;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dispatch({
          type: "patch_step",
          stepId,
          patch: { state: "failed", endedAt: nowIso(), summary: message },
        });
        emit({
          projectId: project.projectId,
          stepId,
          type: "run.failed",
          summary: `关键帧生成失败：${message}`,
          actor: adapters.image.name,
        });
        say(`关键帧生成失败：${message}`, "agent");
        return undefined;
      }
    },
    [adapters, emit, say],
  );

  // -------------------------------------------------------------------------
  // 2. Production: image (optional) -> video -> QC -> repair
  // -------------------------------------------------------------------------
  const waitForRender = useCallback(
    async (
      handle: RenderHandle,
      onProgress: (current: number, total: number) => void,
    ): Promise<GeneratedMedia> => {
      const deadline = Date.now() + 40 * 60 * 1000;
      while (Date.now() < deadline) {
        const p = await adapters.video.poll(handle);
        if (p.state === "failed") throw new Error(p.error ?? "render failed");
        if (p.progress) onProgress(p.progress.current, p.progress.total);
        if (p.state === "generated" && p.artifact) return p.artifact;
        await sleep(config.mode === "live" ? 3000 : 400);
      }
      throw new Error("render timeout");
    },
    [adapters.video],
  );

  const generateShot = useCallback(
    async (shotId: string, overrides?: GenerateOverrides) => {
      const snapshot = store.current;
      const shot = snapshot.shots.find((s) => s.shotId === shotId);
      const project = snapshot.project;
      if (!shot || !project) return;
      if (cancelRef.current) {
        say("调度已取消，未提交新任务。", "agent");
        return;
      }
      const scene = snapshot.scenes.find((s) => s.sceneId === shot.sceneId);
      const skill = skillById(shot.skillId) ?? bestSkill(scene?.synopsis ?? "").skill;

      // One-click production parameters override the skill/config defaults.
      const production = snapshot.production;
      const size = resolutionFor(
        production?.aspectRatio ?? shot.spec.aspectRatio,
        production?.width,
        production?.height,
      );
      const genSteps = overrides?.steps ?? production?.steps ?? skill.params.steps;
      const genSampler = overrides?.sampler ?? production?.sampler ?? skill.params.sampler;
      const genFrames = production?.frames ?? config.video.length;

      // ---- Intelligent routing: rules first, optional model proposal ----
      const boundRefs = collectBoundReferences(snapshot, shot);
      const priorRun = [...snapshot.runs].reverse().find((r) => r.shotId === shotId);
      const routeInput = {
        materialPolicy: shot.spec.materialPolicy,
        hasImportedImage: boundRefs.some((r) => r.source === "imported"),
        hasGeneratedImage: boundRefs.some((r) => r.source === "generated"),
        hasReuseClip: shot.bindings.some((b) => b.role === "reuse_clip"),
        imageAvailable: adapters.image.available,
        imageEnabled: config.image.enabled,
        priorVerdict: priorRun?.score?.verdict,
        repairs: priorRun?.score?.verdict === "repair" ? 1 : 0,
        maxRepairs: config.quality.maxRepairs,
        advice: null as { selectedAction: string; modelId: string } | null,
      };
      try {
        const advice = await adapters.decision.propose({
          stateHash: `sha256:${shortHash(`${shotId}:${shot.spec.action}`)}`,
          allowedActions: allowedActions(routeInput) as string[],
          summary: `镜头「${shot.title}」：${shot.spec.action}`,
          evidenceIds: [shotId],
        });
        routeInput.advice = { selectedAction: advice.selectedAction, modelId: advice.modelId };
        emit({
          projectId: project.projectId,
          type: "decision.proposed",
          summary: `建议 ${advice.selectedAction}`,
          actor: "decision-port",
          payload: advice,
        });
      } catch {
        emit({
          projectId: project.projectId,
          type: "decision.fallback",
          summary: "决策端口不可用，回退规则路由",
          actor: "router",
        });
      }
      const route: RouteDecision = routeShot(routeInput, {
        shadow: config.routing.shadow && !config.routing.auto,
        minConfidence: config.routing.minConfidence,
      });
      if (route.source === "model") {
        dispatch({ type: "bump", key: "routeModelAccepted" });
      } else if (route.shadow && route.modelAction && route.modelAction !== route.action) {
        dispatch({ type: "bump", key: "routeShadowDisagreements" });
      }
      emit({
        projectId: project.projectId,
        type: "decision.applied",
        summary: `路由 ${route.action}（${route.source}${route.shadow ? " · shadow" : ""}）`,
        actor: "router",
        payload: route,
      });
      dispatch({
        type: "bump",
        key: route.action === "reuse_imported" || route.action === "reuse_clip"
          ? "routeReuses"
          : "routeGenerates",
      });
      say(`智能路由：${route.action}｜${route.reasons.join("；")}`, "decision", { route });

      if (route.action === "human_review") {
        dispatch({ type: "patch_shot", shotId, patch: { phase: "HUMAN_REVIEW" } });
        say(`镜头「${shot.title}」按路由进入人工复核。`, "agent");
        return;
      }

      const runId = uid("run");
      const run: Run = {
        runId,
        projectId: project.projectId,
        shotId,
        attemptId: uid("att"),
        commandId: uid("cmd"),
        state: "PROMPT_READY",
        seed:
          (production?.seed ?? 20260000) +
          snapshot.shots.indexOf(shot) +
          (overrides?.seedDelta ?? 0),
        params: { steps: genSteps, sampler: genSampler },
        artifactIds: [],
        createdAt: nowIso(),
      };
      dispatch({ type: "add_run", run });
      dispatch({ type: "patch_shot", shotId, patch: { runIds: [...shot.runIds, runId] } });

      const stepId = uid("step");
      dispatch({
        type: "add_step",
        step: {
          stepId,
          runId,
          shotId,
          kind: "render",
          actor: adapters.video.name,
          state: "running",
          startedAt: nowIso(),
          summary: "提交渲染",
          artifactIds: [],
        },
      });
      emit({ projectId: project.projectId, runId, stepId, type: "step.queued", summary: "镜头入队", actor: "orchestrator" });
      dispatch({ type: "set_run_phase", shotId, phase: "QUEUED" });

      try {
        // 1. prompt refine (with optional variant for regeneration)
        dispatch({ type: "set_run_phase", shotId, phase: "PROMPT_READY" });
        let promptSpec: PromptSpec = await refinePrompt(adapters.text, shot, scene!, skill);
        if (overrides?.promptVariant !== undefined && promptSpec.variants.length > 0) {
          promptSpec = {
            ...promptSpec,
            positive: promptSpec.variants[overrides.promptVariant % promptSpec.variants.length],
          };
        }
        say(`镜头「${shot.title}」提示词已优化（${adapters.text.available ? "text-model" : "skill-template"}）。`, "agent");

        // 2. reference images: imported/generated refs are reused; only
        //    image_conditioned gaps trigger a new keyframe.
        let referenceImages = boundRefs;
        if (routeInput.hasGeneratedImage) {
          say(`镜头「${shot.title}」复用已生成关键帧。`, "tool");
        } else if (route.action === "reuse_imported" || route.action === "reuse_clip") {
          dispatch({ type: "bump", key: "imageReuses" });
          say(
            `镜头「${shot.title}」复用 ${referenceImages.length} 个导入参考素材，跳过生图。`,
            "tool",
          );
        } else if (route.action === "image_conditioned" && adapters.image.available && config.image.enabled) {
          const maxRefs = capabilities?.image?.max_reference_images ?? 4;
          if (referenceImages.length > maxRefs) {
            emit({
              projectId: project.projectId,
              runId,
              stepId,
              type: "tool.progress",
              summary: `参考图 ${referenceImages.length} 超过能力上限 ${maxRefs}，仅使用前 ${maxRefs} 张`,
              actor: "capability-check",
            });
            referenceImages = referenceImages.slice(0, maxRefs);
          }
          dispatch({ type: "set_run_phase", shotId, phase: "ASSET_READY" });
          const keyframe = await generateImage(shotId);
          if (keyframe) {
            const ref = assetReference(keyframe);
            if (ref) referenceImages = [...referenceImages, { ...ref, role: "first_frame" }];
          }
        } else {
          emit({
            projectId: project.projectId,
            runId,
            stepId,
            type: "tool.progress",
            summary: "按路由直接文本条件生成",
            actor: "image-adapter",
          });
        }

        // 3. render + QC + repair loop
        let accepted = false;
        for (let attempt = 0; attempt <= config.quality.maxRepairs; attempt += 1) {
          if (cancelRef.current) {
            say(`镜头「${shot.title}」在安全边界停止（已取消）。`, "agent");
            break;
          }
          dispatch({ type: "set_run_phase", shotId, phase: "RENDERING" });
          emit({ projectId: project.projectId, runId, stepId, type: "agent.started", summary: `开始渲染（第 ${attempt + 1} 次）`, actor: adapters.video.name });
          const req: RenderRequest = {
            shotId,
            promptSpec,
            width: size.width,
            height: size.height,
            length: genFrames,
            seed: run.seed! + attempt,
            steps: genSteps,
            sampler: genSampler,
            refAssetIds: referenceImages.map((r) => r.assetId),
            referenceImages,
            workflowHash: `wf:${shortHash(`${skill.skillId}:${genSteps}:${genSampler}`)}`,
          };
          const handle = await adapters.video.render(req);
          dispatch({ type: "patch_run", runId, patch: { promptId: handle.promptId } });
          const media = await waitForRender(handle, (current, total) => {
            emit({
              projectId: project.projectId,
              runId,
              stepId,
              type: "tool.progress",
              summary: "正在执行视频采样",
              actor: adapters.video.name,
              progress: { unit: "sampling_step", current, total },
            });
          });
          const asset = makeAsset(media, project.projectId, "generated", { runId, shotId });
          dispatch({ type: "add_asset", asset });
          dispatch({ type: "patch_run", runId, patch: { artifactIds: [...run.artifactIds, asset.assetId] } });
          dispatch({ type: "set_run_phase", shotId, phase: "GENERATED" });
          emit({ projectId: project.projectId, runId, stepId, type: "artifact.created", summary: `生成产物 ${asset.storageKey}`, actor: adapters.video.name, artifactIds: [asset.assetId] });
          emit({ projectId: project.projectId, runId, stepId, type: "candidate.created", summary: `候选 ${asset.assetId}`, actor: "orchestrator", artifactIds: [asset.assetId] });

          dispatch({ type: "set_run_phase", shotId, phase: "SCORING" });
          const report = await adapters.judge.evaluate({ runId, shot: shot.spec, asset: media });
          emit({
            projectId: project.projectId,
            runId,
            stepId,
            type: "quality.evaluated",
            summary: `质检 verdict=${report.verdict}`,
            actor: adapters.judge.name,
            payload: report,
          });
          dispatch({ type: "patch_run", runId, patch: { score: report } });
          say(
            `质检结果：${report.verdict}｜身份 ${report.scores.identity?.toFixed(2)} / 动作 ${report.scores.action?.toFixed(2)} / 时间 ${report.scores.temporal?.toFixed(2)}`,
            "agent",
            { report },
          );

          if (report.verdict === "accept") {
            accepted = true;
            dispatch({ type: "accept_asset", shotId, assetId: asset.assetId });
            dispatch({ type: "bump", key: "acceptedShots" });
            emit({
              projectId: project.projectId,
              runId,
              stepId,
              type: "candidate.accepted",
              summary: `采用候选 ${asset.assetId}`,
              actor: "judge",
              artifactIds: [asset.assetId],
            });
            break;
          }
          if (report.verdict === "human_review" || attempt === config.quality.maxRepairs) {
            dispatch({ type: "set_run_phase", shotId, phase: "HUMAN_REVIEW" });
            dispatch({ type: "patch_shot", shotId, patch: { phase: "HUMAN_REVIEW" } });
            say(`镜头「${shot.title}」进入人工复核（预算耗尽或不确定）。`, "agent");
            break;
          }
          dispatch({ type: "set_run_phase", shotId, phase: "REPAIRING" });
          dispatch({ type: "bump", key: "repairCount" });
          const repair = report.repair;
          say(`修复计划：${repair?.action ?? "调整提示词"}（起点 ${repair?.invalidateFrom ?? "PROMPT_READY"}）`, "agent", { repair });
          // deterministic repair: pick another prompt variant
          const variants = promptSpec.variants;
          promptSpec = {
            ...promptSpec,
            positive: variants[(attempt + 1) % variants.length],
          };
        }

        dispatch({
          type: "patch_step",
          stepId,
          patch: {
            state: accepted ? "done" : "failed",
            endedAt: nowIso(),
            summary: accepted ? "渲染并验收通过" : "进入人工复核",
          },
        });
        dispatch({ type: "set_run_phase", shotId, phase: accepted ? "ACCEPTED" : "HUMAN_REVIEW" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dispatch({ type: "set_run_phase", shotId, phase: "FAILED" });
        dispatch({ type: "patch_shot", shotId, patch: { phase: "FAILED" } });
        dispatch({ type: "patch_step", stepId, patch: { state: "failed", endedAt: nowIso(), summary: message } });
        emit({ projectId: project.projectId, runId, stepId, type: "run.failed", summary: message, actor: "orchestrator" });
        say(`镜头「${shot.title}」执行失败：${message}`, "agent");
      }
    },
    [adapters, capabilities, emit, generateImage, say, waitForRender],
  );

  const generateAll = useCallback(async () => {
    cancelRef.current = false;
    dispatch({ type: "set_phase", phase: "producing" });
    for (const shot of store.current.shots) {
      if (cancelRef.current) {
        say("已取消后续调度，运行中的任务在安全边界停止。", "agent");
        break;
      }
      if (shot.phase === "ACCEPTED") continue;
      await generateShot(shot.shotId);
    }
    dispatch({ type: "set_phase", phase: "planned" });
  }, [generateShot, say]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    say("已请求取消：停止后续调度，运行中的任务在安全边界停止。", "agent");
  }, [say]);

  // -------------------------------------------------------------------------
  // 2b. Candidate lifecycle: accept / discard / restore / regenerate
  // -------------------------------------------------------------------------
  const acceptCandidate = useCallback(
    (shotId: string, assetId: string) => {
      const projectId = store.current.project?.projectId ?? "unknown";
      dispatch({ type: "accept_asset", shotId, assetId });
      emit({
        projectId,
        type: "candidate.accepted",
        summary: `采用候选 ${assetId}`,
        actor: "human",
        artifactIds: [assetId],
      });
      say("已采用该候选版本，将进入成片清单。", "agent");
    },
    [emit, say],
  );

  const discardCandidate = useCallback(
    (assetId: string, reason: DiscardReason, note?: string) => {
      const snapshot = store.current;
      const projectId = snapshot.project?.projectId ?? "unknown";
      const record: DiscardRecord = { reasonTag: reason, note, at: nowIso(), by: "human" };
      const asset = snapshot.assets.find((a) => a.assetId === assetId);
      const shotId = asset && typeof asset.metadata.shotId === "string"
        ? (asset.metadata.shotId as string)
        : undefined;
      dispatch({ type: "discard_asset", assetId, record });
      dispatch({ type: "bump", key: "discardedAssets" });
      if (shotId) {
        const shot = snapshot.shots.find((s) => s.shotId === shotId);
        if (shot?.acceptedAssetId === assetId) {
          dispatch({
            type: "patch_shot",
            shotId,
            patch: { phase: "PROMPT_READY", acceptedAssetId: undefined, acceptedRunId: undefined },
          });
        }
      }
      emit({
        projectId,
        type: "candidate.discarded",
        summary: `弃用候选 ${assetId}（${reason}）`,
        actor: "human",
        artifactIds: [assetId],
      });
      say(`已弃用该候选（${reason}），可在回收站中恢复或重生成。`, "tool");
    },
    [emit, say],
  );

  const restoreCandidate = useCallback(
    (assetId: string) => {
      const projectId = store.current.project?.projectId ?? "unknown";
      dispatch({ type: "restore_asset", assetId });
      emit({
        projectId,
        type: "candidate.created",
        summary: `恢复候选 ${assetId}`,
        actor: "human",
        artifactIds: [assetId],
      });
      say("已从回收站恢复为候选。", "tool");
    },
    [emit, say],
  );

  const regenerateShot = useCallback(
    async (
      shotId: string,
      options?: { seedDelta?: number; promptVariant?: number; steps?: number; sampler?: string },
    ) => {
      const snapshot = store.current;
      const shot = snapshot.shots.find((s) => s.shotId === shotId);
      if (!shot) return;
      const projectId = snapshot.project?.projectId ?? "unknown";
      const attempts = snapshot.runs.filter((r) => r.shotId === shotId).length;
      dispatch({ type: "bump", key: "regenerations" });
      emit({
        projectId,
        type: "candidate.regenerated",
        summary: `重新生成「${shot.title}」（第 ${attempts + 1} 次尝试）`,
        actor: "orchestrator",
      });
      say(`重新生成镜头「${shot.title}」…`, "agent");
      await generateShot(shotId, {
        seedDelta: options?.seedDelta ?? (attempts + 1) * 1000,
        ...options,
      });
    },
    [emit, generateShot, say],
  );

  // -------------------------------------------------------------------------
  // 3. Human review / compose / archive
  // -------------------------------------------------------------------------
  const review = useCallback(
    (shotId: string, verdict: "accept" | "reject") => {
      const snapshot = store.current;
      const shot = snapshot.shots.find((s) => s.shotId === shotId);
      if (!shot) return;
      if (verdict === "accept") {
        const candidate = [...snapshot.assets]
          .reverse()
          .find(
            (a) =>
              a.metadata.shotId === shotId &&
              (a.mediaType === "image" || a.mediaType === "video") &&
              a.status !== "discarded",
          );
        if (candidate) {
          dispatch({ type: "accept_asset", shotId, assetId: candidate.assetId });
        } else {
          dispatch({ type: "patch_shot", shotId, patch: { phase: "ACCEPTED" } });
        }
        dispatch({ type: "bump", key: "acceptedShots" });
        say(`人工接受镜头「${shot.title}」。`, "agent");
      } else {
        dispatch({ type: "patch_shot", shotId, patch: { phase: "PLANNED" } });
        say(`人工拒绝镜头「${shot.title}」，已退回重新规划。`, "agent");
      }
    },
    [say],
  );

  const compose = useCallback(
    async (options?: { allowPartial?: boolean }) => {
      const snapshot = store.current;
      const project = snapshot.project;
      if (!project) return;
      const accepted = snapshot.shots.filter((s) => s.phase === "ACCEPTED");
      const hasVideo = (shotId: string) =>
        snapshot.assets.some(
          (a) =>
            a.mediaType === "video" &&
            a.metadata.shotId === shotId &&
            typeof a.metadata.remoteUrl === "string",
        );
      const included = options?.allowPartial
        ? snapshot.shots.filter((s) => s.phase === "ACCEPTED" || hasVideo(s.shotId))
        : accepted;
      if (!options?.allowPartial && accepted.length !== snapshot.shots.length) {
        say(
          `还有 ${snapshot.shots.length - accepted.length} 个镜头未通过验收，暂不能合成交付。`,
          "agent",
        );
        return;
      }
      if (included.length === 0) {
        say("没有可用片段，无法合成成片。", "agent");
        return;
      }
      dispatch({ type: "set_phase", phase: "composing" });
      emit({ projectId: project.projectId, type: "step.completed", summary: "开始合成成片", actor: "ffmpeg" });
      await sleep(800);
      // Preview URL: newest included shot video. Real ffmpeg concat is handled
      // by the backend when available; the last clip is a usable fallback.
      const includedIds = new Set(included.map((s) => s.shotId));
      const clips = snapshot.assets.filter(
        (a) =>
          a.mediaType === "video" &&
          typeof a.metadata.remoteUrl === "string" &&
          includedIds.has(String(a.metadata.shotId)),
      );
      const clipPreview = clips.at(-1);

      // Real ffmpeg concat via the backend when available; otherwise fall back
      // to the last accepted clip as a playable preview.
      let composed: { url: string; storage_key: string } | undefined;
      if (adapters.backend?.compose && clips.length > 0) {
        try {
          composed = await adapters.backend.compose(
            clips.map((a) => String(a.metadata.remoteUrl)),
            project.projectId,
          );
          emit({
            projectId: project.projectId,
            type: "agent.message",
            summary: `后端合成完成（${composed.storage_key}）`,
            actor: "backend",
          });
        } catch {
          say("后端合成不可用（可能缺少 ffmpeg），改用片段预览。", "tool");
        }
      }

      const finalAsset: Asset = {
        assetId: uid("export"),
        projectId: project.projectId,
        source: "derived",
        mediaType: "video",
        version: 1,
        storageKey: composed?.storage_key ?? `exports/${project.projectId}/final.mp4`,
        previewKey: `exports/${project.projectId}/final.jpg`,
        parentAssetIds: included
          .map((s) => s.acceptedRunId)
          .filter(Boolean)
          .map(String),
        metadata: {
          shots: included.length,
          accepted: accepted.length,
          partial: included.length !== snapshot.shots.length,
          aspectRatio: snapshot.brief?.aspectRatio,
          manifest: `exports/${project.projectId}/manifest.json`,
          remoteUrl: composed?.url ?? clipPreview?.metadata.remoteUrl,
          previewKind: composed ? "composed" : clipPreview ? "clip" : undefined,
        },
        state: "READY",
      };
      dispatch({ type: "add_asset", asset: finalAsset });
      emit({
        projectId: project.projectId,
        type: "export.completed",
        summary: `成片已合成：${finalAsset.storageKey}`,
        actor: "ffmpeg",
        artifactIds: [finalAsset.assetId],
      });
      dispatch({ type: "set_final", asset: finalAsset });
      say(
        `成片合成完成：${finalAsset.storageKey}（${included.length} 个镜头${
          included.length !== accepted.length ? `，其中 ${included.length - accepted.length} 个未验收` : ""
        }）。`,
        "agent",
      );
    },
    [adapters, emit, say],
  );

  const archive = useCallback(async () => {
    const snapshot = store.current;
    if (!snapshot.project) return;
    const record = await adapters.store.archive(snapshot.project.projectId, snapshot.assets, {
      manifest: snapshot.finalAsset?.metadata.manifest,
      metrics: snapshot.metrics,
    });
    dispatch({ type: "set_archive", archive: record });
    emit({
      projectId: snapshot.project.projectId,
      type: "export.completed",
      summary: `素材归档完成：${record.manifestKey}`,
      actor: adapters.store.name,
    });
    say(`素材已归档：${record.manifestKey}（${record.assetIds.length} 个资产）。`, "agent");
  }, [adapters.store, emit, say]);

  // -------------------------------------------------------------------------
  // 4. One-click production: markdown + images -> finished video
  // -------------------------------------------------------------------------
  const produceFromMaterials = useCallback(
    async (input: {
      title: string;
      mdFiles: File[];
      images: File[];
      params: ProductionParams;
    }) => {
      if (input.images.length === 0) {
        say("请至少导入一张图片素材，再执行一键出片。", "agent");
        return;
      }
      dispatch({ type: "set_busy", busy: true });
      dispatch({ type: "set_phase", phase: "planning" });
      const projectId = uid("proj");
      emit({
        projectId,
        type: "agent.started",
        summary: "一键出片：解析素材",
        actor: "producer-agent",
      });

      // 1. read the markdown / text materials
      let script = "";
      for (const file of input.mdFiles) {
        try {
          script += `\n\n${await file.text()}`;
        } catch {
          /* ignore unreadable file */
        }
      }
      say(
        `已读取 ${input.mdFiles.length} 个文本素材、${input.images.length} 张图片，正在编排分镜…`,
        "agent",
      );

      // 2. import images into the asset store (source = imported)
      const assets: Asset[] = [];
      const images: { assetId: string; name: string; dataUrl: string }[] = [];
      for (const file of input.images) {
        if (!file.type.startsWith("image/")) continue;
        try {
          const dataUrl = await readFileAsDataUrl(file);
          const assetId = uid("asset");
          assets.push({
            assetId,
            projectId,
            source: "imported",
            mediaType: "image",
            version: 1,
            storageKey: `imports/${projectId}/${file.name}`,
            metadata: {
              name: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              dataUrl,
              remoteUrl: dataUrl,
            },
            state: "READY",
          });
          images.push({ assetId, name: file.name, dataUrl });
        } catch {
          /* skip bad image */
        }
      }
      if (images.length === 0) {
        say("图片素材读取失败，请检查文件格式。", "agent");
        dispatch({ type: "set_busy", busy: false });
        return;
      }

      // 3. build a storyboard, one shot per image, bound as first_frame
      const plan = planFromMaterials(
        {
          title: input.title,
          script,
          imageCount: images.length,
          params: input.params,
        },
        projectId,
      );
      const shots = plan.shots.map((shot, i) => {
        const img = images[i % images.length];
        const binding: AssetBinding = {
          bindingId: uid("bind"),
          shotId: shot.shotId,
          role: "first_frame",
          assetId: img.assetId,
          assetVersion: 1,
        };
        return {
          ...shot,
          bindings: [binding],
          spec: { ...shot.spec, referenceAssets: [img.assetId] },
        };
      });

      dispatch({
        type: "set_materials",
        project: {
          projectId,
          name: input.title || "一键出片项目",
          brief: plan.brief,
          createdAt: nowIso(),
          sceneIds: plan.scenes.map((s) => s.sceneId),
          stateVersion: 1,
        },
        brief: plan.brief,
        scenes: plan.scenes,
        shots,
        routings: Object.fromEntries(
          plan.scenes.map((s) => [s.sceneId, plan.routings[s.index] ?? []]),
        ),
        assets,
        production: input.params,
      });
      say(
        `素材编排完成：${shots.length} 个镜头（${plan.brief.aspectRatio} · ${plan.brief.durationS}s · ${input.params.steps} 步），开始生产。`,
        "agent",
      );
      emit({
        projectId,
        type: "step.completed",
        summary: `素材编排完成 · ${shots.length} 镜头`,
        actor: "producer-agent",
      });
      await sleep(120);
      dispatch({ type: "set_busy", busy: false });

      // 4. produce every shot, then optionally compose
      dispatch({ type: "set_phase", phase: "producing" });
      for (const shot of shots) {
        await generateShot(shot.shotId);
      }
      if (input.params.autoCompose) {
        await sleep(120);
        await compose({ allowPartial: true });
      }
      dispatch({ type: "set_phase", phase: "planned" });
      say("一键出片流程结束。", "agent");
    },
    [compose, emit, generateShot, say],
  );

  const reset = useCallback(() => {
    log.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    cancelRef.current = false;
    dispatch({ type: "reset" });
  }, [log]);

  // expose metrics helper through state
  const metricsState: Metrics = state.metrics;

  return {
    state: { ...state, metrics: metricsState },
    adapters,
    log,
    sseStatus,
    capabilities,
    guide,
    editShotPrompt,
    selectSkill,
    importAsset,
    bindAsset,
    unbindAsset,
    generateImage,
    generateShot,
    generateAll,
    regenerateShot,
    acceptCandidate,
    discardCandidate,
    restoreCandidate,
    cancel,
    review,
    compose,
    archive,
    produceFromMaterials,
    reset,
  };
}
