import { describe, expect, it } from "vitest";
import { groupByBuilding, pairByRoom } from "@/lib/home-reservation-groups";

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

/** 같은 방의 체크아웃 · 체크인을 한 줄로 (2026-10-28 대시보드 「오늘 예약」). */
describe("pairByRoom", () => {
  type R = { id: string; propertyName: string; roomLabel: string };
  const r = (id: string, propertyName: string, roomLabel: string): R => ({ id, propertyName, roomLabel });

  it("같은 건물 · 같은 방이면 나감과 들어옴을 한 줄로, 아니면 따로", () => {
    const rows = pairByRoom(
      [r("in1", "가부키초", "302"), r("in2", "가부키초", "401")],
      [r("out1", "가부키초", "302"), r("out2", "아라키초A", "302")],
    );
    expect(rows.map((x) => [x.checkOut?.id ?? null, x.checkIn?.id ?? null])).toEqual([
      ["out1", "in1"],
      ["out2", null],
      [null, "in2"],
    ]);
    expect(rows[0].key).toBe("out:out1|in:in1");
  });

  it("한 방에 두 번 들어오면 첫 체크인만 짝짓고 남는 것은 따로", () => {
    const rows = pairByRoom([r("a", "가부키초", "1"), r("b", "가부키초", "1")], [r("o", "가부키초", "1")]);
    expect(rows.map((x) => [x.checkOut?.id ?? null, x.checkIn?.id ?? null])).toEqual([
      ["o", "a"],
      [null, "b"],
    ]);
  });
});
