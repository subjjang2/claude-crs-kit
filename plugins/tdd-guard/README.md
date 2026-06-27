# tdd-guard

테스트 없이 구현 코드를 작성하는 것을 **막는** Claude Code 훅 플러그인.

`Edit`/`Write`로 TS/JS 소스 파일을 작성하려 할 때, 해당 모듈의 테스트 파일이 먼저 존재하는지
검사한다. 없으면 `PreToolUse` 단계에서 차단하고, 테스트를 먼저 작성하라는 메시지를 띄운다.

## 설치

```text
/plugin marketplace add subjjang2/claude-crs-kit
/plugin install tdd-guard@claude-crs-kit
```

설치하면 별도 설정 없이 훅이 즉시 활성화된다.

## 동작

`PreToolUse[Edit|Write]`에서 `scripts/tdd-guard.sh`가 실행되어 대상 `file_path`를 검사한다.

**차단 대상** — `.ts` / `.tsx` / `.js` / `.jsx` 소스 파일 중 짝이 되는 테스트가 없는 경우.

**탐색하는 테스트 위치**
- 같은 폴더의 `<name>.test.*` / `<name>.spec.*`
- 인접 또는 상위의 `__tests__/<name>.test.*`
- `<repo>/src/__tests__/<name>.test.*`

**예외 (항상 허용)**
- 테스트 파일 자체 — `*.test.*`, `*.spec.*`, `*_test.*`, `*_spec.*`, `__tests__/` 하위
- 설정·문서·스타일 — `*.json`, `*.css`, `*.scss`, `*.md`, `*.yml`, `*.env*`, `*.config.*`, `tsconfig` 등
- `types/` 폴더 및 타입 선언 파일
- Next.js 프레임워크 파일 — `layout`, `page`, `loading`, `error`, `not-found`, `globals.css`
- `components/` — presentation 레이어로 간주(로직은 `lib/`에 두고 거기서 TDD 강제)

## 의존성

`jq`가 있으면 사용하고, 없으면 `python`으로 JSON을 파싱한다(Windows/jq 미설치 환경 대응).
`bash` 실행 환경이 필요하다.

## 커스터마이즈

예외 규칙이나 테스트 탐색 경로는 `scripts/tdd-guard.sh`의 `case` 블록에서 조정한다.
