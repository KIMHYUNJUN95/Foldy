import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sanitizeSharedUrl } from "@/lib/share-target";

/**
 * Web Share Target 수신기.
 * 사용자가 네이티브 공유 시트에서 Foldy 를 고르면 브라우저가 여기로 POST 한다.
 * URL 을 검증한 뒤 주문 생성 페이지로 303 리다이렉트해서
 * 브라우저가 GET 으로 따라가게 한다(공유 대상용 POST→GET 패턴).
 */
export async function POST(request: NextRequest) {
  let rawUrl: string | null = null;

  try {
    const body = await request.formData();
    // Web Share Target 스펙: `url` 필드를 우선하고, 일부 앱(예: Amazon 모바일)은
    // 상품 URL 을 text 필드에 넣으므로 `text` 로 폴백한다.
    rawUrl =
      body.get("url")?.toString() ??
      body.get("text")?.toString() ??
      null;
  } catch {
    // 잘못된 본문 — URL 을 넣지 않고 리다이렉트한다.
  }

  const safeUrl = sanitizeSharedUrl(rawUrl);
  const destination = new URL("/mobile/orders/new", request.url);
  if (safeUrl) {
    destination.searchParams.set("sharedUrl", safeUrl);
  } else if (rawUrl) {
    // URL 이 있었지만 검증에 실패함 — 폼이 오류 배너를 보이도록 신호를 준다.
    destination.searchParams.set("shareError", "1");
  }

  // 303 See Other: 브라우저가 리다이렉트를 GET 으로 다시 요청하고, 폼 페이지가 렌더된다.
  return NextResponse.redirect(destination, 303);
}
