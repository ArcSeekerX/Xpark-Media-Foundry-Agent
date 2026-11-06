/* Xpark digital asset pipeline — chat + asset library, no framework. */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const state = {
  messages: [],
  checklist: {},
  proposal: null,
  lastProposal: null,
  attachment: null,
  lastAttachmentId: "",
  lastFrame: null,
  lastFrameId: "",
  frameVideoId: "",
  jobs: [],
  jobCounts: {},
  assets: [],
  assetTotals: { video: 0, image: 0 },
  busy: false,
  status: null,
  lightboxId: "",
  knownAssetIds: new Set(),
  firstAssetsLoad: true,
  manage: false,
  selected: new Set(),
  panel: "assets",
  queueFilter: "all",
  conversations: [],
  conversationId: "",
  assetConv: "",
  assetOrder: "desc",
  assetPages: { video: 1, image: 1 },
  assetPageSize: { video: 50, image: 50 },
  skills: [],
  pendingSkills: [],
  skillPopOpen: false,
  skillIndex: 0,
  skillMatches: [],
  historyOpen: false,
};

const CHECKLIST_LABELS = {
  topic: "主题", subject: "主体", scene: "场景",
  style: "风格", duration: "时长", aspect: "画幅",
};

/* ----------------------------------------------------------------- api */
async function api(path, opts = {}) {
  const init = { ...opts };
  if (init.json !== undefined) {
    init.body = JSON.stringify(init.json);
    init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    delete init.json;
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

/* -------------------------------------------------------------- helpers */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtClock(epoch) {
  if (!epoch) return "--:--:--";
  const d = new Date(epoch * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtElapsed(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtDuration(s) {
  if (!s) return "";
  return s >= 10 ? `${Math.round(s)}s` : `${Number(s).toFixed(1)}s`;
}

function fmtSize(bytes) {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function toast(text, kind = "") {
  const el = $("#toast");
  el.textContent = (kind === "ok" ? "✓ " : kind === "err" ? "! " : "") + text;
  el.className = `toast ${kind}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 3400);
}

const JOB_LABEL = {
  queued: "排队中", running: "渲染中", succeeded: "已完成",
  failed: "失败", cancelled: "已取消",
};

function jobStageIndex(job) {
  if (job.status === "queued") return 0;
  if (job.status === "succeeded") return 3;
  if (job.status === "failed" || job.status === "cancelled") return -1;
  const stage = job.stage || "";
  if (stage.includes("下载") || stage.includes("入库")) return 2;
  if (job.progress >= 8 || stage.includes("渲染")) return 1;
  return 0;
}

function jobRail(job) {
  const idx = jobStageIndex(job);
  const stages = job.kind === "image" ? ["排队", "生成", "入库"] : ["排队", "渲染", "入库"];
  return `<div class="job-rail">` + stages.map((label, i) => {
    const cls = idx === 3 || i < idx ? "done" : i === idx ? "active" : "";
    const node = `<span class="node ${cls}"><i></i>${label}</span>`;
    return node + (i < stages.length - 1 ? `<span class="link"></span>` : "");
  }).join("") + `</div>`;
}

/* ----------------------------------------------------------------- chat */
function nearBottom() {
  const list = $("#chat-list");
  return list.scrollTop + list.clientHeight >= list.scrollHeight - 90;
}

function scrollBottom(force = false) {
  const list = $("#chat-list");
  if (force || nearBottom()) list.scrollTop = list.scrollHeight;
}

function setChatStatus(text) {
  $("#chat-status").textContent = text;
}

function renderChat(opts = {}) {
  const list = $("#chat-list");
  const intro = $("#chat-intro");
  const stick = opts.stick !== undefined ? opts.stick : nearBottom();
  intro.classList.toggle("hidden", state.messages.length > 0);

  const bound = list.scrollTop;
  list.querySelectorAll(".msg, .proposal, .typing-row").forEach((el) => el.remove());
  let html = "";
  state.messages.forEach((m) => { html += renderMessage(m); });
  if (state.proposal) html += proposalCard(state.proposal);
  if (state.busy) {
    html += `<div class="msg typing-row"><span class="avatar">导</span>
      <div class="msg-body"><div class="bubble typing">
        <span class="tdots"><i></i><i></i><i></i></span>正在理解你的想法…</div></div></div>`;
  }
  list.insertAdjacentHTML("beforeend", html);
  bindChatEvents();
  renderChecklist();
  if (stick) list.scrollTop = list.scrollHeight;
  else list.scrollTop = Math.min(bound, list.scrollHeight);
  $("#chat-send").disabled = state.busy;
}

function renderMessage(m) {
  const mine = m.role === "user";
  const avatar = mine ? "我" : "导";
  const parts = [];
  if (m.content || m.attach || (m.skills && m.skills.length)) {
    let inner = esc(m.content);
    if (m.attach) {
      inner += `<div class="attach-inline"><img src="${m.attach.file_url}" alt=""><span>参考图 · ${esc(m.attach.title || "已附图")}</span></div>`;
    }
    if (m.skills && m.skills.length) {
      inner += `<div class="skill-tags">${m.skills.map((s) =>
        `<span class="skill-tag">⚡ ${esc(s)}</span>`).join("")}</div>`;
    }
    parts.push(`<div class="bubble">${inner}</div>`);
  }
  if (m.jobId) {
    const job = state.jobs.find((j) => j.id === m.jobId);
    if (job) parts.push(jobCard(job));
  }
  return `<div class="msg ${mine ? "user" : "bot"}">
    <span class="avatar">${avatar}</span>
    <div class="msg-body">${parts.join("")}<span class="msg-time">${fmtClock(m.ts)}</span></div>
  </div>`;
}

function proposalCard(p) {
  const chips = [
    p.style ? `<span class="chip">${esc(p.style)}</span>` : "",
    `<span class="chip hot">${esc(p.duration_s)} 秒</span>`,
    `<span class="chip hot">${esc(p.aspect)}</span>`,
  ].join("");
  return `<div class="proposal">
    <div class="proposal-eyebrow">RENDER PROPOSAL · 待确认</div>
    <div class="proposal-head"><b>${esc(p.title || "未命名视频")}</b></div>
    ${p.summary ? `<p class="proposal-summary">${esc(p.summary)}</p>` : ""}
    <div class="chips">${chips}</div>
    <details><summary>查看英文提示词</summary>
      <pre class="proposal-prompt">${esc(p.prompt)}</pre></details>
    <div class="proposal-actions">
      <button class="btn ghost small" data-act="tweak">继续修改</button>
      <button class="btn ghost" data-act="refs" title="用 Qwen-Image 2.1 先生成 4 张参考图（每张约 3 分钟），挑一张再出片">先生成参考图</button>
      <button class="btn primary" data-act="generate">生成视频</button>
    </div></div>`;
}

function jobCard(job) {
  const elapsedEnd = job.finished_at || (Date.now() / 1000);
  const elapsed = job.started_at ? elapsedEnd - job.started_at : 0;
  const running = job.status === "queued" || job.status === "running";
  const isImage = job.kind === "image";
  const refs = isImage
    ? state.assets.filter((a) => a.job_id === job.id && a.kind === "image") : [];
  const preview = !isImage && job.status === "succeeded" && job.asset_id
    ? `<div class="job-preview"><video src="/api/assets/${job.asset_id}/file"
         poster="/api/assets/${job.asset_id}/poster" controls preload="metadata"></video></div>` : "";
  const refGrid = isImage && job.status === "succeeded" && refs.length
    ? `<div class="job-refs">${refs.map((a) =>
        `<img src="${a.file_url}" data-open="${a.id}" alt="" title="${esc(a.title)}">`).join("")}</div>` : "";
  const openTarget = isImage ? (refs[0] ? refs[0].id : "") : job.asset_id;
  const actions = `
    ${running ? `<button class="btn ghost small" data-cancel="${job.id}">停止</button>` : ""}
    ${job.status === "succeeded" && openTarget
      ? `<button class="btn ghost small" data-open="${openTarget}">查看${isImage ? "参考图" : "作品"}</button>` : ""}`;
  return `<div class="job ${job.status}">
    <div class="job-top">
      <span class="job-title">${esc(job.title || (isImage ? "参考图" : "未命名视频"))}</span>
      <span class="job-status ${job.status}">${JOB_LABEL[job.status] || job.status}</span>
    </div>
    ${jobRail(job)}
    <div class="job-bar"><i style="width:${job.status === "succeeded" ? 100 : Math.max(3, job.progress || 0)}%"></i></div>
    <div class="job-meta">
      <span class="job-stage">${esc(job.error || job.stage || "")}</span>
      ${job.status !== "queued" ? `<span class="job-elapsed" data-job="${job.id}">${fmtElapsed(elapsed)}</span>` : ""}
    </div>
    ${preview}${refGrid}
    ${actions ? `<div class="job-actions">${actions}</div>` : ""}
  </div>`;
}

function bindChatEvents() {
  $$("#chat-list [data-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.act === "generate") generateFromProposal();
      if (btn.dataset.act === "refs") generateReferenceImages();
      if (btn.dataset.act === "tweak") {
        $("#chat-input").focus();
        toast("直接说想改哪里，比如「换成夜晚」「再快一点」");
      }
    });
  });
  $$("#chat-list [data-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => cancelJob(btn.dataset.cancel));
  });
  $$("#chat-list [data-open]").forEach((btn) => {
    btn.addEventListener("click", () => openLightbox(btn.dataset.open));
  });
}

function renderChecklist() {
  const box = $("#chat-checklist");
  const keys = Object.keys(CHECKLIST_LABELS);
  if (!keys.some((k) => state.checklist[k])) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.innerHTML = keys.map((k) => {
    const v = state.checklist[k] || "";
    return `<span class="ck ${v ? "done" : ""}"><b>${CHECKLIST_LABELS[k]}</b>${v ? esc(v) : "待聊"}</span>`;
  }).join("");
  box.classList.remove("hidden");
}

/* ----------------------------------------------------------- chat flow */
async function sendMessage() {
  const input = $("#chat-input");
  const text = input.value.trim();
  if (state.busy || (!text && !state.attachment)) return;
  const attachment = state.attachment;
  const lastFrame = state.lastFrame;
  const usedSkills = [...state.pendingSkills];
  state.messages.push({
    role: "user", content: text || "（附了一张参考图）", ts: Date.now() / 1000,
    attach: attachment || undefined,
    skills: usedSkills.length ? usedSkills : undefined,
  });
  state.pendingSkills = [];
  renderSkillChips();
  if (attachment) state.lastAttachmentId = attachment.id;
  if (lastFrame) state.lastFrameId = lastFrame.id;
  state.attachment = null;
  state.lastFrame = null;
  state.proposal = null;
  input.value = "";
  autoGrow(input);
  state.busy = true;
  renderAttachChip();
  renderChat({ stick: true });
  setChatStatus("正在理解你的想法…");
  try {
    const res = await api("/api/chat", {
      method: "POST",
      json: {
        conversation_id: state.conversationId,
        content: text || "（附了一张参考图）",
        attachment_asset_id: attachment ? attachment.id : "",
        last_frame_asset_id: lastFrame ? lastFrame.id : "",
        reference_note: lastFrame
          ? "用户正在基于参考视频重做：已附带参考帧（首帧/尾帧）。proposal.prompt 要锁定主体、构图与起止画面，只按用户描述修改变化的部分（光线/动作/节奏等），其余保持一致。"
          : "",
        skills: usedSkills,
      },
    });
    if (res.conversation_id) {
      state.conversationId = res.conversation_id;
      setConvKey(res.conversation_id);
    }
    if (res.checklist) state.checklist = res.checklist;
    state.messages.push({
      role: "assistant", content: res.reply || "…", ts: Date.now() / 1000,
      jobId: res.job ? res.job.id : undefined,
    });
    if (res.proposal && res.proposal.prompt) {
      state.proposal = res.proposal;
      state.lastProposal = res.proposal;
    }
    if (res.job) {
      upsertJob(res.job);
      toast(`已提交生成《${res.job.title}》，在对话里看进度`, "ok");
    }
  } catch (err) {
    state.messages.push({
      role: "assistant", content: "出错了：" + err.message, ts: Date.now() / 1000,
    });
  } finally {
    state.busy = false;
    setChatStatus("在线 · 说想法，我来出片");
    renderChat({ stick: true });
    refreshJobs();
    refreshConversations();
    $("#chat-input").focus();
  }
}

async function generateFromProposal() {
  if (!state.proposal) return;
  const p = state.proposal;
  state.proposal = null;
  try {
    const job = await api("/api/jobs", {
      method: "POST",
      json: {
        title: p.title, prompt: p.prompt, duration_s: p.duration_s,
        aspect: p.aspect,
        first_frame_asset_id: state.lastAttachmentId || "",
        last_frame_asset_id: state.lastFrameId || "",
        conversation_id: state.conversationId,
      },
    });
    state.messages.push({
      role: "assistant", content: `已提交生成《${job.title}》，渲染约 5~15 分钟，完成后自动入库。`,
      ts: Date.now() / 1000, jobId: job.id,
    });
    upsertJob(job);
    toast("已进入渲染队列", "ok");
  } catch (err) {
    state.proposal = p;
    toast("提交失败：" + err.message, "err");
  }
  renderChat({ stick: true });
  refreshJobs();
}

async function generateReferenceImages() {
  if (!state.proposal) return;
  const p = state.proposal;
  try {
    const job = await api("/api/images", {
      method: "POST",
      json: {
        title: p.title,
        prompt: p.image_prompt || p.summary || p.prompt,
        count: 4,
        aspect: p.aspect,
        conversation_id: state.conversationId,
      },
    });
    state.messages.push({
      role: "assistant",
      content: `已先排 4 张参考图（Qwen-Image 2.1），每张约 3 分钟，完成后挑一张就能出片。`,
      ts: Date.now() / 1000, jobId: job.id,
    });
    upsertJob(job);
    toast("参考图任务已进入流水线", "ok");
  } catch (err) {
    toast("提交失败：" + err.message, "err");
  }
  renderChat({ stick: true });
  refreshJobs();
}

async function cancelJob(jobId) {
  try {
    await api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
    toast("已请求停止");
    refreshJobs();
  } catch (err) {
    toast("取消失败：" + err.message, "err");
  }
}

function upsertJob(job) {
  const idx = state.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) state.jobs[idx] = job;
  else state.jobs.unshift(job);
}

function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 132) + "px";
}

/* ------------------------------------------------------------- polling */
let lastJobsJson = "";
async function refreshJobs() {
  try {
    const res = await api("/api/jobs?limit=100");
    const counts = res.counts || {};
    state.jobCounts = counts;
    const activeCount = (counts.queued || 0) + (counts.running || 0);
    const badge = $("#queue-badge");
    if (badge) {
      badge.textContent = activeCount || "";
      badge.classList.toggle("hidden", !activeCount);
    }
    const json = JSON.stringify(res.jobs);
    if (json === lastJobsJson) return;
    const prev = new Map(state.jobs.map((j) => [j.id, j.status]));
    state.jobs = res.jobs;
    lastJobsJson = json;
    let finished = false;
    state.jobs.forEach((j) => {
      if (prev.get(j.id) && prev.get(j.id) !== j.status && j.status === "succeeded") {
        finished = true;
        toast(j.kind === "image" ? `《${j.title}》参考图已入库` : `《${j.title}》渲染完成`, "ok");
      }
    });
    const hasActive = activeCount > 0;
    setChatStatus(hasActive ? "渲染中 · 进度在对话里" : "在线 · 说想法，我来出片");
    renderChat();
    if (state.panel === "queue") renderQueue();
    if (finished) refreshAssets();
  } catch (_) {}
}

let lastAssetsJson = "";
async function refreshAssets() {
  try {
    const conv = resolvedConvFilter();
    const responses = await Promise.all(["video", "image"].map((kind) => {
      const params = new URLSearchParams({
        kind,
        limit: String(state.assetPageSize[kind] || 50),
        offset: String(((state.assetPages[kind] || 1) - 1) * (state.assetPageSize[kind] || 50)),
        order: state.assetOrder,
      });
      if (conv) params.set("conversation_id", conv);
      return api(`/api/assets?${params}`);
    }));
    const assets = responses.flatMap((res) => res.assets);
    const json = JSON.stringify(assets);
    if (json === lastAssetsJson) return;
    const fresh = assets.filter((a) => !state.knownAssetIds.has(a.id));
    const firstLoad = state.firstAssetsLoad;
    assets.forEach((a) => state.knownAssetIds.add(a.id));
    const alive = new Set(assets.map((a) => a.id));
    [...state.selected].forEach((id) => { if (!alive.has(id)) state.selected.delete(id); });
    state.assets = assets;
    state.assetTotals.video = responses[0].total;
    state.assetTotals.image = responses[1].total;
    lastAssetsJson = json;
    state.firstAssetsLoad = false;
    renderAssets(firstLoad ? [] : fresh.map((a) => a.id));
  } catch (_) {}
}

async function refreshStatus() {
  try {
    const s = await api("/api/status");
    state.status = s;
    const chip = $("#comfy-status");
    chip.className = "status-chip " + (s.online ? "online" : "offline");
    chip.querySelector("span").textContent = s.online ? "渲染引擎 在线" : "渲染引擎 离线";
    const qwen = s.qwen || {};
    const qchip = $("#qwen-chip");
    qchip.className = "status-chip " + (qwen.online ? "online" : "offline");
    qchip.querySelector("span").textContent = qwen.online
      ? (qwen.loaded ? "绘图引擎 已就绪" : "绘图引擎 在线") : "绘图引擎 离线";
    $("#queue-chip").textContent = s.online
      ? `队列 ${(s.queue.running || 0) + (s.queue.pending || 0)}` : "队列 —";
  } catch (_) {
    const chip = $("#comfy-status");
    chip.className = "status-chip offline";
    chip.querySelector("span").textContent = "渲染引擎 离线";
  }
}

/* -------------------------------------------------------------- assets */
function navAssets() {
  const current = state.assets.find((a) => a.id === state.lightboxId);
  if (!current) return state.assets;
  return state.assets.filter((a) => a.kind === current.kind);
}

function renderSkeletons() {
  const grid = $("#assets-grid");
  grid.innerHTML = `<div class="asset-section-grid">` +
    Array.from({ length: 6 }, () =>
      `<div class="skeleton-card"><div class="skeleton-thumb"></div>
       <div class="skeleton-line"></div><div class="skeleton-line short"></div></div>`).join("") +
    `</div>`;
}

function assetSection(label, kind, items, newIds) {
  const pageSize = state.assetPageSize[kind] || 30;
  const total = state.assetTotals[kind] || 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(state.assetPages[kind] || 1, pageCount);
  state.assetPages[kind] = page;
  const body = items.length
    ? `<div class="asset-section-grid">${items.map((a) => assetCard(a, newIds.includes(a.id))).join("")}</div>`
    : `<div class="asset-section-empty">暂无${label}</div>`;
  const pager = total > pageSize ? assetPager(kind, page, pageCount, pageSize) : "";
  return `<section class="asset-section">
    <div class="asset-section-head"><span class="sec-dot ${kind}"></span><b>${label}</b><i>${total} 个</i></div>
    ${body}${pager}</section>`;
}

function assetPager(kind, page, pageCount, pageSize) {
  const buttons = [];
  for (let i = 1; i <= pageCount; i += 1) {
    if (pageCount > 7 && i > 2 && i < pageCount - 1 && Math.abs(i - page) > 1) {
      if (buttons[buttons.length - 1] !== "…") buttons.push("…");
      continue;
    }
    buttons.push(i);
  }
  return `<div class="asset-pager" data-kind="${kind}">
    <button class="btn ghost small" data-page-action="prev" ${page <= 1 ? "disabled" : ""}>上一页</button>
    <div class="asset-page-numbers">${buttons.map((item) => item === "…"
      ? `<span class="asset-page-gap">…</span>`
      : `<button class="asset-page ${item === page ? "active" : ""}" data-page="${item}">${item}</button>`).join("")}</div>
    <button class="btn ghost small" data-page-action="next" ${page >= pageCount ? "disabled" : ""}>下一页</button>
    <span class="asset-page-status">第 ${page} / ${pageCount} 页</span>
    <label class="asset-page-size">每页
      <select class="dialog-select slim" data-page-size>
        ${[30, 50, 100].map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`).join("")}
      </select>
    </label>
  </div>`;
}

function bindAssetCards(grid) {
  $$(".asset", grid).forEach((el) => {
    el.addEventListener("click", () => {
      if (state.manage) toggleSelect(el.dataset.id);
      else openLightbox(el.dataset.id);
    });
    const asset = state.assets.find((x) => x.id === el.dataset.id);
    if (asset) bindDragSource(el, asset);
  });
  $$(".asset-del", grid).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteAsset(btn.dataset.del);
    });
  });
  $$(".asset-pager", grid).forEach((pager) => {
    const kind = pager.dataset.kind;
    pager.querySelectorAll("[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.assetPages[kind] = Number(btn.dataset.page);
        refreshAssets();
      });
    });
    pager.querySelector("[data-page-action=prev]")?.addEventListener("click", () => {
      state.assetPages[kind] = Math.max(1, (state.assetPages[kind] || 1) - 1);
      refreshAssets();
    });
    pager.querySelector("[data-page-action=next]")?.addEventListener("click", () => {
      state.assetPages[kind] += 1;
      refreshAssets();
    });
    pager.querySelector("[data-page-size]")?.addEventListener("change", (event) => {
      state.assetPageSize[kind] = Number(event.target.value);
      state.assetPages[kind] = 1;
      refreshAssets();
    });
  });
}

function renderAssets(newIds = []) {
  const grid = $("#assets-grid");
  const videos = state.assets.filter((a) => a.kind === "video");
  const images = state.assets.filter((a) => a.kind === "image");
  const videoTotal = state.assetTotals.video;
  const imageTotal = state.assetTotals.image;
  const filtered = !!resolvedConvFilter();
  $("#assets-summary").textContent =
    `${videoTotal + imageTotal} 件 · 视频 ${videoTotal} · 图片 ${imageTotal}`
    + (filtered ? " · 按会话筛选" : "");
  $("#vault-chip").textContent = filtered
    ? `筛选 ${videoTotal + imageTotal}` : `资产 ${videoTotal + imageTotal}`;
  if (!videoTotal && !imageTotal) {
    grid.innerHTML = `<div class="assets-empty">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
        <rect x="6" y="10" width="26" height="20" rx="4"/><path d="M13 38h22a4 4 0 0 0 4-4V16"/>
        <path d="M16 20l6 4-6 4z" fill="currentColor" stroke="none"/></svg>
      <b>还没有数字资产</b>
      在左边和导演助理聊一条视频，生成的成片和参考图都会出现在这里。</div>`;
    return;
  }
  grid.classList.toggle("managing", state.manage);
  grid.innerHTML = assetSection("视频", "video", videos, newIds) +
                   assetSection("图片", "image", images, newIds);
  bindAssetCards(grid);
  syncBulkBar(state.assets.length);
}

function syncBulkBar(filteredCount) {
  const bulk = $("#assets-bulk");
  const show = state.manage && state.panel === "assets";
  bulk.classList.toggle("hidden", !show);
  document.body.classList.toggle("bulk-open", show);
  if (!show) return;
  $("#bulk-count").textContent = `已选 ${state.selected.size} / ${filteredCount} 件`;
  $("#bulk-select-all").textContent =
    state.selected.size === filteredCount && filteredCount > 0 ? "取消全选" : "全选";
  $("#bulk-delete").disabled = !state.selected.size;
}

function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  // incremental update: no grid rebuild (keeps scroll + avoids image flicker)
  const card = document.querySelector(`#assets-grid .asset[data-id="${id}"]`);
  if (card) card.classList.toggle("selected", state.selected.has(id));
  syncBulkBar(document.querySelectorAll("#assets-grid .asset").length);
}

function toggleManage(force) {
  state.manage = force !== undefined ? force : !state.manage;
  state.selected.clear();
  $("#assets-manage").textContent = state.manage ? "完成" : "管理";
  $("#assets-manage").classList.toggle("active", state.manage);
  renderAssets();
}

async function deleteAsset(id) {
  const a = state.assets.find((x) => x.id === id);
  if (!a) return;
  const scope = a.external
    ? "该资产来自外部目录，删除会同时物理删除源文件"
    : "文件将从本地资产库物理删除";
  const ok = await askConfirm("删除资产",
    `《${a.title || a.id}》将被删除：${scope}，不可恢复。`);
  if (!ok) return;
  try {
    const res = await api(`/api/assets/${id}`, { method: "DELETE" });
    state.assets = state.assets.filter((x) => x.id !== id);
    state.selected.delete(id);
    if (state.lightboxId === id) closeLightbox();
    lastAssetsJson = "";
    renderAssets();
    toast(res.origin_deleted ? "已删除（含源文件）" : "已删除", "ok");
  } catch (err) {
    toast("删除失败：" + err.message, "err");
  }
}

async function deleteSelected() {
  const ids = [...state.selected];
  if (!ids.length) return;
  const ok = await askConfirm("批量删除",
    `删除所选 ${ids.length} 件资产？本地产物与外部源文件都会被物理删除，不可恢复。`);
  if (!ok) return;
  try {
    await Promise.all(ids.map((id) => api(`/api/assets/${id}`, { method: "DELETE" })));
    state.assets = state.assets.filter((x) => !state.selected.has(x.id));
    toast(`已删除 ${ids.length} 件资产`, "ok");
    toggleManage(false);
  } catch (err) {
    lastAssetsJson = "";
    refreshAssets();
    toast("部分删除失败：" + err.message, "err");
  }
}

function assetCard(a, isNew) {
  const thumb = a.kind === "video"
    ? (a.poster_url
        ? `<img src="${a.poster_url}" alt="" loading="lazy">`
        : `<video src="${a.file_url}#t=0.2" preload="metadata" muted playsinline></video>`)
    : `<img src="${a.file_url}" alt="" loading="lazy">`;
  const badge = a.kind === "video"
    ? `<span class="asset-badge">VIDEO</span>`
    : `<span class="asset-badge img">IMAGE</span>`;
  const dur = a.kind === "video" && a.duration_s
    ? `<span class="asset-dur">${fmtDuration(a.duration_s)}</span>` : "";
  const play = a.kind === "video" ? `<div class="asset-play"><span>▶</span></div>` : "";
  const source = a.source === "uploaded" ? "上传"
    : a.source === "sample" ? "示例"
    : a.source === "imported" ? "外部"
    : a.source === "derived" ? "衍生" : "AI 生成";
  const qc = a.qc && a.qc.verdict
    ? ` <i class="qc-badge ${a.qc.verdict}" title="${esc(a.qc.note || "AI 质检")}">`
      + (a.qc.verdict === "pass" ? "质检✓" : a.qc.verdict === "warn" ? "质检!" : "质检✕")
      + `</i>` : "";
  const res = a.width && a.height ? `<span class="res">${a.width}×${a.height}</span>` : "";
  const selected = state.selected.has(a.id);
  const check = state.manage ? `<span class="asset-check">✓</span>` : "";
  const del = `<button class="asset-del" data-del="${a.id}" title="删除资产" aria-label="删除资产"><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M4.5 6.5h11M8 6V4.8A.8.8 0 0 1 8.8 4h2.4a.8.8 0 0 1 .8.8V6M6 6.5l.6 8.2a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>`;
  return `<div class="asset ${isNew ? "new" : ""} ${selected ? "selected" : ""}" data-id="${a.id}" title="${esc(a.prompt || a.title)}">
    <div class="asset-thumb">${thumb}${badge}${check}${del}${dur}${play}</div>
    <div class="asset-info">
      <div class="asset-title">${esc(a.title || "未命名")}</div>
      <div class="asset-sub"><span>${esc(source)}${res ? " · " : ""}${res}${qc}</span><span>${fmtClock(a.created_at)}</span></div>
    </div></div>`;
}

function openLightbox(assetId) {
  const a = state.assets.find((x) => x.id === assetId);
  if (!a) return;
  state.lightboxId = assetId;
  $("#lightbox-media-slot").innerHTML = a.kind === "video"
    ? `<video src="${a.file_url}" poster="${a.poster_url}" controls autoplay playsinline></video>`
    : `<img src="${a.file_url}" alt="${esc(a.title)}">`;
  const list = navAssets();
  const idx = list.findIndex((x) => x.id === assetId);
  $("#lb-counter").textContent = list.length > 1 ? `${idx + 1} / ${list.length}` : "";
  $("#lb-prev").disabled = idx <= 0;
  $("#lb-next").disabled = idx < 0 || idx >= list.length - 1;
  $("#lb-title").textContent = a.title || "未命名";
  const chips = [
    a.kind === "video" ? "视频" : "图片",
    a.kind === "video" && a.duration_s ? fmtDuration(a.duration_s) : "",
    a.width && a.height ? `${a.width}×${a.height}` : "",
    fmtSize(a.size_bytes),
    fmtClock(a.created_at),
    a.source === "uploaded" ? "上传" : a.source === "sample" ? "示例资产" : "AI 生成",
  ].filter(Boolean).map((t) => `<span class="chip">${esc(t)}</span>`).join("");
  const qcv = a.qc && a.qc.verdict ? a.qc.verdict : "";
  const qcChip = qcv
    ? `<span class="chip qc-${qcv}" title="${esc((a.qc && a.qc.note) || "")}">质检`
      + (qcv === "pass" ? " 通过" : qcv === "warn" ? " 有瑕疵" : " 未通过") + `</span>` : "";
  const qcNote = qcv && qcv !== "pass" && a.qc
    ? `<div class="lb-qc-note ${qcv}">${esc((a.qc.issues || []).join("；") || a.qc.note || "")}</div>` : "";
  $("#lb-chips").innerHTML = chips + qcChip + qcNote;
  $("#lb-prompt").textContent = a.prompt || "（无提示词）";
  const dl = $("#lb-download");
  dl.href = a.file_url;
  dl.setAttribute("download", `${a.title || a.id}.${a.kind === "video" ? "mp4" : "png"}`);
  $("#lb-use-video").classList.toggle("hidden", a.kind !== "image");
  $("#lb-edit").classList.toggle("hidden", a.kind !== "image");
  $("#lb-video-ref").classList.toggle("hidden", a.kind !== "video");
  $("#lb-post").classList.toggle("hidden", a.kind !== "video");
  $("#lightbox").classList.remove("hidden");
}

/* ----------------------------------------------- reference-frame remake */
function openFrameDialog(videoId) {
  const video = state.assets.find((a) => a.id === videoId);
  if (!video || video.kind !== "video") return;
  state.frameVideoId = videoId;
  $("#frame-dialog-title").textContent = `以《${video.title || "视频"}》为参考重做`;
  $("#frame-dialog").classList.remove("hidden");
}

function closeFrameDialog() {
  state.frameVideoId = "";
  $("#frame-dialog").classList.add("hidden");
}

async function chooseFrame(mode) {
  const video = state.assets.find((a) => a.id === state.frameVideoId);
  if (!video) return;
  closeFrameDialog();
  const wantFirst = mode === "first" || mode === "firstlast";
  const wantLast = mode === "last" || mode === "firstlast";
  toast("正在抽取参考帧…");
  try {
    const conv = state.conversationId;
    const first = wantFirst
      ? await api(`/api/assets/${video.id}/frame`, { method: "POST", json: { position: "first", conversation_id: conv } })
      : null;
    const last = wantLast
      ? await api(`/api/assets/${video.id}/frame`, { method: "POST", json: { position: "last", conversation_id: conv } })
      : null;
    if (!wantFirst && !wantLast) {
      const mid = await api(`/api/assets/${video.id}/frame`, { method: "POST", json: { position: "middle", conversation_id: conv } });
      state.attachment = mid;
      state.lastAttachmentId = mid.id;
      state.lastFrame = null;
      state.lastFrameId = "";
    } else {
      state.attachment = first;
      state.lastAttachmentId = first ? first.id : "";
      state.lastFrame = last;
      state.lastFrameId = last ? last.id : "";
    }
    renderAttachChip();
    closeLightbox();
    lastAssetsJson = "";
    refreshAssets();
    const desc = state.lastFrame ? "首尾帧已锁定" : "参考帧已就绪";
    toast(`${desc}：说说要改哪里，发送即重新生成`, "ok");
    $("#chat-input").focus();
  } catch (err) {
    toast("抽帧失败：" + err.message, "err");
  }
}

async function useImageForVideo() {
  const a = state.assets.find((x) => x.id === state.lightboxId);
  if (!a || a.kind !== "image") return;
  const p = state.proposal || state.lastProposal;
  if (!p || !p.prompt) {
    toast("先在对话里描述想要的视频，再用参考图出片");
    return;
  }
  try {
    const job = await api("/api/jobs", {
      method: "POST",
      json: {
        title: p.title || a.title, prompt: p.prompt,
        duration_s: p.duration_s || 5, aspect: p.aspect || "16:9",
        first_frame_asset_id: a.id,
        conversation_id: state.conversationId,
      },
    });
    closeLightbox();
    state.messages.push({
      role: "assistant",
      content: `已用参考图《${a.title}》提交图生视频《${job.title}》，渲染约 5~15 分钟。`,
      ts: Date.now() / 1000, jobId: job.id,
    });
    upsertJob(job);
    renderChat({ stick: true });
    refreshJobs();
    toast("已提交图生视频", "ok");
  } catch (err) {
    toast("提交失败：" + err.message, "err");
  }
}

function closeLightbox() {
  state.lightboxId = "";
  $("#lightbox").classList.add("hidden");
  $("#lightbox-media-slot").innerHTML = "";
}

function navLightbox(step) {
  const list = navAssets();
  const idx = list.findIndex((x) => x.id === state.lightboxId);
  if (idx < 0) return;
  const next = list[idx + step];
  if (next) openLightbox(next.id);
}

async function runAssetQC() {
  const a = state.assets.find((x) => x.id === state.lightboxId);
  if (!a) return;
  try {
    toast("正在质检（首次会加载视觉模型，稍等）…");
    const res = await api(`/api/assets/${a.id}/qc`, { method: "POST" });
    a.qc = res.qc;
    openLightbox(a.id);
    lastAssetsJson = "";
    refreshAssets();
    toast(res.qc.verdict === "pass" ? "质检通过" :
          res.qc.verdict === "warn" ? "质检：有瑕疵" : "质检：未通过",
          res.qc.verdict === "pass" ? "ok" : "err");
  } catch (err) {
    toast("质检失败：" + err.message, "err");
  }
}

async function sendToFeishu() {
  const a = state.assets.find((x) => x.id === state.lightboxId);
  if (!a) return;
  try {
    toast("正在发送到飞书…");
    await api(`/api/assets/${a.id}/feishu`, { method: "POST" });
    toast("已发送到飞书", "ok");
  } catch (err) {
    toast("发送失败：" + err.message, "err");
  }
}

async function deleteCurrentAsset() {
  const id = state.lightboxId;
  if (!id) return;
  closeLightbox();
  await deleteAsset(id);
}

/* --------------------------------------------------- confirm dialog */
let confirmResolve = null;

function askConfirm(title, text, okText = "删除") {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    $("#confirm-ok").textContent = okText;
    $("#confirm").classList.remove("hidden");
    $("#confirm-cancel").focus();
  });
}

function settleConfirm(value) {
  if (!confirmResolve) return;
  const resolve = confirmResolve;
  confirmResolve = null;
  $("#confirm").classList.add("hidden");
  resolve(value);
}

/* ---------------------------------------------------------- attachment */
function renderAttachChip() {
  const chip = $("#attach-chip");
  const lastChip = $("#attach-chip-last");
  if (!state.attachment) {
    chip.classList.add("hidden");
    chip.innerHTML = "";
  } else {
    chip.innerHTML = `<img src="${state.attachment.file_url}" alt="">
      <span>首帧 · ${esc(state.attachment.title || "已附图")}</span>
      <button title="移除">✕</button>`;
    chip.classList.remove("hidden");
    chip.querySelector("button").addEventListener("click", () => {
      state.attachment = null;
      state.lastAttachmentId = "";
      renderAttachChip();
    });
  }
  if (!state.lastFrame) {
    lastChip.classList.add("hidden");
    lastChip.innerHTML = "";
  } else {
    lastChip.innerHTML = `<img src="${state.lastFrame.file_url}" alt="">
      <span>尾帧 · ${esc(state.lastFrame.title || "已附图")}</span>
      <button title="移除">✕</button>`;
    lastChip.classList.remove("hidden");
    lastChip.querySelector("button").addEventListener("click", () => {
      state.lastFrame = null;
      state.lastFrameId = "";
      renderAttachChip();
    });
  }
}

async function uploadAttachment(file) {
  const form = new FormData();
  form.append("file", file);
  if (state.conversationId) form.append("conversation_id", state.conversationId);
  toast("上传参考图…");
  try {
    const asset = await api("/api/assets/upload", { method: "POST", body: form });
    state.attachment = asset;
    renderAttachChip();
    lastAssetsJson = "";
    refreshAssets();
    toast("参考图已就绪，将以图生视频", "ok");
  } catch (err) {
    toast("上传失败：" + err.message, "err");
  }
}

/* -------------------------------------------------------- conversations */
const NEW_CONV = "__new__";
function convKey() {
  try { return localStorage.getItem("xp-conv") || ""; } catch (_) { return ""; }
}
function setConvKey(id) {
  try { id ? localStorage.setItem("xp-conv", id) : localStorage.removeItem("xp-conv"); } catch (_) {}
}

async function refreshConversations() {
  try {
    const res = await api("/api/conversations");
    state.conversations = res.conversations || [];
    if (state.historyOpen) renderHistory();
    buildConvOptions();
  } catch (_) {}
}

function buildConvOptions() {
  const sel = $("#asset-conv-filter");
  if (!sel) return;
  const opts = ['<option value="">全部资产</option>',
                '<option value="current">当前会话</option>'];
  state.conversations.forEach((c) => {
    opts.push(`<option value="${c.id}">${esc((c.title || c.id).slice(0, 18))}</option>`);
  });
  sel.innerHTML = opts.join("");
  sel.value = state.assetConv;
}

function resolvedConvFilter() {
  if (!state.assetConv) return "";
  if (state.assetConv === "current") return state.conversationId || "__none__";
  return state.assetConv;
}

async function loadConversation(id, opts = {}) {
  if (!id) return false;
  try {
    const data = await api(`/api/conversations/${id}`);
    state.conversationId = id;
    setConvKey(id);
    state.messages = (data.messages || []).map((m) => ({
      role: m.role, content: m.content, ts: m.created_at,
      jobId: m.job_id || undefined, attach: m.asset || undefined,
      skills: (m.skills && m.skills.length) ? m.skills : undefined,
    }));
    state.proposal = data.conversation.proposal || null;
    state.lastProposal = state.proposal;
    state.checklist = data.conversation.checklist || {};
    state.attachment = null;
    state.lastAttachmentId = "";
    state.lastFrame = null;
    state.lastFrameId = "";
    renderAttachChip();
    renderChat({ stick: true });
    if (state.assetConv === "current") {
      lastAssetsJson = "";
      refreshAssets();
    }
    if (opts.toast) toast("已载入历史对话");
    return true;
  } catch (err) {
    toast("载入对话失败：" + err.message, "err");
    return false;
  }
}

function newConversation() {
  state.conversationId = "";
  setConvKey(NEW_CONV);
  state.messages = [];
  state.proposal = null;
  state.lastProposal = null;
  state.checklist = {};
  state.attachment = null;
  state.lastAttachmentId = "";
  state.lastFrame = null;
  state.lastFrameId = "";
  renderAttachChip();
  renderChat({ stick: true });
  refreshConversations();
  if (state.assetConv === "current") {
    lastAssetsJson = "";
    refreshAssets();
  }
}

function renderHistory() {
  const list = $("#history-list");
  if (!state.conversations.length) {
    list.innerHTML = `<div class="queue-empty" style="margin:18px auto">还没有历史对话</div>`;
    return;
  }
  list.innerHTML = state.conversations.map((c) => `
    <div class="history-item ${c.id === state.conversationId ? "current" : ""}" data-conv="${c.id}">
      <div class="history-item-text">
        <b>${esc(c.title)}</b>
        <span>${fmtClock(c.updated_at)} · ${c.message_count} 条消息</span>
      </div>
      <button class="history-del" data-del="${c.id}" title="删除对话" aria-label="删除对话">✕</button>
    </div>`).join("");
  $$("#history-list .history-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-del]")) return;
      toggleHistory(false);
      loadConversation(el.dataset.conv, { toast: true });
    });
  });
  $$("#history-list [data-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteConversation(btn.dataset.del);
    });
  });
}

function toggleHistory(force) {
  state.historyOpen = force !== undefined ? force : !state.historyOpen;
  $("#history-pop").classList.toggle("hidden", !state.historyOpen);
  if (state.historyOpen) {
    renderHistory();
    refreshConversations();
  }
}

async function deleteConversation(id) {
  const conv = state.conversations.find((c) => c.id === id);
  const ok = await askConfirm("删除对话",
    `《${(conv && conv.title) || id}》及其全部消息将被删除，不可恢复。`);
  if (!ok) return;
  try {
    await api(`/api/conversations/${id}`, { method: "DELETE" });
    state.conversations = state.conversations.filter((c) => c.id !== id);
    if (state.conversationId === id) newConversation();
    renderHistory();
    toast("对话已删除", "ok");
  } catch (err) {
    toast("删除失败：" + err.message, "err");
  }
}

/* ------------------------------------------- repair / post / hypit ++ */
const EDIT_PROMPT_DEFAULT =
  "保持原图构图、人物、风格与配色不变，把画面中的文字改为正确、清晰的简体中文；" +
  "删除所有水印、logo、角标；不要新增文字，不要改变画面内容。";

const TTS_VOICES = [
  ["zh-CN-YunyangNeural", "云扬 · 男声播报"],
  ["zh-CN-XiaoxiaoNeural", "晓晓 · 女声通用"],
  ["zh-CN-YunxiNeural", "云希 · 男声少年"],
  ["zh-CN-XiaoyiNeural", "晓伊 · 女声活泼"],
];

const KIND_LABEL = { video: "视频", image: "参考图", edit: "修复",
                     hypit: "讲解片", post: "后期" };

function openEditDialog() {
  const a = state.assets.find((x) => x.id === state.lightboxId);
  if (!a || a.kind !== "image") return;
  $("#edit-dialog-title").textContent = `修复《${a.title || "图片"}》文字 / 水印`;
  $("#edit-prompt").value = EDIT_PROMPT_DEFAULT;
  $("#edit-dialog").classList.remove("hidden");
}

function closeEditDialog() { $("#edit-dialog").classList.add("hidden"); }

async function submitEdit() {
  const a = state.assets.find((x) => x.id === state.lightboxId);
  if (!a) return;
  try {
    const job = await api("/api/images/edit", {
      method: "POST",
      json: { asset_id: a.id, prompt: $("#edit-prompt").value.trim(),
                conversation_id: state.conversationId },
    });
    closeEditDialog();
    closeLightbox();
    upsertJob(job);
    lastJobsJson = "";
    await refreshJobs();
    toast("修复任务已入队，完成后自动入库并回传飞书", "ok");
  } catch (err) {
    toast("提交失败：" + err.message, "err");
  }
}

function openPostDialog() {
  const a = state.assets.find((x) => x.id === state.lightboxId);
  if (!a || a.kind !== "video") return;
  $("#post-dialog-title").textContent = `为《${a.title || "视频"}》加旁白 / 字幕`;
  const sel = $("#post-voice");
  if (!sel.options.length) {
    sel.innerHTML = TTS_VOICES.map(([v, label]) =>
      `<option value="${v}">${label}</option>`).join("");
  }
  $("#post-dialog").classList.remove("hidden");
}

function closePostDialog() { $("#post-dialog").classList.add("hidden"); }

async function submitPost() {
  const a = state.assets.find((x) => x.id === state.lightboxId);
  if (!a) return;
  try {
    const job = await api("/api/post", {
      method: "POST",
      json: {
        asset_id: a.id,
        narration_text: $("#post-text").value.trim(),
        voice: $("#post-voice").value,
        bgm_gain: Number($("#post-bgm").value) / 100,
        burn_subs: $("#post-burn").checked,
        conversation_id: state.conversationId,
      },
    });
    closePostDialog();
    closeLightbox();
    upsertJob(job);
    lastJobsJson = "";
    await refreshJobs();
    toast("后期任务已入队，完成后自动入库并回传飞书", "ok");
  } catch (err) {
    toast("提交失败：" + err.message, "err");
  }
}

async function openHypitDialog() {
  $("#hypit-dialog").classList.remove("hidden");
  const list = $("#hypit-list");
  list.innerHTML = `<div class="queue-empty" style="margin:18px auto">读取工程列表…</div>`;
  try {
    const res = await api("/api/hypit/projects");
    const projects = res.projects || [];
    if (!projects.length) {
      list.innerHTML = `<div class="queue-empty" style="margin:18px auto">工程目录下没有 .svrun 文件</div>`;
      return;
    }
    list.innerHTML = projects.map((p) => `
      <div class="hypit-item" data-name="${esc(p.name)}" data-stem="${esc(p.stem)}">
        <b>${esc(p.stem)}</b>
        <span>${fmtClock(p.updated_at)}</span>
      </div>`).join("");
    $$("#hypit-list .hypit-item").forEach((el) => {
      el.addEventListener("click", () => submitHypit(el.dataset.name, el.dataset.stem));
    });
  } catch (err) {
    list.innerHTML = `<div class="queue-empty" style="margin:18px auto">读取失败：${esc(err.message)}</div>`;
  }
}

function closeHypitDialog() { $("#hypit-dialog").classList.add("hidden"); }

async function submitHypit(name, stem) {
  try {
    const job = await api("/api/hypit/build", {
      method: "POST",
      json: { name, title: stem, conversation_id: state.conversationId },
    });
    closeHypitDialog();
    setPanel("queue");
    upsertJob(job);
    lastJobsJson = "";
    await refreshJobs();
    toast(`《${stem}》已提交构建，约 30 分钟起`, "ok");
  } catch (err) {
    toast("提交失败：" + err.message, "err");
  }
}

async function runAssetSync() {
  toast("正在扫描外部资产目录…");
  try {
    const res = await api("/api/assets/sync", { method: "POST" });
    lastAssetsJson = "";
    await refreshAssets();
    const external = (res.sources || []).filter((s) => s.exists).length;
    toast(`汇总完成：${external} 个目录，发现 ${res.discovered} 件新媒体，入库 ${res.added} 件`, "ok");
  } catch (err) {
    toast("汇总失败：" + err.message, "err");
  }
}

/* ---------------------------------------------------------- queue view */
function queueStatusLabel(job) {
  if (job.status === "running") return job.kind === "image" ? "生成中" : "渲染中";
  return JOB_LABEL[job.status] || job.status;
}

function setPanel(panel) {
  state.panel = panel;
  $$("#panel-switch .pswitch").forEach((b) =>
    b.classList.toggle("active", b.dataset.panel === panel));
  $("#assets-grid").classList.toggle("hidden", panel !== "assets");
  $("#assets-tools").classList.toggle("hidden", panel !== "assets");
  $("#queue-list").classList.toggle("hidden", panel !== "queue");
  $("#queue-tools").classList.toggle("hidden", panel !== "queue");
  if (panel === "queue") renderQueue();
  else renderAssets();
}

function renderQueue() {
  const list = $("#queue-list");
  const jobs = state.jobs.filter((j) => {
    if (state.queueFilter === "all") return true;
    return state.queueFilter.split(",").includes(j.status);
  });
  if (!jobs.length) {
    list.innerHTML = `<div class="queue-empty"><b style="display:block;color:var(--muted);font-size:15px;margin-bottom:6px">队列为空</b>提交生成任务后，这里会列出每个队列任务的进度、参数与结果。</div>`;
    return;
  }
  list.innerHTML = jobs.map(queueRow).join("");
  bindQueueEvents();
}

function queueRow(job) {
  const kind = job.kind || "video";
  const isImage = kind === "image";
  const dataKind = kind === "image" || kind === "edit";
  const active = job.status === "queued" || job.status === "running";
  const elapsedEnd = job.finished_at || (Date.now() / 1000);
  const elapsed = job.started_at ? fmtElapsed(elapsedEnd - job.started_at) : "";
  const pct = job.status === "succeeded" ? 100 : Math.max(2, job.progress || 0);
  return `<div class="queue-row ${job.status}" data-job="${job.id}">
    <div class="q-top">
      <span class="q-kind ${dataKind ? "image" : ""}">${KIND_LABEL[kind] || "视频"}</span>
      <span class="q-title">${esc(job.title || (isImage ? "参考图" : "未命名视频"))}</span>
      <span class="job-status ${job.status}">${queueStatusLabel(job)}</span>
    </div>
    <div class="job-bar"><i style="width:${pct}%"></i></div>
    <div class="q-meta">
      <span>${esc(job.error || job.stage || "")}</span>
      <span>创建 ${fmtClock(job.created_at)}</span>
      ${job.started_at ? `<span>用时 ${elapsed}</span>` : ""}
      ${job.comfy_prompt_id ? `<span>${esc(job.comfy_prompt_id.slice(0, 8))}</span>` : ""}
    </div>
    <details class="q-more"><summary>提示词 / 参数</summary>
      <pre class="q-prompt">${esc(job.prompt)}</pre></details>
    <div class="q-actions">
      ${active ? `<button class="btn ghost small" data-cancel="${job.id}">停止</button>` : ""}
      ${job.status === "succeeded" && job.asset_id ? `<button class="btn ghost small" data-open="${job.asset_id}">查看结果</button>` : ""}
      ${(job.status === "failed" || job.status === "cancelled") ? `<button class="btn ghost small" data-retry="${job.id}">重试</button>` : ""}
    </div>
  </div>`;
}

function bindQueueEvents() {
  $$("#queue-list [data-cancel]").forEach((b) =>
    b.addEventListener("click", () => cancelJob(b.dataset.cancel)));
  $$("#queue-list [data-open]").forEach((b) =>
    b.addEventListener("click", () => openLightbox(b.dataset.open)));
  $$("#queue-list [data-retry]").forEach((b) =>
    b.addEventListener("click", () => retryJob(b.dataset.retry)));
}

async function retryJob(id) {
  try {
    const job = await api(`/api/jobs/${id}/retry`, { method: "POST" });
    upsertJob(job);
    lastJobsJson = "";
    await refreshJobs();
    if (state.panel === "queue") renderQueue();
    toast("已重新入队", "ok");
  } catch (err) {
    toast("重试失败：" + err.message, "err");
  }
}

/* ------------------------------------------------------ drag & drop */
function dragTypesOk(e) {
  const types = (e.dataTransfer && e.dataTransfer.types) || [];
  return [...types].includes("application/x-xp-asset");
}

function bindDragSource(el, asset) {
  el.setAttribute("draggable", "true");
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("application/x-xp-asset", asset.id);
    e.dataTransfer.setData("text/plain", asset.id);
    e.dataTransfer.effectAllowed = "copy";
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
}

function bindDropZone() {
  const panel = $(".chat-panel");
  const box = $(".composer-box");
  const clear = () => {
    panel.classList.remove("drag-active");
    box.classList.remove("drag-over");
  };
  panel.addEventListener("dragover", (e) => {
    if (!dragTypesOk(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    panel.classList.add("drag-active");
    box.classList.add("drag-over");
  });
  panel.addEventListener("dragleave", (e) => {
    if (panel.contains(e.relatedTarget)) return;
    clear();
  });
  panel.addEventListener("drop", (e) => {
    if (!dragTypesOk(e)) return;
    e.preventDefault();
    clear();
    const id = e.dataTransfer.getData("application/x-xp-asset") ||
               e.dataTransfer.getData("text/plain");
    const asset = state.assets.find((a) => a.id === id);
    if (!asset) return;
    if (asset.kind === "video") {
      openFrameDialog(asset.id);
      return;
    }
    state.attachment = asset;
    state.lastAttachmentId = asset.id;
    renderAttachChip();
    toast(`已把《${asset.title || "参考图"}》设为参考图，下一轮图生视频`, "ok");
    $("#chat-input").focus();
  });
}

/* -------------------------------------------------------------- skills */
async function loadSkills() {
  try {
    const res = await api("/api/skills");
    state.skills = res.skills || [];
  } catch (_) {
    state.skills = [];
  }
}

function renderSkillChips() {
  const box = $("#skill-chips");
  if (!state.pendingSkills.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = state.pendingSkills.map((name) =>
    `<span class="skill-chip"><b>⚡ ${esc(name)}</b><button title="移除" data-skill="${esc(name)}">✕</button></span>`).join("");
  $$("#skill-chips [data-skill]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.pendingSkills = state.pendingSkills.filter((s) => s !== btn.dataset.skill);
      renderSkillChips();
    });
  });
}

function skillQuery(text) {
  const m = /^\/(\S*)$/.exec(text);
  return m ? m[1].toLowerCase() : null;
}

function renderSkillPop(query) {
  const pop = $("#skill-pop");
  const list = $("#skill-pop-list");
  state.skillMatches = state.skills.filter((s) =>
    !query || s.name.toLowerCase().includes(query)
    || (s.description || "").toLowerCase().includes(query)).slice(0, 12);
  if (!state.skillMatches.length) {
    pop.classList.add("hidden");
    state.skillPopOpen = false;
    return;
  }
  state.skillIndex = Math.min(state.skillIndex, state.skillMatches.length - 1);
  list.innerHTML = state.skillMatches.map((s, i) =>
    `<div class="skill-pop-item ${i === state.skillIndex ? "active" : ""}" data-skill-name="${esc(s.name)}">
       <b>${esc(s.name)}</b><span>${esc(s.description || "")}</span>
     </div>`).join("");
  $$("#skill-pop-list .skill-pop-item").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      state.skillIndex = state.skillMatches.findIndex((s) => s.name === el.dataset.skillName);
      $$("#skill-pop-list .skill-pop-item").forEach((x, j) =>
        x.classList.toggle("active", j === state.skillIndex));
    });
    el.addEventListener("click", () => pickSkill(el.dataset.skillName));
  });
  pop.classList.remove("hidden");
  state.skillPopOpen = true;
}

function closeSkillPop() {
  $("#skill-pop").classList.add("hidden");
  state.skillPopOpen = false;
}

function pickSkill(name) {
  if (name && !state.pendingSkills.includes(name)) {
    state.pendingSkills.push(name);
    if (state.pendingSkills.length > 3) state.pendingSkills.shift();
    renderSkillChips();
    toast(`已加载技能 ${name}（发送时生效）`);
  }
  const input = $("#chat-input");
  input.value = "";
  autoGrow(input);
  closeSkillPop();
  input.focus();
}

/* ------------------------------------------------------------ bindings */
function init() {
  $("#chat-send").addEventListener("click", sendMessage);
  $("#chat-input").addEventListener("input", (e) => {
    autoGrow(e.target);
    const q = skillQuery(e.target.value);
    if (q === null) {
      closeSkillPop();
    } else {
      state.skillIndex = 0;
      renderSkillPop(q);
    }
  });
  $("#chat-input").addEventListener("keydown", (e) => {
    if (state.skillPopOpen) {
      const q = skillQuery($("#chat-input").value) || "";
      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.skillIndex = Math.min(state.skillIndex + 1, state.skillMatches.length - 1);
        renderSkillPop(q);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        state.skillIndex = Math.max(state.skillIndex - 1, 0);
        renderSkillPop(q);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const picked = state.skillMatches[state.skillIndex];
        if (picked) pickSkill(picked.name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSkillPop();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $("#attach-btn").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) uploadAttachment(file);
    e.target.value = "";
  });
  $("#chat-reset").addEventListener("click", () => {
    newConversation();
    toast("已开始新对话");
  });
  $("#chat-history").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleHistory();
  });
  $("#history-close").addEventListener("click", () => toggleHistory(false));
  document.addEventListener("click", (e) => {
    if (state.skillPopOpen && !e.target.closest(".composer")) closeSkillPop();
    if (!state.historyOpen) return;
    if (e.target.closest("#history-pop") || e.target.closest("#chat-history")) return;
    toggleHistory(false);
  });
  $("#panel-switch").addEventListener("click", (e) => {
    const btn = e.target.closest(".pswitch");
    if (btn) setPanel(btn.dataset.panel);
  });
  $("#queue-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    state.queueFilter = tab.dataset.status;
    $$("#queue-tabs .tab").forEach((t) => t.classList.toggle("active", t === tab));
    renderQueue();
  });
  $("#queue-refresh").addEventListener("click", () => {
    lastJobsJson = "";
    refreshJobs();
    toast("队列已刷新");
  });
  bindDropZone();
  $$(".suggest-list button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#chat-input").value = btn.dataset.suggest || "";
      autoGrow($("#chat-input"));
      sendMessage();
    });
  });
  $("#asset-conv-filter").addEventListener("change", (e) => {
    state.assetConv = e.target.value;
    lastAssetsJson = "";
    refreshAssets();
  });
  $("#asset-order").addEventListener("change", (e) => {
    state.assetOrder = e.target.value;
    lastAssetsJson = "";
    refreshAssets();
  });
  $("#assets-refresh").addEventListener("click", () => {
    lastAssetsJson = "";
    refreshAssets();
    toast("已刷新");
  });
  $("#assets-manage").addEventListener("click", () => toggleManage());
  $("#bulk-select-all").addEventListener("click", () => {
    const items = state.assets;
    const all = state.selected.size === items.length && items.length > 0;
    state.selected.clear();
    if (!all) items.forEach((a) => state.selected.add(a.id));
    $$("#assets-grid .asset").forEach((el) => {
      el.classList.toggle("selected", state.selected.has(el.dataset.id));
    });
    syncBulkBar(items.length);
  });
  $("#bulk-delete").addEventListener("click", deleteSelected);
  $("#bulk-cancel").addEventListener("click", () => toggleManage(false));
  $("#confirm-ok").addEventListener("click", () => settleConfirm(true));
  $("#confirm-cancel").addEventListener("click", () => settleConfirm(false));
  $("#confirm").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) settleConfirm(false);
  });
  $("#lightbox").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeLightbox();
  });
  $("#lb-prev").addEventListener("click", () => navLightbox(-1));
  $("#lb-next").addEventListener("click", () => navLightbox(1));
  $("#lb-use-video").addEventListener("click", useImageForVideo);
  $("#lb-video-ref").addEventListener("click", () => openFrameDialog(state.lightboxId));
  $("#frame-dialog").addEventListener("click", (e) => {
    if (e.target.closest("[data-frame-close]")) closeFrameDialog();
  });
  $$("#frame-dialog [data-frame]").forEach((btn) => {
    btn.addEventListener("click", () => chooseFrame(btn.dataset.frame));
  });
  document.addEventListener("keydown", (e) => {
    if (confirmResolve) {
      if (e.key === "Escape") settleConfirm(false);
      return;
    }
    if (state.frameVideoId) {
      if (e.key === "Escape") closeFrameDialog();
      return;
    }
    if (!$("#edit-dialog").classList.contains("hidden")) {
      if (e.key === "Escape") closeEditDialog();
      return;
    }
    if (!$("#post-dialog").classList.contains("hidden")) {
      if (e.key === "Escape") closePostDialog();
      return;
    }
    if (!$("#hypit-dialog").classList.contains("hidden")) {
      if (e.key === "Escape") closeHypitDialog();
      return;
    }
    if (!state.lightboxId) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") navLightbox(-1);
    if (e.key === "ArrowRight") navLightbox(1);
  });
  $("#lb-qc").addEventListener("click", runAssetQC);
  $("#lb-feishu").addEventListener("click", sendToFeishu);
  $("#lb-edit").addEventListener("click", openEditDialog);
  $("#lb-post").addEventListener("click", openPostDialog);
  $("#lb-delete").addEventListener("click", deleteCurrentAsset);
  $("#edit-submit").addEventListener("click", submitEdit);
  $("#edit-dialog").addEventListener("click", (e) => {
    if (e.target.closest("[data-edit-close]")) closeEditDialog();
  });
  $("#post-submit").addEventListener("click", submitPost);
  $("#post-dialog").addEventListener("click", (e) => {
    if (e.target.closest("[data-post-close]")) closePostDialog();
  });
  $("#post-bgm").addEventListener("input", (e) => {
    $("#post-bgm-val").textContent = e.target.value + "%";
  });
  $("#hypit-dialog").addEventListener("click", (e) => {
    if (e.target.closest("[data-hypit-close]")) closeHypitDialog();
  });
  $("#queue-hypit").addEventListener("click", openHypitDialog);
  $("#assets-sync").addEventListener("click", runAssetSync);

  setInterval(() => {
    if (document.hidden) return;
    refreshJobs();
    refreshStatus();
    refreshAssets();
  }, 3000);
  setInterval(() => {
    if (document.hidden) return;
    $$("#chat-list .job-elapsed[data-job]").forEach((el) => {
      const job = state.jobs.find((j) => j.id === el.dataset.job);
      if (job && job.started_at &&
          (job.status === "running" || job.status === "queued")) {
        el.textContent = fmtElapsed(Date.now() / 1000 - job.started_at);
      }
    });
  }, 1000);

  const themeBtn = $("#theme-btn");
  const syncThemeBtn = () => {
    themeBtn.title = document.documentElement.dataset.theme === "light"
      ? "切换到黑夜模式" : "切换到白昼模式";
  };
  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("xp-theme", next); } catch (_) {}
    syncThemeBtn();
    toast(next === "light" ? "已切换到白昼模式" : "已切换到黑夜模式");
  });
  syncThemeBtn();

  loadSkills();
  renderSkeletons();
  refreshStatus();
  refreshJobs();
  refreshAssets();
  autoGrow($("#chat-input"));

  refreshConversations().then(() => {
    const saved = convKey();
    if (saved === NEW_CONV) { newConversation(); return; }
    const target = saved && state.conversations.some((c) => c.id === saved)
      ? saved
      : (state.conversations[0] ? state.conversations[0].id : "");
    if (target) loadConversation(target);
  });
}

init();
