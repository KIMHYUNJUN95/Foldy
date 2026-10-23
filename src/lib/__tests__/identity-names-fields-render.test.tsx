import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdentityNamesFields } from "@/components/identity/identity-names-fields";
import { getDictionary } from "@/lib/i18n";

// 국적 + 이름 세 가지 입력이 세 언어 문구로 그려지는지 · 국적에 따라 한국어 ↔ 일본어 이름 칸이 바뀌는지.
describe("IdentityNamesFields", () => {
  const value = { nationality: "KR", nameKo: "김하루", nameJa: "", nameEn: "KIM HARU", nameKatakana: "キム ハル" };

  for (const locale of ["ko", "ja", "en"] as const) {
    it(`renders in ${locale}`, () => {
      const copy = getDictionary(locale).onboarding.identity;
      const html = renderToStaticMarkup(
        <IdentityNamesFields copy={copy} errors={{}} locale={locale} onChange={() => {}} showErrors={false} value={value} />,
      );
      expect(html).toContain(copy.nameKoLabel);
      expect(html).not.toContain(copy.nameEnLabel);
      expect(html).toContain(copy.nameKatakanaLabel);
      expect(html).not.toContain(copy.nameJaLabel);
    });
  }

  it("swaps to the Japanese name for JP and shows errors when asked", () => {
    const copy = getDictionary("ko").onboarding.identity;
    const html = renderToStaticMarkup(
      <IdentityNamesFields
        copy={copy}
        errors={{ nameJa: "name_ja_required" }}
        formNames
        locale="ko"
        onChange={() => {}}
        showErrors
        value={{ ...value, nationality: "JP", nameKo: "" }}
        variant="desktop"
      />,
    );
    expect(html).toContain(copy.nameJaLabel);
    expect(html).toContain(copy.errors.name_ja_required);
    expect(html).toContain('name="nationality"');
  });
});
