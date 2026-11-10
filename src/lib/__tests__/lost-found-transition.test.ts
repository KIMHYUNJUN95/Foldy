import { describe, expect, it } from "vitest";
import { isValidLostItemTransition, lostItemFieldTargets } from "@/lib/lost-found-handling";

/**
 * 분실물 현장(모바일 · lost_found.handle) 상태 규칙 — 사용자 결정 2026-11-10.
 * 현장은 「폐기 예정 → 폐기 완료」만 폐기 쪽으로 넘길 수 있다. 「보관 중 → 폐기 예정」은 밤 자동 처리 · PC 관리자만.
 * 반환은 진행 중 어디서든. 종결 상태에서는 같은 상태 저장도 안 된다.
 */
describe("분실물 현장 상태 넘기기", () => {
  it.each([
    ["registered", "stored"],
    ["disposal_scheduled", "disposed"],
    ["registered", "returned"],
    ["stored", "returned"],
    ["disposal_scheduled", "returned"],
    ["registered", "registered"],
    ["stored", "stored"],
    ["disposal_scheduled", "disposal_scheduled"],
  ] as const)("%s → %s 허용", (from, to) => {
    expect(isValidLostItemTransition(from, to)).toBe(true);
  });

  it.each([
    ["stored", "disposal_scheduled"],
    ["registered", "disposal_scheduled"],
    ["stored", "disposed"],
    ["registered", "disposed"],
    ["stored", "registered"],
    ["disposal_scheduled", "stored"],
    ["disposed", "disposed"],
    ["returned", "returned"],
    ["disposed", "stored"],
    ["returned", "registered"],
  ] as const)("%s → %s 막음", (from, to) => {
    expect(isValidLostItemTransition(from, to)).toBe(false);
  });

  it("상태 칩은 갈 수 있는 상태만(지금 상태 포함)", () => {
    expect(lostItemFieldTargets("stored")).toEqual(["stored", "returned"]);
    expect(lostItemFieldTargets("registered")).toEqual(["registered", "stored", "returned"]);
    expect(lostItemFieldTargets("disposal_scheduled")).toEqual(["disposal_scheduled", "disposed", "returned"]);
    expect(lostItemFieldTargets("disposed")).toEqual([]);
  });
});
