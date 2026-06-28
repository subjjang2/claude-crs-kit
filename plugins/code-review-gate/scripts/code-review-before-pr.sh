#!/bin/bash

# Code Review Gate Hook — PreToolUse[Bash]
# gh pr create 전에 /code-review 완료를 강제한다.
# 마커 파일(.git/code-review-pr-passed)의 해시가 현재 브랜치 diff 해시(PR base 기준)와
# 일치할 때만 PR 생성을 허용, 불일치 시 deny + 절차 지시를 반환한다.

INPUT=$(cat)

# command 추출은 진짜 JSON 파서(node)로 — sed 스크랩은 --title/--body 안의
# 따옴표를 만나면 값을 과탐(over-grab)한다 (context-path-guard.sh:14 와 동일 패턴).
# node 미설치 환경에서만 기존 sed 방식으로 폴백한다.
extract_command() {
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.command)||"")}catch(e){}})'
  else
    echo "$INPUT" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p'
  fi
}
COMMAND=$(extract_command)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# gh pr create 감지 — 연속 공백을 1칸으로 squeeze 해 'gh pr  create' 류 변형도 잡는다.
NORM=$(echo "$COMMAND" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ')
case "$NORM" in
  *"gh pr create"*) ;;
  *) exit 0 ;;
esac

# 프로젝트 루트
REPO_DIR="${CLAUDE_PROJECT_DIR:-.}"
MARKER_FILE="$REPO_DIR/.git/code-review-pr-passed"

# PR 의 실제 base 를 존중 (--base <branch> / --base=<branch>), 없으면 main.
# 브랜치 이름은 대소문자 구분이므로 squeeze 안 한 원본 COMMAND 에서 추출.
PR_BASE=$(echo "$COMMAND" | grep -oE '\-\-base[ =]+[^ ]+' | head -1 | sed -E 's/^--base[ =]+//')
[ -z "$PR_BASE" ] && PR_BASE="main"

# 베이스 해석 (origin/<base> → <base> → origin/master → master 순)
BASE=$(git -C "$REPO_DIR" rev-parse --verify "origin/$PR_BASE" 2>/dev/null \
     || git -C "$REPO_DIR" rev-parse --verify "$PR_BASE" 2>/dev/null \
     || git -C "$REPO_DIR" rev-parse --verify origin/master 2>/dev/null \
     || git -C "$REPO_DIR" rev-parse --verify master 2>/dev/null)

if [ -z "$BASE" ]; then
  exit 0  # 베이스를 못 찾으면 통과 (게이트 오작동 방지 — fresh/shallow clone)
fi

# 현재 브랜치와 베이스 간 diff 해시 (PR에 포함될 전체 변경)
DIFF_CONTENT=$(git -C "$REPO_DIR" diff "$BASE"...HEAD 2>/dev/null)

# diff 가 비어있으면(변경 없음) PR도 의미 없으므로 통과
if [ -z "$DIFF_CONTENT" ]; then
  exit 0
fi

DIFF_HASH=$(echo "$DIFF_CONTENT" | git -C "$REPO_DIR" hash-object --stdin 2>/dev/null)

# 마커 해시와 비교
if [ -f "$MARKER_FILE" ]; then
  MARKER_HASH=$(tr -d '[:space:]' < "$MARKER_FILE" 2>/dev/null)
  if [ "$MARKER_HASH" = "$DIFF_HASH" ]; then
    exit 0  # 이미 리뷰된 변경 — PR 생성 허용
  fi
fi

# 리뷰 미완료 → deny + 절차 안내.
# deny JSON 은 node 로 직렬화한다 — Windows 경로의 백슬래시(C:\dev_new\...)를
# heredoc 으로 raw 보간하면 \d, \t 같은 잘못된 JSON escape 가 되어 Claude Code 가
# 파싱에 실패하고 deny 가 무시(fail-open)된다. JSON.stringify 가 안전하게 escape.
REASON="CODE REVIEW GATE: PR 생성 전에 코드 리뷰가 완료되지 않았습니다 (base: ${PR_BASE}). 다음 순서로 진행하세요 — ① /code-review medium 실행 후 findings 검토·반영, ② 수정·스테이징·커밋 완료 후 마커 기록 (git -C \"${REPO_DIR}\" diff ${BASE}...HEAD | git -C \"${REPO_DIR}\" hash-object --stdin > \"${MARKER_FILE}\"), ③ PR 재생성."

if command -v node >/dev/null 2>&1; then
  printf '%s' "$REASON" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:s}}))})'
else
  # node 미설치 폴백: 백슬래시·따옴표만 escape.
  ESC=$(printf '%s' "$REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "${ESC}"
  }
}
EOF
fi

exit 0
