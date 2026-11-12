/**
 * 「빈 방」 — 그날 밤 묵는 예약도 없고 **차단도 아닌** 방. 순수 모듈, 모바일 머리 줄 · 목록 탭 · 건물 고르기 · PC 오늘 운영이 같이 쓴다(2026-11-12).
 *
 * 예전엔 모바일 머리 줄은 차단을 뺐고 목록 「빈 방」 탭 · 건물 고르기는 안 빼서, 같은 날 숫자가 둘이었다. 차단된 방은 팔 수 없으니
 * 빈 방으로 세지 않는다. 목록은 「예약 없이 차단된 방」을 따로(`blockedEmpty`) 보여 줄 수 있다.
 */
export type StayRange = { checkInDate: string; checkOutDate: string };

/** 그날 밤 묵는가 — 체크인 ≤ 날 < 체크아웃. */
export function staysOnNight(stay: StayRange, date: string): boolean {
  return stay.checkInDate <= date && stay.checkOutDate > date;
}

export function splitVacantRooms(
  rooms: readonly string[],
  occupied: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
): { vacant: string[]; blockedEmpty: string[] } {
  const vacant: string[] = [];
  const blockedEmpty: string[] = [];
  for (const room of rooms) {
    if (occupied.has(room)) continue;
    if (blocked.has(room)) blockedEmpty.push(room);
    else vacant.push(room);
  }
  return { vacant, blockedEmpty };
}

/** 예약 목록 → 그날 밤 묵는 방 키. */
export function occupiedRoomsOn<T extends StayRange>(
  stays: readonly T[],
  date: string,
  keyOf: (stay: T) => string,
): Set<string> {
  const result = new Set<string>();
  for (const stay of stays) if (staysOnNight(stay, date)) result.add(keyOf(stay));
  return result;
}
