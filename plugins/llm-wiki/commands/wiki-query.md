---
description: 위키를 검색해 질문에 답하고, 가치 있으면 새 페이지로 파일링
---

# QUERY — 위키 기반 질의응답

> 프로젝트에 `CLAUDE.md`가 있고 QUERY 워크플로를 정의했다면 **그 규칙을 우선**한다.

질문: $ARGUMENTS

## 절차
1. `wiki/` 전반을 검색해 관련 페이지를 찾는다.
2. `[[링크]]`로 출처를 인용하며 한국어로 종합 답변한다(근거 없는 추측 금지).
3. 답변이 재사용 가치가 있으면 새 `concept`/`theme` 페이지로 파일링하고 `index.md`를 갱신한다(frontmatter·wikilink 컨벤션은 ingest와 동일).
4. `log.md`에 QUERY 줄을 **추가만** 한다:
   ```
   YYYY-MM-DD QUERY "<질문>" → answer; filed concepts/<새 페이지>
   ```
