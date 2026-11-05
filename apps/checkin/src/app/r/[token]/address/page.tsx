import { redirect } from "next/navigation";

import { AddressForm } from "@/components/address-form";
import { afterPeopleHref, getStayOr404, guestEntries } from "@/lib/guest/page";
import { fmt, getDictionary } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

// 사는 곳 주소(시안 재수정 2 · A5~A7). 전원 집 주소 전체를 대표자가 한 칸에 쓰고, 「모두 같아요?」 한 번으로 끝낸다(2026-11-04).
// 사람을 다 넣은 뒤에만 연다(누가 외국인인지 알아야 글자 규칙이 정해진다). 이미 다 있어도 고치러 올 수 있다.
export const dynamic = "force-dynamic";

export default async function AddressPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, locale] = await Promise.all([params, getLocale()]);
  const stay = await getStayOr404(token);
  const dict = getDictionary(locale);
  const representative = stay.guests.find((guest) => guest.is_representative);
  const entries = guestEntries(stay, token, (n) => fmt(dict.guests.ordinal, { n }));
  if (!stay.editable || !representative || !entries.every((entry) => entry.done)) redirect(`/r/${token}?view=list`);

  return (
    <AddressForm
      token={token}
      locale={locale}
      dict={{ address: dict.address, common: dict.common }}
      guests={stay.guests.map((guest) => ({
        id: guest.id,
        name: guest.name_roman ?? "",
        isRepresentative: guest.is_representative,
        isChild: guest.guest_type === "child",
        hasJapanAddress: guest.has_japan_address === true,
        address: guest.address ?? "",
      }))}
      nextHref={afterPeopleHref(token, false, stay.consented)}
      backHref={`/r/${token}?view=list`}
    />
  );
}
