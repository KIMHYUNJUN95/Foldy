import { addressError, normalizeAddress } from "./address";

// 「전원 같은 주소?」 분배(순수 — DB 없음). 44 FR-K06 · FR-W02.
// 대표자 글은 대표자의 hasJapanAddress 로, others 의 글은 그 사람 자신의 hasJapanAddress 로 검사한다.
// 나머지 사람은 대표자 글을 그대로 받는다 — 글자 검사 없이(외국 동행자가 일본 거주 대표자 주소를 함께 쓸 수 있다).

export type AddressGuest = { id: string; is_representative: boolean; has_japan_address: boolean | null };
export type AddressOther = { guestId: string; address: string };
export type AddressGroup = { address: string; ids: string[] };

export type AddressPlan = { ok: true; groups: AddressGroup[] } | { ok: false; fields: string[] };

export function planAddresses(guests: AddressGuest[], representativeAddress: string, others: AddressOther[]): AddressPlan {
  const representative = guests.find((guest) => guest.is_representative);
  if (!representative) return { ok: false, fields: ["address"] };
  const fields: string[] = [];

  const repText = normalizeAddress(representativeAddress);
  if (addressError(repText, representative.has_japan_address === true)) fields.push("address");

  const own = new Map<string, string>();
  for (const other of others) {
    const guest = guests.find((row) => row.id === other.guestId);
    // 이 예약에 없는 사람 · 대표자 · 같은 사람을 두 번 보낸 경우는 거절.
    if (!guest || guest.is_representative || own.has(guest.id)) {
      fields.push(`address.${other.guestId}`);
      continue;
    }
    const text = normalizeAddress(other.address);
    if (addressError(text, guest.has_japan_address === true)) fields.push(`address.${guest.id}`);
    else own.set(guest.id, text);
  }
  if (fields.length) return { ok: false, fields };

  const groups: AddressGroup[] = [{ address: repText, ids: [] }];
  for (const guest of guests) {
    const mine = own.get(guest.id);
    if (mine === undefined) groups[0].ids.push(guest.id);
    else groups.push({ address: mine, ids: [guest.id] });
  }
  return { ok: true, groups };
}

/**
 * 대표자의 일본 거주 여부가 실제로 바뀌어 대표자 주소를 비울 때, 같이 비울 동행자 — 대표자의 **옛 글과 글자 그대로 같은** 주소를 쓰던 사람만.
 * 다르게 적은 사람은 건드리지 않는다. 안 비우면 그 동행자는 「다른 주소」로 보여, 대표자와 다른 글자 규칙으로 검사받다 막힌다.
 * 웹 · 태블릿 저장 경로가 같이 쓴다.
 */
export function companionsSharingOldAddress(
  guests: { id: string; is_representative: boolean; address: string | null }[],
  oldRepresentativeAddress: string | null,
): string[] {
  if (!oldRepresentativeAddress) return [];
  return guests.filter((guest) => !guest.is_representative && guest.address === oldRepresentativeAddress).map((guest) => guest.id);
}

/** 같은 글은 한 번의 update 로 묶는다(`.in("id", ids)`). 일부만 저장되고 끊겨도 다시 보내면 같은 결과(멱등). */
export async function applyAddressPlan(
  db: {
    from: (table: "guests") => {
      update: (values: Record<string, unknown>) => {
        eq: (column: string, value: string) => { in: (column: string, values: string[]) => PromiseLike<{ error: { message: string } | null }> };
      };
    };
  },
  stayId: string,
  groups: AddressGroup[],
  nowIso: string,
): Promise<void> {
  for (const group of groups) {
    if (group.ids.length === 0) continue;
    const { error } = await db.from("guests").update({ address: group.address, updated_at: nowIso }).eq("stay_id", stayId).in("id", group.ids);
    if (error) throw new Error(error.message);
  }
}
