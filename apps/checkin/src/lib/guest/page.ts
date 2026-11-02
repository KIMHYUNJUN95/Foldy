import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { createCheckinServiceClient } from "../supabase/service";
import { seatCount } from "./party";
import { loadStayByToken, type StayView } from "./store";

// 한 요청 안에서 같은 토큰을 두 번 읽지 않는다. 없는 · 닫힌 링크는 404 하나로(어느 쪽인지 말하지 않음).
export const getStayOr404 = cache(async (token: string): Promise<StayView> => {
  const stay = await loadStayByToken(createCheckinServiceClient(), token);
  if (!stay) notFound();
  return stay;
});

export type GuestEntry = {
  key: string;
  href: string;
  label: string;
  done: boolean;
  isRepresentative: boolean;
  isChild: boolean;
  hasPhoto: boolean;
  placeholder: boolean;
};

/** 사람 목록(시안 W2) — 저장한 사람 + 손님이 말한 인원(없으면 예약 인원)만큼 빈 자리. 빈 자리를 누르면 새 사람. */
export function guestEntries(stay: StayView, token: string, ordinal: (n: number) => string): GuestEntry[] {
  const entries: GuestEntry[] = stay.guests.map((guest, index) => ({
    key: guest.id,
    href: `/r/${token}/guest/${guest.id}`,
    label: guest.name_roman || ordinal(index + 1),
    done: guest.missing.length === 0,
    isRepresentative: guest.is_representative,
    isChild: guest.guest_type === "child",
    hasPhoto: guest.hasPassportPhoto,
    placeholder: false,
  }));
  for (let n = entries.length + 1; n <= seatCount(stay.guests.length, stay.partySize); n += 1) {
    entries.push({
      key: `new-${n}`,
      href: `/r/${token}/guest/new`,
      label: ordinal(n),
      done: false,
      isRepresentative: false,
      isChild: false,
      hasPhoto: false,
      placeholder: true,
    });
  }
  return entries;
}
