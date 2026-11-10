import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComplaintsFakeDb } from "@/lib/__tests__/complaints-fake-db";

/**
 * 리뷰 번역 — 2026-11-10 점검 수정.
 * - 월 사용량은 **원문 글자 수**를 **이번 달 전부**(1,000행 상한 없이) 센다. 예전엔 1,000행에서 잘리고 번역문 길이를 셌다.
 * - 저장된 번역은 원문이 바뀌면(해시가 다르면) 보여 주지 않는다.
 */
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));

import {
  createTranslationBudget,
  getStoredTranslations,
  getStoredTranslationsForReviews,
  translateReviewPart,
} from "@/lib/review-translate";

const ORG = "00000000-0000-4000-8000-000000000900";
const REVIEW = "00000000-0000-4000-8000-000000000001";
const hash = (t: string) => createHash("sha256").update(t.trim()).digest("hex").slice(0, 32);
const thisMonth = new Date().toISOString();

function reviewRow(text = "hello world") {
  return { id: REVIEW, organization_id: ORG, review_text: text, headline: null, positive_review_text: null, negative_review_text: null, private_feedback: null };
}

describe("월 사용량 — 원문 글자 수, 행 상한 없이", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.DEEPL_API_KEY = "k:fx";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ translations: [{ text: "안녕", detected_source_language: "EN" }] }) });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    delete process.env.DEEPL_API_KEY;
    vi.unstubAllGlobals();
  });

  it("이번 달 1,200줄 × 원문 400자 = 480,000자면 새 번역을 멈춘다(번역문은 짧아도)", async () => {
    const used = Array.from({ length: 1200 }, (_, i) => ({
      id: `t${i}`,
      organization_id: ORG,
      external_review_id: `other-${i}`,
      source_part: "review",
      target_locale: "ko",
      translated_text: "짧음",
      source_char_count: 400,
      translated_at: thisMonth,
      source_text_hash: "x",
    }));
    state.db = createComplaintsFakeDb({ tables: { external_reviews: [reviewRow()], review_translations: used } }).client;
    const out = await translateReviewPart({
      organizationId: ORG,
      externalReviewId: REVIEW,
      part: "review",
      targetLocale: "ko",
      sourceText: "hello world",
    });
    expect(out).toEqual({ status: "unavailable", reason: "budget_exhausted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("조각 여러 개를 동시에 번역해도 한 번 읽은 한도를 나눠 쓴다(같은 옛 합계로 모두 통과하지 않는다)", async () => {
    const used = [{ id: "t0", organization_id: ORG, external_review_id: "o", source_part: "review", target_locale: "ko", translated_text: "x", source_char_count: 449_985, translated_at: thisMonth, source_text_hash: "x" }];
    const db = createComplaintsFakeDb({ tables: { external_reviews: [reviewRow()], review_translations: used } });
    state.db = db.client;
    const budget = createTranslationBudget();
    const parts = ["review", "positive", "negative"] as const;
    const out = await Promise.all(
      parts.map((part) =>
        translateReviewPart({ organizationId: ORG, externalReviewId: REVIEW, part, targetLocale: "ko", sourceText: "ten chars!", budget }),
      ),
    );
    expect(out.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("DeepL 이 실패하면 잡아 둔 한도를 돌려놓는다(다음 조각이 쓸 수 있다)", async () => {
    const used = [{ id: "t0", organization_id: ORG, external_review_id: "o", source_part: "review", target_locale: "ko", translated_text: "x", source_char_count: 449_985, translated_at: thisMonth, source_text_hash: "x" }];
    state.db = createComplaintsFakeDb({ tables: { external_reviews: [reviewRow()], review_translations: used } }).client;
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const budget = createTranslationBudget();
    const first = await translateReviewPart({ organizationId: ORG, externalReviewId: REVIEW, part: "review", targetLocale: "ko", sourceText: "ten chars!", budget });
    const second = await translateReviewPart({ organizationId: ORG, externalReviewId: REVIEW, part: "positive", targetLocale: "ko", sourceText: "ten chars!", budget });
    expect(first).toEqual({ status: "unavailable", reason: "failed" });
    expect(second.status).toBe("ok");
  });

  it("새 번역을 저장할 때 원문 글자 수를 같이 남긴다", async () => {
    const fake = createComplaintsFakeDb({ tables: { external_reviews: [reviewRow()], review_translations: [] } });
    state.db = fake.client;
    await translateReviewPart({ organizationId: ORG, externalReviewId: REVIEW, part: "review", targetLocale: "ko", sourceText: "hello world" });
    expect(fake.tables.review_translations[0].source_char_count).toBe("hello world".length);
  });
});

describe("저장된 번역 — 원문이 바뀌면 숨긴다", () => {
  it("해시가 같으면 보여 주고, 다르면 뺀다", async () => {
    state.db = createComplaintsFakeDb({
      tables: {
        external_reviews: [reviewRow("new text"), { ...reviewRow("x"), id: "r2", review_text: "same" }],
        review_translations: [
          { external_review_id: REVIEW, source_part: "review", target_locale: "ko", translated_text: "옛 번역", source_text_hash: hash("old text") },
          { external_review_id: "r2", source_part: "review", target_locale: "ko", translated_text: "맞는 번역", source_text_hash: hash("same") },
        ],
      },
    }).client;
    expect(await getStoredTranslations({ externalReviewId: REVIEW, targetLocale: "ko" })).toEqual({});
    const many = await getStoredTranslationsForReviews({ externalReviewIds: [REVIEW, "r2"], targetLocale: "ko" });
    expect(many.get(REVIEW)).toBeUndefined();
    expect(many.get("r2")).toEqual({ review: "맞는 번역" });
  });

  it("상세 화면이 원문을 넘기면 원문을 다시 읽지 않는다", async () => {
    state.db = createComplaintsFakeDb({
      tables: {
        external_reviews: [reviewRow("same")],
        review_translations: [
          { external_review_id: REVIEW, source_part: "review", target_locale: "ko", translated_text: "맞는 번역", source_text_hash: hash("same") },
        ],
      },
      failSelect: (table) => (table === "external_reviews" ? { code: "XX000", message: "should not read" } : null),
    }).client;
    expect(
      await getStoredTranslations({ externalReviewId: REVIEW, targetLocale: "ko", sources: { review: "same" } }),
    ).toEqual({ review: "맞는 번역" });
  });
});

describe("마이그레이션 전(source_char_count 칸 없음)에도 번역이 멈추지 않는다", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.DEEPL_API_KEY = "k:fx";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ translations: [{ text: "안녕" }] }) });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    delete process.env.DEEPL_API_KEY;
    vi.unstubAllGlobals();
  });

  it("사용량은 번역문 길이로 대신 세고, 저장은 칸을 빼고 다시 한다", async () => {
    const missing = { code: "42703", message: "column review_translations.source_char_count does not exist" };
    const fake = createComplaintsFakeDb({
      tables: { external_reviews: [reviewRow()], review_translations: [] },
      failSelect: (table, cols) => (table === "review_translations" && cols.includes("source_char_count") ? missing : null),
      failWrite: (table, op, payload) =>
        table === "review_translations" && op === "upsert" && JSON.stringify(payload).includes("source_char_count")
          ? { code: "PGRST204", message: "Could not find the 'source_char_count' column" }
          : null,
    });
    state.db = fake.client;
    const out = await translateReviewPart({ organizationId: ORG, externalReviewId: REVIEW, part: "review", targetLocale: "ko", sourceText: "hello world" });
    expect(out.status).toBe("ok");
    expect(fake.tables.review_translations).toHaveLength(1);
    expect(fake.tables.review_translations[0].source_char_count).toBeUndefined();
  });
});

describe("원문 글자 수는 코드포인트로(DB char_length 와 같게)", () => {
  beforeEach(() => {
    process.env.DEEPL_API_KEY = "k:fx";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ translations: [{ text: "x" }] }) }));
  });
  afterEach(() => {
    delete process.env.DEEPL_API_KEY;
    vi.unstubAllGlobals();
  });
  it("이모지 2개 + 글자 1개 = 3", async () => {
    const fake = createComplaintsFakeDb({ tables: { external_reviews: [reviewRow("😀😀a")], review_translations: [] } });
    state.db = fake.client;
    await translateReviewPart({ organizationId: ORG, externalReviewId: REVIEW, part: "review", targetLocale: "ko", sourceText: "😀😀a" });
    expect(fake.tables.review_translations[0].source_char_count).toBe(3);
  });
});
