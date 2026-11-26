import { describe, expect, it } from "vitest";
import type { OpsCalendarBar, OpsCalendarBlock } from "@/lib/ops-calendar";
import { buildGapContext, shiftDay } from "@/lib/ops-gap-context";

/**
 * 1박 갭의 앞뒤 맥락.
 *
 * 계약: `src/lib/ops-gap-context.ts`
 * 시안: `6-minstay.dc.html` → 갭 목록 (`Booking ▸ 1박 ▸ Airbnb`)
 *
 * **하나만 밀려도 엉뚱한 예약이 붙는다.** 예약 막대는 체크아웃 날 밤이 비어 있으므로
 * 앞 예약은 `checkOut === 갭날짜`, 뒤 예약은 `checkIn === 갭날짜 + 1` 이다.
 */
const bar = (over: Partial<OpsCalendarBar>): OpsCalendarBar => ({
  channel: "airbnb",
  checkIn: "2026-12-01",
  checkOut: "2026-12-03",
  guestName: "Guest",
  id: "b1",
  isCancelled: false,
  kind: "confirmed",
  roomKey: "402",
  ...over,
});

const block = (over: Partial<OpsCalendarBlock>): OpsCalendarBlock => ({
  endDate: "2026-12-05",
  id: "k1",
  roomKey: "402",
  startDate: "2026-12-05",
  ...over,
});

const labels = new Map([
  ["402", "402호"],
  ["201", "201호"],
]);

describe("shiftDay", () => {
  it("달과 해를 넘어간다", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("buildGapContext", () => {
  it("앞은 체크아웃이 갭날짜인 예약, 뒤는 체크인이 갭+1인 예약", () => {
    const entries = buildGapContext({
      gapCells: new Set(["402|2026-12-03"]),
      bars: [
        bar({ id: "in", channel: "booking", checkIn: "2026-12-01", checkOut: "2026-12-03" }),
        bar({ id: "out", channel: "airbnb", checkIn: "2026-12-04", checkOut: "2026-12-07" }),
      ],
      blocks: [],
      roomLabels: labels,
    });
    expect(entries).toEqual([
      {
        roomKey: "402",
        roomLabel: "402호",
        propertyName: "",
        date: "2026-12-03",
        before: { kind: "booking" },
        after: { kind: "airbnb" },
      },
    ]);
  });

  it("체크아웃이 하루 어긋난 예약은 앞이 아니다 — 그 밤은 비어 있지 않다", () => {
    const entries = buildGapContext({
      gapCells: new Set(["402|2026-12-03"]),
      bars: [bar({ checkIn: "2026-12-01", checkOut: "2026-12-02" })],
      blocks: [],
      roomLabels: labels,
    });
    expect(entries[0]?.before).toEqual({ kind: "none" });
  });

  it("취소된 예약은 맥락이 아니다 — 그 자리는 비어 있다", () => {
    const entries = buildGapContext({
      gapCells: new Set(["402|2026-12-03"]),
      bars: [bar({ checkOut: "2026-12-03", isCancelled: true })],
      blocks: [],
      roomLabels: labels,
    });
    expect(entries[0]?.before).toEqual({ kind: "none" });
  });

  it("블록도 맥락이다 — 앞은 갭 전날, 뒤는 갭 다음날을 덮는 블록", () => {
    const entries = buildGapContext({
      gapCells: new Set(["402|2026-12-03"]),
      bars: [],
      blocks: [
        block({ id: "before", startDate: "2026-12-01", endDate: "2026-12-02" }),
        block({ id: "after", startDate: "2026-12-04", endDate: "2026-12-06" }),
      ],
      roomLabels: labels,
    });
    expect(entries[0]?.before).toEqual({ kind: "block" });
    expect(entries[0]?.after).toEqual({ kind: "block" });
  });

  it("예약이 블록보다 구체적이다 — 둘 다 있으면 손님 쪽을 보여준다", () => {
    const entries = buildGapContext({
      gapCells: new Set(["402|2026-12-03"]),
      bars: [bar({ channel: "manual", checkOut: "2026-12-03" })],
      blocks: [block({ startDate: "2026-12-01", endDate: "2026-12-02" })],
      roomLabels: labels,
    });
    expect(entries[0]?.before).toEqual({ kind: "manual" });
  });

  it("다른 방의 예약은 맥락이 아니다", () => {
    const entries = buildGapContext({
      gapCells: new Set(["402|2026-12-03"]),
      bars: [bar({ roomKey: "201", checkOut: "2026-12-03" })],
      blocks: [],
      roomLabels: labels,
    });
    expect(entries[0]?.before).toEqual({ kind: "none" });
  });

  it("방 이름 · 날짜 순으로 정렬한다 — 목록 순서가 매번 달라지면 안 된다", () => {
    const entries = buildGapContext({
      gapCells: new Set(["402|2026-12-05", "201|2026-12-09", "402|2026-12-01"]),
      bars: [],
      blocks: [],
      roomLabels: labels,
    });
    expect(entries.map((entry) => `${entry.roomLabel}/${entry.date}`)).toEqual([
      "201호/2026-12-09",
      "402호/2026-12-01",
      "402호/2026-12-05",
    ]);
  });

  it("이름을 모르는 방은 키를 그대로 쓴다 — 목록에서 빠지지는 않는다", () => {
    const entries = buildGapContext({
      gapCells: new Set(["999|2026-12-03"]),
      bars: [],
      blocks: [],
      roomLabels: labels,
    });
    expect(entries[0]?.roomLabel).toBe("999");
  });

  it("건물을 달고, 주면 격자 순서대로 정렬한다 — 방 번호만으로는 어느 건물인지 모른다", () => {
    const entries = buildGapContext({
      gapCells: new Set(["B::107|2026-11-21", "A::502|2026-11-24"]),
      bars: [],
      blocks: [],
      propertyNames: new Map([
        ["A::502", "아라키초A"],
        ["B::107", "오쿠보B"],
      ]),
      roomLabels: new Map([
        ["A::502", "502"],
        ["B::107", "107"],
      ]),
      // 격자에서는 아라키초A 가 먼저다 — 방 번호 순(107 < 502)이 아니라 이 순서를 따라야 한다.
      roomOrder: new Map([
        ["A::502", 0],
        ["B::107", 1],
      ]),
    });
    expect(entries.map((entry) => [entry.propertyName, entry.roomLabel])).toEqual([
      ["아라키초A", "502"],
      ["오쿠보B", "107"],
    ]);
  });
});
