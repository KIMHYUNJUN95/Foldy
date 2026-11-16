import { describe, expect, it } from "vitest";
import { linkedOf } from "@/components/admin/maintenance/maintenance-console-data";
import type { AdminMaintenanceReport } from "@/lib/admin-maintenance";

const resv = { checkIn: "2026-11-10", checkOut: "2026-11-20", guest: "Kim" };
const clean = { date: "2026-11-16", room: "101", staff: "A" };
const make = (link: AdminMaintenanceReport["link"], occupied: boolean) =>
  ({ link, occupied }) as AdminMaintenanceReport;

describe("linkedOf", () => {
  it("재실 중이어도 예약이 있으면 연동 없음이 아니다", () => {
    const l = linkedOf(make({ cleaning: null, reservation: resv }, true));
    expect(l.reservation).toEqual(resv);
    expect(l.empty).toBe(false);
  });
  it("청소만 있어도 연동 있음", () => {
    expect(linkedOf(make({ cleaning: clean, reservation: null }, false)).empty).toBe(false);
  });
  it("둘 다 없으면 연동 없음", () => {
    expect(linkedOf(make({ cleaning: null, reservation: null }, false)).empty).toBe(true);
  });
});
