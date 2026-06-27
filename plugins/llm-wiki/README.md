# llm-wiki

Karpathy식 **LLM Wiki 세컨드브레인**을 운영하기 위한 Claude Code 플러그인.
raw 원본을 위키로 정리하고, 위키를 검색해 답하고, 정합성을 점검하는 커맨드와
리포지토리의 AI-readiness를 점수화·시각화하는 스킬을 제공한다.

## 커맨드

| 커맨드 | 동작 |
|--------|------|
| `/wiki-ingest [대상]` | raw 소스를 읽어 summary·entity·concept·theme 페이지 생성/갱신. 대상 생략 시 미처리 raw 전부 |
| `/wiki-query <질문>` | 위키를 검색해 `[[링크]]` 인용과 함께 답하고, 가치 있으면 새 페이지로 파일링 |
| `/wiki-lint` | 모순·낡은 정보·고아 페이지·누락 링크·stub 공백 점검 후 수정 |

## 스킬

- **ai-readiness-cartography** — 리포지토리를 v2 AI-Ready 루브릭(100점·7개 카테고리)으로 채점하고
  단일 HTML 대시보드 + ROI 정렬 액션 리스트를 생성. "AI-readiness 지도", "repo cartography",
  "codebase audit 시각화" 등으로 트리거된다.

## 전제: vault 3-layer 구조

커맨드는 다음 구조의 vault에서 동작한다(없으면 `/wiki-ingest`가 만들면서 채운다):

```
raw/        # 불변 원본 (읽기 전용 — 절대 수정·삭제 안 함)
wiki/
  summaries/  entities/  concepts/  themes/  journal/
index.md    # 페이지 카탈로그
log.md      # append-only 액션 로그
```

프로젝트 루트에 `CLAUDE.md`가 있고 INGEST/QUERY/LINT 워크플로·페이지 컨벤션을 정의했다면
**그 규칙이 커맨드 기본 동작보다 우선**한다.

### 페이지 컨벤션 (요약)
- Obsidian `[[wikilinks]]`로 상호링크. 본문 언어는 한국어.
- 모든 페이지 상단 frontmatter: `type / title / created / updated / sources / tags / status`.
- `log.md`는 `날짜 INGEST|QUERY|LINT ...` 형식으로 **추가만** 한다.
