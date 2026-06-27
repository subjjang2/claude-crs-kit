---
description: raw 소스를 읽어 위키 페이지로 정리 (summary·entity·concept·theme 생성/갱신)
---

# INGEST — 원본을 위키로 정리

> 프로젝트에 `CLAUDE.md`가 있고 INGEST 워크플로·페이지 컨벤션을 정의했다면 **그 규칙을 우선**한다.
> 아래는 그런 정의가 없을 때 쓰는 기본 워크플로다.

대상: $ARGUMENTS (비어 있으면 `raw/`에서 아직 ingest 안 된 파일 + `raw/inbox.md` 미처리 항목 전부)

## 절차
1. 대상 raw 파일을 읽는다. URL이면 WebFetch로 가져와 `raw/`에 스냅샷으로 저장한다. **raw 원본은 절대 수정·삭제하지 않는다.**
2. 핵심 takeaway를 한국어로 간단히 짚어준다.
3. `wiki/summaries/`에 요약 페이지를 작성한다(원문 복붙 금지, 압축·재구성). 끝에 "→ 연결된 개념/엔티티" 섹션으로 `[[링크]]` 나열.
4. 관련 **entity / concept / theme** 페이지를 생성·갱신하고 서로 `[[wikilink]]`로 연결한다. 기존 페이지가 있으면 새 정보를 누적(중복·모순 주의)하고 `updated`를 갱신.
5. `index.md`(카탈로그)에 신규/변경 페이지를 반영한다.
6. `log.md`에 INGEST 줄을 **추가만** 한다(기존 줄 수정·삭제 금지).

## 페이지 컨벤션
- 모든 위키 페이지 상단에 frontmatter:
  ```yaml
  ---
  type: summary | entity | concept | theme | journal
  title: 페이지 제목
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  sources: ["[[원본파일명]]"]
  tags: [태그]
  status: stub | active | stable
  ---
  ```
- 날짜는 추측하지 말고 현재 날짜를 쓴다. 파일명 = 페이지 제목(한국어·공백 허용).
- 새 페이지를 언급할 땐 즉시 `[[링크]]`로 건다(대상이 아직 없어도 stub 자리표시).

## log.md 포맷
```
YYYY-MM-DD INGEST raw/<파일> → summaries/<페이지>, +[[엔티티]] +[[개념]]
```
