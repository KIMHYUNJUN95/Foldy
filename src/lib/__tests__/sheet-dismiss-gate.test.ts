import { describe, expect, it } from "vitest";
import { decideSheetDismiss } from "@/lib/sheet-dismiss-gate";

/** BottomSheet 의 close() · 닫힘 타이머를 그대로 흉내 낸 작은 모형 — 시트가 보이는지 · onClose 가 불렸는지만 본다. */
function makeSheet() {
  const state = { shown: true, closing: false, onCloseCalls: 0, disabled: false };
  return {
    state,
    close() {
      if (decideSheetDismiss("request", state.disabled) === "stay") return;
      state.closing = true;
      state.shown = false;
    },
    finishTimer() {
      if (!state.closing) return;
      if (decideSheetDismiss("finish", state.disabled) === "reopen") {
        state.closing = false;
        state.shown = true;
        return;
      }
      state.onCloseCalls += 1;
    },
  };
}

describe("공용 시트 닫기 막기", () => {
  it("막지 않으면 미끄러져 나간 뒤 onClose 를 부른다(기존 동작)", () => {
    expect(decideSheetDismiss("request", false)).toBe("slideOut");
    expect(decideSheetDismiss("finish", false)).toBe("close");
    const sheet = makeSheet();
    sheet.close();
    expect(sheet.state.shown).toBe(false);
    sheet.finishTimer();
    expect(sheet.state.onCloseCalls).toBe(1);
  });

  it("막힌 동안 닫기 요청(스크림 · Esc · 끌어내리기 · 안쪽 close)은 시트를 그대로 둔다", () => {
    expect(decideSheetDismiss("request", true)).toBe("stay");
    const sheet = makeSheet();
    sheet.state.disabled = true;
    sheet.close();
    sheet.finishTimer();
    expect(sheet.state.shown).toBe(true);
    expect(sheet.state.closing).toBe(false);
    expect(sheet.state.onCloseCalls).toBe(0);
  });

  it("미끄러져 나가는 도중에 막히면 다시 올라오고 onClose 는 부르지 않는다(저장 중 사진 지움 방지)", () => {
    expect(decideSheetDismiss("finish", true)).toBe("reopen");
    const sheet = makeSheet();
    sheet.close();
    sheet.state.disabled = true;
    sheet.finishTimer();
    expect(sheet.state.shown).toBe(true);
    expect(sheet.state.onCloseCalls).toBe(0);
  });

  it("막기가 풀리면 다시 닫힌다", () => {
    const sheet = makeSheet();
    sheet.state.disabled = true;
    sheet.close();
    sheet.state.disabled = false;
    sheet.close();
    sheet.finishTimer();
    expect(sheet.state.onCloseCalls).toBe(1);
  });
});
