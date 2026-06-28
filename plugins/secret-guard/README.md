# secret-guard

파일 내용·셸 명령에 **실 API 키/토큰/개인키가 하드코딩**되는 것을 `PreToolUse` 단계에서 차단하는 훅.

## 동작

- 대상: `Edit` · `Write` · `Bash` · `PowerShell`
- 고신뢰 패턴(접두사 + 길이)으로 매칭해 오탐 최소화:
  - `sk-ant-…`(Anthropic), `sk-…`/`sk_live_…`(OpenAI/Stripe), `ghp_`/`gho_`/`ghs_`/`github_pat_…`(GitHub),
    `AKIA…`(AWS), `AIza…`(Google), `xox[baprs]-…`(Slack), `-----BEGIN … PRIVATE KEY-----`(PEM)
- 매칭 시 `permissionDecision: deny` + 사유 반환. 매칭값은 **앞 8자만** 마스킹 노출.
- placeholder는 허용: `EXAMPLE` · `your_` · `placeholder` · `dummy` · `xxxx` 등 표식 포함 시 통과.

`.env` 파일 자체의 편집을 막는 가드(env-guard)와 **상호보완** — 이쪽은 "내용/명령 속 시크릿 값"을 스캔한다.

## 요구사항

- `bash` (Git Bash 등), `grep`

## 설치

마켓플레이스 `claude-crs-kit`에서 `secret-guard` 플러그인을 활성화하면 훅이 자동 등록된다.
