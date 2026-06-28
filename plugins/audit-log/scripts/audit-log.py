#!/usr/bin/env python3
"""AUDIT LOG — PostToolUse hook. Appends tool_input/tool_response to .claude/audit.jsonl. Fail-open."""
import sys, os, json
from datetime import datetime, timezone

MAX_RESULT_CHARS = 4000


def main():
    data = json.load(sys.stdin)
    base = os.environ.get("CLAUDE_PROJECT_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    log_path = os.path.join(base, ".claude", "audit.jsonl")
    result = data.get("tool_response")
    result_str = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, default=str)
    if result_str and len(result_str) > MAX_RESULT_CHARS:
        result_str = result_str[:MAX_RESULT_CHARS] + "…[truncated]"
    rec = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "session_id": data.get("session_id"),
        "tool": data.get("tool_name"),
        "args": data.get("tool_input"),
        "result": result_str,
    }
    with open(log_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
