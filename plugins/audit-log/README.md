# audit-log

모든 툴 호출을 `PostToolUse` 단계에서 JSONL 감사 로그로 남기는 훅.

## 동작

- 대상: 모든 툴(`matcher: *`)
- 각 호출마다 한 줄(JSON)을 `<project>/.claude/audit.jsonl`에 append:
  - `ts`(UTC ISO8601), `session_id`, `tool`(tool_name), `args`(tool_input), `result`(tool_response)
- `result`는 4000자 초과 시 truncate.
- 로그 경로 기준: `CLAUDE_PROJECT_DIR` 우선, 없으면 스크립트 위치 기준.
- **fail-open**: 어떤 예외든 삼키고 `exit 0` — 로깅 실패가 세션을 막지 않는다.

## 요구사항

- `python3`

## 설치

마켓플레이스 `claude-crs-kit`에서 `audit-log` 플러그인을 활성화하면 훅이 자동 등록된다.

> `.claude/audit.jsonl`은 커밋되지 않도록 `.gitignore`에 추가하는 것을 권장한다.
