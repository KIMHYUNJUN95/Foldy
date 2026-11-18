import { describe, expect, it, vi } from "vitest";

// 화면 조각이 서버 액션 모듈을 함께 들여오므로 서버 전용 표시만 비운다.
vi.mock("server-only", () => ({}));
import { errorText } from "@/components/guest-messages/gm-parts";
import { getDictionary, locales } from "@/lib/i18n";

describe("errorText — assist_placeholder", () => {
  it("shows its own copy in every locale, not the generic failure", () => {
    for (const locale of locales) {
      const copy = getDictionary(locale).guestMessages;
      const text = errorText("assist_placeholder", copy);
      expect(text).toBe(copy.errAssistPlaceholder);
      expect(text.trim()).not.toBe("");
      expect(text).not.toBe(copy.actionFailed);
    }
  });
});
