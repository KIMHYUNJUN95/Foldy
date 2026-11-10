import { describe, expect, it } from "vitest";
import { filterOrdersForExport, ordersExportQuery } from "@/lib/orders-export-filter";

const base = { building_name: "아라키초A", itemNames: ["타월"], reporter_name: "김", title: "비품", urgency: "normal" };
const orders = [
  { ...base, id: "a", status: "requested" as const },
  { ...base, id: "b", status: "approved" as const, urgency: "high" },
  { ...base, id: "c", status: "ordered" as const },
  { ...base, id: "d", status: "received" as const },
  { ...base, id: "e", status: "closed" as const },
  { ...base, building_name: "오쿠보A", id: "f", status: "requested" as const },
];

describe("주문 내보내기 — 처리 중 보기", () => {
  it("숨은 기간 없이 읽는다(기본 30일이 넘어가도 무시)", () => {
    const q = ordersExportQuery({ endDate: "2026-11-10", scope: "open", startDate: "2026-10-12", status: "closed" });
    expect(q).toEqual({ dateRange: {} });
  });

  it("종결 안 된 주문 전부 · 건물 고르기만 따른다", () => {
    const rows = filterOrdersForExport(orders, { building: "아라키초A", query: "없는말", scope: "open", urgency: "high" });
    expect(rows.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("주문 내보내기 — 전체 기록 보기", () => {
  it("기간 · 상태를 그대로 쓴다", () => {
    expect(ordersExportQuery({ endDate: "2026-11-10", startDate: "2026-10-12", status: "closed" })).toEqual({
      dateRange: { endDate: "2026-11-10", startDate: "2026-10-12" },
      status: "closed",
    });
  });

  it("긴급도 · 검색어로 거른다", () => {
    expect(filterOrdersForExport(orders, { urgency: "high" }).map((o) => o.id)).toEqual(["b"]);
    expect(filterOrdersForExport(orders, { query: "없는말" })).toEqual([]);
  });
});
