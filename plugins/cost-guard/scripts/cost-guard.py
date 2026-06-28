#!/usr/bin/env python3
"""
COST GUARD — PreToolUse hook (global)

Computes the running cost of the current session from the transcript JSONL
(token usage x model pricing) and, when it reaches HARD_LIMIT, sends a Telegram
alert and BLOCKS all further tool calls (circuit breaker). A one-time SOFT warning
is also sent at SOFT_LIMIT (non-blocking).

Why this exists: hook stdin does NOT carry cost (only statusLine input does), so we
recompute from `transcript_path`. There is no official "kill session" hook, so the
stop is implemented as PreToolUse `deny` on every subsequent tool.

Fail-open by design: any error -> exit 0 (allow the tool). A guard bug must never
brick the session.

Config (env first, then ~/.claude/.cost-guard.env fallback):
  COST_HARD_LIMIT_USD  (default 15)
  COST_SOFT_LIMIT_USD  (default 5)
  TELEGRAM_BOT_TOKEN
  TELEGRAM_CHAT_ID
  COST_GUARD_TEST=1    -> send a test Telegram message and exit (credential check)
"""

import sys
import os
import json
import urllib.request
import urllib.parse

HOME = os.path.expanduser("~")
ENV_FILE = os.path.join(HOME, ".claude", ".cost-guard.env")
STATE_DIR = os.path.join(HOME, ".cache", "cost-guard")
HISTORY_FILE = os.path.join(STATE_DIR, "history.jsonl")

# Pricing per single token (USD). cw = cache write (5m, 1.25x input), cr = cache read (0.1x input).
# NOTE: the [1m] 1M-context premium tier (>200k ctx) is billed ~2x; we use standard
# rates here, so very-large-context sessions are slightly UNDER-counted (guard trips
# a bit late). Acceptable for a cost guard; revisit if it matters.
PRICES = {
    "claude-opus":   {"in": 15 / 1e6, "out": 75 / 1e6, "cw": 18.75 / 1e6, "cr": 1.5 / 1e6},
    "claude-sonnet": {"in": 3 / 1e6,  "out": 15 / 1e6, "cw": 3.75 / 1e6,  "cr": 0.30 / 1e6},
    "claude-haiku":  {"in": 1 / 1e6,  "out": 5 / 1e6,  "cw": 1.25 / 1e6,  "cr": 0.10 / 1e6},
}
DEFAULT_PRICE = PRICES["claude-opus"]


def load_env_file():
    """Read KEY=VALUE lines from ~/.claude/.cost-guard.env (never raises)."""
    vals = {}
    try:
        with open(ENV_FILE, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip()
    except Exception:
        pass
    return vals


def cfg(key, file_vals, default=None):
    v = os.environ.get(key)
    if v is None or v == "":
        v = file_vals.get(key)
    if v is None or v == "":
        return default
    return v


def price_for(model):
    if not model:
        return DEFAULT_PRICE
    for prefix, p in PRICES.items():
        if model.startswith(prefix):
            return p
    return DEFAULT_PRICE


def send_telegram(token, chat_id, text):
    """POST sendMessage. 5s timeout, never raises."""
    if not token or not chat_id:
        return False
    try:
        url = "https://api.telegram.org/bot%s/sendMessage" % token
        data = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode("utf-8")
        req = urllib.request.Request(url, data=data)
        urllib.request.urlopen(req, timeout=5).read()
        return True
    except Exception:
        return False


def emit_deny(cost, hard):
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                "COST GUARD: 세션 비용 $%.2f가 HARD_LIMIT $%.2f에 도달. 이후 작업을 차단합니다. "
                "계속하려면 새 세션을 시작하거나 ~/.cache/cost-guard/<session_id>.tripped 를 삭제하세요."
                % (cost, hard)
            ),
        }
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


def load_state(path):
    try:
        with open(path, encoding="utf-8") as fh:
            s = json.load(fh)
        if not isinstance(s, dict):
            raise ValueError
        s.setdefault("offset", 0)
        s.setdefault("totals", {})  # model -> {in,out,cw,cr}
        s.setdefault("soft_notified", False)
        s.setdefault("rel_notified", False)  # baseline x mult warning sent once
        return s
    except Exception:
        return {"offset": 0, "totals": {}, "soft_notified": False, "rel_notified": False}


def read_history():
    """Return list of recorded session costs (oldest first). Never raises."""
    costs = []
    try:
        with open(HISTORY_FILE, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    c = float(json.loads(line).get("cost", 0))
                except Exception:
                    continue
                if c > 0:
                    costs.append(c)
    except Exception:
        pass
    return costs


def median(vals):
    s = sorted(vals)
    k = len(s)
    if k == 0:
        return None
    mid = k // 2
    return s[mid] if k % 2 else (s[mid - 1] + s[mid]) / 2.0


def record_session(payload):
    """SessionEnd: compute final session cost and append it to history.jsonl."""
    session_id = payload.get("session_id") or "default"
    transcript_path = payload.get("transcript_path")
    if not transcript_path or not os.path.exists(transcript_path):
        return 0
    os.makedirs(STATE_DIR, exist_ok=True)
    state_path = os.path.join(STATE_DIR, "%s.json" % session_id)
    state = load_state(state_path)
    state = update_totals_from_transcript(transcript_path, state)
    save_state(state_path, state)
    cost = total_cost(state)
    if cost <= 0:
        return 0
    try:
        with open(HISTORY_FILE, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"session_id": session_id, "cost": round(cost, 4)}) + "\n")
    except Exception:
        pass
    return 0


def save_state(path, state):
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
    except Exception:
        pass


def update_totals_from_transcript(transcript_path, state):
    """Read only new bytes since state['offset']; accumulate per-model token totals."""
    try:
        size = os.path.getsize(transcript_path)
    except Exception:
        return state
    offset = state.get("offset", 0)
    if offset > size:  # transcript rotated/truncated -> recompute from scratch
        offset = 0
        state["totals"] = {}
    try:
        with open(transcript_path, "r", encoding="utf-8", errors="replace") as fh:
            fh.seek(offset)
            for line in fh:
                if not line.endswith("\n"):
                    # partial last line; stop and leave offset before it
                    break
                offset += len(line.encode("utf-8"))
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                msg = obj.get("message") or {}
                usage = msg.get("usage")
                if not usage:
                    continue
                model = msg.get("model") or "claude-opus"
                t = state["totals"].setdefault(
                    model, {"in": 0, "out": 0, "cw": 0, "cr": 0}
                )
                t["in"] += usage.get("input_tokens", 0) or 0
                t["out"] += usage.get("output_tokens", 0) or 0
                t["cw"] += usage.get("cache_creation_input_tokens", 0) or 0
                t["cr"] += usage.get("cache_read_input_tokens", 0) or 0
    except Exception:
        return state
    state["offset"] = offset
    return state


def total_cost(state):
    cost = 0.0
    for model, t in state.get("totals", {}).items():
        p = price_for(model)
        cost += (
            t["in"] * p["in"]
            + t["out"] * p["out"]
            + t["cw"] * p["cw"]
            + t["cr"] * p["cr"]
        )
    return cost


def main():
    file_vals = load_env_file()
    token = cfg("TELEGRAM_BOT_TOKEN", file_vals)
    chat_id = cfg("TELEGRAM_CHAT_ID", file_vals)

    # Credential self-test mode
    if os.environ.get("COST_GUARD_TEST") == "1":
        ok = send_telegram(token, chat_id, "✅ COST GUARD 테스트 메시지 — Telegram 연동 정상")
        sys.stderr.write("telegram test: %s\n" % ("OK" if ok else "FAILED (token/chat_id 확인)"))
        return 0

    # SessionEnd record mode: persist this session's final cost to history, then exit.
    if "--record" in sys.argv:
        raw = sys.stdin.read()
        try:
            payload = json.loads(raw) if raw.strip() else {}
        except Exception:
            return 0
        return record_session(payload)

    try:
        hard = float(cfg("COST_HARD_LIMIT_USD", file_vals, "15"))
    except Exception:
        hard = 15.0
    try:
        soft = float(cfg("COST_SOFT_LIMIT_USD", file_vals, "5"))
    except Exception:
        soft = 5.0
    try:
        rel_mult = float(cfg("COST_REL_MULTIPLIER", file_vals, "3"))
    except Exception:
        rel_mult = 3.0
    try:
        base_n = int(float(cfg("COST_BASELINE_N", file_vals, "20")))
    except Exception:
        base_n = 20
    try:
        base_min = int(float(cfg("COST_BASELINE_MIN", file_vals, "5")))
    except Exception:
        base_min = 5

    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        return 0  # fail-open
    session_id = payload.get("session_id") or "default"
    transcript_path = payload.get("transcript_path")

    os.makedirs(STATE_DIR, exist_ok=True)
    tripped = os.path.join(STATE_DIR, "%s.tripped" % session_id)
    state_path = os.path.join(STATE_DIR, "%s.json" % session_id)

    # Fast path: already tripped -> deny without parsing/network
    if os.path.exists(tripped):
        emit_deny(hard, hard)
        return 0

    if not transcript_path or not os.path.exists(transcript_path):
        return 0  # nothing to measure -> allow

    state = load_state(state_path)
    state = update_totals_from_transcript(transcript_path, state)
    cost = total_cost(state)

    # Baseline = median of recent recorded sessions. Computed once per session
    # (cached in state) since history.jsonl only changes at SessionEnd. None until
    # enough sessions are recorded (warm-up), which disables the relative warning.
    if "baseline" not in state:
        recent = read_history()[-base_n:]
        state["baseline"] = median(recent) if len(recent) >= base_min else None
    baseline = state.get("baseline")

    if cost >= hard:
        send_telegram(
            token, chat_id,
            "🛑 COST GUARD: 세션 %s 비용 $%.2f가 HARD_LIMIT $%.2f 도달 → 이후 작업 차단"
            % (session_id, cost, hard),
        )
        try:
            open(tripped, "w").close()
        except Exception:
            pass
        save_state(state_path, state)
        emit_deny(cost, hard)
        return 0

    # Relative spike warning: this session costs > baseline x multiplier (non-blocking).
    if baseline and rel_mult > 0 and cost >= baseline * rel_mult and not state.get("rel_notified"):
        send_telegram(
            token, chat_id,
            "📈 COST GUARD: 세션 %s 비용 $%.2f가 평소(중앙값 $%.2f)의 %.1f배 초과 (평소 대비 급증)"
            % (session_id, cost, baseline, rel_mult),
        )
        state["rel_notified"] = True

    if soft and cost >= soft and not state.get("soft_notified"):
        send_telegram(
            token, chat_id,
            "⚠️ COST GUARD: 세션 %s 비용 $%.2f가 SOFT_LIMIT $%.2f 초과 (HARD $%.2f에서 차단)"
            % (session_id, cost, soft, hard),
        )
        state["soft_notified"] = True

    save_state(state_path, state)
    return 0  # allow


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)  # fail-open
