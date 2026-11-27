import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";
import { lostItemClock } from "@/lib/lost-found-constants";
import {
  lostRowTone,
  maintenanceRowTone,
  orderRowTone,
  splitRequestRowsByStatus,
  tokyoMonthDayLabel,
} from "@/lib/request-status-groups";

describe("splitRequestRowsByStatus", () => {
  it("끝남이 아닌 줄은 진행 중, 각 묶음 안 순서는 그대로", () => {
    const rows = [
      { id: "a", done: false },
      { id: "b", done: true },
      { id: "c", done: false },
      { id: "d", done: true },
    ];
    const { open, done } = splitRequestRowsByStatus(rows);
    expect(open.map((r) => r.id)).toEqual(["a", "c"]);
    expect(done.map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("빈 목록이면 두 묶음 모두 비어 있다", () => {
    expect(splitRequestRowsByStatus([])).toEqual({ open: [], done: [] });
  });
});

describe("tokyoMonthDayLabel", () => {
  it("도쿄 날짜로 M/D — UTC 15시 이후는 다음 날", () => {
    expect(tokyoMonthDayLabel("2026-11-24T14:59:00Z")).toBe("11/24");
    expect(tokyoMonthDayLabel("2026-11-24T15:00:00Z")).toBe("11/25");
    expect(tokyoMonthDayLabel("2026-01-05T03:00:00Z")).toBe("1/5");
  });

  it("연말 경계 — UTC 12/31 15:00 은 도쿄 1/1", () => {
    expect(tokyoMonthDayLabel("2026-12-31T14:59:59Z")).toBe("12/31");
    expect(tokyoMonthDayLabel("2026-12-31T15:00:00Z")).toBe("1/1");
  });
});

// 실제 상태 값 → 톤 → 묶음. 묶음은 톤 하나로만 정해진다(done 이면 끝남).
const groupOf = (tone: string) => (tone === "done" ? "done" : "open");

describe("요청 줄 상태 → 톤 → 묶음", () => {
  const today = "2026-11-27";
  const lost = (status: Parameters<typeof lostRowTone>[0], found_at: string, hold_until: string | null = null) =>
    lostRowTone(status, lostItemClock({ status, found_at, hold_until }, today));

  it.each([
    // [이름, 톤, 묶음]
    ["분실물 보관 중(여유)", lost("stored", "2026-11-20T03:00:00Z"), "open", "open"],
    ["분실물 등록됨(여유)", lost("registered", "2026-11-26T03:00:00Z"), "open", "open"],
    ["분실물 폐기 예정(여유)", lost("disposal_scheduled", "2026-11-20T03:00:00Z"), "open", "open"],
    ["분실물 보관 중 · 기한 임박", lost("stored", "2026-11-01T03:00:00Z", "2026-11-29"), "soon", "open"],
    ["분실물 보관 중 · 기한 지남", lost("stored", "2026-08-01T03:00:00Z"), "soon", "open"],
    ["분실물 반환", lost("returned", "2026-11-20T03:00:00Z"), "done", "done"],
    ["분실물 폐기", lost("disposed", "2026-08-01T03:00:00Z"), "done", "done"],
    ["수리 접수", maintenanceRowTone("open"), "open", "open"],
    ["수리 처리 중", maintenanceRowTone("in_progress"), "prog", "open"],
    ["수리 완료", maintenanceRowTone("closed"), "done", "done"],
    ["수리 무효", maintenanceRowTone("cancelled"), "done", "done"],
    ["주문 요청됨", orderRowTone("requested"), "open", "open"],
    ["주문 승인됨", orderRowTone("approved"), "open", "open"],
    ["주문 처리됨", orderRowTone("ordered"), "open", "open"],
    ["주문 입고", orderRowTone("received"), "done", "done"],
    ["주문 종료", orderRowTone("closed"), "done", "done"],
  ])("%s → %s · %s", (_name, tone, wantTone, wantGroup) => {
    expect(tone).toBe(wantTone);
    expect(groupOf(tone)).toBe(wantGroup);
  });
});

describe("묶음 이름은 상태 글자와 겹치지 않는다", () => {
  for (const locale of ["ko", "ja", "en"] as const) {
    it(locale, () => {
      const d = getDictionary(locale);
      const statusWords = new Set<string>([
        ...Object.values(d.maintenance.statusLabels),
        ...Object.values(d.lostFound.statusLabels),
        ...Object.values(d.mobile.orderStatusLabels),
      ]);
      expect(statusWords.has(d.mobile.requestGroupOpen)).toBe(false);
      expect(statusWords.has(d.mobile.requestGroupDone)).toBe(false);
    });
  }
});
