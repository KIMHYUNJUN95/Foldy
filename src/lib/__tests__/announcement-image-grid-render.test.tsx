import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// 공지 사진 수화 경고 회귀 테스트(2026-11-20, 공지 unslop 2차 A5) — 소스 글자 찾기 대신 실제로 그려 본다.
// `suppressHydrationWarning` 은 React 가 HTML 로 내보내지 않는 속성이라 진짜 next/image 로는 결과에서 보이지 않는다.
// 그래서 next/image 만 「받은 속성을 data- 로 적는 <img>」 로 바꾸고, 컴포넌트는 그대로 renderToString 해서
// 세 모양(plain · feature · grid) 모두 사진마다 그 속성이 붙는지 본다. docs/product/11 → 「태블릿 2분할 수화 경고」.
vi.mock("next/image", () => ({
  default: (props: { alt?: string; src: string; suppressHydrationWarning?: boolean }) =>
    createElement("img", {
      alt: props.alt ?? "",
      src: props.src,
      "data-shw": props.suppressHydrationWarning ? "on" : "off",
    }),
}));

const { AnnouncementImageGrid } = await import("@/components/announcements/announcement-image-grid");
const { SessionProvider } = await import("@/components/providers/session-provider");

type Variant = NonNullable<ComponentProps<typeof AnnouncementImageGrid>["variant"]>;

function render(variant: Variant, imageUrls: string[]) {
  return renderToString(
    <SessionProvider initialSession={null}>
      <AnnouncementImageGrid closeLabel="close" imageAltLabel="photo" imageUrls={imageUrls} variant={variant} />
    </SessionProvider>,
  );
}

const urls = ["https://example.com/a.jpg", "https://example.com/b.jpg"];

describe("AnnouncementImageGrid — 사진마다 suppressHydrationWarning", () => {
  for (const variant of ["plain", "feature", "grid"] as const) {
    it(`${variant}: 사진 ${urls.length}장 모두 켜져 있다`, () => {
      const html = render(variant, urls);
      const imgs = html.match(/<img[^>]*>/g) ?? [];
      expect(imgs).toHaveLength(urls.length);
      for (const img of imgs) expect(img).toContain('data-shw="on"');
    });
  }

  it("사진이 없으면 아무것도 그리지 않는다", () => {
    expect(render("plain", [])).toBe("");
  });
});
