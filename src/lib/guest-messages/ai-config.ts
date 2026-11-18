/**
 * AI 답장 도우미 설정 — 모델 · 차원 · 한 달 상한 · 요금이 있는 **한 곳**(49 §8-4 · D2). 모델을 바꿀 때는 여기만 고친다.
 *
 * 환경 변수(이름만 — 값은 문서 · 로그에 쓰지 않는다):
 * - `VOYAGE_API_KEY` — 임베딩. 없으면 도우미 줄이 안 뜬다(`unavailable`).
 * - `ANTHROPIC_API_KEY` — 초안. 없으면 초안만 `unavailable`(문구 추천은 계속).
 * - `GUEST_AI_MONTHLY_CAP_USD` — 한 달(도쿄) 초안 비용 상한, 기본 30.
 * - `GUEST_AI_FAKE=1` — 외부 호출 없이 고정 숫자 · 고정 초안(로컬 시험용). 운영(`VERCEL_ENV=production` 또는 `NODE_ENV=production`)에서는 무시한다.
 */

import "server-only";

export const GUEST_AI_CONFIG = {
  draftModel: "claude-sonnet-5-5",
  draftMaxTokens: 2000,
  embedModel: "voyage-4",
  embedDim: 1024,
  embedBatch: 128,
  /** 임베딩에 보내는 글 길이(글자) — 긴 메일 전달문이 토큰을 다 먹지 않게. */
  embedMaxChars: 2000,
  /** 비슷한 과거 질문을 찾는 기간(D4). */
  similarMonths: 12,
  /** 같은 건물이면 거리에서 빼는 값(SQL `guest_reply_similar` 와 같다). */
  sameBuildingBonus: 0.03,
  /** 초안에 넘기는 최근 대화 줄 수(§8-3). */
  threadLines: 12,
  defaultMonthlyCapUsd: 30,
  /**
   * `draftModel` 의 요금(USD / 100만 토큰) — 비용 기록(`cost_micro_usd`)용. **모델을 바꾸면 이 값도 같이** 바꾼다(시험이 묶어 둠).
   * claude-sonnet-5-5: 입력 2 · 출력 10 · 캐시 읽기 0.10(공용 모델 요금표, 2026-10 기준) · 캐시 쓰기 = 입력 × 1.25(5분 캐시).
   * Voyage 는 무료 범위 안이라 비용에 넣지 않는다.
   */
  draftPricePerMTok: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  /**
   * 초안 하나를 부르기 전에 한도에서 먼저 잡아 두는 비용(micro USD) — 부른 뒤 실제 값으로 바꾼다.
   * 최대 출력 2,000 토큰(0.02) + 넉넉한 입력 10,000 토큰(0.02). 동시에 여러 사람이 눌러도 한도를 크게 넘지 않게.
   */
  draftReserveMicroUsd: 40_000,
} as const;

export function isGuestAiFake(): boolean {
  return process.env.GUEST_AI_FAKE === "1" && process.env.VERCEL_ENV !== "production" && process.env.NODE_ENV !== "production";
}

export function guestAiMonthlyCapMicroUsd(): number {
  const text = process.env.GUEST_AI_MONTHLY_CAP_USD?.trim();
  // 비어 있으면 기본값(Number("") 이 0 이라 한도 0 = 꺼짐이 되지 않게). 0 을 직접 쓰면 초안을 끈다.
  const raw = text ? Number(text) : Number.NaN;
  const usd = Number.isFinite(raw) && raw >= 0 ? raw : GUEST_AI_CONFIG.defaultMonthlyCapUsd;
  return Math.round(usd * 1_000_000);
}

export function hasVoyageKey(): boolean {
  return isGuestAiFake() || Boolean(process.env.VOYAGE_API_KEY?.trim());
}

export function hasAnthropicKey(): boolean {
  return isGuestAiFake() || Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export const FAKE_DRAFT_MODEL = "fake";

/** 질문 줄에 적는 임베딩 모델 — 가짜 숫자는 "fake" 로 남겨, 진짜 키로 돌리면 다시 바꾸고 가짜끼리는 재사용한다. */
export function activeEmbedModel(): string {
  return isGuestAiFake() ? "fake" : GUEST_AI_CONFIG.embedModel;
}
