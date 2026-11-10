import { beforeEach, describe, expect, it, vi } from "vitest";
import { createComplaintsFakeDb } from "@/lib/__tests__/complaints-fake-db";

/**
 * 게스트 피드백(수기 컴플레인) 서버 규칙 — 2026-11-10 점검 수정.
 * 권한 한 곳(complaintRights) · 상태 변경 조건부 갱신 · 등록/댓글 중복 막기(submission_id) · 연결 id 조직 확인 ·
 * 평점 범위 · 목록 1,000건 넘김. 실제 DB 는 부르지 않는다(가짜 DB).
 */
const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => state.db,
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => state.db,
}));

import {
  canChangeStatus,
  complaintRights,
  createComplaint,
  createComplaintComment,
  deleteComplaint,
  listComplaints,
  resolveComplaint,
  updateComplaint,
} from "@/lib/complaints";
import type { AppSession } from "@/lib/session";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = uuid(900);
const OTHER = uuid(901);
const ME = uuid(800);
const YOU = uuid(801);

function session(caps: string[], userId = ME): AppSession {
  return {
    organization: { id: ORG, name: "org" },
    user: { id: userId, role: "cs_staff", preferredLanguage: "ko" },
    capabilities: caps,
  } as unknown as AppSession;
}

const WRITER = ["complaint.write", "complaint.comment"];
const MANAGER = ["complaint.write", "complaint.manage", "complaint.comment"];

function complaintRow(over: Record<string, unknown> = {}) {
  return {
    id: uuid(1),
    organization_id: ORG,
    created_by_user_id: ME,
    title: "t",
    platform: "airbnb",
    platform_ref: null,
    status: "open",
    description: null,
    image_urls: [],
    rating: null,
    property_id: null,
    property_name: null,
    room_id: null,
    room_label: null,
    reservation_id: null,
    guest_name: null,
    resolved_at: null,
    resolved_by_user_id: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...over,
  };
}

function setup(tables: Record<string, Record<string, unknown>[]> = {}) {
  const fake = createComplaintsFakeDb({
    tables,
    unique: {
      customer_complaints: [["organization_id", "submission_id"]],
      complaint_comments: [["organization_id", "submission_id"]],
    },
  });
  state.db = fake.client;
  return fake;
}

const base = { platform: "airbnb", title: "소음", imageUrls: [] as string[] };

describe("complaintRights — 권한 판정 한 곳", () => {
  it("해결 · 다시 열기는 complaint.manage 만(작성자 본인도 manage 없으면 안 됨)", () => {
    expect(complaintRights(session(WRITER), { createdByUserId: ME }).changeStatus).toBe(false);
    expect(canChangeStatus(session(WRITER), { createdByUserId: ME })).toBe(false);
    expect(complaintRights(session(MANAGER), { createdByUserId: YOU }).changeStatus).toBe(true);
  });
  it("수정 · 삭제는 작성자 + complaint.write, 아니면 manage", () => {
    expect(complaintRights(session(WRITER), { createdByUserId: ME })).toMatchObject({ edit: true, delete: true });
    expect(complaintRights(session([]), { createdByUserId: ME })).toMatchObject({ edit: false, delete: false });
    expect(complaintRights(session(WRITER), { createdByUserId: YOU })).toMatchObject({ edit: false, delete: false });
    expect(complaintRights(session(MANAGER), { createdByUserId: YOU })).toMatchObject({ edit: true, delete: true });
  });
});

describe("서버 가드가 같은 판정을 쓴다", () => {
  beforeEach(() => setup({ customer_complaints: [complaintRow()] }));

  it("write 를 잃은 작성자는 지울 수 없다", async () => {
    await expect(deleteComplaint({ session: session([]), id: uuid(1) })).rejects.toThrow("forbidden");
  });
  it("write 를 잃은 작성자는 고칠 수 없다", async () => {
    await expect(updateComplaint({ session: session([]), id: uuid(1), patch: { title: "x" } })).rejects.toThrow("forbidden");
  });
  it("manage 없는 작성자는 해결할 수 없다", async () => {
    await expect(resolveComplaint({ session: session(WRITER), id: uuid(1) })).rejects.toThrow("forbidden");
  });
});

describe("상태 변경 — 읽은 상태일 때만 바꾼다", () => {
  it("읽은 뒤 다른 사람이 먼저 바꿨으면 stale 로 거절하고 덮어쓰지 않는다", async () => {
    let raced = false;
    const fake = createComplaintsFakeDb({
      tables: { customer_complaints: [complaintRow()] },
      // 읽기와 갱신 사이에 다른 사람이 먼저 해결해 버린다.
      beforeWrite: (table, op, tables) => {
        if (raced || table !== "customer_complaints" || op !== "update") return;
        raced = true;
        Object.assign(tables.customer_complaints[0], { status: "resolved", resolved_by_user_id: YOU });
      },
    });
    state.db = fake.client;
    await expect(resolveComplaint({ session: session(MANAGER), id: uuid(1) })).rejects.toThrow("stale");
    expect(fake.tables.customer_complaints[0].resolved_by_user_id).toBe(YOU);
  });
});

describe("등록 중복 막기 — submission_id", () => {
  it("같은 submission_id 로 두 번 보내면 한 줄만 생기고 같은 id 를 돌려준다", async () => {
    const fake = setup();
    const sub = uuid(55);
    const first = await createComplaint({ session: session(WRITER), input: { ...base, submissionId: sub } });
    const second = await createComplaint({ session: session(WRITER), input: { ...base, submissionId: sub } });
    expect(second.id).toBe(first.id);
    expect(fake.tables.customer_complaints).toHaveLength(1);
  });
  it("동시에 들어와 유니크 위반(23505)이 나도 먼저 만든 줄 id 를 돌려준다", async () => {
    const sub = uuid(56);
    setup({ customer_complaints: [complaintRow({ id: uuid(9), submission_id: sub })] });
    // 미리 읽기를 피하려고 같은 id 가 이미 있는 상태에서 insert 경합만 본다.
    const out = await createComplaint({ session: session(WRITER), input: { ...base, submissionId: sub } });
    expect(out.id).toBe(uuid(9));
  });
  it.each(["42703", "PGRST204"])("submission_id 칸이 없는 DB(%s)면 칸을 빼고 다시 넣는다(코드 먼저 배포)", async (code) => {
    const fake = createComplaintsFakeDb({
      tables: { customer_complaints: [] },
      failSelect: (table, columns) => (table === "customer_complaints" && columns === "id" ? { code, message: "no column" } : null),
      failWrite: (table, op, payload) =>
        table === "customer_complaints" && op === "insert" && payload && typeof payload === "object" && "submission_id" in payload
          ? { code, message: "no column" }
          : null,
    });
    state.db = fake.client;
    const out = await createComplaint({ session: session(WRITER), input: { ...base, submissionId: uuid(70) } });
    expect(fake.tables.customer_complaints).toHaveLength(1);
    expect(fake.tables.customer_complaints[0].id).toBe(out.id);
    expect(fake.tables.customer_complaints[0]).not.toHaveProperty("submission_id");
  });

  it("submission_id 가 없어도 등록된다(예전 화면 호환)", async () => {
    const fake = setup();
    await createComplaint({ session: session(WRITER), input: base });
    await createComplaint({ session: session(WRITER), input: base });
    expect(fake.tables.customer_complaints).toHaveLength(2);
  });
  it("uuid 가 아닌 submission_id 는 거절", async () => {
    setup();
    await expect(createComplaint({ session: session(WRITER), input: { ...base, submissionId: "x" } })).rejects.toThrow(
      "invalid_submission",
    );
  });
});

describe("등록 — 연결 id 는 세션 조직 것이어야 한다", () => {
  it("다른 조직의 객실 id 는 거절", async () => {
    setup({ rooms: [{ id: uuid(70), organization_id: OTHER }] });
    await expect(createComplaint({ session: session(WRITER), input: { ...base, roomId: uuid(70) } })).rejects.toThrow(
      "invalid_link",
    );
  });
  it("다른 조직의 예약 id 는 거절", async () => {
    setup({ reservations: [{ id: uuid(71), organization_id: OTHER }] });
    await expect(
      createComplaint({ session: session(WRITER), input: { ...base, reservationId: uuid(71) } }),
    ).rejects.toThrow("invalid_link");
  });
  it("같은 조직 건물 · 객실 · 예약이면 통과", async () => {
    setup({
      properties: [{ id: uuid(72), organization_id: ORG }],
      rooms: [{ id: uuid(73), organization_id: ORG }],
      reservations: [{ id: uuid(74), organization_id: ORG }],
    });
    await expect(
      createComplaint({
        session: session(WRITER),
        input: { ...base, propertyId: uuid(72), roomId: uuid(73), reservationId: uuid(74) },
      }),
    ).resolves.toHaveProperty("id");
  });
});

describe("등록 — 평점 범위", () => {
  beforeEach(() => setup());
  it("Airbnb 6점은 거절(5점 만점)", async () => {
    await expect(createComplaint({ session: session(WRITER), input: { ...base, rating: 6 } })).rejects.toThrow("invalid_rating");
  });
  it("음수 거절", async () => {
    await expect(createComplaint({ session: session(WRITER), input: { ...base, rating: -1 } })).rejects.toThrow("invalid_rating");
  });
  it("Booking 8.5 는 통과", async () => {
    await expect(
      createComplaint({ session: session(WRITER), input: { ...base, platform: "booking", rating: 8.5 } }),
    ).resolves.toHaveProperty("id");
  });
  it("점수 없는 플랫폼(direct)에 남은 점수는 버린다", async () => {
    const fake = setup();
    await createComplaint({ session: session(WRITER), input: { ...base, platform: "direct", rating: 3 } });
    expect(fake.tables.customer_complaints[0].rating).toBeNull();
  });
});

describe("댓글 중복 막기 — submission_id", () => {
  it("같은 submission_id 면 한 줄만", async () => {
    const fake = setup({ customer_complaints: [complaintRow()] });
    const sub = uuid(60);
    const a = await createComplaintComment({ session: session(WRITER), complaintId: uuid(1), content: "x", imageUrls: [], submissionId: sub });
    const b = await createComplaintComment({ session: session(WRITER), complaintId: uuid(1), content: "x", imageUrls: [], submissionId: sub });
    expect(b.id).toBe(a.id);
    expect(fake.tables.complaint_comments).toHaveLength(1);
  });
  it("같은 submission_id 가 다른 컴플레인 댓글이면 그 줄을 돌려주지 않고 거절", async () => {
    const fake = setup({ customer_complaints: [complaintRow(), complaintRow({ id: uuid(2) })] });
    const sub = uuid(61);
    await createComplaintComment({ session: session(WRITER), complaintId: uuid(1), content: "x", imageUrls: [], submissionId: sub });
    await expect(
      createComplaintComment({ session: session(WRITER), complaintId: uuid(2), content: "y", imageUrls: [], submissionId: sub }),
    ).rejects.toThrow("invalid_submission");
    expect(fake.tables.complaint_comments).toHaveLength(1);
  });
  it("없으면 예전처럼 매번 만든다", async () => {
    const fake = setup({ customer_complaints: [complaintRow()] });
    await createComplaintComment({ session: session(WRITER), complaintId: uuid(1), content: "x", imageUrls: [] });
    await createComplaintComment({ session: session(WRITER), complaintId: uuid(1), content: "x", imageUrls: [] });
    expect(fake.tables.complaint_comments).toHaveLength(2);
  });
});

describe("목록 — 1,000건 넘어도 전부", () => {
  it("1,500건을 모두 돌려준다", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) =>
      complaintRow({ id: uuid(10_000 + i), created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z` }),
    );
    setup({ customer_complaints: rows, memberships: [] });
    const list = await listComplaints({ session: session(WRITER) });
    expect(list).toHaveLength(1500);
  });
  it("첫 쪽 읽기가 실패해도 빈 목록(«없음»)이 아니라 오류", async () => {
    state.db = createComplaintsFakeDb({
      tables: { customer_complaints: [complaintRow()], memberships: [] },
      failSelect: (table) => (table === "customer_complaints" ? { code: "XX000", message: "boom" } : null),
    }).client;
    await expect(listComplaints({ session: session(WRITER) })).rejects.toThrow("list_failed");
  });
  it("두 번째 쪽 읽기가 실패하면 앞 1,000건만 조용히 돌려주지 않고 오류", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => complaintRow({ id: uuid(20_000 + i) }));
    let reads = 0;
    state.db = createComplaintsFakeDb({
      tables: { customer_complaints: rows, memberships: [] },
      failSelect: (table) => (table === "customer_complaints" && ++reads === 2 ? { code: "XX000", message: "boom" } : null),
    }).client;
    await expect(listComplaints({ session: session(WRITER) })).rejects.toThrow("list_failed");
  });
});
