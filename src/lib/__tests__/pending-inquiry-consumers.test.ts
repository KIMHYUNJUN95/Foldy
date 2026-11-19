import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { decideCalendarDeepLink } from "@/lib/calendar-deep-link";

import { createFakeSupabase } from "./fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => null }));

const { getCleaningTargets } = await import("@/lib/cleaning-targets");
const { loadStayKeys } = await import("@/lib/cleaning-assign/rooms");

// 2026-11-19 — 문의 · 예약 요청(Beds24 inquiry · request, 우리 표 `confirmed`)은 운영 화면에서 빠진다. 손님 메시지함은 남긴다.

const ORG = "org-1";
const DATE = "2026-11-20";

function reservation(id: string, status: unknown, over: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: ORG,
    status: "confirmed",
    guest_name: `Guest ${id}`,
    property_name: "가부키초",
    room_label: "201",
    check_in_date: "2026-11-18",
    check_out_date: DATE,
    raw_payload: status === undefined ? { bookId: 1 } : { status },
    ...over,
  };
}

describe("청소 대상(getCleaningTargets)", () => {
  it("문의 · 요청은 퇴실 청소 · 셋팅 · 다음 체크인에서 빠지고 상태 없는 예약은 남는다", async () => {
    const { client } = createFakeSupabase({
      reservations: [
        reservation("inq-out", "inquiry", { room_label: "301" }),
        reservation("new-out", "new", { room_label: "201" }),
        reservation("none-out", undefined, { room_label: "202" }),
        // 201 오늘 체크인이 문의뿐이면 턴오버가 아니다.
        reservation("req-in", "request", { room_label: "201", check_in_date: DATE, check_out_date: "2026-11-22" }),
        // 셋팅 후보 — 문의(숫자 5)는 빠지고 확정만 남는다.
        reservation("num-in", 5, { room_label: "401", check_in_date: DATE, check_out_date: "2026-11-22" }),
        reservation("conf-in", "confirmed", { room_label: "402", check_in_date: DATE, check_out_date: "2026-11-22" }),
      ],
    });
    const result = await getCleaningTargets(ORG, DATE, client as never);
    expect(result.cleaningList.map((row) => row.departingGuestName).sort()).toEqual(["Guest new-out", "Guest none-out"]);
    const room201 = result.cleaningList.find((row) => row.departingGuestName === "Guest new-out");
    expect(room201?.hasTurnover).toBe(false);
    expect(room201?.nextCheckInGuestName).toBeNull();
    expect(result.settingList.map((row) => row.arrivingGuestName)).toEqual(["Guest conf-in"]);
  });
});

describe("오늘 내 방 청소 종류(loadStayKeys)", () => {
  it("문의로 묵는 방은 손님 있는 방으로 치지 않는다", async () => {
    const { client } = createFakeSupabase({
      reservations: [
        reservation("inq", "inquiry", { room_label: "301", check_in_date: DATE, check_out_date: "2026-11-22" }),
        reservation("new", "new", { room_label: "302", check_in_date: DATE, check_out_date: "2026-11-22" }),
      ],
    });
    const keys = await loadStayKeys(client as never, ORG, DATE);
    expect(keys.arriving.size).toBe(1);
    expect([...keys.arriving][0]).toContain("302");
  });
});

describe("캘린더 예약 딥링크", () => {
  it("문의 · 요청이면 캘린더에 없다는 안내를 준다", () => {
    const decision = decideCalendarDeepLink({
      currentMonth: "2026-11",
      excluded: false,
      nextMonth: "2026-12",
      reservation: { checkInDate: DATE, checkOutDate: "2026-11-22", pendingInquiry: true, propertyName: "가부키초", status: "confirmed" },
    });
    expect(decision).toEqual({ kind: "notice", reason: "inquiry" });
  });
});

describe("운영 화면 읽기는 같은 판정으로 DB 에서 거른다", () => {
  // 화면마다 `.not("raw_payload", "cs", …)` 을 따로 쓰지 않도록 — 헬퍼 하나를 쓰는지 본다.
  const files = [
    "src/lib/cleaning-targets.ts",
    "src/lib/cleaning-assign/rooms.ts",
    "src/lib/admin-calendar-dashboard.ts",
    "src/app/mobile/calendar/page.tsx",
    "src/lib/home.ts",
    "src/lib/admin-building-map.ts",
    "src/lib/complaint-reservations.ts",
    "src/actions/task-context.ts",
    "src/lib/automation/data.ts",
  ];
  it.each(files)("%s", (file) => {
    const source = readFileSync(path.resolve(file), "utf8");
    const reads = source.split('from("reservations")').length - 1;
    const filtered = source.split("excludePendingInquiries(").length - 1;
    expect(reads).toBeGreaterThan(0);
    expect(filtered).toBeGreaterThan(0);
  });
});
