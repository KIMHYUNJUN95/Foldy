import { describe, expect, it } from "vitest";
import { nextSaveNotice, saveBarOf } from "@/lib/automation/live-view";

/** 모바일 자동화 설정 저장 줄 — 실패 안내가 뜨고 사라지는 규칙 · 줄이 막힌 채 남지 않기(2026-11-19 화면 확인 뒤). */
const base = { dirty: false, justSaved: false, notice: null as string | null, saving: false, view: false };

describe("nextSaveNotice", () => {
  it("막힘(서버 실패 · 화면 먼저 막음)이면 그 문구", () => {
    expect(nextSaveNotice({ message: "conflict", type: "blocked" })).toBe("conflict");
  });
  it("사용자가 고치거나 · 되돌리거나 · 다시 저장을 누르면 지운다", () => {
    for (const type of ["edit", "revert", "retry"] as const) expect(nextSaveNotice({ type })).toBeNull();
  });
});

describe("saveBarOf", () => {
  it("바뀐 곳 0 · 안내 없음이면 줄이 사라진다", () => {
    expect(saveBarOf(base).shown).toBe(false);
  });
  it("conflict 뒤 새로 읽은 값으로 바뀐 곳이 0이 돼도 안내가 있으면 줄이 남고, 되돌리기로 닫을 수 있다", () => {
    const bar = saveBarOf({ ...base, notice: "conflict" });
    expect(bar).toEqual({ canRevert: true, canSave: false, shown: true });
  });
  it("줄이 보이는데 두 단추가 다 꺼지는 건 저장 중일 때뿐", () => {
    for (const dirty of [true, false])
      for (const justSaved of [true, false])
        for (const notice of ["x", null]) {
          const bar = saveBarOf({ ...base, dirty, justSaved, notice });
          if (bar.shown && !bar.canRevert && !bar.canSave) expect(justSaved && !dirty && notice === null).toBe(true);
        }
    expect(saveBarOf({ ...base, dirty: true, saving: true })).toMatchObject({ canRevert: false, canSave: false, shown: true });
  });
  it("보기 전용이면 줄을 그리지 않는다", () => {
    expect(saveBarOf({ ...base, dirty: true, notice: "x", view: true }).shown).toBe(false);
  });
});
