# claude-crs-kit

> CRS 팀의 Claude Code 플러그인 마켓플레이스. 세컨드브레인 운영·테스트 우선 가드·토큰 효율 분석 등 팀 공용 도구를 한곳에 묶어 배포한다. 훅·커맨드·스킬을 계속 추가해 나간다.

이 마켓플레이스는 현재 플러그인 **3종**을 포함한다.

| 플러그인 | 한 줄 설명 | 형태 |
|---|---|---|
| [`llm-wiki`](plugins/llm-wiki/README.md) | raw를 던지면 요약·엔티티·개념·테마 위키 페이지를 자동 생성·링크하고, 리포의 AI-readiness까지 점수화 | 커맨드 3종 + 스킬 1종 |
| [`tdd-guard`](plugins/tdd-guard/README.md) | 테스트 파일이 없는 구현 코드(Edit/Write)를 PreToolUse 훅으로 차단해 테스트 우선 작성을 강제 | 훅 |
| [`improve-token-efficiency`](plugins/improve-token-efficiency/README.md) | Claude Code 세션 로그를 파싱해 토큰·캐시 효율·비용을 점수화하고 HTML 대시보드 + 절감안 생성 | 스킬 |

---

## 설치

```text
/plugin marketplace add subjjang2/claude-crs-kit
/plugin install llm-wiki@claude-crs-kit
/plugin install tdd-guard@claude-crs-kit
/plugin install improve-token-efficiency@claude-crs-kit
```

필요한 플러그인만 골라 설치하면 된다. 업데이트는 `/plugin update <플러그인명>`.

> 로컬 경로로도 설치 가능: `/plugin marketplace add C:/dev_new/claude-crs-kit`

---

## 플러그인

### llm-wiki — LLM Wiki 세컨드브레인

Karpathy식 세컨드브레인 운영 도구. 원본(raw)을 던지면 LLM이 읽고 요약·엔티티·개념·테마 페이지를 만들고, 상호링크·인덱스·로그를 자동으로 유지한다. 병목은 읽기/사고가 아니라 **bookkeeping**이고, 그 grunt work를 도구가 맡는다.

- `/wiki-ingest [대상]` — raw 소스(파일·URL·`raw/inbox.md`)를 읽어 위키 페이지를 생성·갱신하고 `[[wikilink]]`로 상호연결. raw 원본은 절대 수정·삭제하지 않는다.
- `/wiki-query <질문>` — 위키 전반을 검색해 `[[링크]]` 출처를 인용하며 한국어로 종합 답변. 재사용 가치가 있으면 새 페이지로 파일링.
- `/wiki-lint` — 모순·낡은 정보·고아 페이지·누락 링크·stub 공백을 찾아 고치고 `log.md`에 결과 append.
- **스킬 `ai-readiness-cartography`** — 임의 리포를 AI-Ready v2 루브릭(100점 · 7개 카테고리)으로 감사하고 단일 HTML 대시보드 + 채점 JSON + ROI 순 액션 리스트를 생성.

vault는 `raw/`(불변 원본) · `wiki/`(LLM 소유 영역) · `index.md` · `log.md`의 3-layer 구조에서 동작한다. 자세한 동작·컨벤션은 [`plugins/llm-wiki/README.md`](plugins/llm-wiki/README.md) 참고.

### tdd-guard — 테스트 우선 가드 훅

테스트 파일이 없는 구현 코드(Edit/Write)를 **PreToolUse 훅**으로 차단해 테스트 우선 작성(TDD)을 강제한다. TS/JS 소스를 대상으로 하며, 설정·타입·컴포넌트·프레임워크 파일은 예외 처리한다. 자세한 규칙은 [`plugins/tdd-guard/README.md`](plugins/tdd-guard/README.md).

### improve-token-efficiency — 토큰 효율 분석

Claude Code가 `~/.claude/projects/<encoded>/*.jsonl`에 남기는 세션 로그를 파싱해, 별도 API 호출 없이 레포 단위로 **토큰 사용·캐시 효율·비용·점수**를 집계하고 개선안을 제시하는 HTML 대시보드를 만드는 스킬이다.

- 4-axis 루브릭으로 세션을 점수화: Cache utilization(40%) · Output density(20%) · Read redundancy(20%) · Tool economy(20%).
- Chart.js 단일 HTML 대시보드 + 6종 절감안($ 추정) 생성.
- "토큰 효율 분석", "세션 비용 분석", "analyze token efficiency" 등의 요청에 자동 트리거. 자세한 사용법은 [`plugins/improve-token-efficiency/README.md`](plugins/improve-token-efficiency/README.md).

---

## 리포 구성

```text
.claude-plugin/marketplace.json          # 마켓플레이스 정의 (claude-crs-kit)
plugins/
  llm-wiki/                              # 커맨드 3종 + ai-readiness-cartography 스킬
    .claude-plugin/plugin.json
    commands/  ·  skills/  ·  README.md
  tdd-guard/                             # PreToolUse 훅
    .claude-plugin/plugin.json
    hooks/  ·  scripts/  ·  README.md
  improve-token-efficiency/             # 토큰 효율 분석 스킬
    .claude-plugin/plugin.json
    skills/improve-token-efficiency/  ·  README.md
```

---

## 업데이트 / 기여

플러그인을 수정한 뒤 `git push` 하면, 팀원은 `/plugin update <플러그인명>`으로 갱신을 받는다.
버전을 올릴 때는 `marketplace.json`의 해당 항목과 각 플러그인 `.claude-plugin/plugin.json`의 `version`을 함께 맞춘다.
