# code-review-gate

커밋·PR을 만들기 전에 코드 리뷰를 **강제**하는 2겹 게이트.

- **로컬 게이트 (Claude Code 훅)** — `git commit` / `gh pr create` 직전에 `/code-review` 완료 여부를 검사해, 미완료면 커밋·PR 생성을 차단한다. Bash·PowerShell 양쪽에서 동작한다.
- **원격 게이트 (GitHub Actions)** — PR이 열리면 diff를 LLM에 보내 5축 Risk Score를 채점하고 `risk:*` 라벨 + 요약 코멘트를 남긴다.

## 설치

```text
/plugin marketplace add subjjang2/claude-crs-kit
/plugin install code-review-gate@claude-crs-kit
```

설치하면 로컬 훅은 즉시 활성화된다. GitHub Actions 부분은 레포에 파일을 복사해야 동작한다(아래 참조).

## 1. 로컬 게이트 — `code-review-before-pr.sh`

`PreToolUse[Bash|PowerShell]`에서 실행되어, 명령에 `git commit` 또는 `gh pr create`가 포함될 때만 개입한다. (커밋 메시지 텍스트 속 "commit" 언급에 오발동하지 않도록 단어경계로 매칭)

**동작 — 커밋 게이트 (`KIND=commit`)**
1. 커밋될 변경을 해싱한다 — 기본은 스테이징(`git diff --cached`), `-a/--all/-am`이면 추적파일 전체(`git diff HEAD`).
2. 그 해시를 마커 파일 `.git/code-review-commit-passed`의 해시와 비교한다. 일치하면 허용, 불일치/마커 없음이면 `deny`.
3. **우회 차단** — staged diff가 비어도(`git add X && git commit` 한 줄 묶기, untracked-only, `git commit <pathspec>` 등 훅 시점에 staging이 아직 안 잡힌 경우) 작업트리에 미커밋 변경이 있으면 `diff HEAD + untracked 목록`을 검사 대상으로 잡아 마커와 불일치시켜 deny한다. → "먼저 staging → 마커 기록 → 단독 commit" 정규 절차를 강제.

**동작 — PR 게이트 (`KIND=pr`)**
1. PR base를 결정한다 — `--base <branch>` 존중, 없으면 `main` (`origin/<base>` -> `<base>` -> `origin/master` -> `master` 순으로 해석).
2. 현재 브랜치 `diff <base>...HEAD`의 해시를 마커 파일 `.git/code-review-pr-passed`의 해시와 비교한다.
   - **일치** -> 이미 리뷰된 변경 -> PR 생성 **허용**.
   - **불일치 / 마커 없음** -> `deny` + 절차 안내 반환.

**deny 시 안내 절차**
1. `/code-review medium` 실행 후 findings 검토·반영.
2. 수정·스테이징 완료 후 마커 기록:
   ```bash
   # 커밋 게이트
   git diff --cached | git hash-object --stdin > .git/code-review-commit-passed
   # (git commit -a 면 'diff --cached' 대신 'diff HEAD')

   # PR 게이트
   git diff <base>...HEAD | git hash-object --stdin > .git/code-review-pr-passed
   ```
3. 커밋 / PR 재시도.

**fail-open 설계** — 게이트 오작동으로 작업이 막히는 것을 막기 위해, 다음 경우엔 조용히 통과시킨다: diff가 비고 작업트리도 깨끗할 때, base를 못 찾을 때(shallow/fresh clone), command 추출 실패 시. command 추출과 deny JSON 직렬화는 Windows 경로의 백슬래시 문제를 피하려고 `node`로 처리하며, node 미설치 환경에서는 `sed` 폴백을 쓴다.

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

로컬 훅은 **커밋·PR을 만들기 전**(리뷰 누락 차단), GitHub Actions는 **PR이 열린 후**(위험도 자동 채점)에 동작한다. 커밋은 에이전트가 거의 항상 도구로 실행하므로 커밋 게이트가 1차 방어선, PR 게이트가 보조선이다. 함께 쓰면 사람·CI 양쪽에서 리뷰 누락을 막는다. (단, 사용자가 터미널·웹 UI에서 직접 커밋/PR하는 경로는 막지 못하므로 서버측 강제는 GitHub Actions·branch protection으로 보완)
