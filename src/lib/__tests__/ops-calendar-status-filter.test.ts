import { describe, expect, it, vi } from "vitest";

import { pendingBeds24InquiryKind } from "@/lib/beds24/reservation-status";
import { assignBarLanes } from "@/lib/ops-bar-lanes";
import {
  DEFAULT_OPS_STATUS_FILTER,
  isDefaultOpsStatusFilter,
  isOpsBarShown,
  opsStatusFilterBadgeCount,
  parseOpsStatusFilter,
  resolveOpsStatusFilter,
  serializeOpsStatusFilter,
} from "@/lib/ops-calendar-status-filter";
import { barOccupiesRoom, opsReservationKind } from "@/lib/ops-reservation-kind";
import { opsVacantRoomKeys } from "@/lib/ops-vacant-today";
import { splitOpsBars } from "@/lib/ops-calendar-occupancy";
import { toRoomAxisKey } from "@/lib/ops-room-key";

vi.mock("server-only", () => ({}));

const serviceClient = null as never;
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => serviceClient }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => serviceClient }));

const { readOpsMoveTargets, readOpsRoomUnavailableNights } = await import("@/lib/ops-calendar");

/**
 * 판매 캘린더 「예약 표시」 필터 · 문의 처리 (2026-11-26).
 *
 * 버그: Beds24 원본 `inquiry` · `request`(Airbnb 문의 · 예약 요청)는 우리 표에 `confirmed` 로 적혀 판매 캘린더에
 * 확정 막대로 그려졌고(예: 96720615), 빈 방 · 옮기기 대상 · 새 예약 겹침 검사에서 방을 막았다.
 * 계약: docs/product/33-calendar-write-features.md 「예약 표시 — 상태 필터」
 */

describe("pendingBeds24InquiryKind — 문의와 요청을 나눈다(같은 값 집합)", () => {
  it("inquiry · 5 는 문의, request · 3 은 요청, 나머지는 null", () => {
    expect(pendingBeds24InquiryKind("inquiry")).toBe("inquiry");
    expect(pendingBeds24InquiryKind("5")).toBe("inquiry");
    expect(pendingBeds24InquiryKind(5)).toBe("inquiry");
    expect(pendingBeds24InquiryKind("request")).toBe("request");
    expect(pendingBeds24InquiryKind("3")).toBe("request");
    expect(pendingBeds24InquiryKind(3)).toBe("request");
    expect(pendingBeds24InquiryKind("new")).toBeNull();
    expect(pendingBeds24InquiryKind("Inquiry")).toBeNull();
    expect(pendingBeds24InquiryKind(null)).toBeNull();
  });
});

describe("opsReservationKind — 예약 한 건의 표시 종류", () => {
  it("취소 · 노쇼가 먼저, 그다음 문의 · 요청, 나머지는 확정", () => {
    expect(opsReservationKind("cancelled", "inquiry")).toBe("cancelled");
    expect(opsReservationKind("no_show", "new")).toBe("cancelled");
    expect(opsReservationKind("confirmed", "inquiry")).toBe("inquiry");
    expect(opsReservationKind("confirmed", 3)).toBe("request");
    expect(opsReservationKind("confirmed", "new")).toBe("confirmed");
    expect(opsReservationKind("confirmed", undefined)).toBe("confirmed");
  });

  it("방을 차지하는 것은 확정뿐 — 문의 · 요청은 빈 방으로 센다", () => {
    expect(barOccupiesRoom({ isCancelled: false, kind: "confirmed" })).toBe(true);
    expect(barOccupiesRoom({ isCancelled: false, kind: "inquiry" })).toBe(false);
    expect(barOccupiesRoom({ isCancelled: false, kind: "request" })).toBe(false);
    expect(barOccupiesRoom({ isCancelled: true, kind: "cancelled" })).toBe(false);
    // 예전 모양(kind 없음)은 isCancelled 만 본다.
    expect(barOccupiesRoom({ isCancelled: false })).toBe(true);
  });

  it("오늘 빈방 — 문의 막대는 방을 채우지 않는다(켜서 그려도 점유가 아니다)", () => {
    const { stays } = splitOpsBars(
      [{ channel: "airbnb", checkIn: "2026-11-25", checkOut: "2026-11-28", guestName: "g", id: "i", isCancelled: false, kind: "inquiry", roomKey: "A" }],
      ["confirmed", "inquiry"],
    );
    expect([...opsVacantRoomKeys({ roomKeys: ["A"], stays, today: "2026-11-26" })]).toEqual(["A"]);
  });
});

describe("예약 표시 필터 — 기본 · URL · 저장값", () => {
  it("기본은 확정만", () => {
    expect(DEFAULT_OPS_STATUS_FILTER).toEqual(["confirmed"]);
    expect(isDefaultOpsStatusFilter(["confirmed"])).toBe(true);
    expect(opsStatusFilterBadgeCount(["confirmed"])).toBe(0);
  });

  it("URL 값(쉼표)을 읽고 순서를 고정하고 모르는 값 · 중복은 버린다", () => {
    expect(parseOpsStatusFilter("inquiry,confirmed,bogus,inquiry")).toEqual(["confirmed", "inquiry"]);
    expect(parseOpsStatusFilter(["cancelled", "request"])).toEqual(["request", "cancelled"]);
    expect(parseOpsStatusFilter("")).toBeNull();
    expect(parseOpsStatusFilter(undefined)).toBeNull();
    expect(parseOpsStatusFilter("bogus")).toBeNull();
    expect(parseOpsStatusFilter(42)).toBeNull();
  });

  it("URL 이 저장값보다 먼저, 둘 다 없으면 기본 · 예전 cancelled=1 은 취소를 더한다", () => {
    expect(resolveOpsStatusFilter({ url: "inquiry", saved: ["cancelled"] })).toEqual(["inquiry"]);
    expect(resolveOpsStatusFilter({ url: undefined, saved: ["confirmed", "cancelled"] })).toEqual(["confirmed", "cancelled"]);
    expect(resolveOpsStatusFilter({ url: undefined, saved: null })).toEqual(["confirmed"]);
    expect(resolveOpsStatusFilter({ url: undefined, saved: "garbage" })).toEqual(["confirmed"]);
    expect(resolveOpsStatusFilter({ legacyCancelled: true, url: undefined, saved: null })).toEqual(["confirmed", "cancelled"]);
  });

  it("URL 로 다시 쓰기 — 기본이면 비운다", () => {
    expect(serializeOpsStatusFilter(["confirmed"])).toBeUndefined();
    expect(serializeOpsStatusFilter(["inquiry", "confirmed"])).toBe("confirmed,inquiry");
    // 아무것도 안 고른 것도 상태다 — 빈 값과 구분한다.
    expect(serializeOpsStatusFilter([])).toBe("none");
    expect(parseOpsStatusFilter("none")).toEqual([]);
  });

  it("+N 은 기본과 다른 항목 수", () => {
    expect(opsStatusFilterBadgeCount(["confirmed", "inquiry", "request", "cancelled"])).toBe(3);
    expect(opsStatusFilterBadgeCount(["inquiry"])).toBe(2);
    expect(opsStatusFilterBadgeCount([])).toBe(1);
  });

  it("고른 종류만 그린다", () => {
    expect(isOpsBarShown("inquiry", ["confirmed"])).toBe(false);
    expect(isOpsBarShown("inquiry", ["confirmed", "inquiry"])).toBe(true);
    expect(isOpsBarShown("confirmed", ["cancelled"])).toBe(false);
  });
});

describe("assignBarLanes — 겹치면 확정이 위층", () => {
  it("문의가 먼저 체크인해도 확정이 0층", () => {
    const { laneById, laneCountByRoom } = assignBarLanes([
      { checkIn: "2026-12-01", checkOut: "2026-12-05", id: "inq", rank: 1, roomKey: "A" },
      { checkIn: "2026-12-02", checkOut: "2026-12-04", id: "conf", rank: 0, roomKey: "A" },
    ]);
    expect(laneById.get("conf")).toBe(0);
    expect(laneById.get("inq")).toBe(1);
    expect(laneCountByRoom.get("A")).toBe(2);
  });

  it("rank 가 없으면 예전 순서 그대로", () => {
    const { laneById } = assignBarLanes([
      { checkIn: "2026-12-01", checkOut: "2026-12-05", id: "a", roomKey: "A" },
      { checkIn: "2026-12-02", checkOut: "2026-12-04", id: "b", roomKey: "A" },
    ]);
    expect(laneById.get("a")).toBe(0);
    expect(laneById.get("b")).toBe(1);
  });
});

// ── 읽기: 문의 · 요청은 방을 막지 않는다 ────────────────────────────────────

type Result = { data: unknown; error: { message: string } | null };

function fakeClient(resolve: (table: string, columns: string) => Result) {
  return {
    from(table: string) {
      let columns = "";
      const chain: Record<string, unknown> = {};
      for (const method of ["eq", "in", "order", "gt", "gte", "lt", "lte", "is", "neq", "not", "range", "maybeSingle", "single", "or", "limit"]) {
        chain[method] = () => chain;
      }
      chain.select = (value?: string) => {
        columns = value ?? "";
        return chain;
      };
      chain.then = (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve(table, columns)).then(onFulfilled, onRejected);
      return chain;
    },
  } as never;
}

function reservationRow(id: string, checkIn: string, checkOut: string, rawStatus: unknown) {
  return {
    check_in_date: checkIn,
    check_out_date: checkOut,
    guest_name: `Guest ${id}`,
    id,
    property_name: "가부키초",
    room_label: "201",
    rp_status: rawStatus,
    source: "airbnb",
    status: "confirmed",
  };
}

function readClient(reservations: unknown[]) {
  return fakeClient((table, columns) => {
    if (table === "reservations") {
      // 원본 상태를 실제로 고르지 않으면 판정이 안 된다 — 가짜도 고른 칸만 돌려준다.
      const wantsStatus = columns.includes("raw_payload->status");
      return {
        data: reservations.map((row) => {
          const copy = { ...(row as Record<string, unknown>) };
          if (!wantsStatus) delete copy.rp_status;
          return copy;
        }),
        error: null,
      };
    }
    if (table === "rooms" && columns.startsWith("id, properties")) {
      return { data: [{ id: "room-a", properties: { external_property_id: 100 } }], error: null };
    }
    if (table === "beds24_property_rates_state") {
      return { data: [{ external_property_id: 100, last_full_read_at: "2026-11-25T00:00:00Z" }], error: null };
    }
    if (table === "rooms") return { data: [], error: null };
    if (table === "room_daily_rates") {
      return {
        data: ["2026-12-01", "2026-12-02", "2026-12-03"].map((stay_date) => ({
          min_stay: 1,
          override_kind: null,
          room_id: "room-a",
          stay_date,
          synced_at: "2026-11-25T01:00:00Z",
        })),
        error: null,
      };
    }
    return { data: [], error: null };
  });
}

const ROOM_KEY = toRoomAxisKey("가부키초", "201");

describe("readOpsRoomUnavailableNights — 새 예약 · 수정 겹침", () => {
  it("문의 · 요청이 있는 밤은 비어 있다, 확정만 막는다", async () => {
    const supabase = readClient([
      reservationRow("conf", "2026-12-01", "2026-12-02", "new"),
      reservationRow("inq", "2026-12-02", "2026-12-04", "inquiry"),
      reservationRow("req", "2026-12-02", "2026-12-03", 3),
    ]);
    const result = await readOpsRoomUnavailableNights({
      from: "2026-12-01",
      organizationId: "org-1",
      roomIds: ["room-a"],
      roomKey: ROOM_KEY,
      supabase,
      toExclusive: "2026-12-04",
    });
    expect(result.booked).toEqual(["2026-12-01"]);
  });
});

describe("readOpsMoveTargets — 옮기기 후보", () => {
  it("문의만 있는 줄은 옮길 수 있다(겹침 손님 없음)", async () => {
    const supabase = readClient([reservationRow("inq", "2026-12-01", "2026-12-04", "inquiry")]);
    const result = await readOpsMoveTargets({
      excludeReservationId: "moving",
      from: "2026-12-01",
      organizationId: "org-1",
      rows: [{ roomIds: ["room-a"], roomKey: ROOM_KEY }],
      supabase,
      toExclusive: "2026-12-04",
    });
    expect(result.get(ROOM_KEY)?.booked).toEqual([]);
    expect(result.get(ROOM_KEY)?.clashGuest).toBeNull();
  });

  it("확정은 그대로 겹침", async () => {
    const supabase = readClient([reservationRow("conf", "2026-12-01", "2026-12-03", "new")]);
    const result = await readOpsMoveTargets({
      excludeReservationId: "moving",
      from: "2026-12-01",
      organizationId: "org-1",
      rows: [{ roomIds: ["room-a"], roomKey: ROOM_KEY }],
      supabase,
      toExclusive: "2026-12-04",
    });
    expect(result.get(ROOM_KEY)?.booked).toEqual(["2026-12-01", "2026-12-02"]);
    expect(result.get(ROOM_KEY)?.clashGuest).toBe("Guest conf");
  });
});
