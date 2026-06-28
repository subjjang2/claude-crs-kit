#!/bin/bash

# Secret Guard Hook — PreToolUse[Edit|Write|Bash|PowerShell]
# 파일 내용 또는 셸 명령에 실 API 키/시크릿이 하드코딩·노출되는 것을 차단.
# env-guard(.env 파일 편집 차단)와 상호보완: 이쪽은 '내용/명령 속 시크릿 값'을 스캔.

INPUT=$(cat)

# 고신뢰 시크릿 패턴 (접두사 + 길이로 오탐 최소화). 한 줄에 하나.
PATTERNS='sk-ant-[A-Za-z0-9_-]{20,}
sk-(proj-)?[A-Za-z0-9]{20,}
ghp_[A-Za-z0-9]{36}
gho_[A-Za-z0-9]{36}
ghs_[A-Za-z0-9]{36}
github_pat_[A-Za-z0-9_]{40,}
AKIA[0-9A-Z]{16}
AIza[0-9A-Za-z_-]{35}
xox[baprs]-[A-Za-z0-9-]{10,}
sk_live_[0-9A-Za-z]{20,}
-----BEGIN[A-Z ]*PRIVATE KEY-----'

HIT=""
while IFS= read -r PAT; do
  [ -z "$PAT" ] && continue
  MATCH=$(echo "$INPUT" | grep -Eo -e "$PAT" | head -1)
  [ -z "$MATCH" ] && continue
  # placeholder/example 는 허용
  case "$MATCH" in
    *EXAMPLE*|*example*|*xxxx*|*XXXX*|*your_*|*your-*|*placeholder*|*PLACEHOLDER*|*dummy*|*DUMMY*) continue ;;
  esac
  # 마스킹: 앞 8자만 노출
  HIT="${MATCH:0:8}…"
  break
done <<EOF
$PATTERNS
EOF

if [ -n "$HIT" ]; then
  cat << EOF2
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "SECRET GUARD: 실 API 키/시크릿으로 보이는 값(${HIT})이 파일 내용 또는 명령에 포함되어 차단했습니다. 시크릿은 코드에 하드코딩하지 말고 .env / 환경변수로 주입하세요. placeholder가 오탐된 경우 'EXAMPLE'·'your_' 등 표식을 쓰세요."
  }
}
EOF2
fi

exit 0
