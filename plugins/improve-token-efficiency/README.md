# improve-token-efficiency

Claude Code가 `~/.claude/projects/<encoded-repo-path>/*.jsonl`에 남기는 세션 로그를 파싱해서, 레포 단위로 **토큰 사용·캐시 효율·비용·점수**를 집계하고 개선안을 제시하는 HTML 대시보드를 만드는 스킬이다. 별도 API 호출 없이, CLI가 기록해 둔 assistant 메시지의 `usage` 필드만으로 비용 구조를 재구성한다.

## 사용

스킬은 "토큰 효율 분석", "세션 비용 분석", "analyze token efficiency" 등의 요청에 자동 트리거된다. 수동 실행도 가능하다:

```bash
# 1. 세션 분석 → JSON
python3 skills/improve-token-efficiency/scripts/analyze_sessions.py \
    --repo "$(pwd)" --out /tmp/session_analysis.json

# 2. 대시보드 HTML 생성
python3 skills/improve-token-efficiency/scripts/build_dashboard.py \
    --input /tmp/session_analysis.json --out /tmp/efficiency_report.html
```

Windows에서 인코딩 문제가 있으면 `--sessions-dir`로 `~/.claude/projects/<encoded>/`를 직접 지정한다.

## 점수 (Rubric)

| 지표 | 가중치 | 측정 |
|---|---|---|
| Cache utilization | 40% | `cache_read / total_input`, 0.85↑ 만점 |
| Output density | 20% | `output / total_input`, ~2% sweet spot |
| Read redundancy | 20% | 동일 파일 반복 Read 감점 |
| Tool economy | 20% | 출력 1k 토큰당 툴 호출 수 |

## 구성

- `scripts/analyze_sessions.py` — 세션 파싱·집계·점수화 → JSON
- `scripts/build_dashboard.py` — Chart.js 기반 단일 HTML 대시보드
- `scripts/detect_patterns.py` / `build_patterns_dashboard.py` — 패턴 분석·시각화

Python 3.9+ stdlib만 사용한다 (pip install 불필요).
