# claude-crs-kit

> CRS 팀의 Claude Code 플러그인 마켓플레이스. Karpathy식 **LLM Wiki 세컨드브레인** 운영 도구로 시작해, 훅·커맨드·스킬을 계속 추가해 나간다.

원본(raw)을 던지면 LLM이 읽고 요약·엔티티·개념·테마 페이지를 만들고, 상호링크·인덱스·로그를
자동으로 유지한다. 병목은 읽기/사고가 아니라 **bookkeeping**이고, 그 grunt work를 도구가 맡는다.
여기에 더해, 임의 리포지토리가 코딩 에이전트에게 얼마나 친화적인지 점수화·시각화하는 스킬을 함께 묶었다.

이 마켓플레이스는 플러그인 1종 **`llm-wiki`** 를 포함한다.

---

## 설치

```text
/plugin marketplace add subjjang2/claude-crs-kit
/plugin install llm-wiki@claude-crs-kit
```

설치하면 아래 커맨드 3종과 스킬 1종이 즉시 활성화된다. 업데이트는 `/plugin update llm-wiki`.

> 로컬 경로로도 설치 가능: `/plugin marketplace add C:/dev_new/claude-crs-kit`

---

## 무엇을 해결하나

개인 지식 기록을 LLM과 함께 쌓다 보면, 정작 시간을 잡아먹는 건 생각이 아니라 **정리·링크·인덱싱·로그 관리**다.
`llm-wiki`는 이 반복 작업을 커맨드로 자동화해, raw를 넣는 순간부터 검색·정합성 점검까지 한 흐름으로 잇는다.

- **남기면 자동으로 정리된다** — `/wiki-ingest`가 요약·엔티티·개념·테마 페이지를 만들고 서로 링크한다.
- **물으면 출처와 함께 답한다** — `/wiki-query`가 위키를 검색해 `[[링크]]` 인용으로 종합 답변하고, 가치 있으면 새 페이지로 파일링한다.
- **방치하면 썩는 걸 막는다** — `/wiki-lint`가 모순·낡은 정보·고아 페이지·누락 링크·stub 공백을 찾아 고친다.
- **에이전트 친화도를 측정한다** — `ai-readiness-cartography` 스킬이 리포를 100점 루브릭으로 채점해 대시보드로 보여준다.

---

## 커맨드

### `/wiki-ingest [대상]`
raw 소스를 읽어 위키 페이지를 생성·갱신한다.

- **대상**: 파일 경로·URL을 주거나, 생략하면 `raw/`의 미처리 파일 + `raw/inbox.md` 항목 전부.
- URL이면 가져와 `raw/`에 스냅샷으로 저장한다. **raw 원본은 절대 수정·삭제하지 않는다.**
- 산출: `wiki/summaries/`에 요약 1장 + 관련 `entities/` · `concepts/` · `themes/` 생성·누적, `[[wikilink]]` 상호연결, `index.md`·`log.md` 갱신.

### `/wiki-query <질문>`
위키 전반을 검색해 `[[링크]]` 출처를 인용하며 한국어로 종합 답변한다.
답변이 재사용 가치가 있으면 새 `concept`/`theme` 페이지로 파일링하고 `index.md`를 갱신한다.

### `/wiki-lint`
정합성을 점검하고 명확한 문제는 즉시 수정한다.

| 점검 항목 | 내용 |
|-----------|------|
| 모순 | 서로 충돌하는 주장 |
| 낡은 정보 | 더 이상 유효하지 않은 서술 |
| 고아 페이지 | 어디서도 `[[링크]]`되지 않는 페이지 |
| 누락 링크 | 본문에 언급됐으나 링크 안 된 페이지 |
| 지식 공백 | stub 상태로 방치된 페이지 |

결과는 `log.md`에 `YYYY-MM-DD LINT 모순 N, 고아 N, 누락 링크 N`으로 append.

---

## 스킬: ai-readiness-cartography

임의 리포지토리를 **AI-Ready v2 루브릭(100점 · 7개 카테고리)**으로 감사하고,
**단일 HTML 대시보드 + 채점 JSON + ROI 순 액션 리스트**를 한 번에 만든다.

- **7개 카테고리**: Navigation · Context Quality · Tribal Knowledge · Dependency Mapping · Verification Gates · Freshness · Agent Outcomes
- 번들된 Python 채점기(`scripts/score.py`)가 커버리지·환각 경로(hallucinated paths)·드리프트·god file을 자동 탐지.
- 산출물 톤은 의사결정용 기술 계기판 — 판타지 지도 아님.
- **트리거 예시**: "이 레포 AI-readiness 점수 매겨줘", "agent-friendly 한지 시각화", "repo cartography", "Claude Code가 이 레포를 잘 다룰까".

---

## vault 구조 (커맨드 동작 전제)

커맨드는 다음 3-layer 구조의 vault에서 동작한다. 없으면 `/wiki-ingest`가 만들면서 채운다.

```text
raw/                 # 1. 불변 원본 — 읽기 전용, 절대 수정·삭제 안 함
  inbox.md           #    텍스트·URL 붙여넣기용 임시함
wiki/                # 2. LLM이 소유하는 영역
  summaries/         #    raw 1개당 요약 1장
  entities/          #    인물·프로젝트·책·습관·도구
  concepts/          #    개념·방법론·원칙
  themes/            #    여러 개념·엔티티를 묶는 상위 주제
  journal/           #    시간순 기록 (선택)
index.md             # 전체 페이지 카탈로그
log.md               # append-only 액션 로그
```

### 페이지 컨벤션
- Obsidian `[[wikilinks]]`로 상호링크 → Graph View 자동 구성. 본문 언어는 한국어 권장.
- 모든 페이지 상단 frontmatter: `type / title / created / updated / sources / tags / status`.
- `log.md`는 `날짜 INGEST|QUERY|LINT ...` 형식으로 **추가만** 한다(기존 줄 수정·삭제 금지).

> 프로젝트 루트에 `CLAUDE.md`가 있고 INGEST/QUERY/LINT 워크플로·컨벤션을 정의했다면
> **그 규칙이 커맨드 기본 동작보다 우선**한다. 커맨드는 그런 정의가 없는 vault에서도 동작하도록 self-contained하게 작성돼 있다.

---

## 일반적인 사용 흐름

```text
1. raw/inbox.md 에 메모·기사·대화를 붙여넣는다
2. /wiki-ingest          → 요약·엔티티·개념 페이지가 자동 생성·연결됨
3. /wiki-query 질문...    → 쌓인 위키에서 출처와 함께 답을 받음
4. 주기적으로 /wiki-lint  → 모순·고아·stub 정리
```

---

## 리포 구성

```text
.claude-plugin/marketplace.json     # 마켓플레이스 정의 (claude-crs-kit)
plugins/llm-wiki/
  .claude-plugin/plugin.json
  commands/   wiki-ingest · wiki-query · wiki-lint
  skills/     ai-readiness-cartography/  (SKILL.md · scripts · assets · references)
  README.md                            # 플러그인 상세
```

플러그인 단독 문서는 [`plugins/llm-wiki/README.md`](plugins/llm-wiki/README.md) 참고.

---

## 업데이트 / 기여

플러그인을 수정한 뒤 `git push` 하면, 팀원은 `/plugin update llm-wiki`로 갱신을 받는다.
버전을 올릴 때는 `marketplace.json`과 `plugins/llm-wiki/.claude-plugin/plugin.json`의 `version`을 함께 맞춘다.
