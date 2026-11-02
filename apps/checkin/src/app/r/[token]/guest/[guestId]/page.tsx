import { notFound } from "next/navigation";

import { PersonForm, type PersonInitial } from "@/components/person-form";
import { COUNTRIES } from "@/lib/guest/countries";
import { getStayOr404, guestEntries } from "@/lib/guest/page";
import { currentPassportPath, PASSPORT_BUCKET } from "@/lib/guest/store";
import { fmt, getDictionary, intlTag } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// 한 사람 명부(시안 W3). guestId 가 "new" 면 새 사람.
export const dynamic = "force-dynamic";

const PHOTO_URL_SECONDS = 300;

function splitName(nameRoman: string | null, fromBooking: boolean) {
  const tokens = (nameRoman ?? "").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { lastName: "", firstName: "" };
  if (tokens.length === 1) return { lastName: tokens[0], firstName: "" };
  // 우리가 저장한 이름은 「성 이름」, 예약(Beds24)에서 온 이름은 보통 「이름 성」.
  return fromBooking
    ? { lastName: tokens[tokens.length - 1], firstName: tokens.slice(0, -1).join(" ") }
    : { lastName: tokens[0], firstName: tokens.slice(1).join(" ") };
}

export default async function GuestPage({ params }: { params: Promise<{ token: string; guestId: string }> }) {
  const [{ token, guestId }, locale] = await Promise.all([params, getLocale()]);
  const stay = await getStayOr404(token);
  const dict = getDictionary(locale);
  const isNew = guestId === "new";
  const guest = isNew ? undefined : stay.guests.find((row) => row.id === guestId);
  if (!isNew && !guest) notFound();
  if (isNew && !stay.editable) notFound();

  const representative = stay.guests.find((row) => row.is_representative);
  const isRepresentative = !!guest?.is_representative;
  const ordinal = (n: number) => fmt(dict.guests.ordinal, { n });
  const entries = guestEntries(stay, token, ordinal);
  const position = isNew ? stay.guests.length + 1 : stay.guests.findIndex((row) => row.id === guestId) + 1;
  const total = Math.max(entries.length, position);

  // 저장한 뒤 갈 곳: 다른 사람 중 아직 안 끝난 첫 사람 → 없으면 동의 → 끝.
  const nextEntry = entries.find((entry) => !entry.done && entry.key !== guestId && !(isNew && entry.placeholder && entry.key === `new-${position}`));
  const nextHref = nextEntry ? nextEntry.href : stay.consented ? `/r/${token}` : `/r/${token}/terms`;

  let photoUrl: string | null = null;
  if (guest?.hasPassportPhoto) {
    const db = createCheckinServiceClient();
    const path = await currentPassportPath(db, guest.id);
    if (path) {
      const { data } = await db.storage.from(PASSPORT_BUCKET).createSignedUrl(path, PHOTO_URL_SECONDS);
      photoUrl = data?.signedUrl ?? null;
    }
  }

  const regionNames = new Intl.DisplayNames([intlTag(locale)], { type: "region" });
  const collator = new Intl.Collator(intlTag(locale));
  const countries = COUNTRIES.map((country) => ({ code: country.alpha3, name: regionNames.of(country.alpha2) ?? country.alpha3 })).sort(
    (a, b) => collator.compare(a.name, b.name),
  );

  const name = splitName(guest?.name_roman ?? null, guest?.source === "beds24");
  const initial: PersonInitial = {
    id: guest?.id,
    lastName: name.lastName,
    firstName: name.firstName,
    guestType: guest?.guest_type ?? "adult",
    hasJapanAddress: guest?.has_japan_address ?? false,
    nationality: guest?.nationality ?? "",
    passportNumber: guest?.passport_number ?? "",
    age: guest?.age ?? null,
    contact: guest?.contact ?? "",
    gender: (guest?.gender as "male" | "female" | null) ?? null,
    noPassport: !!guest?.no_passport_reason,
    address: guest?.address ?? (isRepresentative ? "" : (representative?.address ?? "")),
    prevStay: guest?.prev_stay ?? (isRepresentative ? "" : (representative?.prev_stay ?? "")),
    nextDest: guest?.next_dest ?? (isRepresentative ? "" : (representative?.next_dest ?? "")),
  };

  return (
    <PersonForm
      token={token}
      locale={locale}
      dict={{ person: dict.person, common: dict.common, guests: dict.guests, route: dict.route }}
      title={isRepresentative ? dict.person.repTitle : guest?.name_roman || ordinal(position)}
      counter={fmt(dict.person.counter, { i: position, n: total })}
      initial={initial}
      isRepresentative={isRepresentative}
      representativeName={representative?.name_roman ?? ""}
      sharedFromRep={
        !isRepresentative
          ? { address: representative?.address ?? "", prevStay: representative?.prev_stay ?? "", nextDest: representative?.next_dest ?? "" }
          : null
      }
      photoUrl={photoUrl}
      countries={countries}
      editable={stay.editable}
      nextHref={nextHref}
      routeHref={`/r/${token}/route`}
      listHref={`/r/${token}?view=list`}
      // 새 사람 화면의 「안 와요」는 빈 자리가 남아 있을 때만(저장한 사람은 언제나).
      canRemove={!guest ? stay.guests.length < stay.partySize : !guest.is_representative}
    />
  );
}
