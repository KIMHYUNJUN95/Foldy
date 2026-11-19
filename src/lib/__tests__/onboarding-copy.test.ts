import { describe, expect, it } from "vitest";
import { getDictionary, locales } from "@/lib/i18n";

// 가입 마법사 unslop(2026-11-19) — 완료 제목 · 본문 이름 자리 · 지운 줄이 세 언어 모두 맞는지.
describe("onboarding copy", () => {
  it.each(locales)("%s — 완료 제목이 있고 이름은 본문에 들어간다", (locale) => {
    const o = getDictionary(locale).onboarding;
    expect(o.success.title).toBeTruthy();
    expect(o.success.bodyJoined).toContain("{name}");
    expect(o.success.bodyJoined).toContain("{org}");
    expect(o.success.bodyJoined).toContain("{role}");
    expect(o.success.bodyNoTeam).toContain("{name}");
    const success = o.success as Record<string, unknown>;
    expect(success.eyebrow).toBeUndefined();
    expect(success.welcomePrefix).toBeUndefined();
  });

  it.each(locales)("%s — 언어 항목 · 언어 줄 · 틀린 코드 제목 줄은 없다", (locale) => {
    const o = getDictionary(locale).onboarding as unknown as {
      intro: Record<string, unknown>;
      review: Record<string, unknown>;
      joinFlow: Record<string, unknown>;
    };
    expect(o.intro.itemLangTitle).toBeUndefined();
    expect(o.review.rowLang).toBeUndefined();
    expect(o.joinFlow.invalidTitle).toBeUndefined();
  });

  it("틀린 초대 코드는 한 문장", () => {
    expect(getDictionary("ko").onboarding.errors.invalid_invite).toBe(
      "코드가 맞지 않아요. 관리자에게 받은 코드를 다시 확인해 주세요",
    );
  });

  it("한국어 완료 제목 · 소요 시간", () => {
    const o = getDictionary("ko").onboarding;
    expect(o.success.title).toBe("가입을 마쳤어요");
    expect(JSON.stringify(o)).toContain("1~2분");
    expect(JSON.stringify(o)).not.toContain("초대코드");
  });
});
