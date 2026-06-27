# llm-wiki-tools — Claude Code 플러그인 마켓플레이스

LLM Wiki 세컨드브레인 운영 도구를 팀에 배포하기 위한 마켓플레이스.
현재 플러그인 1종(`llm-wiki`)을 포함한다.

## 설치 (팀원용)

```
/plugin marketplace add C:/dev_new/llm-wiki-marketplace
/plugin install llm-wiki@llm-wiki-tools
```

> git URL로 배포한 경우:
> ```
> /plugin marketplace add <git-host>/<owner>/llm-wiki-marketplace
> /plugin install llm-wiki@llm-wiki-tools
> ```

설치하면 `/wiki-ingest`, `/wiki-query`, `/wiki-lint` 커맨드와 `ai-readiness-cartography` 스킬을 쓸 수 있다.

## 구성

```
.claude-plugin/marketplace.json   # 마켓플레이스 정의
plugins/llm-wiki/                 # 플러그인 (커맨드 3 + 스킬 1)
```

플러그인 상세는 [`plugins/llm-wiki/README.md`](plugins/llm-wiki/README.md) 참고.
