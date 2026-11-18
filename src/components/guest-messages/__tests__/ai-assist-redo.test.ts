import { describe, expect, it } from "vitest";
import {
  ALL_ASSIST_PLACEHOLDERS,
  blockingSlots,
  resolveDraftResult,
  type AssistDraft,
} from "@/components/guest-messages/ai-assist-model";

const prev: AssistDraft = {
  draftId: "d-1",
  checks: [],
  needsHuman: false,
  reason: null,
  placeholders: ["[출입 비밀번호]"],
  wrong: "asking",
};
const fieldText = "안녕하세요, 도착하시면 [출입 비밀번호] 로 들어오세요.";

describe("초안 → 다시 만들기 실패 → 보내기 막힘", () => {
  for (const [name, result, redo] of [
    ["failed", { ok: false, errorKey: "failed" }, "fail"],
    ["unavailable", { ok: false, errorKey: "unavailable" }, "fail"],
    ["cap", { ok: false, errorKey: "cap" }, "cap"],
    ["direct", { ok: true, kind: "direct", draftId: "d-2", reason: null }, "direct"],
  ] as const) {
    it(`${name}: keeps the previous draft and its id, leaves the field alone`, () => {
      const next = resolveDraftResult(prev, result);
      expect(next.state).toMatchObject({ kind: "draft", draftId: "d-1", placeholders: prev.placeholders, wrong: "none", redo });
      expect(next.text).toBeNull();
      expect(next.discardId).toBeNull();
      // 칸에 남은 앞 AI 글 — 보내기는 여전히 막힌다.
      expect(blockingSlots(fieldText, next.state.kind === "draft" ? next.state.placeholders : [])).toEqual(["[출입 비밀번호]"]);
    });
  }

  it("invalid (no question): keeps the draft quietly and hides the draft button", () => {
    const next = resolveDraftResult(prev, { ok: false, errorKey: "invalid" });
    expect(next.state).toMatchObject({ kind: "draft", draftId: "d-1" });
    expect(next.state.kind === "draft" && next.state.redo).toBeFalsy();
    expect(next.noQuestion).toBe(true);
  });

  it("a new draft replaces the old one and discards the old id", () => {
    const next = resolveDraftResult(prev, {
      ok: true, kind: "draft", draftId: "d-2", text: "new", lang: "ko", checks: [], needsHuman: false, reason: null, placeholders: [],
    });
    expect(next.state).toMatchObject({ kind: "draft", draftId: "d-2" });
    expect(next.text).toBe("new");
    expect(next.discardId).toBe("d-1");
  });
});

describe("blockingSlots", () => {
  it("blocks every assist placeholder in all three languages even with no draft state", () => {
    expect(ALL_ASSIST_PLACEHOLDERS.length).toBeGreaterThanOrEqual(3);
    for (const label of ALL_ASSIST_PLACEHOLDERS) {
      expect(blockingSlots(`hi ${label} bye`)).toEqual([label]);
    }
    expect(blockingSlots("Your door code is ready.")).toEqual([]);
  });
});
