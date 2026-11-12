import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// 가짜 Supabase — 체인(from → select/insert/update/delete → eq … → maybeSingle/single 또는 await)을 기록하고,
// 시나리오가 정한 응답을 돌려준다(2026-11-12 리뷰: 서버 분기 테스트).
type Op = "select" | "insert" | "update" | "delete";
type Call = { table: string; op: Op; filters: Record<string, unknown>; payload?: unknown };
type Responder = (call: Call) => { data: unknown; error: { code?: string } | null };

let responder: Responder = () => ({ data: null, error: null });
const calls: Call[] = [];

function builder(table: string) {
  const call: Call = { table, op: "select", filters: {} };
  const finish = () => {
    calls.push({ ...call, filters: { ...call.filters } });
    return Promise.resolve(responder(call));
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: (payload: unknown) => ((call.op = "insert"), (call.payload = payload), chain),
    update: (payload: unknown) => ((call.op = "update"), (call.payload = payload), chain),
    delete: () => ((call.op = "delete"), chain),
    eq: (column: string, value: unknown) => ((call.filters[column] = value), chain),
    maybeSingle: finish,
    single: finish,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => finish().then(resolve, reject),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ from: (table: string) => builder(table) }),
}));

import { saveReservationInternalNote } from "@/lib/reservation-internal-notes";
import { resolveNoteConflict } from "@/lib/reservation-note-sync";
import type { AppSession } from "@/lib/session";

const session = { organization: { id: "org-1" }, user: { id: "user-1" } } as unknown as AppSession;
const reservationId = "11111111-1111-4111-8111-111111111111";
const V1 = "2026-11-12T01:00:00.000000+00:00";
const V2 = "2026-11-12T02:00:00.000000+00:00";

/** 예약은 있다 + 메모 표의 지금 값(`current`) + 쓰기 응답(`write`). */
function scenario(opts: {
  current: { note: string; updated_at: string } | null;
  write?: (call: Call) => { data: unknown; error: { code?: string } | null };
}) {
  responder = (call) => {
    if (call.table === "reservations") return { data: { id: reservationId }, error: null };
    if (call.op === "select") return { data: opts.current, error: null };
    return opts.write ? opts.write(call) : { data: null, error: null };
  };
}

beforeEach(() => {
  calls.length = 0;
});

describe("saveReservationInternalNote — 서버 분기", () => {
  it("update 가 0줄인데 버전이 그대로면 권한 없음(RLS 가 조용히 막은 것)", async () => {
    scenario({ current: { note: "옛", updated_at: V1 }, write: () => ({ data: null, error: null }) });
    const result = await saveReservationInternalNote({ expectedUpdatedAt: V1, note: "새", reservationId, session });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    const update = calls.find((call) => call.op === "update");
    expect(update?.filters).toMatchObject({ organization_id: "org-1", reservation_id: reservationId, updated_at: V1 });
  });

  it("update 가 0줄이고 버전이 바뀌었으면 충돌 + 최신 값", async () => {
    scenario({ current: { note: "남이 고침", updated_at: V2 }, write: () => ({ data: null, error: null }) });
    const result = await saveReservationInternalNote({ expectedUpdatedAt: V1, note: "새", reservationId, session });
    expect(result).toEqual({ ok: false, error: "conflict", current: { note: "남이 고침", updatedAt: V2 } });
  });

  it("delete 가 0줄이고 남이 이미 지웠으면 충돌(빈 메모)", async () => {
    scenario({ current: null, write: () => ({ data: [], error: null }) });
    const result = await saveReservationInternalNote({ expectedUpdatedAt: V1, note: "", reservationId, session });
    expect(result).toEqual({ ok: false, error: "conflict", current: { note: "", updatedAt: null } });
  });

  it("없던 메모 insert 가 23505 면 누가 먼저 만든 것 — 충돌 + 최신 값", async () => {
    scenario({ current: { note: "먼저 쓴 메모", updated_at: V2 }, write: () => ({ data: null, error: { code: "23505" } }) });
    const result = await saveReservationInternalNote({ expectedUpdatedAt: null, note: "새", reservationId, session });
    expect(result).toEqual({ ok: false, error: "conflict", current: { note: "먼저 쓴 메모", updatedAt: V2 } });
  });

  it("insert 가 42501 이면 권한 없음 · 성공이면 새 버전", async () => {
    scenario({ current: null, write: () => ({ data: null, error: { code: "42501" } }) });
    expect(await saveReservationInternalNote({ expectedUpdatedAt: null, note: "새", reservationId, session })).toEqual({
      ok: false,
      error: "forbidden",
    });
    scenario({ current: null, write: () => ({ data: { note: "새", updated_at: V1 }, error: null }) });
    expect(await saveReservationInternalNote({ expectedUpdatedAt: null, note: " 새 ", reservationId, session })).toEqual({
      ok: true,
      snapshot: { note: "새", updatedAt: V1 },
    });
  });

  it("버전 없음 + 빈 값은 쓰지 않는다(noop) — 그사이 남이 만들었으면 충돌로 알려 준다", async () => {
    scenario({ current: null });
    expect(await saveReservationInternalNote({ expectedUpdatedAt: null, note: "", reservationId, session })).toEqual({
      ok: true,
      snapshot: { note: "", updatedAt: null },
    });
    expect(calls.some((call) => call.op !== "select")).toBe(false);
    scenario({ current: { note: "남이 만듦", updated_at: V1 } });
    expect(await saveReservationInternalNote({ expectedUpdatedAt: null, note: "", reservationId, session })).toEqual({
      ok: false,
      error: "conflict",
      current: { note: "남이 만듦", updatedAt: V1 },
    });
  });

  it("다른 조직 예약이면 쓰지 않는다", async () => {
    responder = () => ({ data: null, error: null });
    expect(await saveReservationInternalNote({ expectedUpdatedAt: null, note: "새", reservationId, session })).toEqual({
      ok: false,
      error: "reservation_not_found",
    });
  });
});

describe("충돌인데 최신 값이 내가 보낸 값과 같으면 성공", () => {
  it("같으면(앞뒤 공백 무시) same, 다르면 conflict", () => {
    expect(resolveNoteConflict(" 청소 늦게 ", { note: "청소 늦게", updatedAt: V2 })).toEqual({
      kind: "same",
      snapshot: { note: "청소 늦게", updatedAt: V2 },
    });
    expect(resolveNoteConflict("내 글", { note: "남의 글", updatedAt: V2 })).toEqual({ kind: "conflict" });
    expect(resolveNoteConflict("", { note: "", updatedAt: null }).kind).toBe("same");
  });
});
