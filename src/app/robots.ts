import type { MetadataRoute } from "next";

/**
 * Foldy 는 초대 전용 비공개 운영 앱이라 색인할 공개 콘텐츠가 없다. 모든 크롤러를
 * 막아서 로그인/앱 페이지가 검색 결과에 나오지 않게 한다. (루트 메타데이터의
 * `robots: { index: false }` 와 이중 안전장치.)
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
