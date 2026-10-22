import { describe, expect, it } from "vitest";
import { groupByBuilding } from "@/lib/home-reservation-groups";

/** 홈 체크인 · 체크아웃을 건물별로 묶는다 (2026-10-22). */
type Row = { id: string; property: string; room: string };

const labels = { arakicho_a: "Arakicho A", kabukicho: "Kabukicho", stay_ari: "STAY ARI" };
const group = (rows: Row[]) => groupByBuilding(rows, (r) => r.property, (r) => r.room, labels);

describe("groupByBuilding", () => {
  it("판매 캘린더와 같은 운영 순서로 건물을 세운다", () => {
    const groups = group([
      { id: "1", property: "STAY ARI Apartment Hotel", room: "101" },
      { id: "2", property: "가부키초", room: "302" },
      { id: "3", property: "아라키초A", room: "401" },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Arakicho A", "Kabukicho", "STAY ARI"]);
  });

  it("같은 건물은 하나로 모으고 객실 번호순(숫자 기준)", () => {
    const groups = group([
      { id: "a", property: "가부키초", room: "502" },
      { id: "b", property: "歌舞伎町", room: "8" },
      { id: "c", property: "가부키초", room: "302" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("같은 객실은 들어온 순서를 지킨다(체크인 먼저)", () => {
    const groups = group([
      { id: "in", property: "가부키초", room: "302" },
      { id: "out", property: "가부키초", room: "302" },
    ]);
    expect(groups[0].items.map((r) => r.id)).toEqual(["in", "out"]);
  });

  it("목록에 없는 건물은 뒤에, 이름은 그대로", () => {
    const groups = group([
      { id: "x", property: "New Building", room: "1" },
      { id: "y", property: "가부키초", room: "1" },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Kabukicho", "New Building"]);
  });
});
