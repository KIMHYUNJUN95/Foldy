/**
 * 수동 예약 생성 — **순수 규칙만.** Beds24 왕복과 DB 는 호출부가 한다.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「수동 예약 생성」
 * 원본: STAY ARI Manager `BuildingCalendar.jsx` → `ManualBookingModal`
 *
 * ## 예약은 roomId **하나**에 붙는다
 *
 * 가격은 소스 유닛에, 최소숙박은 활성 유닛 전부에 쓰지만 **예약은 다르다** — Beds24 의
 * 예약 한 건은 roomId 하나에 속한다. 그래서 숙박 기간 **전체에서 한 유닛**을 골라야 한다.
 *
 * 그런데 우리 계정은 유닛이 교체되는 구간이 있다(2026-09-25 실측: 듀얼 21개 방이
 * 10/01~10/04 에 둘 다 활성, 그 전후로 주인이 바뀐다). 그 구간을 걸치면 **어느 유닛에
 * 붙여도 뒷날짜에는 잠긴 유닛**이 되어 채널에서 사라지거나 재고가 어긋난다.
 *
 * 저쪽도 같은 결론이라 그런 예약을 **거부한다**(`"Active room could not be resolved"`).
 * 우리도 거부하되 **어느 날짜가 문제인지** 같이 돌려준다 — 「안 된다」만 하면 사람이
 * 무엇을 고쳐야 할지 모른다.
 *
 * ## 저쪽보다 덜 거부한다
 *
 * 저쪽은 날짜마다 「선호 유닛」을 고른 뒤 그 결과가 전부 같아야 통과시킨다. 교체 구간처럼
 * 둘 다 활성인 날에는 선호가 B 를 고를 수 있어, 앞뒤가 A 뿐인 숙박이 **괜히 거부**된다.
 *
 * 우리는 **교집합**을 본다 — 모든 밤에 살아 있는 유닛이 하나라도 있으면 그걸 쓴다.
 * 고른 유닛이 전 기간 활성이라는 보장은 그대로이므로 안전하고, 헛거부만 줄어든다.
 */

/** 화면 문구는 사전이 만든다 — 서버가 한국어를 돌려주면 ja/en 사용자에게 한국어가 뜬다. */
export type ManualBookingError =
  | "no_room"
  | "no_guest_name"
  | "bad_dates"
  | "past_arrival"
  | "bad_price"
  | "bad_occupancy"
  | "stay_too_long";

/** Beds24 예약 한 건의 최대 숙박. 실수로 1년을 잡는 것을 막는다. */
export const MAX_STAY_NIGHTS = 60;

export type ManualBookingInput = {
  roomKey: string;
  arrival: string;
  departure: string;
  guestName: string;
  /** **총액**이다(1박 단가가 아니다) — 저쪽 라벨도 `Total Price`. */
  totalPrice: number | null;
  numAdult: number;
  numChild: number;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateManualBooking(
  input: ManualBookingInput,
  today: string,
): ManualBookingError | null {
  if (!input.roomKey.trim()) return "no_room";
  if (!input.guestName.trim()) return "no_guest_name";
  if (!DATE_PATTERN.test(input.arrival) || !DATE_PATTERN.test(input.departure)) return "bad_dates";
  // 체크아웃은 체크인 **다음 날 이상**이다. 같은 날이면 팔 밤이 없다.
  if (input.departure <= input.arrival) return "bad_dates";
  if (input.arrival < today) return "past_arrival";
  if (stayNights(input.arrival, input.departure).length > MAX_STAY_NIGHTS) return "stay_too_long";
  if (input.totalPrice === null || !Number.isFinite(input.totalPrice) || input.totalPrice < 0) {
    return "bad_price";
  }
  if (!Number.isInteger(input.numAdult) || input.numAdult < 1) return "bad_occupancy";
  if (!Number.isInteger(input.numChild) || input.numChild < 0) return "bad_occupancy";
  return null;
}

/** 체크인~체크아웃 사이의 「밤」. **체크아웃 날 밤은 비어 있다.** */
export function stayNights(arrival: string, departure: string): string[] {
  const nights: string[] = [];
  const cursor = new Date(`${arrival}T12:00:00Z`);
  let guard = 0;
  while (cursor.toISOString().slice(0, 10) < departure && guard < 400) {
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return nights;
}

/**
 * 격자에서 체크인을 찍은 뒤 **체크아웃으로 누를 수 있는 날짜들.**
 *
 * 저쪽(`handleDateCellClick`)과 같은 흐름이다 — 첫 클릭이 체크인, 두 번째 클릭이 체크아웃이고
 * 그 사이는 막대처럼 미리 칠해진다. 저쪽은 두 번째 클릭에서 겹침을 검사하고 `alert` 로
 * 튕겨냈지만, 우리는 **처음부터 누를 수 있는 날만 누르게** 한다. 튕겨내면 처음부터 다시
 * 골라야 한다.
 *
 * - 체크아웃은 체크인 **다음 날부터**다(0박은 없다).
 * - 이미 팔린 밤을 **넘어갈 수 없다.** 다만 그 밤의 날짜 자체는 체크아웃으로 고를 수 있다 —
 *   다음 손님이 들어오는 날 아침에 나가는 것은 정상이다.
 * - `MAX_STAY_NIGHTS` 를 넘지 않는다.
 *
 * `dates` 는 화면에 보이는 연속 날짜다(정렬됨). 창 밖 체크아웃은 패널의 날짜 피커로 고친다.
 */
export function checkoutCandidates(
  checkIn: string,
  dates: readonly string[],
  isOccupied: (date: string) => boolean,
): Set<string> {
  const candidates = new Set<string>();
  if (isOccupied(checkIn)) return candidates;
  let nights = 0;
  for (const date of dates) {
    if (date <= checkIn) continue;
    nights += 1;
    if (nights > MAX_STAY_NIGHTS) break;
    candidates.add(date);
    // 이 날 밤이 팔렸으면 여기서 나가야 한다 — 그 너머는 팔린 밤을 끼게 된다.
    if (isOccupied(date)) break;
  }
  return candidates;
}

/**
 * 포인터가 가리키는 날 → **실제로 잡힐 체크아웃.**
 *
 * 누를 수 없는 날을 가리켜도 미리보기가 사라지지 않게 **가장 가까운 유효한 날로 당긴다** —
 * 팔린 밤 너머로 끌면 막대가 그 벽 앞에서 멈춘다. 끊기지 않고 따라오는 느낌이 여기서 나온다.
 * 미리보기와 확정이 같은 함수를 쓰므로 **보이는 그대로 잡힌다.**
 *
 * 체크인 이하를 가리키면 `null` — 아직 기간이 없다(1박짜리 자리표시만 보인다).
 */
export function resolveDraftCheckout(
  checkIn: string,
  pointed: string,
  candidates: ReadonlySet<string>,
): string | null {
  if (pointed <= checkIn || candidates.size === 0) return null;
  if (candidates.has(pointed)) return pointed;
  let last: string | null = null;
  for (const date of candidates) {
    if (date > pointed) break;
    last = date;
  }
  return last;
}

export type StayUnitResult =
  | { ok: true; externalRoomId: string }
  /** `conflictDates` 는 **팔 유닛이 없는 밤**이다. 화면이 「며칠~며칠이 문제」라고 적는다. */
  | { ok: false; reason: "no_active_unit" | "unit_changes"; conflictDates: string[] };

/**
 * 숙박 전체에서 쓸 유닛 하나를 고른다.
 *
 * `activeByNight` 는 밤마다 **그때 살아 있는** Beds24 roomId 목록이다
 * (`1 ≤ minStay < 50`). 하나도 없는 밤이 있으면 그 밤은 애초에 팔 수 없다.
 */
export function resolveStayUnit(activeByNight: Map<string, string[]>): StayUnitResult {
  const nights = [...activeByNight.keys()].sort();
  if (nights.length === 0) return { conflictDates: [], ok: false, reason: "no_active_unit" };

  const empty = nights.filter((night) => (activeByNight.get(night) ?? []).length === 0);
  if (empty.length > 0) return { conflictDates: empty, ok: false, reason: "no_active_unit" };

  let intersection: string[] = [...(activeByNight.get(nights[0]) ?? [])];
  for (const night of nights.slice(1)) {
    const current = new Set(activeByNight.get(night) ?? []);
    intersection = intersection.filter((id) => current.has(id));
    if (intersection.length === 0) {
      // 유닛이 중간에 갈린다. **어느 밤부터 갈리는지**를 돌려줘야 사람이 기간을 나눌 수 있다.
      return { conflictDates: [night], ok: false, reason: "unit_changes" };
    }
  }
  // 여럿이 살아남으면 **가장 작은 id** 로 고정한다 — 순서가 흔들리면 같은 입력에 다른
  // 유닛이 걸려, 나중에 「왜 저기 붙었지」를 재현할 수 없다.
  return { externalRoomId: [...intersection].sort()[0], ok: true };
}

/**
 * Beds24 는 `firstName`·`lastName` 을 따로 받는다. 저쪽과 같은 규칙으로 쪼갠다 —
 * 첫 토큰이 이름, 나머지가 성이고 **성이 비면 `.`** 을 넣는다(빈 값은 거절당한다).
 */
export function splitGuestName(guestName: string): { firstName: string; lastName: string } {
  const trimmed = guestName.trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: "Guest", lastName: "." };
  const [first, ...rest] = trimmed.split(" ");
  return { firstName: first, lastName: rest.join(" ") || "." };
}

/**
 * 취소에 쓸 **Beds24 예약번호**를 꺼낸다.
 *
 * `readBeds24BookingId`(`reservation-status.ts`)를 쓰면 안 된다 — 그쪽은 `apiReference` 를
 * 먼저 보므로 **채널 예약코드**(`HMZEYJJX5W` 같은 것)를 돌려준다. 그 값으로 `POST /bookings`
 * 를 부르면 **엉뚱한 예약이 취소되거나** 조용히 아무 일도 안 일어난다.
 *
 * Beds24 예약번호는 **숫자**다(`92553068`). 숫자가 아니면 취소하지 않는다 — 모르는 값으로
 * 취소를 시도하는 것보다 「못 찾았다」고 멈추는 편이 안전하다.
 */
export function readBeds24CancelTargetId(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  const record = rawPayload as Record<string, unknown>;
  for (const key of ["bookId", "book_id", "id", "bookingId", "booking_id"]) {
    const value = record[key];
    const text =
      typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : typeof value === "string"
          ? value.trim()
          : "";
    if (/^\d+$/.test(text)) return text;
  }
  return null;
}

/**
 * 같은 방(격자 한 행)의 수기 예약을 **한 번에 하나만** 만들게 하는 잠금 이름(2026-10-19) — `beds24_try_lock`
 * (`sync-locks.ts`) 으로 잡는다. 기간이 아니라 **방 단위**다: 10/1~10/3 과 10/2~10/4 처럼 겹치는 두 요청도 같은 잠금을 다툰다.
 * Beds24 는 수기 예약의 겹침을 막아 주지 않아, 두 사람이 동시에 누르면 둘 다 만들어졌다.
 */
export function manualBookingLockName(organizationId: string, roomKey: string): string {
  return `manual_booking:${organizationId}:${roomKey}`;
}

/**
 * Beds24 달력(되읽기)에서 **팔 수 없는 밤** — 재고 0 또는 차단(2026-10-19). 우리 표는 웹훅 · 동기화를 거친 값이라 방금 들어온
 * 채널 예약이나 방금 만든 수기 예약(API 로 만든 예약은 웹훅이 안 온다)을 모를 수 있다 — 만들기 직전에 Beds24 를 한 번 더 본다.
 * 갭 감지와 같은 기준이다(`numAvail <= 0` = 막힘, `ops-gap-detection.ts`). 값이 없는 밤은 판단하지 않는다.
 */
export function beds24UnsellableNights(
  calendar: ReadonlyArray<Record<string, unknown>>,
  nights: readonly string[],
): string[] {
  const blocked = new Set<string>();
  for (const entry of calendar) {
    const from = typeof entry.from === "string" ? entry.from : null;
    const to = typeof entry.to === "string" ? entry.to : from;
    if (!from || !to) continue;
    const soldOut = typeof entry.numAvail === "number" && entry.numAvail <= 0;
    const blackout = entry.override === "blackout";
    if (!soldOut && !blackout) continue;
    for (const night of nights) if (night >= from && night <= to) blocked.add(night);
  }
  return nights.filter((night) => blocked.has(night));
}

/**
 * 예약 생성 호출이 던졌을 때 — **안 만들어진 게 확실한가**(2026-10-19).
 *
 * - `not_created` — Beds24 가 4xx 로 거절했다(429 포함). 요청 키를 놓아 다시 시도하게 한다.
 * - `unknown` — 시간 초과 · 연결 끊김 · 5xx · 응답 해석 실패. 요청은 이미 갔을 수 있다. 키를 놓으면 다시 눌러 **두 번 만든다**
 *   — 키를 붙잡아 두고 사람에게 Beds24 에서 확인하라고 한다.
 */
export function classifyBookingCreateError(error: unknown): "not_created" | "unknown" {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status: unknown }).status);
    if (Number.isInteger(status) && status >= 400 && status < 500) return "not_created";
  }
  return "unknown";
}
