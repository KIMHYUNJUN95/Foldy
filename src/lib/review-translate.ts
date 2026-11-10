// 외부 리뷰 온디맨드 번역 (DeepL API Free). 서버 전용.
//
// 계약: docs/product/25-complaint-workflow.md → "Review Translation"
//
//   * 원문은 항상 보존한다. 번역은 원문을 대체하거나 수정하지 않는다.
//   * 상세 보기만 호출을 일으킨다. 목록, 정렬, 필터는 절대 번역하지 않는다.
//   * 같은 (리뷰 + 본문 부분 + 대상 로케일)은 원문이 저장된 값과 계속 해시가 같은 한
//     영구히 캐시에서 답한다.
//   * DeepL API Free 는 월 500,000자를 허용하며 *입력* 길이로 센다. 새 번역은
//     450,000자에서 멈춰 한 번에 몰려도 무료 한도를 넘지 않게 하며, 이미
//     저장된 번역은 계속 렌더된다.
//   * API 키는 서버 환경 변수에만 둔다 — 브라우저, 로그, 문서에는 절대 두지 않는다.

import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type TranslationPart = "review" | "positive" | "negative" | "headline" | "private";
export type TranslationLocale = "ko" | "ja" | "en";

/** 이 값에 도달하면 새 번역 요청을 중단한다. 무료 한도 500,000자에 대한 안전 여유. */
const MONTHLY_CHAR_BUDGET = 450_000;

const DEEPL_TARGET: Record<TranslationLocale, string> = {
  ko: "KO",
  ja: "JA",
  en: "EN-US",
};

function untyped(client: SupabaseClient<unknown>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

/** 글자 수 = 코드포인트 수 — DB `char_length` 와 같다(이모지 하나 = 1). `.length` 는 UTF-16 이라 2로 센다. */
function charCount(text: string): number {
  return Array.from(text).length;
}

/** `source_char_count` 칸이 아직 없는 DB(마이그레이션 전) — 코드가 먼저 나가도 번역이 멈추지 않게. */
function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

function hashSource(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

function getDeepLEnv(): { url: string; key: string } | null {
  const key = process.env.DEEPL_API_KEY?.trim();
  if (!key) return null;
  // 무료 등급 키는 ":fx" 로 끝나며 무료 호스트를 써야 한다.
  const url =
    process.env.DEEPL_API_URL?.trim() ??
    (key.endsWith(":fx") ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate");
  return { url, key };
}

export type TranslationResult =
  | { status: "ok"; text: string; sourceLocale: string | null; cached: boolean }
  | { status: "unavailable"; reason: "not_configured" | "budget_exhausted" | "failed" };

/**
 * 이번 달 사용량(문자 수). `review_translations.translated_at` 기준으로 **원문** 글자 수를 합산한다.
 *
 * DeepL의 `/usage`를 신뢰하지 않고 자체 집계를 쓰는 이유는, 키가 다른 서비스와 공유될 수
 * 있고 우리가 통제하는 것은 우리가 보낸 요청뿐이기 때문이다.
 *
 * 2026-11-10: 예전엔 (1) `range()` 없이 읽어 1,000행에서 잘렸고 (2) 번역문 길이를 셌다 — DeepL 은 **보낸 원문**으로
 * 센다. 이제 1,000행씩 끝까지 읽고 `source_char_count`(저장할 때 남긴 원문 길이)를 더한다. 그 칸이 없는 옛 줄만
 * 번역문 길이로 대신한다. 조직을 가리지 않는다 — DeepL 키 하나를 모든 조직이 같이 쓴다.
 */
async function monthlyCharsUsed(db: SupabaseClient, monthStartIso: string): Promise<number> {
  const withCount = await sumMonthlyChars(db, monthStartIso, true);
  // 칸이 없으면(마이그레이션 전) 번역문 길이로 대신 센다 — 예전 방식이지만 1,000행 상한은 없다.
  if (withCount === "missing_column") return (await sumMonthlyChars(db, monthStartIso, false)) as number;
  return withCount;
}

async function sumMonthlyChars(
  db: SupabaseClient,
  monthStartIso: string,
  useSourceCount: boolean,
): Promise<number | "missing_column"> {
  const PAGE = 1000;
  let sum = 0;
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await db
      .from("review_translations")
      .select(useSourceCount ? "id, source_char_count, translated_text" : "id, translated_text")
      .gte("translated_at", monthStartIso)
      .order("id", { ascending: true })
      .range(start, start + PAGE - 1);
    if (error && useSourceCount && isMissingColumn(error)) return "missing_column";
    // 사용량을 모르면 한도를 지킬 수 없다 — 새 번역을 멈추는 쪽으로(한도 소진으로 본다).
    if (error) return Number.POSITIVE_INFINITY;
    const rows = (data ?? []) as unknown as { source_char_count?: number | null; translated_text: string }[];
    for (const row of rows) sum += row.source_char_count ?? charCount(row.translated_text);
    if (rows.length < PAGE) break;
  }
  return sum;
}

/**
 * 이번 달 남은 번역 한도 — 한 번 읽고 나눠 쓴다(2026-11-10). 「번역 보기」는 조각 5개를 동시에 번역하는데, 예전엔
 * 조각마다 사용량을 다시 읽어 다섯 개 모두 같은 옛 합계로 «한도 안» 판정을 받았다(합치면 한도를 넘길 수 있었다).
 * `reserve` 는 사용량을 처음 한 번만 읽고, 그 뒤엔 «읽은 값 + 이번에 잡은 양» 으로 판정한 뒤 바로 잡는다 —
 * `await` 뒤 판정 · 차감 사이에 다른 조각이 끼어들 수 없다. DeepL 이 실패하면 `refund` 로 돌려놓는다.
 */
export type TranslationBudget = { reserve(chars: number): Promise<boolean>; refund(chars: number): void };

export function createTranslationBudget(): TranslationBudget {
  let used: Promise<number> | null = null;
  let reserved = 0;
  return {
    async reserve(chars) {
      if (!used) {
        const db = untyped(getSupabaseServiceClient() as unknown as SupabaseClient<unknown>);
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);
        used = monthlyCharsUsed(db, monthStart.toISOString());
      }
      const base = await used;
      if (base + reserved + chars > MONTHLY_CHAR_BUDGET) return false;
      reserved += chars;
      return true;
    },
    refund(chars) {
      reserved = Math.max(0, reserved - chars);
    },
  };
}

/**
 * 리뷰 본문 한 조각을 목표 언어로 번역한다. 캐시가 있으면 즉시 돌려준다.
 *
 * `sourceLanguageCode`가 있으면(Booking.com `content.language_code`) DeepL 자동 감지를
 * 건너뛰어 사용량을 아낀다. Airbnb는 언어 코드를 주지 않으므로 자동 감지로 돌아간다.
 *
 * `sourceText` 는 반드시 서버가 `external_reviews` 에서 읽은 원문이어야 한다(2026-10-26) — 클라이언트가 보낸 글을
 * 넘기면 아무 글이나 번역 한도를 쓰고 이 리뷰의 번역으로 캐시된다. `translateReviewPartAction` 이 리뷰를 읽어 넘긴다.
 */
export async function translateReviewPart(input: {
  organizationId: string;
  externalReviewId: string;
  part: TranslationPart;
  targetLocale: TranslationLocale;
  sourceText: string;
  sourceLanguageCode?: string | null;
  /** 여러 조각을 함께 번역할 때 나눠 쓰는 한도(`createTranslationBudget`). 없으면 이 조각만 따로 센다. */
  budget?: TranslationBudget;
}): Promise<TranslationResult> {
  const { organizationId, externalReviewId, part, targetLocale } = input;
  const sourceText = input.sourceText.trim();
  if (!sourceText) return { status: "unavailable", reason: "failed" };

  const service = getSupabaseServiceClient();
  const db = untyped(service as unknown as SupabaseClient<unknown>);
  const sourceHash = hashSource(sourceText);

  // 부모 리뷰가 같은 조직인지 먼저 확인한다 — 번역 행만 보고 신뢰하지 않는다.
  const { data: reviewRow } = await db
    .from("external_reviews")
    .select("id, organization_id")
    .eq("id", externalReviewId)
    .maybeSingle();
  const review = reviewRow as { id: string; organization_id: string } | null;
  if (!review || review.organization_id !== organizationId) {
    return { status: "unavailable", reason: "failed" };
  }

  const { data: cachedRow } = await db
    .from("review_translations")
    .select("translated_text, source_locale, source_text_hash")
    .eq("external_review_id", externalReviewId)
    .eq("source_part", part)
    .eq("target_locale", targetLocale)
    .maybeSingle();
  const cached = cachedRow as
    | { translated_text: string; source_locale: string | null; source_text_hash: string }
    | null;

  // 원문이 바뀌었으면 저장된 번역을 쓰지 않고 새로 만든다.
  if (cached && cached.source_text_hash === sourceHash) {
    return { status: "ok", text: cached.translated_text, sourceLocale: cached.source_locale, cached: true };
  }

  const env = getDeepLEnv();
  if (!env) return { status: "unavailable", reason: "not_configured" };

  const budget = input.budget ?? createTranslationBudget();
  const chars = charCount(sourceText);
  if (!(await budget.reserve(chars))) {
    return { status: "unavailable", reason: "budget_exhausted" };
  }

  const body = new URLSearchParams();
  body.set("text", sourceText);
  body.set("target_lang", DEEPL_TARGET[targetLocale]);
  const sourceLang = input.sourceLanguageCode?.trim().toUpperCase();
  if (sourceLang) body.set("source_lang", sourceLang.slice(0, 2));

  let translated: string | null = null;
  let detected: string | null = null;
  try {
    const response = await fetch(env.url, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${env.key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    });
    if (!response.ok) {
      budget.refund(chars);
      return { status: "unavailable", reason: "failed" };
    }
    const json = (await response.json()) as {
      translations?: { text?: unknown; detected_source_language?: unknown }[];
    };
    const first = json.translations?.[0];
    if (first && typeof first.text === "string") translated = first.text;
    if (first && typeof first.detected_source_language === "string") {
      detected = first.detected_source_language;
    }
  } catch {
    budget.refund(chars);
    return { status: "unavailable", reason: "failed" };
  }

  if (translated === null) {
    budget.refund(chars);
    return { status: "unavailable", reason: "failed" };
  }

  const row = {
    organization_id: organizationId,
    external_review_id: externalReviewId,
    source_part: part,
    target_locale: targetLocale,
    source_locale: detected ?? sourceLang ?? null,
    translated_text: translated,
    provider: "deepl",
    translated_at: new Date().toISOString(),
    source_text_hash: sourceHash,
  };
  const onConflict = { onConflict: "external_review_id,source_part,target_locale" };
  let { error } = await db
    .from("review_translations")
    .upsert({ ...row, source_char_count: chars }, onConflict);
  // 칸이 아직 없으면(마이그레이션 전) 칸을 빼고 다시 저장한다.
  if (error && isMissingColumn(error)) ({ error } = await db.from("review_translations").upsert(row, onConflict));
  // 저장 실패는 번역 자체를 못 쓰게 만들 이유가 없다 — 다음 요청 때 다시 만든다.
  if (error) {
    return { status: "ok", text: translated, sourceLocale: detected, cached: false };
  }

  return { status: "ok", text: translated, sourceLocale: detected, cached: false };
}

type SourceRow = {
  id: string;
  headline: string | null;
  review_text: string | null;
  positive_review_text: string | null;
  negative_review_text: string | null;
  private_feedback: string | null;
};

const SOURCE_COLUMN: Record<TranslationPart, keyof Omit<SourceRow, "id">> = {
  review: "review_text",
  positive: "positive_review_text",
  negative: "negative_review_text",
  headline: "headline",
  private: "private_feedback",
};

/** 이미 읽은 원문(상세 화면이 가진 리뷰)으로 조각별 해시를 만든다 — 원문을 다시 읽지 않는다. */
export type TranslationSources = Partial<Record<TranslationPart, string | null>>;

function hashesFromSources(sources: TranslationSources): Partial<Record<TranslationPart, string>> {
  const hashes: Partial<Record<TranslationPart, string>> = {};
  for (const part of Object.keys(SOURCE_COLUMN) as TranslationPart[]) {
    const text = sources[part]?.trim();
    if (text) hashes[part] = hashSource(text);
  }
  return hashes;
}

/** 리뷰들의 **지금** 원문 해시(조각별). 저장된 번역이 이 원문의 번역인지 가리는 데 쓴다. */
async function currentSourceHashes(db: SupabaseClient, ids: string[]): Promise<Map<string, Partial<Record<TranslationPart, string>>>> {
  const out = new Map<string, Partial<Record<TranslationPart, string>>>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from("external_reviews")
      .select("id, headline, review_text, positive_review_text, negative_review_text, private_feedback")
      .in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const row of (data ?? []) as SourceRow[]) {
      const sources: TranslationSources = {};
      for (const part of Object.keys(SOURCE_COLUMN) as TranslationPart[]) sources[part] = row[SOURCE_COLUMN[part]];
      out.set(row.id, hashesFromSources(sources));
    }
  }
  return out;
}

/**
 * 리뷰 여러 건의 **이미 저장된** 번역 — Excel · PDF 내보내기용. 새로 번역하지 않는다(비용, 2026-10-28 결정).
 * 리뷰 id 는 호출부가 세션 조직으로 거른 목록에서만 온다.
 * 원문이 바뀐 뒤의 옛 번역(해시가 다름)은 뺀다(2026-11-10) — 다음에 상세에서 번역을 누르면 새로 만든다.
 */
export async function getStoredTranslationsForReviews(input: {
  externalReviewIds: string[];
  targetLocale: TranslationLocale;
  /** 호출부가 이미 읽은 원문(리뷰 id → 조각별 원문). 있으면 원문을 다시 읽지 않는다. */
  sources?: Map<string, TranslationSources>;
}): Promise<Map<string, Partial<Record<TranslationPart, string>>>> {
  const out = new Map<string, Partial<Record<TranslationPart, string>>>();
  if (input.externalReviewIds.length === 0) return out;
  const service = getSupabaseServiceClient();
  const db = untyped(service as unknown as SupabaseClient<unknown>);
  const hashes = input.sources
    ? new Map([...input.sources].map(([id, sources]) => [id, hashesFromSources(sources)] as const))
    : await currentSourceHashes(db, input.externalReviewIds);
  for (let i = 0; i < input.externalReviewIds.length; i += 200) {
    const { data, error } = await db
      .from("review_translations")
      .select("external_review_id, source_part, translated_text, source_text_hash")
      .in("external_review_id", input.externalReviewIds.slice(i, i + 200))
      .eq("target_locale", input.targetLocale);
    if (error) throw error;
    for (const row of (data ?? []) as {
      external_review_id: string;
      source_part: TranslationPart;
      translated_text: string;
      source_text_hash: string;
    }[]) {
      if (hashes.get(row.external_review_id)?.[row.source_part] !== row.source_text_hash) continue;
      const parts = out.get(row.external_review_id) ?? {};
      parts[row.source_part] = row.translated_text;
      out.set(row.external_review_id, parts);
    }
  }
  return out;
}

/** 상세 화면이 한 번에 여는 번역 캐시(요청 없이 저장된 것만). 원문이 바뀐 옛 번역은 뺀다(2026-11-10). */
export async function getStoredTranslations(input: {
  externalReviewId: string;
  targetLocale: TranslationLocale;
  /** 상세 화면이 이미 읽은 원문 — 넘기면 원문을 다시 읽지 않는다(`reviewTranslationSources`). */
  sources?: TranslationSources;
}): Promise<Partial<Record<TranslationPart, string>>> {
  // 상세 화면은 번역이 없어도 열려야 한다 — 읽기 실패는 «저장된 번역 없음» 으로 본다(예전과 같다).
  const all = await getStoredTranslationsForReviews({
    externalReviewIds: [input.externalReviewId],
    targetLocale: input.targetLocale,
    sources: input.sources ? new Map([[input.externalReviewId, input.sources]]) : undefined,
  }).catch(() => new Map<string, Partial<Record<TranslationPart, string>>>());
  return all.get(input.externalReviewId) ?? {};
}

/** 리뷰 상세 값 → 조각별 원문(`getStoredTranslations` 의 `sources`). */
export function reviewTranslationSources(review: {
  headline: string | null;
  reviewText: string | null;
  positiveReviewText: string | null;
  negativeReviewText: string | null;
  privateFeedback: string | null;
}): TranslationSources {
  return {
    headline: review.headline,
    review: review.reviewText,
    positive: review.positiveReviewText,
    negative: review.negativeReviewText,
    private: review.privateFeedback,
  };
}
