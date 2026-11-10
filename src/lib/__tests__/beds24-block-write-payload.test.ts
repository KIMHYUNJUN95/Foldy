import { describe, expect, it } from "vitest";
import {
  buildBlockSegments,
  buildUnblockSegments,
  diffBlockReadback,
  eachNight,
  isRoomGoneError,
  splitRejectedPostItems,
  validateBlockRange,
} from "@/lib/beds24/block-write-payload";

/**
 * 블록 쓰기 페이로드.
 *
 * 계약: `docs/product/33-calendar-write-features.md` → 「저쪽 블록의 실제 규칙」
 * 원본: `functions/index.js` → `createBeds24BlackoutOverride` · `clearBeds24BlackoutOverride`
 *
 * 틀리면 **팔리면 안 되는 방이 팔리거나, 팔아야 할 방이 잠긴다.** 우리 DB 가 틀어지는 것과
 * 급이 다르므로 모양을 테스트로 고정한다.
 */
describe("validateBlockRange", () => {
  it("하루짜리 블록은 유효하다 — 그날 밤 하나를 막는 것이다", () => {
    expect(validateBlockRange({ startDate: "2026-10-01", endDate: "2026-10-01" })).toBeNull();
  });

  it("뒤집힌 범위는 막는다", () => {
    expect(validateBlockRange({ startDate: "2026-10-05", endDate: "2026-10-01" })).toBe(
      "range_reversed",
    );
  });

  it("날짜 모양이 아니면 막는다 — 그대로 보내면 Beds24 가 조용히 무시한다", () => {
    expect(validateBlockRange({ startDate: "2026/10/01", endDate: "2026-10-02" })).toBe(
      "invalid_date",
    );
    expect(validateBlockRange({ startDate: "", endDate: "2026-10-02" })).toBe("invalid_date");
  });
});

describe("eachNight", () => {
  it("양끝을 포함한다", () => {
    expect(eachNight({ startDate: "2026-10-01", endDate: "2026-10-03" })).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("달을 넘어간다", () => {
    expect(eachNight({ startDate: "2026-10-30", endDate: "2026-11-02" })).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("윤년 2월을 넘어간다", () => {
    expect(eachNight({ startDate: "2028-02-28", endDate: "2028-03-01" })).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });
});

describe("buildBlockSegments", () => {
  it("같은 밤 범위의 여러 방을 한 페이로드 배열로 묶는다", () => {
    expect(
      buildBlockSegments({
        externalRoomIds: ["648398", "450096"],
        range: { startDate: "2026-10-01", endDate: "2026-10-03" },
      }),
    ).toEqual([
      {
        roomId: 648398,
        calendar: [{ from: "2026-10-01", to: "2026-10-03", override: "blackout" }],
      },
      {
        roomId: 450096,
        calendar: [{ from: "2026-10-01", to: "2026-10-03", override: "blackout" }],
      },
    ]);
  });

  it("중복 roomId 는 한 번만 — 같은 방을 두 번 막을 이유가 없다", () => {
    const payloads = buildBlockSegments({
      externalRoomIds: ["648398", "648398", " 648398 "],
      range: { startDate: "2026-10-01", endDate: "2026-10-01" },
    });
    expect(payloads).toHaveLength(1);
  });

  it("숫자가 아닌 roomId 는 버린다 — Beds24 는 그런 항목을 조용히 무시한다", () => {
    expect(
      buildBlockSegments({
        externalRoomIds: ["abc", "0", "-5", "648398"],
        range: { startDate: "2026-10-01", endDate: "2026-10-01" },
      }).map((p) => p.roomId),
    ).toEqual([648398]);
  });
});

describe("buildUnblockSegments", () => {
  it("스냅샷이 없으면 override 만 푼다 — 모르는 재고를 추측해 쓰지 않는다", () => {
    expect(
      buildUnblockSegments({
        externalRoomId: "648398",
        range: { startDate: "2026-10-01", endDate: "2026-10-03" },
      }),
    ).toEqual({
      roomId: 648398,
      calendar: [{ from: "2026-10-01", to: "2026-10-03", override: "none" }],
    });
  });

  it("스냅샷이 있으면 날짜별 재고를 같이 되돌린다", () => {
    expect(
      buildUnblockSegments({
        externalRoomId: "648398",
        range: { startDate: "2026-10-01", endDate: "2026-10-02" },
        preBlockNumAvail: { "2026-10-01": 1, "2026-10-02": 2 },
      }),
    ).toEqual({
      roomId: 648398,
      calendar: [
        { from: "2026-10-01", to: "2026-10-01", override: "none", numAvail: 1 },
        { from: "2026-10-02", to: "2026-10-02", override: "none", numAvail: 2 },
      ],
    });
  });

  it("같은 재고가 이어지면 한 구간으로 합친다 — 왕복 페이로드를 줄인다", () => {
    expect(
      buildUnblockSegments({
        externalRoomId: "648398",
        range: { startDate: "2026-10-01", endDate: "2026-10-03" },
        preBlockNumAvail: { "2026-10-01": 1, "2026-10-02": 1, "2026-10-03": 1 },
      })?.calendar,
    ).toEqual([{ from: "2026-10-01", to: "2026-10-03", override: "none", numAvail: 1 }]);
  });

  it("스냅샷이 일부 날짜만 있으면 그 날짜만 재고를 쓴다", () => {
    expect(
      buildUnblockSegments({
        externalRoomId: "648398",
        range: { startDate: "2026-10-01", endDate: "2026-10-02" },
        preBlockNumAvail: { "2026-10-02": 3 },
      })?.calendar,
    ).toEqual([
      { from: "2026-10-01", to: "2026-10-01", override: "none" },
      { from: "2026-10-02", to: "2026-10-02", override: "none", numAvail: 3 },
    ]);
  });

  it("roomId 가 숫자가 아니면 null — 부를 대상이 없다", () => {
    expect(
      buildUnblockSegments({
        externalRoomId: "not-a-room",
        range: { startDate: "2026-10-01", endDate: "2026-10-01" },
      }),
    ).toBeNull();
  });
});

describe("diffBlockReadback", () => {
  const nights = ["2026-10-01", "2026-10-02"];

  it("걸린 것을 확인한다", () => {
    expect(
      diffBlockReadback({
        nights,
        actual: new Map([
          ["2026-10-01", "blackout"],
          ["2026-10-02", "blackout"],
        ]),
        expect: "blackout",
      }),
    ).toEqual([]);
  });

  it("Beds24 가 success 를 줘도 안 들어간 날짜를 잡아낸다", () => {
    expect(
      diffBlockReadback({
        nights,
        actual: new Map([["2026-10-01", "blackout"]]),
        expect: "blackout",
      }),
    ).toEqual(["2026-10-02"]);
  });

  it("풀린 것을 확인한다 — none 도 null 도 풀린 것이다", () => {
    expect(
      diffBlockReadback({
        nights,
        actual: new Map([["2026-10-01", "none"]]),
        expect: "cleared",
      }),
    ).toEqual([]);
  });

  it("안 풀린 날짜를 잡아낸다", () => {
    expect(
      diffBlockReadback({
        nights,
        actual: new Map([
          ["2026-10-01", "none"],
          ["2026-10-02", "blackout"],
        ]),
        expect: "cleared",
      }),
    ).toEqual(["2026-10-02"]);
  });

  it("noCheckIn 같은 다른 override 는 블록이 아니다", () => {
    expect(
      diffBlockReadback({
        nights: ["2026-10-01"],
        actual: new Map([["2026-10-01", "noCheckIn"]]),
        expect: "cleared",
      }),
    ).toEqual([]);
  });
});

describe("isRoomGoneError — Beds24 에서 지워진 유닛 신호", () => {
  it("invalid roomid 만 인정한다(대소문자 · 띄어쓰기 허용)", () => {
    expect(isRoomGoneError("invalid roomid")).toBe(true);
    expect(isRoomGoneError("Invalid room id")).toBe(true);
    expect(isRoomGoneError("INVALID  ROOMID.")).toBe(true);
    expect(isRoomGoneError("invalid date")).toBe(false);
    expect(isRoomGoneError("invalid roomid; invalid date")).toBe(false);
    expect(isRoomGoneError("invalid roomid; Invalid room id")).toBe(true);
    expect(isRoomGoneError("rate limit")).toBe(false);
    expect(isRoomGoneError(null)).toBe(false);
    expect(isRoomGoneError(undefined)).toBe(false);
  });
});

describe("splitRejectedPostItems", () => {
  const ok = (id: string) => ({ accepted: true, error: null, externalRoomId: id });
  const bad = (id: string, error: string | null) => ({ accepted: false, error, externalRoomId: id });

  it("지워진 유닛만 거절됐고 받아들여진 게 있으면 건너뛸 수 있다", () => {
    expect(splitRejectedPostItems([ok("1"), bad("2", "invalid roomid")])).toEqual({
      acceptedIds: ["1"],
      goneIds: ["2"],
      otherRejected: [],
      skippable: true,
    });
  });

  it("쓰기 전 달력 데이터가 있던 유닛은 invalid roomid 여도 지워진 유닛이 아니다", () => {
    const split = splitRejectedPostItems([ok("1"), bad("2", "invalid roomid")], (id) => id === "2");
    expect(split.skippable).toBe(false);
    expect(split.otherRejected).toEqual(["2"]);
  });

  it("다른 거절이 섞이거나 받아들여진 게 없으면 건너뛰지 않는다", () => {
    expect(splitRejectedPostItems([ok("1"), bad("2", "invalid roomid"), bad("3", "x")]).skippable).toBe(false);
    expect(splitRejectedPostItems([bad("2", "invalid roomid")]).skippable).toBe(false);
    expect(splitRejectedPostItems([ok("1"), bad("2", null)]).skippable).toBe(false);
  });
});
