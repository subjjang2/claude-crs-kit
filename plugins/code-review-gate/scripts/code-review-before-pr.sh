#!/bin/bash

# Code Review Gate Hook — PreToolUse[Bash|PowerShell]
# git commit / gh pr create 전에 /code-review 완료를 강제한다.
# 해당 시점의 diff 해시가 마커 파일 해시와 일치할 때만 허용, 불일치 시 deny + 절차 지시.
#   - commit: 스테이징 변경(git diff --cached; -a 면 diff HEAD) ↔ .git/code-review-commit-passed
#   - pr    : base...HEAD 변경                                  ↔ .git/code-review-pr-passed

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

# 명령 종류 판별 — 부분일치는 커밋 메시지 안의 문구 언급에도 오발동하므로,
# 실제 호출만 잡도록 단어 경계로 매칭한다. squeeze + lowercase 후 검사.
NORM=$(echo "$COMMAND" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ')
if echo "$NORM" | grep -Eq '(^|[;&|] *)git( +-[^ ]+| +--[^ ]+| +-c +[^ ]+)* +commit( |$)'; then
  KIND=commit
elif echo "$NORM" | grep -Eq '(^|[;&|] *)gh +pr +create( |$)'; then
  KIND=pr
else
  exit 0
fi

# 프로젝트 루트
REPO_DIR="${CLAUDE_PROJECT_DIR:-.}"

if [ "$KIND" = commit ]; then
  # 아직 커밋 안 된 변경을 해싱. -a/--all/-am 은 스테이징을 건너뛰므로 추적파일 전체(diff HEAD).
  # 단, -a 감지는 실제 플래그에만 반응해야 한다 — 따옴표로 감싼 커밋 메시지(-m "...add -a...")를
  # 먼저 제거한 뒤 검사해 메시지 텍스트 속 ' -a' 로 인한 오탐(잘못된 diff 소스 전환)을 막는다.
  FLAGS=$(echo "$NORM" | sed "s/\"[^\"]*\"//g; s/'[^']*'//g")
  case "$FLAGS" in
    *" -a"*|*" --all"*|*" -am"*) DIFF_CONTENT=$(git -C "$REPO_DIR" diff HEAD 2>/dev/null) ;;
    *)                           DIFF_CONTENT=$(git -C "$REPO_DIR" diff --cached 2>/dev/null) ;;
  esac
  # 우회 차단: staged diff 가 비어도(= `git add && git commit` 한 줄 묶기, untracked-only,
  # `git commit <pathspec>` 등으로 훅 시점에 staging 이 아직 안 잡힌 경우) 커밋될 변경이
  # 작업트리에 남아 있으면 통과시키지 않는다. 전체 작업트리(diff HEAD + untracked 목록)를
  # 검사 대상으로 삼으면 cached 기반 마커와 반드시 불일치 → deny 로 떨어져, "먼저 staging →
  # 마커 기록 → 단독 commit" 정규 절차를 강제한다. (line 68 의 빈-diff 통과로 새지 않게)
  if [ -z "$DIFF_CONTENT" ] && [ -n "$(git -C "$REPO_DIR" status --porcelain 2>/dev/null)" ]; then
    DIFF_CONTENT=$(git -C "$REPO_DIR" diff HEAD 2>/dev/null)
    UNTRACKED=$(git -C "$REPO_DIR" ls-files --others --exclude-standard 2>/dev/null)
    DIFF_CONTENT="${DIFF_CONTENT}${UNTRACKED}"
  fi
  MARKER_FILE="$REPO_DIR/.git/code-review-commit-passed"
else
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
  # 베이스를 못 찾으면 통과 (게이트 오작동 방지 — fresh/shallow clone)
  [ -z "$BASE" ] && exit 0
  DIFF_CONTENT=$(git -C "$REPO_DIR" diff "$BASE"...HEAD 2>/dev/null)
fi

# diff 가 비어있으면(변경 없음) 통과
[ -z "$DIFF_CONTENT" ] && exit 0

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
if [ "$KIND" = commit ]; then
  REASON="CODE REVIEW GATE: 커밋 전에 코드 리뷰가 완료되지 않았습니다. 다음 순서로 진행하세요 — ① /code-review medium 실행 후 findings 검토·반영, ② 수정분을 git add 로 스테이징, ③ 마커 기록 (git -C \"${REPO_DIR}\" diff --cached | git -C \"${REPO_DIR}\" hash-object --stdin > \"${MARKER_FILE}\"  — git commit -a 면 'diff --cached' 대신 'diff HEAD'), ④ 커밋 재시도."
else
  REASON="CODE REVIEW GATE: PR 생성 전에 코드 리뷰가 완료되지 않았습니다 (base: ${PR_BASE}). 다음 순서로 진행하세요 — ① /code-review medium 실행 후 findings 검토·반영, ② 수정·스테이징·커밋 완료 후 마커 기록 (git -C \"${REPO_DIR}\" diff ${BASE}...HEAD | git -C \"${REPO_DIR}\" hash-object --stdin > \"${MARKER_FILE}\"), ③ PR 재생성."
fi

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
