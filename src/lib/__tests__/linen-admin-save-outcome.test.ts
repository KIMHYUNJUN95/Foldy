import { describe, expect, it } from "vitest";
import { linenSaveFailureOutcome } from "@/components/admin/linen-return/linen-console-data";

describe("PC 수정 저장 실패 뒤 화면", () => {
  it("stale 이면 수정 창을 닫고 새로 불러온다 — 예전 입력값으로 남의 수정을 덮어쓰지 않게", () => {
    expect(linenSaveFailureOutcome("stale")).toEqual({ closeEditor: true, refresh: true });
  });
  it("기록이 사라졌으면 창을 닫고 새로 불러온다", () => {
    expect(linenSaveFailureOutcome("not_found")).toEqual({ closeEditor: true, refresh: true });
  });
  it("입력 오류는 창을 열어 둔다(고쳐서 다시 저장)", () => {
    for (const reason of ["invalid_item", "too_many_photos", "invalid_photo", "error"] as const) {
      expect(linenSaveFailureOutcome(reason)).toEqual({ closeEditor: false, refresh: false });
    }
  });
});
