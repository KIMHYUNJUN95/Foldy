import { describe, expect, it } from "vitest";

import { getDictionary, locales } from "@/lib/i18n";
import {
  firstInvalidField,
  splitServerError,
  validateCompose,
} from "../suggestion-compose-errors";

describe("validateCompose", () => {
  it("빈 칸마다 그 칸의 오류를 건다", () => {
    expect(validateCompose({ hasRecipient: false, title: " ", body: "" })).toEqual({
      recipient: "missing_recipient",
      title: "missing_title",
      body: "missing_body",
    });
  });

  it("다 채우면 오류가 없다", () => {
    expect(validateCompose({ hasRecipient: true, title: "제목", body: "본문" })).toEqual({});
  });
});

describe("firstInvalidField", () => {
  it("화면 위에서부터 첫 오류 칸", () => {
    expect(firstInvalidField({ body: "missing_body", title: "missing_title" })).toBe("title");
    expect(firstInvalidField({ photos: "too_many_photos", recipient: "missing_recipient" })).toBe(
      "recipient",
    );
    expect(firstInvalidField({})).toBeNull();
  });
});

describe("splitServerError", () => {
  it("칸에 묶인 서버 오류는 그 칸으로", () => {
    expect(splitServerError("invalid_recipient")).toEqual({
      fields: { recipient: "invalid_recipient" },
      form: null,
    });
    expect(splitServerError("missing_body")).toEqual({ fields: { body: "missing_body" }, form: null });
  });

  it("칸에 묶이지 않는 오류 · 모르는 값은 보내기 근처 한 줄", () => {
    expect(splitServerError("upload_failed")).toEqual({ fields: {}, form: "upload_failed" });
    expect(splitServerError("whatever")).toEqual({ fields: {}, form: "save_failed" });
    expect(splitServerError("__proto__")).toEqual({ fields: {}, form: "save_failed" });
  });

  it("없으면 오류도 없다", () => {
    expect(splitServerError(null)).toEqual({ fields: {}, form: null });
    expect(splitServerError("")).toEqual({ fields: {}, form: null });
  });
});

describe("제안함 쓰기 문구", () => {
  it.each(locales)("%s — 보내는 중 · 저장 중 · 참조 빼기 문구가 있다", (locale) => {
    const copy = getDictionary(locale).mobile.suggestions;
    expect(copy.sending).toMatch(/…$/);
    expect(copy.saving).toMatch(/…$/);
    expect(copy.removeReference).toContain("{name}");
  });

  it.each(locales)("%s — 짧은 오류 · 빈 상태 문구는 마침표로 끝나지 않는다", (locale) => {
    const copy = getDictionary(locale).mobile.suggestions;
    const short = [...Object.values(copy.errors), copy.empty, copy.noComments, copy.statusSheetSub];
    for (const text of short) expect(text).not.toMatch(/[.。]$/);
  });

  it("ko · ja 는 영어로 떨어지지 않는다", () => {
    const en = getDictionary("en").mobile.suggestions;
    for (const locale of ["ko", "ja"] as const) {
      const copy = getDictionary(locale).mobile.suggestions;
      expect(copy.sending).not.toBe(en.sending);
      expect(copy.saving).not.toBe(en.saving);
      expect(copy.removeReference).not.toBe(en.removeReference);
    }
  });
});
