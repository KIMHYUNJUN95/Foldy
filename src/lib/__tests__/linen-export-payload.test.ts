import { describe, expect, it } from "vitest";
import { buildLinenExportPayload } from "@/components/admin/linen-return/linen-console-data";
import type { AdminLinenRecordVM, AdminLinenReturnData } from "@/lib/admin-linen-returns";

function rec(id: string, building: string, who: string, lines: [string, number][]): AdminLinenRecordVM {
  return {
    id,
    shortId: id,
    buildingName: building,
    buildingLabel: `${building}-L`,
    registeredAt: "2026-11-01 10:00",
    registeredById: who,
    registrantName: `name-${who}`,
    lines: lines.map(([itemId, quantity]) => ({ itemId, code: null, name: `item-${itemId}`, quantity })),
    totalQuantity: lines.reduce((s, [, q]) => s + q, 0),
    note: null,
    photos: [],
    canManage: true,
    updatedAt: "2026-11-01T01:00:00.000000+00:00",
  };
}

const data: AdminLinenReturnData = {
  records: [rec("r1", "A", "u1", [["t", 2]]), rec("r2", "B", "u2", [["s", 3]]), rec("r3", "A", "u2", [["s", 1]])],
  items: [
    { id: "t", code: null, name: "item-t", buildingName: null },
    { id: "s", code: null, name: "item-s", buildingName: null },
  ],
  buildings: [
    { name: "A", label: "A-L" },
    { name: "B", label: "B-L" },
  ],
  loadError: false,
};

describe("내보내기 내용은 서버가 필터로 다시 만든다", () => {
  it("필터 없음 = 기간 전체", () => {
    const p = buildLinenExportPayload(data, { from: "2026-11-01", to: "2026-11-30", view: "records", building: "all", item: "all", registrant: "all" });
    expect(p.records).toHaveLength(3);
    expect(p.building).toBeNull();
    expect(p.scopeLabel).toBe("");
  });

  it("건물 · 품목 · 등록자 필터, 표시는 현지화 라벨", () => {
    const p = buildLinenExportPayload(data, { from: "2026-11-01", to: "2026-11-30", view: "records", building: "A", item: "s", registrant: "all" });
    expect(p.records.map((r) => r.building)).toEqual(["A-L"]);
    expect(p.building).toBe("A-L");
    expect(p.scopeLabel).toBe("A-L · item-s");
    expect(p.items.find((i) => i.name === "item-s")?.allBuildingQuantity).toBe(4);
  });

  it("품목별 보기에서는 품목 필터를 적용하지 않는다(화면과 같게)", () => {
    const p = buildLinenExportPayload(data, { from: "2026-11-01", to: "2026-11-30", view: "items", building: "all", item: "s", registrant: "u2" });
    expect(p.records).toHaveLength(2);
    expect(p.scopeLabel).toBe("name-u2");
  });

  it("모르는 필터 값은 그 값과 맞는 기록이 없을 뿐", () => {
    const p = buildLinenExportPayload(data, { from: "2026-11-01", to: "2026-11-30", view: "records", building: "Z", item: "all", registrant: "all" });
    expect(p.records).toHaveLength(0);
  });
});
