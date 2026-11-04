import { describe, expect, it } from "vitest";

import { planSync, type ReservationRow, type StayRow } from "../sync/plan";

const ORG = "org-1";
const TODAY = "2026-11-02";

function resv(over: Partial<ReservationRow> = {}): ReservationRow {
  return {
    id: "r1",
    organization_id: ORG,
    original_reservation_id: "HM123",
    property_name: "가부키초",
    room_label: "201",
    check_in_date: "2026-11-05",
    check_out_date: "2026-11-07",
    status: "confirmed",
    raw_payload: { numAdult: 2, numChild: 1 },
    ...over,
  };
}

function stay(over: Partial<StayRow> = {}): StayRow {
  return {
    id: "s1",
    organization_id: ORG,
    reservation_group_key: "HM123",
    property_key: "kabukicho",
    check_in_date: "2026-11-05",
    check_out_date: "2026-11-07",
    guest_count_expected: 3,
    status: "pending",
    retain_until: "2029-11-07",
    ...over,
  };
}

describe("planSync", () => {
  it("방 여러 개 예약은 stay 하나로 묶는다", () => {
    const plan = planSync(
      [
        resv({ id: "r2", room_label: "202", check_out_date: "2026-11-08", raw_payload: { numAdult: 1 } }),
        resv(),
      ],
      [],
      [],
      TODAY,
    );
    expect(plan.inserts).toHaveLength(1);
    const [insert] = plan.inserts;
    expect(insert).toMatchObject({
      reservation_group_key: "HM123",
      property_key: "kabukicho",
      check_in_date: "2026-11-05",
      check_out_date: "2026-11-08",
      guest_count_expected: 4,
      retain_until: "2029-11-08",
    });
    expect(insert.rooms.map((room) => room.reservation_id)).toEqual(["r1", "r2"]);
  });

  it("인원을 모르면 방 하나 1명으로 본다", () => {
    const plan = planSync([resv({ raw_payload: {} })], [], [], TODAY);
    expect(plan.inserts[0].guest_count_expected).toBe(1);
  });

  it("전부 취소된 예약은 새로 만들지 않는다", () => {
    const plan = planSync([resv({ status: "cancelled" })], [], [], TODAY);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
  });

  it("열린 stay 의 예약이 취소되면 닫고 30일 뒤 지운다", () => {
    const plan = planSync([resv({ status: "no_show" })], [stay()], [], TODAY);
    expect(plan.updates).toEqual([
      { id: "s1", patch: { status: "cancelled", retain_until: "2026-12-02" }, needsCode: false },
    ]);
  });

  it("체크인한 stay 는 바꾸지 않고 건수만 센다", () => {
    const plan = planSync([resv({ check_out_date: "2026-11-09" })], [stay({ status: "checked_in" })], [], TODAY);
    expect(plan.updates).toHaveLength(0);
    expect(plan.changedAfterCheckin).toBe(1);
    const cancelled = planSync([resv({ status: "cancelled" })], [stay({ status: "checked_in" })], [], TODAY);
    expect(cancelled.updates).toHaveLength(0);
  });

  it("날짜 · 인원이 바뀌면 바뀐 칸만 고친다", () => {
    const plan = planSync([resv({ check_out_date: "2026-11-08" })], [stay()], [{ id: "sr1", stay_id: "s1", reservation_id: "r1" }], TODAY);
    expect(plan.updates).toEqual([
      { id: "s1", patch: { check_out_date: "2026-11-08", retain_until: "2029-11-08" }, needsCode: false },
    ]);
    expect(plan.roomInserts).toHaveLength(0);
    expect(plan.roomDeletes).toHaveLength(0);
  });

  it("바뀐 것이 없으면 아무것도 하지 않는다", () => {
    const plan = planSync([resv()], [stay()], [{ id: "sr1", stay_id: "s1", reservation_id: "r1" }], TODAY);
    expect(plan).toMatchObject({ inserts: [], updates: [], roomInserts: [], roomDeletes: [] });
  });

  it("취소됐던 예약이 살아나면 열고 코드를 새로 준다", () => {
    const plan = planSync([resv()], [stay({ status: "cancelled", retain_until: "2026-12-01" })], [], TODAY);
    expect(plan.updates[0]).toMatchObject({ patch: { status: "pending", retain_until: "2029-11-07" }, needsCode: true });
  });

  it("방이 늘고 줄면 stay_rooms 를 맞춘다", () => {
    const plan = planSync(
      [resv({ id: "r1", status: "cancelled" }), resv({ id: "r3", room_label: "203", raw_payload: { numAdult: 3 } })],
      [stay()],
      [{ id: "sr1", stay_id: "s1", reservation_id: "r1" }],
      TODAY,
    );
    expect(plan.roomInserts).toEqual([{ organization_id: ORG, stay_id: "s1", reservation_id: "r3", room_label: "203" }]);
    expect(plan.roomDeletes).toEqual(["sr1"]);
  });

  it("모르는 건물 · 번호 없는 예약은 건너뛴다", () => {
    const plan = planSync(
      [resv({ property_name: "새 건물" }), resv({ id: "r9", original_reservation_id: " " })],
      [],
      [],
      TODAY,
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.unknownProperty).toBe(1);
  });

  it("태블릿을 두지 않는 건물(사노)은 stay 도 코드도 만들지 않고 건너뛴 건수만 센다", () => {
    const plan = planSync([resv({ property_name: "사노" }), resv({ id: "r2", original_reservation_id: "B2", property_name: "사노" })], [], [], TODAY);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.excludedProperty).toBe(2);
    expect(plan.unknownProperty).toBe(0);
  });

  it("다른 조직의 같은 번호는 따로 본다", () => {
    const plan = planSync([resv(), resv({ id: "r5", organization_id: "org-2" })], [stay()], [{ id: "sr1", stay_id: "s1", reservation_id: "r1" }], TODAY);
    expect(plan.inserts.map((insert) => insert.organization_id)).toEqual(["org-2"]);
  });
});
