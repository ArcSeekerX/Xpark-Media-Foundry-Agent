# Conversational video agent: turns a chat into a ready-to-render H3 brief.
from __future__ import annotations

import re
from typing import Any, Optional

from . import config
from .llm import as_str, chat, extract_json

SYSTEM_PROMPT = """你是「Xpark 数字资产生成流水线」的导演助理。用户描述想要什么视频,你负责把想法聊清楚,然后给出可直接送进本地 MiniMax H3 模型(同时生成画面和声音)的一条完整方案。

工作方式:
1) 每轮最多问 1 个问题,只问目前最影响成片、而用户还没说的信息。提问优先级:核心画面/主体 > 场景与氛围 > 风格质感 > 时长画幅。reply 用口语化中文,1~3 句,给建议时可给 2~3 个选项降低回答成本。
2) 用户说「随便/你定/都行/直接开始/赶时间」时,立即给 proposal,用合理默认补齐,不再追问。
3) 信息一旦足够(主体+画面方向,或用户明确要开始),就给 proposal;不要为了提问而提问。用户只是闲聊或问你的能力时,自然简短回答即可。
4) 每轮都必须输出 checklist,且完整反映到目前为止聊到的全部信息(包括前几轮),字段没聊到就留空字符串;不要只写本轮新增。
5) proposal 只在信息足够时出现,否则为 null。

proposal.prompt 是给 MiniMax H3 的英文提示词,要求:
- 90~170 词,按固定结构分节书写,并保留分节标题:
  subject_definitions: 描述主体(外貌/身份/服装)
  summary: 一句话概括
  integrated_multimodal_description: 风格、光线、色调、镜头语言
  [Shot 1]: 主体动作、环境变化、镜头运动
  Audio: 环境音/配乐/人声(无对白就写 no dialogue)
- 画面具体、有电影感;镜头运动明确(locked-off / slow push-in / handheld 等)
- 画面内不要出现任何文字:显式写上 no subtitles, no captions, no on-screen text, no watermark
- 时长贴合内容,不必长:5~15 秒即可

proposal 其他字段:
- title: 中文片名,不超过 16 字
- summary: 一句中文概述,不超过 60 字
- image_prompt: 给 Qwen-Image 2.1 的关键帧提示词(中文 30~60 字),描述最能代表这条视频的一帧:主体、构图、光线、风格;画面内不要出现任何文字/字幕/水印
- duration_s: 5~15 的整数(默认 5)
- aspect: 只允许 "16:9"、"9:16"、"1:1"(默认 16:9)

当用户说「先出参考图/先画几张图/看看画面」时,照常给出 proposal(系统会自动先排参考图);不要因此改变 reply 的正常口吻。

只输出一个 JSON 对象,不要 markdown 代码块、不要多余文字:
{"reply": str, "checklist": {"topic": str, "subject": str, "scene": str, "style": str, "duration": str, "aspect": str}, "proposal": null 或 {"title": str, "summary": str, "prompt": str, "image_prompt": str, "duration_s": int, "aspect": str}}

示例一(信息不足,先问一个问题):
用户: 想做个雨夜便利店的悬疑感小片
输出: {"reply":"雨夜便利店很出片。主角定成夜班店员,还是深夜进店的客人?","checklist":{"topic":"雨夜便利店悬疑","subject":"","scene":"雨夜便利店","style":"","duration":"","aspect":""},"proposal":null}
示例二(信息足够,直接给方案):
用户: 店员吧,写实电影感,直接生成
输出: {"reply":"好,按写实悬疑夜戏给你排一条。","checklist":{"topic":"雨夜便利店悬疑","subject":"夜班店员","scene":"雨夜便利店","style":"写实电影感","duration":"5 秒","aspect":"16:9"},"proposal":{"title":"雨夜便利店","summary":"写实悬疑:夜班店员在雨夜便利店遭遇异常","prompt":"subject_definitions:\\nA tired young convenience-store clerk in a dark-blue uniform, mid-20s.\\nsummary:\\nA realistic cinematic suspense vignette in a convenience store on a rainy night.\\nintegrated_multimodal_description:\\nPhotorealistic, rain-streaked glass, cold fluorescent interior mixed with cyan neon from the street, shallow depth of field. Locked-off medium shot.\\n[Shot 1]\\nThe clerk stands behind the counter, glancing up as the automatic door slides open to an empty street; the door closes, rain hissing, a fridge hums. He walks slowly to the glass, his breath fogging it, and leaves a handprint on the cold surface. Distant thunder rolls. Camera locked-off, subtle handheld micro-shake only.\\nAudio: heavy rain ambience, low synth drone, humming refrigerator, no dialogue.\\nno subtitles, no captions, no on-screen text, no watermark.","duration_s":5,"aspect":"16:9"}}
"""

CHECKLIST_KEYS = ("topic", "subject", "scene", "style", "duration", "aspect")
_ASPECT_VALUES = tuple(config.ASPECTS)

_DURATION_RE = re.compile(r"(\d{1,2})\s*(?:秒|s\b|sec)", re.IGNORECASE)
_ASPECT_HINTS = (
    ("9:16", ("9:16", "9比16", "竖屏", "竖版", "竖向")),
    ("1:1", ("1:1", "1比1", "方形", "方屏")),
    ("16:9", ("16:9", "16比9", "横屏", "横版", "横向")),
)
_START_RE = re.compile(
    r"(开始生成|直接生成|马上生成|立即生成|现在就生成|开始出片|直接出片|"
    r"一键出片|生成视频|出片吧|出片|开工|开机|开始吧|就这样|可以了|确认|没问题)")
_IMAGE_INTENT_RE = re.compile(
    r"(参考图|参考图片|先出图|先画|预览图|看看画面|出几张图|生成图|"
    r"图片先|来几张|草稿图|先做图|出图)")
_MAX_HISTORY = 20


def _extract_overrides(messages: list[dict]) -> dict:
    text = "\n".join(str(m.get("content") or "")
                     for m in messages if m.get("role") == "user")
    out: dict[str, Any] = {}
    match = _DURATION_RE.search(text)
    if match:
        out["duration_s"] = max(config.DURATION_MIN,
                                min(config.DURATION_MAX, int(match.group(1))))
    for aspect, hints in _ASPECT_HINTS:
        if any(h in text for h in hints):
            out["aspect"] = aspect
            break
    return out


def _clamp_proposal(raw: Any) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    prompt = str(raw.get("prompt") or "").strip()
    summary = as_str(raw.get("summary"), 60)
    if len(prompt) < 40 and not summary:
        return None
    if len(prompt) < 40:
        prompt = (f"subject_definitions:\n{summary}\n"
                  f"summary:\n{summary}\n"
                  f"integrated_multimodal_description:\n{summary}\n"
                  f"[Shot 1]\n{summary}\nAudio: ambient sound, no dialogue.\n"
                  "no subtitles, no captions, no on-screen text, no watermark.")
    try:
        duration = int(raw.get("duration_s") or config.DURATION_DEFAULT)
    except (TypeError, ValueError):
        duration = config.DURATION_DEFAULT
    duration = max(config.DURATION_MIN, min(config.DURATION_MAX, duration))
    aspect = str(raw.get("aspect") or "")
    if aspect not in _ASPECT_VALUES:
        aspect = "16:9"
    title = as_str(raw.get("title"), 16) or summary[:16] or "未命名视频"
    image_prompt = as_str(raw.get("image_prompt"), 300) or summary or prompt[:200]
    return {"title": title, "summary": summary or prompt[:60],
            "prompt": prompt, "image_prompt": image_prompt,
            "duration_s": duration, "aspect": aspect}


def _sanitize_checklist(raw: Any) -> dict:
    out = {key: "" for key in CHECKLIST_KEYS}
    if isinstance(raw, dict):
        for key in CHECKLIST_KEYS:
            out[key] = as_str(raw.get(key), 40)
    return out


def _fill_checklist_from_proposal(checklist: dict, proposal: Optional[dict],
                                  overrides: dict) -> dict:
    if proposal:
        if not checklist.get("topic"):
            checklist["topic"] = proposal["summary"][:40]
        if not checklist.get("style"):
            checklist["style"] = ""
        checklist["duration"] = f"{proposal['duration_s']} 秒"
        checklist["aspect"] = proposal["aspect"]
    if overrides.get("duration_s"):
        checklist["duration"] = f"{overrides['duration_s']} 秒"
    if overrides.get("aspect"):
        checklist["aspect"] = overrides["aspect"]
    return checklist


def _fallback_prompt(messages: list[dict]) -> str:
    brief = "。".join(str(m.get("content") or "").strip()
                      for m in messages if m.get("role") == "user"
                      and str(m.get("content") or "").strip())[-400:]
    return ("subject_definitions:\nA cinematic scene based on the user's brief.\n"
            f"summary:\n{brief or 'A short cinematic vignette.'}\n"
            "integrated_multimodal_description:\ncinematic look, natural light, "
            "shallow depth of field, smooth camera move.\n"
            "[Shot 1]\nThe main subject performs a simple, clear action in a "
            "living environment; ambient details move naturally.\n"
            "Audio: ambient sound, soft music, no dialogue.\n"
            "no subtitles, no captions, no on-screen text, no watermark.")


def run_chat(messages: list[dict], attachment: Optional[dict] = None,
             note: str = "", skills: Optional[list[tuple[str, str]]] = None) -> dict:
    """One conversation turn -> {reply, checklist, proposal, start_intent}."""
    history = [
        {"role": "user" if m.get("role") == "user" else "assistant",
         "content": str(m.get("content") or "")}
        for m in (messages or [])[-_MAX_HISTORY:]
        if str(m.get("content") or "").strip()
    ]
    last_user = next((m["content"] for m in reversed(history)
                      if m["role"] == "user"), "")
    overrides = _extract_overrides(history)

    system = SYSTEM_PROMPT
    if attachment:
        system += (
            "\n补充:用户当前附带了参考图(将以图生视频,作为第一帧)。"
            "proposal.prompt 要写成「让图中画面自然动起来」,保持主体身份、"
            "服装、构图与色调一致,描述运动、环境与声音,不要重绘主体。")
    if note:
        system += "\n补充:" + note
    if skills:
        blocks = "\n\n".join(f"## {name}\n{doc}" for name, doc in skills)
        system += (
            "\n\n# 已加载技能(本轮必须遵循其流程与要求,并按技能约定组织你的回复和产物)\n"
            + blocks)

    raw = ""
    try:
        raw = chat([{"role": "system", "content": system}] + history)
        data = extract_json(raw)
    except ValueError:
        try:
            data = extract_json(chat([
                {"role": "system", "content": system},
                {"role": "user", "content": "请重新输出:必须是单个合法 JSON 对象。"},
                *history]))
        except Exception:
            return {"reply": raw.strip() or "我这轮没想好措辞,再说一次?",
                    "checklist": _sanitize_checklist(None),
                    "proposal": None,
                    "start_intent": bool(_START_RE.search(last_user))}
    except Exception as exc:
        return {"reply": f"文本模型暂时不可用({type(exc).__name__}),稍后再试。",
                "checklist": _sanitize_checklist(None),
                "proposal": None, "start_intent": False}

    reply = str(data.get("reply") or "").strip() or "说说你想要的画面?"
    proposal = _clamp_proposal(data.get("proposal"))
    checklist = _sanitize_checklist(data.get("checklist"))
    start_intent = bool(_START_RE.search(last_user))
    image_intent = bool(_IMAGE_INTENT_RE.search(last_user))

    if proposal is None and (start_intent or image_intent):
        proposal = _clamp_proposal({
            "title": "", "summary": checklist.get("topic") or "",
            "prompt": _fallback_prompt(history),
            "duration_s": overrides.get("duration_s", config.DURATION_DEFAULT),
            "aspect": overrides.get("aspect", "16:9"),
        })
        if proposal and start_intent and not image_intent:
            reply = "好,按我们聊到的直接开拍。"
    if proposal:
        # deterministic values (33秒 / 竖屏) win over the model's numbers
        proposal["duration_s"] = overrides.get("duration_s", proposal["duration_s"])
        proposal["aspect"] = overrides.get("aspect", proposal["aspect"])
    checklist = _fill_checklist_from_proposal(checklist, proposal, overrides)

    return {"reply": reply, "checklist": checklist, "proposal": proposal,
            "start_intent": start_intent, "image_intent": image_intent}
