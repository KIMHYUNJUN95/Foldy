import { redirect } from "next/navigation";

import { RouteForm } from "@/components/route-form";
import { getStayOr404, guestEntries } from "@/lib/guest/page";
import { fmt, getDictionary } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

// 어디서 오셔서 어디로 가세요(시안 W3s). 신주쿠 규칙 10 이라 일본에 사는 손님도 묻는다(43 §2-1, 2026-11-03).
export const dynamic = "force-dynamic";

export default async function RoutePage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, locale] = await Promise.all([params, getLocale()]);
  const stay = await getStayOr404(token);
  const representative = stay.guests.find((guest) => guest.is_representative);
  if (!representative) redirect(`/r/${token}?view=list`);

  const dict = getDictionary(locale);
  const ordinal = (n: number) => fmt(dict.guests.ordinal, { n });
  const entries = guestEntries(stay, token, ordinal);
  // 대표자 명부 다음 화면이라 목록의 첫 번째(대표자)를 빼고 아직 안 끝난 첫 사람 → 없으면 동의 → 끝.
  const nextIndex = entries.findIndex((entry) => !entry.done && entry.key !== representative.id);
  const nextHref = nextIndex >= 0 ? entries[nextIndex].href : stay.consented ? `/r/${token}` : `/r/${token}/terms`;

  return (
    <RouteForm
      token={token}
      locale={locale}
      dict={{ route: dict.route, person: dict.person, common: dict.common }}
      initial={{ prevStay: representative.prev_stay ?? "", nextDest: representative.next_dest ?? "" }}
      editable={stay.editable}
      nextLabel={nextIndex >= 0 ? ordinal(nextIndex + 1) : null}
      nextHref={nextHref}
      backHref={`/r/${token}/guest/${representative.id}`}
    />
  );
}
