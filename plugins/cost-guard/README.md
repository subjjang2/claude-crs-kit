# cost-guard

세션 비용을 감시해 **절대 한도 차단(서킷브레이커)** + **평소 대비 급증 경고**를 제공하는 훅.

훅 stdin에는 비용이 실리지 않으므로(`statusLine` 입력에만 있음), `transcript_path`의 JSONL을 읽어 토큰 사용량 × 모델 단가로 세션 누적 비용을 **직접 재계산**한다.

## 동작

- **PreToolUse[*]** — 매 툴 호출 전 누적 비용 평가
  - **HARD 한도($) 도달** → Telegram 알림 + 이후 모든 툴 `deny`(서킷브레이커). 트립 마커(`~/.cache/cost-guard/<session_id>.tripped`) 생성.
  - **평소(최근 N개 세션 비용 중앙값) × 배수 초과** → Telegram 급증 경고(비차단, 세션당 1회).
  - **SOFT 한도($) 초과** → Telegram 경고(비차단, 세션당 1회).
- **SessionEnd** — `--record` 모드로 세션 최종 비용을 `~/.cache/cost-guard/history.jsonl`에 1줄 append. 이 이력이 다음 세션들의 "평소" 기준선(중앙값)이 된다.
- **warm-up**: 기록된 세션이 `COST_BASELINE_MIN`개 미만이면 상대 급증 경고는 비활성(절대 한도만 적용).
- **fail-open**: 어떤 예외든 `exit 0`(툴 허용). 가드 버그가 세션을 막지 않는다.

비용 재계산은 transcript를 offset 기반 **증분 파싱**하며, baseline 중앙값은 세션당 1회만 계산해 상태파일에 캐시한다.

## 설정

환경변수 우선, 없으면 `~/.claude/.cost-guard.env`(`KEY=VALUE`) 폴백:

| 키 | 기본값 | 설명 |
|---|---|---|
| `COST_HARD_LIMIT_USD` | `15` | 차단 절대 한도(USD) |
| `COST_SOFT_LIMIT_USD` | `5` | 경고 절대 한도(USD) |
| `COST_REL_MULTIPLIER` | `3` | 평소(중앙값) 대비 급증 경고 배수 |
| `COST_BASELINE_N` | `20` | 기준선 산출에 쓰는 최근 세션 개수 |
| `COST_BASELINE_MIN` | `5` | 상대 경고를 켜는 최소 이력 개수(warm-up) |
| `TELEGRAM_BOT_TOKEN` | — | Telegram 봇 토큰 |
| `TELEGRAM_CHAT_ID` | — | Telegram 채팅 ID |

### Telegram 연동 테스트

```bash
COST_GUARD_TEST=1 python scripts/cost-guard.py
```

자격증명이 맞으면 테스트 메시지를 보내고 종료한다.

## 트립 해제

차단 상태를 풀려면 새 세션을 시작하거나 `~/.cache/cost-guard/<session_id>.tripped`를 삭제한다.

## 요구사항

- `python3`

## 설치

마켓플레이스 `claude-crs-kit`에서 `cost-guard` 플러그인을 활성화하면 훅이 자동 등록된다. Telegram 알림을 쓰려면 위 환경변수를 설정한다.
