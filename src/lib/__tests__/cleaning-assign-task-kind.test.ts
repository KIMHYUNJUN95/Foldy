import { describe, expect, it } from "vitest";
import { physicalKeyOf } from "@/lib/cleaning-assign/room-key";
import { holdSkipReason, todaySkipReason, todayTaskKey } from "@/lib/cleaning-assign/task-kind";
import { buildRoomKey, getCanonicalPropertyName, getCanonicalRoomLabel, getDisplayRoomLabel } from "@/lib/room-label-normalization";

// 오늘 내 방 시작 종류 — 예약을 보고 정한다(2026-11-02 점검 결정 ②).
describe("todayTaskKey", () => {
  const stay = { staying: new Set(["A|401"]), arriving: new Set(["A|402"]) };

  it("checkout rooms are checkout cleans", () => {
    expect(todayTaskKey({ source: "checkout", roomKey: "A|401" }, stay)).toBe("checkout");
  });

  it("a carried room is a stay-over clean only when a new guest is staying tonight", () => {
    expect(todayTaskKey({ source: "carry", roomKey: "A|401" }, stay)).toBe("long_stay");
    expect(todayTaskKey({ source: "carry", roomKey: "A|402" }, stay)).toBe("checkout");
    expect(todayTaskKey({ source: "carry", roomKey: "A|403" }, stay)).toBe("checkout");
  });

  it("a hand-added room with a guest staying tonight is a stay-over clean", () => {
    expect(todayTaskKey({ source: "extra", roomKey: "A|401" }, stay)).toBe("long_stay");
  });

  it("a hand-added room with a check-in today is a setup", () => {
    expect(todayTaskKey({ source: "extra", roomKey: "A|402" }, stay)).toBe("simple");
  });

  it("a hand-added empty room stays a checkout clean", () => {
    expect(todayTaskKey({ source: "extra", roomKey: "A|403" }, stay)).toBe("checkout");
  });
});

// 실제 키 모양 — 수기 추가 방 키(객실 카탈로그 식)와 예약에서 만든 키(`physicalKeyOf`)가 같아야 종류가 맞는다(2026-11-02 리뷰).
describe("room key format (extra room ↔ reservation)", () => {
  /** `getActiveRoomCatalog` → `loadCleaningRoomOptions` 가 수기 추가 방 `room_key` 를 만드는 식. */
  const catalogKey = (property: string, rawLabel: string) => {
    const cp = getCanonicalPropertyName(property);
    return buildRoomKey(cp, getDisplayRoomLabel(cp, getCanonicalRoomLabel(cp, rawLabel)));
  };

  it("uses the stored `건물_방` shape", () => {
    expect(physicalKeyOf("아라키초A", "201").roomKey).toBe("아라키초A_201");
  });

  it.each([
    ["아라키초A", "401"],
    ["아라키초A", "401_2_2"],
    ["아라키초B", "302"],
    ["다카다노바바", "4"],
    ["STAY ARI Apartment Hotel", "O201"],
  ])("reservation key matches the catalog key for %s %s", (property, label) => {
    expect(physicalKeyOf(property, label).roomKey).toBe(catalogKey(property, label));
  });

  it("folds Arakicho's second Beds24 account onto the same room", () => {
    expect(physicalKeyOf("아라키초A", "401_2_2").roomKey).toBe(physicalKeyOf("아라키초A", "401").roomKey);
  });

  it("a stay-over extra room with real keys becomes a stay-over clean", () => {
    const reservationKey = physicalKeyOf("아라키초A", "401_2_2").roomKey;
    const extraRoomKey = catalogKey("아라키초A", "401");
    const keys = { staying: new Set([reservationKey]), arriving: new Set<string>() };
    expect(todayTaskKey({ source: "extra", roomKey: extraRoomKey }, keys)).toBe("long_stay");
  });
});

// 오늘 청소 안 하는 이유 — 화면과 서버가 같은 규칙을 쓴다(2026-11-02 리뷰).
describe("todaySkipReason", () => {
  const base = { changed: false, deferredUntil: null, resolvedHold: false, status: "pending" as const, hasSession: false };

  it("a normal waiting room is cleaned", () => {
    expect(todaySkipReason(base)).toBeNull();
  });

  it("a room dropped from today's list is a booking change", () => {
    expect(todaySkipReason({ ...base, changed: true })).toBe("booking");
  });

  it("a room a manager postponed is held", () => {
    expect(todaySkipReason({ ...base, deferredUntil: "2026-11-05" })).toBe("held");
  });

  it("a room marked handled without a cleaning record is resolved, not done", () => {
    expect(todaySkipReason({ ...base, resolvedHold: true, status: "done" })).toBe("resolved");
  });

  it("a room already being cleaned or cleaned is never blocked", () => {
    expect(todaySkipReason({ ...base, changed: true, status: "progress", hasSession: true })).toBeNull();
    expect(todaySkipReason({ ...base, deferredUntil: "2026-11-05", status: "done", hasSession: true })).toBeNull();
    expect(todaySkipReason({ ...base, resolvedHold: true, status: "progress", hasSession: true })).toBeNull();
  });
});

// 서버가 시작 직전에 보는 관리자 표시 — 화면 규칙(`todaySkipReason`)과 같은 판단.
describe("holdSkipReason", () => {
  it("resolved wins over postponed, and plain rooms pass", () => {
    expect(holdSkipReason({ deferredUntil: null, resolvedHold: false })).toBeNull();
    expect(holdSkipReason({ deferredUntil: "2026-11-05", resolvedHold: false })).toBe("held");
    expect(holdSkipReason({ deferredUntil: null, resolvedHold: true })).toBe("resolved");
  });

  it("agrees with the screen rule for a room nobody has started", () => {
    for (const hold of [
      { deferredUntil: null, resolvedHold: false },
      { deferredUntil: "2026-11-05", resolvedHold: false },
      { deferredUntil: null, resolvedHold: true },
    ]) {
      const status = hold.resolvedHold ? ("done" as const) : ("pending" as const);
      expect(todaySkipReason({ ...hold, changed: false, status, hasSession: false })).toBe(holdSkipReason(hold));
    }
  });
});
