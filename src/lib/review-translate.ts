// On-demand translation of external reviews (DeepL API Free). Server-only.
//
// Contract: docs/product/25-complaint-workflow.md → "Review Translation"
//
//   * The original text is always preserved; a translation never replaces or edits it.
//   * Only a detail view triggers a call. Lists, sorting and filters never translate.
//   * The same (review + body part + target locale) is answered from cache forever, as long as
//     the source text still hashes to the stored value.
//   * DeepL API Free allows 500,000 characters a month, counted on the *input* length. We stop
//     issuing new translations at 450,000 so a burst cannot overshoot the free tier; already
//     stored translations keep rendering.
//   * The API key lives in a server env var only — never in the browser, logs or docs.

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
  // Free-tier keys end in ":fx" and must use the free host.
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
