import { StayScreen } from "@/components/stay-screen";
import { getStayOr404 } from "@/lib/guest/page";
import { getLocale } from "@/lib/i18n/server";

// 개인 링크 /r/<토큰>. 화면은 StayScreen(W2 · W4 · W5).
export const dynamic = "force-dynamic";

export default async function StayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const [{ token }, { view }, locale] = await Promise.all([params, searchParams, getLocale()]);
  const stay = await getStayOr404(token);
  return <StayScreen stay={stay} token={token} locale={locale} view={view} />;
}
