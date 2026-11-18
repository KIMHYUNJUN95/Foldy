import { describe, expect, it } from "vitest";
import { draftToDiscardOnLeave, fitFieldHeight, sendFailureView } from "@/components/guest-messages/ai-assist-model";

describe("draftToDiscardOnLeave", () => {
  it("returns the unsent draft id, nothing after send/discard (idle) or while loading", () => {
    expect(
      draftToDiscardOnLeave({ kind: "draft", draftId: "d-1", checks: [], needsHuman: false, reason: null, placeholders: [], wrong: "none" }),
    ).toBe("d-1");
    expect(draftToDiscardOnLeave({ kind: "idle" })).toBeNull();
    expect(draftToDiscardOnLeave({ kind: "loading" })).toBeNull();
    expect(draftToDiscardOnLeave({ kind: "fail" })).toBeNull();
  });
});

describe("sendFailureView", () => {
  it("closes the translation confirm and shows assist_placeholder inline", () => {
    expect(sendFailureView("assist_placeholder")).toEqual({ closePreview: true, inline: true });
  });
  it("leaves other send errors on the existing toast path", () => {
    expect(sendFailureView("stale")).toEqual({ closePreview: false, inline: false });
    expect(sendFailureView("failed")).toEqual({ closePreview: false, inline: false });
  });
});

describe("fitFieldHeight", () => {
  // 폰: 15px × 1.4 = 21px 줄, 위아래 여백 24 + 테두리 3.
  const phone = { lineHeight: 21, chrome: 27, minLines: 5, maxLines: 8 };
  it("always ends on a whole line", () => {
    for (const contentHeight of [10, 63, 84.4, 105, 105.6, 147, 300]) {
      const h = fitFieldHeight({ ...phone, contentHeight });
      expect(Number.isInteger((h - phone.chrome) / phone.lineHeight)).toBe(true);
    }
  });
  it("grows with the draft between min and max lines", () => {
    expect(fitFieldHeight({ ...phone, contentHeight: 63 })).toBe(5 * 21 + 27);
    expect(fitFieldHeight({ ...phone, contentHeight: 126 })).toBe(6 * 21 + 27);
    expect(fitFieldHeight({ ...phone, contentHeight: 999 })).toBe(8 * 21 + 27);
  });
  it("does not add a line for sub-pixel rounding", () => {
    expect(fitFieldHeight({ ...phone, contentHeight: 126.3 })).toBe(6 * 21 + 27);
  });
});
