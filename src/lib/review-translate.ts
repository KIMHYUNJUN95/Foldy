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
 * 이번 달 사용량(문자 수). `review_translations.translated_at` 기준으로 원문 길이를 합산한다.
 *
 * DeepL의 `/usage`를 신뢰하지 않고 자체 집계를 쓰는 이유는, 키가 다른 서비스와 공유될 수
 * 있고 우리가 통제하는 것은 우리가 보낸 요청뿐이기 때문이다.
 */
async function monthlyCharsUsed(db: SupabaseClient, monthStartIso: string): Promise<number> {
  const { data } = await db
    .from("review_translations")
    .select("translated_text")
    .gte("translated_at", monthStartIso);
  const rows = (data ?? []) as { translated_text: string }[];
  return rows.reduce((sum, row) => sum + row.translated_text.length, 0);
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

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const used = await monthlyCharsUsed(db, monthStart.toISOString());
  if (used + sourceText.length > MONTHLY_CHAR_BUDGET) {
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
    if (!response.ok) return { status: "unavailable", reason: "failed" };
    const json = (await response.json()) as {
      translations?: { text?: unknown; detected_source_language?: unknown }[];
    };
    const first = json.translations?.[0];
    if (first && typeof first.text === "string") translated = first.text;
    if (first && typeof first.detected_source_language === "string") {
      detected = first.detected_source_language;
    }
  } catch {
    return { status: "unavailable", reason: "failed" };
  }

  if (translated === null) return { status: "unavailable", reason: "failed" };

  const { error } = await db.from("review_translations").upsert(
    {
      organization_id: organizationId,
      external_review_id: externalReviewId,
      source_part: part,
      target_locale: targetLocale,
      source_locale: detected ?? sourceLang ?? null,
      translated_text: translated,
      provider: "deepl",
      translated_at: new Date().toISOString(),
      source_text_hash: sourceHash,
    },
    { onConflict: "external_review_id,source_part,target_locale" },
  );
  // 저장 실패는 번역 자체를 못 쓰게 만들 이유가 없다 — 다음 요청 때 다시 만든다.
  if (error) {
    return { status: "ok", text: translated, sourceLocale: detected, cached: false };
  }

  return { status: "ok", text: translated, sourceLocale: detected, cached: false };
}

/** 상세 화면이 한 번에 여는 번역 캐시(요청 없이 저장된 것만). */
/**
 * 리뷰 여러 건의 **이미 저장된** 번역 — Excel · PDF 내보내기용. 새로 번역하지 않는다(비용, 2026-10-28 결정).
 * 리뷰 id 는 호출부가 세션 조직으로 거른 목록에서만 온다.
 */
export async function getStoredTranslationsForReviews(input: {
  externalReviewIds: string[];
  targetLocale: TranslationLocale;
}): Promise<Map<string, Partial<Record<TranslationPart, string>>>> {
  const out = new Map<string, Partial<Record<TranslationPart, string>>>();
  if (input.externalReviewIds.length === 0) return out;
  const service = getSupabaseServiceClient();
  const db = untyped(service as unknown as SupabaseClient<unknown>);
  for (let i = 0; i < input.externalReviewIds.length; i += 200) {
    const { data, error } = await db
      .from("review_translations")
      .select("external_review_id, source_part, translated_text")
      .in("external_review_id", input.externalReviewIds.slice(i, i + 200))
      .eq("target_locale", input.targetLocale);
    if (error) throw error;
    for (const row of (data ?? []) as { external_review_id: string; source_part: TranslationPart; translated_text: string }[]) {
      const parts = out.get(row.external_review_id) ?? {};
      parts[row.source_part] = row.translated_text;
      out.set(row.external_review_id, parts);
    }
  }
  return out;
}

export async function getStoredTranslations(input: {
  externalReviewId: string;
  targetLocale: TranslationLocale;
}): Promise<Partial<Record<TranslationPart, string>>> {
  const service = getSupabaseServiceClient();
  const db = untyped(service as unknown as SupabaseClient<unknown>);
  const { data } = await db
    .from("review_translations")
    .select("source_part, translated_text")
    .eq("external_review_id", input.externalReviewId)
    .eq("target_locale", input.targetLocale);
  const rows = (data ?? []) as { source_part: TranslationPart; translated_text: string }[];
  const out: Partial<Record<TranslationPart, string>> = {};
  for (const row of rows) out[row.source_part] = row.translated_text;
  return out;
}
