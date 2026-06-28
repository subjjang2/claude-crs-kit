// AI 기반 PR 리뷰 스크립트.
// PR diff를 OpenAI 호환 엔드포인트(커스텀 LLM 포함)에 보내
// 5축 Risk Score 채점 + 한국어 요약 리뷰를 받고,
// 결과를 PR에 단일 코멘트로 작성(있으면 업데이트)한다.

const {
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  OPENAI_MODEL = "qwen3.6-35b-a3b-prismaquant",
  GITHUB_TOKEN,
  REPO,
  PR_NUMBER,
} = process.env;

// diff가 너무 길면 prefill 시간이 늘어 서버 60초 hard timeout에 걸린다.
// 입력을 줄여 모델 응답을 60초 안에 끝내기 위한 상한(문자 기준).
const MAX_DIFF_CHARS = 15_000;

// 출력 토큰 상한. 생성 시간은 출력 토큰 수에 비례하므로, 서버 timeout 안에
// 응답을 끝내려면 출력도 제한해야 한다. 리뷰 JSON에는 충분한 여유.
const MAX_OUTPUT_TOKENS = 1500;

// 코멘트를 다시 찾기 위한 숨김 마커.
const MARKER = "<!-- ai-pr-review -->";

// 각 축의 만점. Risk Score = 높을수록 위험.
const MAX_SCORE = {
  security: 30,
  scope: 20,
  breaking: 20,
  tests: 15,
  migration: 15,
};

// 총점 → 위험 등급. max는 해당 등급의 상한(이하)을 뜻한다.
const RISK_LEVELS = [
  {
    max: 15,
    label: "risk:low",
    emoji: "🟢",
    action: "AI 코멘트만. 1명 승인으로 auto-merge 후보.",
  },
  {
    max: 35,
    label: "risk:medium",
    emoji: "🟡",
    action: "사람 리뷰어 1명 필수 지정. Auto-merge 비활성.",
  },
  {
    max: 60,
    label: "risk:high",
    emoji: "🟠",
    action: "시니어 1명 지정 + Security/Architecture 리뷰 추가 호출.",
  },
  {
    max: 100,
    label: "risk:critical",
    emoji: "🔴",
    action: "즉시 사람 호출. RFC/ADR 링크 요구. Merge 차단.",
  },
];
const RISK_LABELS = RISK_LEVELS.map((l) => l.label);

const GITHUB_API = "https://api.github.com";

function assertEnv() {
  const missing = ["OPENAI_API_KEY", "GITHUB_TOKEN", "REPO", "PR_NUMBER"].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    console.error(`필수 환경변수 누락: ${missing.join(", ")}`);
    process.exit(1);
  }
}

async function gh(path, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${path}`);
  }
  return res;
}

async function getPr() {
  const res = await gh(`/repos/${REPO}/pulls/${PR_NUMBER}`);
  return res.json();
}

async function getFiles() {
  const files = [];
  for (let page = 1; ; page++) {
    const res = await gh(
      `/repos/${REPO}/pulls/${PR_NUMBER}/files?per_page=100&page=${page}`,
    );
    const batch = await res.json();
    files.push(...batch);
    if (batch.length < 100) break;
  }
  return files;
}

// 파일별 patch를 이어붙여 리뷰용 diff 텍스트를 만든다. 상한을 넘으면 잘라낸다.
function buildDiff(files) {
  let diff = "";
  let truncated = false;
  for (const f of files) {
    const header = `\n### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n`;
    const patch = f.patch ?? "(binary 또는 patch 없음)";
    if (diff.length + header.length + patch.length > MAX_DIFF_CHARS) {
      truncated = true;
      break;
    }
    diff += `${header}${patch}\n`;
  }
  return { diff, truncated };
}

const SYSTEM_PROMPT = `당신은 시니어 코드 리뷰어입니다. 주어진 GitHub Pull Request의 diff를 검토해
(1) 머지 위험도를 아래 5개 축으로 채점하고 (2) 한국어로 간결한 리뷰를 작성합니다.
diff에 실제로 존재하는 근거만 사용하고, 추측하거나 지어내지 마세요.

## Risk Score Rubric (총 100점, 높을수록 위험)

1. 보안 (security) — 0~30점
   - 0점: 보안 표면에 영향 없음
   - 만점: auth·permission·secret·암호화 관련 변경, 미검증 사용자 입력 등 새 외부 입력 경로, 알려진 CVE가 있는 의존성 추가
   - 보안은 한 번 뚫리면 복구가 어려워 가중치가 가장 높습니다.

2. 스코프 (scope) — 0~20점
   - 변경 파일 수·라인 수·영향 모듈 수에 비례
   - 약 5파일/100줄 = 낮음, 30파일/2000줄 이상 = 만점에 근접
   - 큰 PR은 사람 리뷰가 필수입니다.

3. breaking change — 0~20점
   - public API 시그니처 변경, DB 스키마 변경, 환경 변수 추가/제거, deprecated 마킹
   - backward compatibility를 깨는 변경일수록 높게

4. 테스트 커버리지 (tests) — 0~15점 (신뢰도가 낮을수록 높은 점수)
   - 새 코드에 대응하는 테스트 부재, 기존 테스트 삭제, 커버리지 하락 시 높게
   - 테스트가 충실하면 0점에 가깝게

5. 마이그레이션 (migration) — 0~15점
   - DB 마이그레이션, 데이터 백필, 환경 설정 변경 동반 여부
   - 롤백이 어려운 변경일수록 높게

각 축은 정수로 채점하고 상한을 넘기지 마세요.
findings에는 코드 근거가 있는 항목만 넣으세요.

출력은 간결하게: summary는 2~3문장, findings는 가장 중요한 최대 4개,
각 detail은 1~2문장으로 제한하세요(응답이 길면 서버 timeout으로 잘립니다).

반드시 아래 JSON 형식으로만 응답하세요. 설명 없이 JSON만 출력하세요:
{
  "scores": {
    "security": <0-30 정수>,
    "scope": <0-20 정수>,
    "breaking": <0-20 정수>,
    "tests": <0-15 정수>,
    "migration": <0-15 정수>
  },
  "summary": "<한국어 요약>",
  "findings": [
    { "title": "<제목>", "severity": "low|medium|high", "detail": "<상세>" }
  ],
  "recommendation": "<권장 사항>"
}`;

const RESPONSE_SCHEMA = {
  name: "pr_review",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      scores: {
        type: "object",
        additionalProperties: false,
        properties: {
          security: { type: "integer" },
          scope: { type: "integer" },
          breaking: { type: "integer" },
          tests: { type: "integer" },
          migration: { type: "integer" },
        },
        required: ["security", "scope", "breaking", "tests", "migration"],
      },
      summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            severity: { type: "string", enum: ["low", "medium", "high"] },
            detail: { type: "string" },
          },
          required: ["title", "severity", "detail"],
        },
      },
      recommendation: { type: "string" },
    },
    required: ["scores", "summary", "findings", "recommendation"],
  },
};

// JSON 텍스트에서 첫 번째 { ... } 블록을 추출한다 (평문 폴백용).
function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("응답에서 JSON을 찾을 수 없습니다.");
  return JSON.parse(match[0]);
}

// 연결 끊김(Premature close 등)·5xx는 일시적일 수 있으므로 지수백오프로 재시도한다.
// 400/422 같은 요청 오류는 재시도해도 같으므로 즉시 던진다.
const MAX_ATTEMPTS = 4;

function isRetriable(e) {
  const status = e?.status;
  if (status && status < 500 && status !== 429) return false; // 4xx(429 제외)는 영구 오류
  const msg = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  return (
    !status ||
    status >= 500 ||
    status === 429 ||
    /premature close|econnreset|socket hang up|timeout|fetch failed|terminated|network/i.test(
      msg,
    )
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(label, fn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetriable(e) || attempt === MAX_ATTEMPTS) throw e;
      const backoff = Math.min(2000 * 2 ** (attempt - 1), 15000);
      console.warn(
        `${label} 실패(시도 ${attempt}/${MAX_ATTEMPTS}): ${e.message} — ${backoff}ms 후 재시도`,
      );
      await sleep(backoff);
    }
  }
  throw lastErr;
}

const LLM_BASE = OPENAI_BASE_URL || "https://api.openai.com/v1";

// LLM 호출은 openai SDK 대신 raw fetch로 한다.
// SDK는 chat_template_kwargs 같은 비표준 파라미터를 요청에서 누락시켜
// reasoning(thinking)이 꺼지지 않았고, 그 결과 응답이 길어져 GitHub Actions
// 경로에서 연결이 끊겼다(Premature close). raw fetch는 보낸 body를 그대로
// 전송하므로 reasoning이 정상적으로 꺼지고 CI에서 안정적으로 동작한다(probe 검증).
async function streamContent(params) {
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      max_tokens: MAX_OUTPUT_TOKENS,
      // reasoning(thinking) 비활성화. 켜면 thinking에 토큰을 대량 소비해 생성이
      // 수십 초로 길어지고 연결이 끊긴다. 끄면 ~4초로 단축. (vLLM/Qwen 표준 옵션)
      chat_template_kwargs: { enable_thinking: false },
      ...params,
      stream: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `LLM ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
    );
    err.status = res.status;
    throw err;
  }
  // SSE 스트림을 줄 단위로 파싱해 delta.content를 누적한다. 토큰을 받는 대로
  // 바이트가 흘러 프록시 idle timeout도 회피한다.
  let content = "";
  let buf = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        content += JSON.parse(data).choices?.[0]?.delta?.content ?? "";
      } catch {
        // 부분 청크/keep-alive 라인은 무시
      }
    }
  }
  if (!content.trim()) throw new Error("스트림에서 빈 응답을 받았습니다.");
  return content;
}

async function review({ pr, stats, diff, truncated }) {

  const userContent = [
    `저장소: ${REPO}`,
    `PR #${PR_NUMBER}: ${pr.title}`,
    "",
    "설명:",
    pr.body || "(없음)",
    "",
    `변경 통계: ${stats.changedFiles} files, +${stats.additions} / -${stats.deletions}`,
    truncated ? "주의: diff가 길어 일부만 포함되었습니다." : "",
    "",
    "=== DIFF ===",
    diff,
  ].join("\n");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  // 1차: strict json_schema (OpenAI 네이티브 지원 시 최우선)
  try {
    const content = await withRetry("json_schema", () =>
      streamContent({
        model: OPENAI_MODEL,
        messages,
        response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
      }),
    );
    return JSON.parse(content);
  } catch (e) {
    const isUnsupported =
      e?.status === 400 || e?.status === 422 || /json_schema|response_format/i.test(e?.message ?? "");
    if (!isUnsupported) throw e;
    console.warn(`json_schema 미지원, json_object 폴백: ${e.message}`);
  }

  // 2차: json_object (대부분의 OpenAI 호환 서버가 지원)
  try {
    const content = await withRetry("json_object", () =>
      streamContent({
        model: OPENAI_MODEL,
        messages,
        response_format: { type: "json_object" },
      }),
    );
    return JSON.parse(content);
  } catch (e) {
    const isUnsupported =
      e?.status === 400 || e?.status === 422 || /json_object|response_format/i.test(e?.message ?? "");
    if (!isUnsupported) throw e;
    console.warn(`json_object 미지원, 평문 폴백: ${e.message}`);
  }

  // 3차: 평문 응답에서 JSON 블록 추출
  const content = await withRetry("plain", () =>
    streamContent({ model: OPENAI_MODEL, messages }),
  );
  return extractJson(content);
}

// 모델이 범위를 벗어난 점수를 줄 수 있으므로 0~만점으로 보정.
function clampScores(raw) {
  const out = {};
  for (const key of Object.keys(MAX_SCORE)) {
    const v = Math.round(raw?.[key] ?? 0);
    out[key] = Math.max(0, Math.min(MAX_SCORE[key], v));
  }
  return out;
}

function riskLevel(total) {
  return RISK_LEVELS.find((l) => total <= l.max) ?? RISK_LEVELS.at(-1);
}

function renderComment({ data, scores, total, level, stats, truncated }) {
  const sevEmoji = { high: "🔴", medium: "🟡", low: "🟢" };
  const findings = data.findings?.length
    ? data.findings
        .map((f) => `- ${sevEmoji[f.severity] ?? "•"} **${f.title}** — ${f.detail}`)
        .join("\n")
    : "_특이사항 없음_";

  return [
    MARKER,
    "## 🤖 AI PR 리뷰",
    "",
    `### Risk Score: ${total} / 100 — ${level.emoji} \`${level.label}\``,
    "",
    "| 축 | 점수 | 만점 |",
    "|---|---:|---:|",
    `| 🔐 보안 | ${scores.security} | 30 |`,
    `| 📦 스코프 | ${scores.scope} | 20 |`,
    `| 💥 Breaking change | ${scores.breaking} | 20 |`,
    `| 🧪 테스트 커버리지 | ${scores.tests} | 15 |`,
    `| 🗄️ 마이그레이션 | ${scores.migration} | 15 |`,
    "",
    `> **권장 처리:** ${level.action}`,
    "",
    "### 요약",
    data.summary,
    "",
    "### 주요 발견",
    findings,
    "",
    "### 권장 사항",
    data.recommendation,
    "",
    "---",
    `<sub>model: ${OPENAI_MODEL} · ${stats.changedFiles} files, +${stats.additions}/-${stats.deletions}${truncated ? " · diff truncated" : ""}</sub>`,
  ].join("\n");
}

// risk:* 라벨을 PR에 부착한다. 다른 risk:* 라벨은 제거해 항상 1개만 유지.
async function applyRiskLabel(pr, level) {
  const current = (pr.labels ?? []).map((l) => l.name);
  for (const name of current) {
    if (RISK_LABELS.includes(name) && name !== level.label) {
      await gh(
        `/repos/${REPO}/issues/${PR_NUMBER}/labels/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
    }
  }
  if (!current.includes(level.label)) {
    await gh(`/repos/${REPO}/issues/${PR_NUMBER}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels: [level.label] }),
    });
  }
}

async function upsertComment(body) {
  const res = await gh(
    `/repos/${REPO}/issues/${PR_NUMBER}/comments?per_page=100`,
  );
  const comments = await res.json();
  const existing = comments.find((c) => c.body?.includes(MARKER));
  if (existing) {
    await gh(`/repos/${REPO}/issues/comments/${existing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
  } else {
    await gh(`/repos/${REPO}/issues/${PR_NUMBER}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
  }
}

async function main() {
  assertEnv();
  const pr = await getPr();
  const files = await getFiles();
  const { diff, truncated } = buildDiff(files);
  const stats = {
    changedFiles: pr.changed_files,
    additions: pr.additions,
    deletions: pr.deletions,
  };

  const data = await review({ pr, stats, diff, truncated });
  const scores = clampScores(data.scores);
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const level = riskLevel(total);
  const body = renderComment({ data, scores, total, level, stats, truncated });
  await upsertComment(body);
  await applyRiskLabel(pr, level);

  console.log(`리뷰 코멘트 작성 완료. Risk Score ${total}/100 (${level.label}).`);
}

main().catch((err) => {
  console.error(`리뷰 실패: ${err.message}`);
  process.exit(1);
});
