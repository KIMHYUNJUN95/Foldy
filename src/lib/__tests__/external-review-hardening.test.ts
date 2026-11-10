import { describe, expect, it, vi } from "vitest";
import { createComplaintsFakeDb } from "@/lib/__tests__/complaints-fake-db";

/**
 * 외부 리뷰 서버 규칙 — 2026-11-10 점검 수정.
 * - 비공개 피드백은 일반 사용자 연결로 읽지 않는다(칸 권한을 거뒀다) → 서버 연결(service_role)로, 조직 확인 뒤에만.
 * - 리뷰 → 컴플레인 전환: 이미 연결됐거나 경합(23505)이면 오류 대신 연결된 컴플레인 id, 연결 실패면 만든 컴플레인을 지운다.
 */
const state = vi.hoisted(() => ({ user: null as unknown, service: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.service }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => state.user }));

import { convertReviewToComplaint, getExternalReview } from "@/lib/external-reviews";
import type { AppSession } from "@/lib/session";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = uuid(900);
const OTHER = uuid(901);
const session = {
  organization: { id: ORG, name: "o" },
  user: { id: uuid(800), role: "cs_staff", preferredLanguage: "ko" },
  capabilities: ["complaint.write"],
} as unknown as AppSession;

function review(over: Record<string, unknown> = {}) {
  return {
    id: uuid(1),
    organization_id: ORG,
    provider: "airbnb",
    external_review_id: "r1",
    rating_value: 2,
    rating_scale: 5,
    risk_level: "risk",
    rating_breakdown: {},
    reviewed_at: "2026-11-01T00:00:00Z",
    imported_at: "2026-11-01T00:00:00Z",
    property_id: null,
    property_name: "아라키초A",
    room_id: null,
    room_label: null,
    reservation_id: null,
    source_reservation_id: null,
    guest_display_name: null,
    headline: null,
    source_language_code: null,
    review_text: "dirty",
    positive_review_text: null,
    negative_review_text: null,
    ota_reply_text: null,
    ota_replied_at: null,
    linked_complaint_id: null,
    private_feedback: "secret note",
    ...over,
  };
}

describe("getExternalReview — 비공개 피드백은 서버 연결로", () => {
  it("사용자 연결 select 에 private_feedback 이 들어가지 않는다", async () => {
    const selects: string[] = [];
    const user = createComplaintsFakeDb({ tables: { external_reviews: [review()] } }).client;
    const original = user.from;
    (user as { from: (t: string) => unknown }).from = (t: string) => {
      const b = original(t) as { select: (c?: string, o?: unknown) => unknown };
      const sel = b.select.bind(b);
      b.select = (c?: string, o?: unknown) => {
        selects.push(c ?? "*");
        return sel(c, o as never);
      };
      return b;
    };
    state.user = user;
    state.service = createComplaintsFakeDb({ tables: { external_reviews: [review()] } }).client;
    const detail = await getExternalReview({ session, id: uuid(1) });
    expect(detail?.privateFeedback).toBe("secret note");
    expect(selects.join(" ")).not.toContain("private_feedback");
    expect(selects.join(" ")).not.toContain("raw_payload");
  });

  it("사용자 연결로 안 읽히는(다른 조직) 리뷰면 비공개 피드백도 없다", async () => {
    state.user = createComplaintsFakeDb({ tables: { external_reviews: [] } }).client;
    state.service = createComplaintsFakeDb({ tables: { external_reviews: [review({ organization_id: OTHER })] } }).client;
    expect(await getExternalReview({ session, id: uuid(1) })).toBeNull();
  });

  it("비공개 피드백 서버 읽기만 실패하면 상세는 열리고 비공개 피드백만 비운다", async () => {
    state.user = createComplaintsFakeDb({ tables: { external_reviews: [review()] } }).client;
    state.service = createComplaintsFakeDb({
      tables: { external_reviews: [review()] },
      failSelect: () => ({ code: "XX000", message: "boom" }),
    }).client;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const detail = await getExternalReview({ session, id: uuid(1) });
    spy.mockRestore();
    expect(detail?.id).toBe(uuid(1));
    expect(detail?.privateFeedback).toBeNull();
  });
});

describe("convertReviewToComplaint", () => {
  it("이미 연결된 리뷰는 오류 대신 연결된 컴플레인 id + alreadyLinked", async () => {
    state.service = createComplaintsFakeDb({ tables: { external_reviews: [review({ linked_complaint_id: uuid(50) })] } }).client;
    await expect(convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" })).resolves.toEqual({
      complaintId: uuid(50),
      alreadyLinked: true,
    });
  });

  it("경합으로 컴플레인 쪽 유니크 위반(23505)이 나면 먼저 만든 컴플레인 id", async () => {
    const fake = createComplaintsFakeDb({
      tables: {
        external_reviews: [review()],
        customer_complaints: [{ id: uuid(51), organization_id: ORG, external_review_id: uuid(1) }],
      },
      unique: { customer_complaints: [["external_review_id"]] },
    });
    state.service = fake.client;
    const out = await convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" });
    expect(out).toEqual({ complaintId: uuid(51), alreadyLinked: true });
    expect(fake.tables.customer_complaints).toHaveLength(1);
  });

  it("리뷰 연결이 실패하면 방금 만든 컴플레인을 지운다(반쪽 상태를 남기지 않는다)", async () => {
    const fake = createComplaintsFakeDb({
      tables: { external_reviews: [review()], customer_complaints: [] },
      failWrite: (table, op) => (table === "external_reviews" && op === "update" ? { code: "XX000", message: "boom" } : null),
    });
    state.service = fake.client;
    await expect(convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" })).rejects.toThrow("save_failed");
    expect(fake.tables.customer_complaints).toHaveLength(0);
  });

  it("23505 인데 먼저 만든 쪽이 연결 전에 멈춘 반쪽 상태면 리뷰 연결을 마저 잇는다", async () => {
    const fake = createComplaintsFakeDb({
      tables: {
        external_reviews: [review()],
        customer_complaints: [{ id: uuid(51), organization_id: ORG, external_review_id: uuid(1) }],
      },
      unique: { customer_complaints: [["external_review_id"]] },
    });
    state.service = fake.client;
    await convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" });
    expect(fake.tables.external_reviews[0].linked_complaint_id).toBe(uuid(51));
  });

  it("연결 직전에 남이 먼저 연결했으면 내 컴플레인은 지우고 남의 컴플레인을 돌려준다", async () => {
    let raced = false;
    const fake = createComplaintsFakeDb({
      tables: { external_reviews: [review()], customer_complaints: [] },
      beforeWrite: (table, op, tables) => {
        if (raced || table !== "external_reviews" || op !== "update") return;
        raced = true;
        tables.customer_complaints.push({ id: uuid(52), organization_id: ORG, external_review_id: null });
        tables.external_reviews[0].linked_complaint_id = uuid(52);
      },
    });
    state.service = fake.client;
    const out = await convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" });
    expect(out).toEqual({ complaintId: uuid(52), alreadyLinked: true });
    expect(fake.tables.customer_complaints.map((c) => c.id)).toEqual([uuid(52)]);
  });

  it("남이 연결한 컴플레인이 이미 없으면 그 id 를 돌려주지 않고 save_failed", async () => {
    let raced = false;
    const fake = createComplaintsFakeDb({
      tables: { external_reviews: [review()], customer_complaints: [] },
      beforeWrite: (table, op, tables) => {
        if (raced || table !== "external_reviews" || op !== "update") return;
        raced = true;
        tables.external_reviews[0].linked_complaint_id = uuid(53);
      },
    });
    state.service = fake.client;
    await expect(convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" })).rejects.toThrow("save_failed");
  });

  it("연결 응답만 잃었고 실제로는 내 컴플레인에 연결됐으면 지우지 않고 그대로 돌려준다", async () => {
    const fake = createComplaintsFakeDb({
      tables: { external_reviews: [review()], customer_complaints: [] },
      beforeWrite: (table, op, tables) => {
        if (table === "external_reviews" && op === "update") {
          tables.external_reviews[0].linked_complaint_id = tables.customer_complaints[0].id;
        }
      },
      failWrite: (table, op) => (table === "external_reviews" && op === "update" ? { code: "08006", message: "lost" } : null),
    });
    state.service = fake.client;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" });
    spy.mockRestore();
    expect(out.alreadyLinked).toBe(false);
    expect(fake.tables.customer_complaints).toHaveLength(1);
    expect(fake.tables.external_reviews[0].linked_complaint_id).toBe(out.complaintId);
  });

  it("연결 실패 뒤 다시 읽기마저 실패하면 지우지 않고 save_failed", async () => {
    const fake = createComplaintsFakeDb({
      tables: { external_reviews: [review()], customer_complaints: [] },
      failWrite: (table, op) => (table === "external_reviews" && op === "update" ? { code: "XX000", message: "boom" } : null),
      failSelect: (table, columns) => (table === "external_reviews" && columns === "linked_complaint_id" ? { code: "XX000", message: "boom" } : null),
    });
    state.service = fake.client;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" })).rejects.toThrow("save_failed");
    spy.mockRestore();
    expect(fake.tables.customer_complaints).toHaveLength(1);
  });

  it("연결 오류 뒤 다시 읽었더니 남이 이미 연결했으면, 그 컴플레인이 있을 때 alreadyLinked 로 돌려준다", async () => {
    const fake = createComplaintsFakeDb({
      tables: { external_reviews: [review()], customer_complaints: [] },
      beforeWrite: (table, op, tables) => {
        if (table === "external_reviews" && op === "update" && !tables.external_reviews[0].linked_complaint_id) {
          tables.customer_complaints.push({ id: uuid(54), organization_id: ORG, external_review_id: null });
          tables.external_reviews[0].linked_complaint_id = uuid(54);
        }
      },
      failWrite: (table, op) => (table === "external_reviews" && op === "update" ? { code: "XX000", message: "boom" } : null),
    });
    state.service = fake.client;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" });
    spy.mockRestore();
    expect(out).toEqual({ complaintId: uuid(54), alreadyLinked: true });
    expect(fake.tables.customer_complaints.map((c) => c.id)).toEqual([uuid(54)]);
  });

  it("23505 경로에서 다시 잇기가 오류(FK 위반 등)면 찾은 id 를 돌려주지 않고 save_failed", async () => {
    const fake = createComplaintsFakeDb({
      tables: {
        external_reviews: [review()],
        customer_complaints: [{ id: uuid(51), organization_id: ORG, external_review_id: uuid(1) }],
      },
      unique: { customer_complaints: [["external_review_id"]] },
      failWrite: (table, op) => (table === "external_reviews" && op === "update" ? { code: "23503", message: "fk" } : null),
    });
    state.service = fake.client;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" })).rejects.toThrow("save_failed");
    spy.mockRestore();
  });

  it("23505 경로에서 다시 잇기가 0줄인데 리뷰가 다른 컴플레인에 걸려 있으면 save_failed", async () => {
    const fake = createComplaintsFakeDb({
      tables: {
        external_reviews: [review({ linked_complaint_id: null })],
        customer_complaints: [{ id: uuid(51), organization_id: ORG, external_review_id: uuid(1) }],
      },
      unique: { customer_complaints: [["external_review_id"]] },
      beforeWrite: (table, op, tables) => {
        if (table === "external_reviews" && op === "update") tables.external_reviews[0].linked_complaint_id = uuid(77);
      },
    });
    state.service = fake.client;
    await expect(convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" })).rejects.toThrow("save_failed");
  });

  it("정상 전환이면 연결되고 alreadyLinked=false", async () => {
    const fake = createComplaintsFakeDb({ tables: { external_reviews: [review()], customer_complaints: [] } });
    state.service = fake.client;
    const out = await convertReviewToComplaint({ session, reviewId: uuid(1), title: "t" });
    expect(out.alreadyLinked).toBe(false);
    expect(fake.tables.external_reviews[0].linked_complaint_id).toBe(out.complaintId);
  });
});
