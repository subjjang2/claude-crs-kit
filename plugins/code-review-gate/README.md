# code-review-gate

PR을 만들기 전에 코드 리뷰를 **강제**하는 2겹 게이트.

- **로컬 게이트 (Claude Code 훅)** — `gh pr create` 직전에 `/code-review` 완료 여부를 검사해, 미완료면 PR 생성을 차단한다.
- **원격 게이트 (GitHub Actions)** — PR이 열리면 diff를 LLM에 보내 5축 Risk Score를 채점하고 `risk:*` 라벨 + 요약 코멘트를 남긴다.

## 설치

```text
/plugin marketplace add subjjang2/claude-crs-kit
/plugin install code-review-gate@claude-crs-kit
```

설치하면 로컬 훅은 즉시 활성화된다. GitHub Actions 부분은 레포에 파일을 복사해야 동작한다(아래 참조).

## 1. 로컬 게이트 — `code-review-before-pr.sh`

`PreToolUse[Bash]`에서 실행되어, Bash 명령에 `gh pr create`가 포함될 때만 개입한다.

**동작**
1. PR base를 결정한다 — `--base <branch>` 존중, 없으면 `main` (`origin/<base>` -> `<base>` -> `origin/master` -> `master` 순으로 해석).
2. 현재 브랜치 `diff <base>...HEAD`의 해시를 마커 파일 `.git/code-review-pr-passed`의 해시와 비교한다.
   - **일치** -> 이미 리뷰된 변경 -> PR 생성 **허용**.
   - **불일치 / 마커 없음** -> `deny` + 절차 안내 반환.

**deny 시 안내 절차**
1. `/code-review medium` 실행 후 findings 검토·반영.
2. 수정·스테이징·커밋 완료 후 마커 기록:
   ```bash
   git diff <base>...HEAD | git hash-object --stdin > .git/code-review-pr-passed
   ```
3. PR 재생성.

**fail-open 설계** — 게이트 오작동으로 작업이 막히는 것을 막기 위해, 다음 경우엔 조용히 통과시킨다: diff가 비었을 때, base를 못 찾을 때(shallow/fresh clone), command 추출 실패 시. command 추출과 deny JSON 직렬화는 Windows 경로의 백슬래시 문제를 피하려고 `node`로 처리하며, node 미설치 환경에서는 `sed` 폴백을 쓴다.

## 2. 원격 게이트 — AI PR Review (GitHub Actions)

플러그인 설치만으로는 GitHub Actions가 자동 배치되지 않는다. 다음 파일을 대상 레포에 복사한다.

```text
github/workflows/ai-pr-review.yml   ->  .github/workflows/ai-pr-review.yml
github/scripts/ai-review.mjs        ->  .github/scripts/ai-review.mjs
github/scripts/package.json         ->  .github/scripts/package.json
```

**동작** — `pull_request`(opened/synchronize/reopened)에서 `ai-review.mjs`가 PR diff를 OpenAI 호환 엔드포인트로 보내 채점한다.

- 5축 Risk Score: `security(30)` · `scope(20)` · `breaking(20)` · `tests(15)` · `migration(15)`.
- 총점 -> 등급 라벨: `risk:low` / `risk:medium` / `risk:high` / `risk:critical`.
- 결과를 PR에 단일 코멘트로 작성(있으면 업데이트, 숨김 마커 `<!-- ai-pr-review -->`로 추적).
- fork PR은 Secrets 접근이 안 되어 자동 스킵된다.

**필요 설정**
- Secret: `LLM_API_KEY` (OpenAI 호환 키).
- 워크플로우 env: `OPENAI_BASE_URL`, `OPENAI_MODEL` (기본 `qwen3.6-35b-a3b-prismaquant`). 사내 엔드포인트면 `ai-pr-review.yml`의 값을 조정.
- 권한: `pull-requests: write`, `issues: write`(라벨 부착).
- diff 상한 15,000자 / 출력 1,500토큰 — 서버 60초 timeout 회피용.

## 두 게이트의 관계

로컬 훅은 **PR을 만들기 전**(리뷰 누락 차단), GitHub Actions는 **PR이 열린 후**(위험도 자동 채점)에 동작한다. 함께 쓰면 사람·CI 양쪽에서 리뷰 누락을 막는다.
