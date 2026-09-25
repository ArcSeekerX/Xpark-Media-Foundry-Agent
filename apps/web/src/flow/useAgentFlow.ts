import { useCallback, useMemo, useReducer, useRef } from "react";
import { createAdapters } from "../adapters";
import type { Adapters, GeneratedMedia, RenderHandle } from "../adapters/types";
import { refinePrompt } from "../agent/refine";
import { planProject } from "../agent/planner";
import { applySkill, bestSkill } from "../skills/router";
import { skillById } from "../skills/registry";
import { config } from "../config";
import { EventLog } from "./events";
import { initialState, reducer } from "./store";
import type { Metrics, State } from "./store";
import { nowIso, shortHash, sleep, uid } from "../lib/util";
import type {
  AgentMessage,
  Asset,
  FlowEvent,
  PromptSpec,
  RenderRequest,
  Run,
  ScoreReport,
  Shot,
} from "../types";

function makeAsset(
  media: GeneratedMedia,
  projectId: string,
  source: Asset["source"],
  metadata: Record<string, unknown> = {},
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
  };
}

export interface AgentFlow {
  state: State;
  adapters: Adapters;
  log: EventLog;
  guide: (sentence: string) => Promise<void>;
  editShotPrompt: (shotId: string, positive: string, negative: string) => void;
  selectSkill: (sceneId: string, skillId: string) => void;
  generateShot: (shotId: string) => Promise<void>;
  generateAll: () => Promise<void>;
  review: (shotId: string, verdict: "accept" | "reject") => void;
  compose: () => Promise<void>;
  archive: () => Promise<void>;
  reset: () => void;
}

export function useAgentFlow(): AgentFlow {
  const [state, dispatch] = useReducer(reducer, initialState);
  const store = useRef<State>(state);
  store.current = state;

  const log = useRef(new EventLog()).current;
  const adapters = useMemo(() => createAdapters(), []);

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
        shots: plan.shots,
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
    async (shotId: string) => {
      const snapshot = store.current;
      const shot = snapshot.shots.find((s) => s.shotId === shotId);
      const project = snapshot.project;
      if (!shot || !project) return;
      const scene = snapshot.scenes.find((s) => s.sceneId === shot.sceneId);
      const skill = skillById(shot.skillId) ?? bestSkill(scene?.synopsis ?? "").skill;

      const runId = uid("run");
      const run: Run = {
        runId,
        projectId: project.projectId,
        shotId,
        attemptId: uid("att"),
        commandId: uid("cmd"),
        state: "PROMPT_READY",
        seed: 20260000 + snapshot.shots.indexOf(shot),
        params: { steps: skill.params.steps, sampler: skill.params.sampler },
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
        // 1. prompt refine
        dispatch({ type: "set_run_phase", shotId, phase: "PROMPT_READY" });
        let promptSpec: PromptSpec = await refinePrompt(adapters.text, shot, scene!, skill);
        say(`镜头「${shot.title}」提示词已优化（${adapters.text.available ? "text-model" : "skill-template"}）。`, "agent");

        // 2. image condition (placeholder until a T2I model is installed)
        if (!adapters.image.available) {
          emit({
            projectId: project.projectId,
            runId,
            stepId,
            type: "tool.progress",
            summary: "生图适配器未启用（本机无文生图模型），跳过图像条件",
            actor: "image-adapter",
          });
        }

        // 3. render + QC + repair loop
        let accepted = false;
        for (let attempt = 0; attempt <= config.quality.maxRepairs; attempt += 1) {
          dispatch({ type: "set_run_phase", shotId, phase: "RENDERING" });
          emit({ projectId: project.projectId, runId, stepId, type: "agent.started", summary: `开始渲染（第 ${attempt + 1} 次）`, actor: adapters.video.name });
          const req: RenderRequest = {
            shotId,
            promptSpec,
            width: config.video.width,
            height: config.video.height,
            length: config.video.length,
            seed: run.seed! + attempt,
            steps: skill.params.steps,
            sampler: skill.params.sampler,
            refAssetIds: [],
            workflowHash: `wf:${shortHash(JSON.stringify(skill.params))}`,
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
            dispatch({ type: "set_run_phase", shotId, phase: "ACCEPTED" });
            dispatch({ type: "patch_shot", shotId, patch: { phase: "ACCEPTED", acceptedRunId: runId } });
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
    [adapters, emit, say, waitForRender],
  );

  const generateAll = useCallback(async () => {
    dispatch({ type: "set_phase", phase: "producing" });
    for (const shot of store.current.shots) {
      if (shot.phase === "ACCEPTED") continue;
      await generateShot(shot.shotId);
    }
    dispatch({ type: "set_phase", phase: "planned" });
  }, [generateShot]);

  // -------------------------------------------------------------------------
  // 3. Human review / compose / archive
  // -------------------------------------------------------------------------
  const review = useCallback(
    (shotId: string, verdict: "accept" | "reject") => {
      const shot = store.current.shots.find((s) => s.shotId === shotId);
      if (!shot) return;
      if (verdict === "accept") {
        dispatch({ type: "patch_shot", shotId, patch: { phase: "ACCEPTED" } });
        dispatch({ type: "bump", key: "acceptedShots" });
        say(`人工接受镜头「${shot.title}」。`, "agent");
      } else {
        dispatch({ type: "patch_shot", shotId, patch: { phase: "PLANNED" } });
        say(`人工拒绝镜头「${shot.title}」，已退回重新规划。`, "agent");
      }
    },
    [say],
  );

  const compose = useCallback(async () => {
    const snapshot = store.current;
    const project = snapshot.project;
    if (!project) return;
    const accepted = snapshot.shots.filter((s) => s.phase === "ACCEPTED");
    if (accepted.length !== snapshot.shots.length) {
      say(`还有 ${snapshot.shots.length - accepted.length} 个镜头未通过验收，暂不能合成交付。`, "agent");
      return;
    }
    dispatch({ type: "set_phase", phase: "composing" });
    emit({ projectId: project.projectId, type: "step.completed", summary: "开始合成成片", actor: "ffmpeg" });
    await sleep(800);
    const finalAsset: Asset = {
      assetId: uid("export"),
      projectId: project.projectId,
      source: "derived",
      mediaType: "video",
      version: 1,
      storageKey: `exports/${project.projectId}/final.mp4`,
      previewKey: `exports/${project.projectId}/final.jpg`,
      parentAssetIds: accepted
        .map((s) => s.acceptedRunId)
        .filter(Boolean)
        .map(String),
      metadata: {
        shots: accepted.length,
        aspectRatio: snapshot.brief?.aspectRatio,
        manifest: `exports/${project.projectId}/manifest.json`,
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
    say(`成片合成完成：${finalAsset.storageKey}（${accepted.length} 个镜头）。`, "agent");
  }, [emit, say]);

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

  const reset = useCallback(() => {
    log.clear();
    dispatch({ type: "reset" });
  }, [log]);

  // expose metrics helper through state
  const metricsState: Metrics = state.metrics;

  return {
    state: { ...state, metrics: metricsState },
    adapters,
    log,
    guide,
    editShotPrompt,
    selectSkill,
    generateShot,
    generateAll,
    review,
    compose,
    archive,
    reset,
  };
}
