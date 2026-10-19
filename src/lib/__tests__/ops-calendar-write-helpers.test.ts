import { describe, expect, it } from "vitest";
import {
  buildBlockNightSegments,
  buildUnblockSegments,
  mergeSnapshotNumAvail,
  planSnapshotTrim,
  preBlockNumAvailOf,
  type BlockSnapshotRow,
} from "@/lib/beds24/block-write-payload";
import { Beds24HttpError } from "@/lib/beds24/calendar-client";
import {
  beds24UnsellableNights,
  classifyBookingCreateError,
  manualBookingLockName,
} from "@/lib/ops-manual-booking";
import { chunkCellsByRanges } from "@/lib/ops-revert";

/** 판매 캘린더 쓰기 정합성(2026-10-19) — #8 되돌리기 나누기 · #9 차단 스냅샷 · #10 수기 예약 판정의 순수 규칙. */

const snapshot = (
  id: string,
  startDate: string,
  endDate: string,
  createdAt: string,
  values: Record<string, number>,
  roomId = "101",
): BlockSnapshotRow => ({
  created_at: createdAt,
  end_date: endDate,
  external_room_id: roomId,
  id,
  pre_block_num_avail: values,
  start_date: startDate,
});

describe("mergeSnapshotNumAvail — 겹치는 스냅샷에서 밤별 복원 재고", () => {
  it("구간이 정확히 같지 않아도(일부 해제) 그 밤의 재고를 찾는다", () => {
    const merged = mergeSnapshotNumAvail(
      [snapshot("a", "2026-11-10", "2026-11-14", "2026-10-01T00:00:00Z", { "2026-11-11": 2, "2026-11-12": 1 })],
      { endDate: "2026-11-12", startDate: "2026-11-11" },
    );
    expect(merged.get("101")).toEqual({ "2026-11-11": 2, "2026-11-12": 1 });
  });

  it("두 차단에 걸친 해제는 두 스냅샷을 합친다", () => {
    const merged = mergeSnapshotNumAvail(
      [
        snapshot("a", "2026-11-01", "2026-11-02", "2026-10-01T00:00:00Z", { "2026-11-01": 1, "2026-11-02": 1 }),
        snapshot("b", "2026-11-03", "2026-11-04", "2026-10-02T00:00:00Z", { "2026-11-03": 3, "2026-11-04": 3 }),
      ],
      { endDate: "2026-11-04", startDate: "2026-11-01" },
    );
    expect(merged.get("101")).toEqual({ "2026-11-01": 1, "2026-11-02": 1, "2026-11-03": 3, "2026-11-04": 3 });
  });

  it("같은 밤이 여러 스냅샷에 있으면 먼저 만든 값(막기 전에 더 가까운 값)을 쓴다", () => {
    const merged = mergeSnapshotNumAvail(
      [
        snapshot("late", "2026-11-01", "2026-11-01", "2026-10-05T00:00:00Z", { "2026-11-01": 0 }),
        snapshot("early", "2026-11-01", "2026-11-03", "2026-10-01T00:00:00Z", { "2026-11-01": 1 }),
      ],
      { endDate: "2026-11-01", startDate: "2026-11-01" },
    );
    expect(merged.get("101")).toEqual({ "2026-11-01": 1 });
  });

  it("해제 구간 밖의 밤과 숫자가 아닌 값은 버린다", () => {
    const merged = mergeSnapshotNumAvail(
      [snapshot("a", "2026-11-01", "2026-11-05", "2026-10-01T00:00:00Z", { "2026-11-01": 1, "2026-11-04": 1 })],
      { endDate: "2026-11-03", startDate: "2026-11-02" },
    );
    expect(merged.get("101")).toEqual({});
  });
});

describe("planSnapshotTrim — 푼 밤만 스냅샷에서 잘라 낸다", () => {
  it("가운데를 풀면 앞 · 뒤 조각으로 나누고 그 밤의 재고만 남긴다", () => {
    const plan = planSnapshotTrim(
      [snapshot("a", "2026-11-10", "2026-11-14", "2026-10-01T00:00:00Z", { "2026-11-10": 1, "2026-11-12": 1, "2026-11-14": 2 })],
      { endDate: "2026-11-12", startDate: "2026-11-11" },
    );
    expect(plan.deleteIds).toEqual(["a"]);
    expect(plan.keep).toEqual([
      expect.objectContaining({ end_date: "2026-11-10", pre_block_num_avail: { "2026-11-10": 1 }, start_date: "2026-11-10" }),
      expect.objectContaining({ end_date: "2026-11-14", pre_block_num_avail: { "2026-11-14": 2 }, start_date: "2026-11-13" }),
    ]);
  });

  it("전부 풀면 지우기만 한다, 겹치지 않는 스냅샷은 건드리지 않는다", () => {
    const plan = planSnapshotTrim(
      [
        snapshot("a", "2026-11-10", "2026-11-12", "2026-10-01T00:00:00Z", {}),
        snapshot("b", "2026-12-01", "2026-12-02", "2026-10-01T00:00:00Z", {}),
      ],
      { endDate: "2026-11-30", startDate: "2026-11-01" },
    );
    expect(plan).toEqual({ deleteIds: ["a"], keep: [] });
  });
});

describe("preBlockNumAvailOf — 이미 막혀 있던 밤은 「막기 전 재고」가 아니다", () => {
  it("blackout 인 밤의 재고는 뺀다", () => {
    expect(
      preBlockNumAvailOf({
        numAvail: { "2026-11-01": 1, "2026-11-02": 0 },
        overrides: new Map([
          ["2026-11-01", null],
          ["2026-11-02", "blackout"],
        ]),
      }),
    ).toEqual({ "2026-11-01": 1 });
  });
});

describe("보상 롤백 페이로드", () => {
  it("buildUnblockSegments(onlyNights) 는 고른 밤만 푼다", () => {
    expect(
      buildUnblockSegments({
        externalRoomId: "101",
        onlyNights: ["2026-11-01", "2026-11-03"],
        preBlockNumAvail: { "2026-11-01": 1, "2026-11-03": 1 },
        range: { endDate: "2026-11-03", startDate: "2026-11-01" },
      }),
    ).toEqual({
      calendar: [
        { from: "2026-11-01", numAvail: 1, override: "none", to: "2026-11-01" },
        { from: "2026-11-03", numAvail: 1, override: "none", to: "2026-11-03" },
      ],
      roomId: 101,
    });
  });

  it("buildUnblockSegments(onlyNights) 에 구간 안의 밤이 없으면 보내지 않는다", () => {
    expect(
      buildUnblockSegments({
        externalRoomId: "101",
        onlyNights: [],
        range: { endDate: "2026-11-03", startDate: "2026-11-01" },
      }),
    ).toBeNull();
  });

  it("buildBlockNightSegments 는 붙은 밤을 한 구간으로 다시 막는다", () => {
    expect(
      buildBlockNightSegments({ externalRoomId: "101", nights: ["2026-11-02", "2026-11-01", "2026-11-04"] }),
    ).toEqual({
      calendar: [
        { from: "2026-11-01", override: "blackout", to: "2026-11-02" },
        { from: "2026-11-04", override: "blackout", to: "2026-11-04" },
      ],
      roomId: 101,
    });
  });
});

describe("chunkCellsByRanges — 차단 되돌리기를 구간 상한 안으로", () => {
  it("구간 수가 상한을 넘으면 나누고, 한 구간은 쪼개지 않는다", () => {
    const cells = Array.from({ length: 130 }, (_, index) => ({
      date: `2026-11-${String((index % 2) * 2 + 1).padStart(2, "0")}`,
      roomKey: `room-${Math.floor(index / 2)}`,
    }));
    // 방 65개 × 끊긴 밤 2개 = 구간 130개.
    const chunks = chunkCellsByRanges(cells, 60);
    expect(chunks.map((chunk) => chunk.length)).toEqual([60, 60, 10]);
    expect(chunks.flat()).toHaveLength(130);
  });

  it("이어진 밤은 한 구간이라 같은 묶음에 남는다", () => {
    const cells = ["2026-11-01", "2026-11-02", "2026-11-03"].map((date) => ({ date, roomKey: "r" }));
    expect(chunkCellsByRanges(cells, 1)).toEqual([cells]);
  });
});

describe("수기 예약 판정", () => {
  it("잠금 이름은 조직 · 방 단위다", () => {
    expect(manualBookingLockName("org-a", "P::101")).toBe("manual_booking:org-a:P::101");
    expect(manualBookingLockName("org-a", "P::101")).not.toBe(manualBookingLockName("org-b", "P::101"));
  });

  it("Beds24 재고 0 · 차단인 밤을 찾는다 — 값이 없는 밤은 판단하지 않는다", () => {
    expect(
      beds24UnsellableNights(
        [
          { from: "2026-11-01", numAvail: 1, to: "2026-11-01" },
          { from: "2026-11-02", numAvail: 0, to: "2026-11-03" },
          { from: "2026-11-04", override: "blackout", to: "2026-11-04" },
          { from: "2026-11-05", to: "2026-11-05" },
        ],
        ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"],
      ),
    ).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
  });

  it("4xx 는 안 만들어진 것, 시간 초과 · 5xx · 연결 끊김은 모름", () => {
    expect(classifyBookingCreateError(new Beds24HttpError(400, null, false))).toBe("not_created");
    expect(classifyBookingCreateError(new Beds24HttpError(429, 30, true))).toBe("not_created");
    expect(classifyBookingCreateError(new Beds24HttpError(502, null, false))).toBe("unknown");
    expect(classifyBookingCreateError(new DOMException("timed out", "TimeoutError"))).toBe("unknown");
    expect(classifyBookingCreateError(new TypeError("fetch failed"))).toBe("unknown");
  });
});
