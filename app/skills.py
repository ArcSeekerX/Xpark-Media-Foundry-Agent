# Load installed opencode skills (SKILL.md) for chat-time invocation.
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional

from . import config

SKILLS_DIR = Path(os.environ.get("VA_SKILLS_DIR",
                                 "/root/.config/opencode/skills"))
MAX_SKILL_CHARS = 6000
MAX_SKILLS_PER_TURN = 3
_NAME_RE = re.compile(r"^name:\s*(.+)$", re.MULTILINE)
_DESC_RE = re.compile(r"^description:\s*(.*)$", re.MULTILINE)


def _parse_frontmatter(text: str) -> tuple[str, str]:
    if not text.startswith("---"):
        return "", ""
    end = text.find("\n---", 3)
    block = text[3:end] if end > 0 else text[3:4000]
    name = ""
    m = _NAME_RE.search(block)
    if m:
        name = m.group(1).strip().strip('"').strip("'")
    desc = ""
    lines = block.splitlines()
    for i, line in enumerate(lines):
        if not line.startswith("description:"):
            continue
        head = line.split(":", 1)[1].strip()
        if head in (">-", ">", "|", "|-"):
            collected = []
            for nxt in lines[i + 1:]:
                if nxt and not nxt.startswith((" ", "\t")):
                    break
                collected.append(nxt.strip())
            desc = " ".join(c for c in collected if c)
        else:
            desc = head
        break
    return name, desc


def _allowed(name: str, dirname: str) -> bool:
    allow = config.SKILLS_ALLOW
    if not allow or "all" in allow:
        return True
    return name in allow or dirname in allow


def list_skills() -> list[dict]:
    skills: list[dict] = []
    if not SKILLS_DIR.exists():
        return skills
    for entry in sorted(SKILLS_DIR.iterdir()):
        skill_file = entry / "SKILL.md"
        if not skill_file.is_file():
            continue
        try:
            text = skill_file.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        name, desc = _parse_frontmatter(text)
        display = name or entry.name
        if not _allowed(display, entry.name):
            continue
        skills.append({"name": display, "dir": entry.name,
                       "description": " ".join(desc.split())[:200]})
    return skills


def load_skill(name: str) -> Optional[tuple[str, str]]:
    """Return (canonical_name, content) for an installed skill."""
    name = (name or "").strip()
    if not name or "/" in name or ".." in name:
        return None
    for skill in list_skills():
        if name in (skill["name"], skill["dir"]):
            path = SKILLS_DIR / skill["dir"] / "SKILL.md"
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                return None
            return skill["name"], text[:MAX_SKILL_CHARS]
    return None
