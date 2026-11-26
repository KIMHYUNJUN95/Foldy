import { resolveGuestCountry, type GuestCountrySource } from "@/lib/guest-country";

/**
 * 판매 캘린더 — 예약 상세 패널이 보여줄 값. **순수하다**(DB·네트워크를 모른다).
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 상세」
 * 원본: STAY ARI Manager `BuildingCalendar.jsx` → `ReservationDetailModal`
 *
 * ## 원본(`raw_payload`)을 통째로 넘기지 않는다
 *
 * 우리 표의 `raw_payload` 는 Beds24 예약 JSON 그대로다. 거기에는 **결제 토큰**(`stripeToken`,
 * `pcibookingToken`)도 들어 있다. 화면에 필요한 필드만 **이름을 지정해** 꺼내고 나머지는 서버
 * 밖으로 나가지 않는다 — 나중에 Beds24 가 필드를 늘려도 저절로 새지 않는다.
 *
 * ## 어떤 필드가 실제로 차 있나 (2026-09-28 실측, 체크인 6월 이후 3,762건)
 *
 * 항상: 이름 · 인원 · 채널 · 예약/변경 시각 · Beds24 번호 · 요금 설명.
 * 대체로: 금액·수수료(취소되면 Beds24 가 0 으로 바꾼다) · 국가(74%) · 전화(62%) · 손님 요청(54%)
 * · 이메일(50%) · 채널 메시지(28%, 부킹닷컴) · 내부 메모(17%).
 * 드묾: 주소(7%) · 휴대폰 · 도착 예정 시각(8건). **빈 값은 줄째 숨긴다** — 「—」가 줄지어 있으면
 * 정작 있는 값이 안 보인다.
 */

export type OpsReservationDetail = {
  id: string;
  /** 우리 표의 상태(`confirmed` / `cancelled` …). */
  status: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  propertyName: string;
  roomLabel: string;

  // ── 손님 ─────────────────────────────
  email: string | null;
  phone: string | null;
  mobile: string | null;
  /**
   * ISO 3166-1 alpha-2 대문자. 이름은 화면이 로캘로 바꾼다.
   * 채널이 안 줬으면 **전화번호로 추정**한 값이다 — `countrySource` 로 가른다(`guest-country.ts`).
   */
  countryCode: string | null;
  countrySource: GuestCountrySource | null;
  /** 코드가 아닌 국가 표기(드물다). 코드가 없을 때만 쓴다. */
  countryText: string | null;
  /** 손님 언어(`en`, `ja` …). */
  language: string | null;
  address: string | null;
  numAdult: number | null;
  numChild: number | null;
  arrivalTime: string | null;

  // ── 금액 ─────────────────────────────
  /** Beds24 `price` — 숙박 **총액**(엔). 취소되면 Beds24 가 0 으로 바꾼다. */
  price: number | null;
  commission: number | null;
  rateDescription: string | null;

  // ── 메시지 ───────────────────────────
  /** 손님이 적은 요청(`comments`). */
  guestComments: string | null;
  /** Beds24 내부 메모(`notes`). 손님에게 안 보인다. */
  internalNotes: string | null;
  /** 채널이 붙인 메시지(`apiMessage`) — 부킹닷컴의 결제·요청 안내 등. */
  channelMessage: string | null;

  // ── 예약 ─────────────────────────────
  /** 채널 이름(`referer`) — `Airbnb`, `Booking.com`, `Direct` … */
  channelName: string | null;
  /** 채널 예약번호(`apiReference`) — 손님·채널과 대화할 때 쓰는 번호. */
  channelReference: string | null;
  /** Beds24 예약번호(`id`). */
  beds24Id: string | null;
  /** 여러 방을 한 번에 잡은 예약의 대표 번호. */
  groupMasterId: string | null;
  flagText: string | null;
  /** ISO 시각(UTC). */
  bookedAt: string | null;
  modifiedAt: string | null;
  cancelledAt: string | null;
};

export type ReservationDetailRow = {
  id: string;
  status: string;
  guest_name: string;
  check_in_date: string;
  check_out_date: string;
  property_name: string;
  room_label: string;
  raw_payload: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 문자열 값. 비었거나 공백뿐이면 `null`. */
function text(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** 숫자 값. 숫자 문자열도 받는다. 모르면 `null` — **0 과 다르다.** */
function number(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 번호류. 0 은 「없음」이다(Beds24 가 빈 번호를 0 으로 준다). */
function identifier(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === "number") return Number.isFinite(value) && value !== 0 ? String(value) : null;
  return text(record, key);
}

export function buildOpsReservationDetail(row: ReservationDetailRow): OpsReservationDetail {
  const raw = asRecord(row.raw_payload);

  const mobile = text(raw, "mobile");
  const phone = text(raw, "phone");
  const country = resolveGuestCountry({
    channelCode: text(raw, "country2") ?? text(raw, "country"),
    phones: [phone, mobile],
  });
  const countryText = country ? null : text(raw, "country");

  const address = [text(raw, "address"), text(raw, "city"), text(raw, "state"), text(raw, "postcode")]
    .filter((part): part is string => !!part)
    .join(", ");

  return {
    address: address || null,
    arrivalTime: text(raw, "arrivalTime"),
    beds24Id: identifier(raw, "id"),
    bookedAt: text(raw, "bookingTime"),
    cancelledAt: text(raw, "cancelTime"),
    channelMessage: text(raw, "apiMessage"),
    channelName: text(raw, "referer") ?? text(raw, "channel"),
    channelReference: text(raw, "apiReference"),
    checkIn: row.check_in_date,
    checkOut: row.check_out_date,
    commission: number(raw, "commission"),
    countryCode: country?.code ?? null,
    countrySource: country?.source ?? null,
    countryText,
    email: text(raw, "email"),
    flagText: text(raw, "flagText"),
    groupMasterId: identifier(raw, "masterId"),
    guestComments: text(raw, "comments"),
    guestName: row.guest_name,
    id: row.id,
    internalNotes: text(raw, "notes"),
    language: text(raw, "lang"),
    // 같은 번호가 두 칸에 있으면 한 번만 보인다.
    mobile: mobile && mobile !== phone ? mobile : null,
    modifiedAt: text(raw, "modifiedTime"),
    numAdult: number(raw, "numAdult"),
    numChild: number(raw, "numChild"),
    phone,
    price: number(raw, "price"),
    propertyName: row.property_name,
    rateDescription: text(raw, "rateDescription"),
    roomLabel: row.room_label,
    status: row.status,
  };
}

/**
 * 「손님」 칸(이메일 · 전화 · 휴대폰 · 나라 · 언어 · 주소)에 보일 값이 하나라도 있는가.
 * Airbnb 문의(inquiry) 원본은 이 칸들이 비어 오는 일이 많다 — 다 비면 PC 패널 · 모바일 시트 둘 다 칸째 숨긴다.
 * (손님 이름은 패널 머리에 따로 보인다.)
 */
export function hasGuestContactDetails(
  detail: Pick<OpsReservationDetail, "address" | "countryCode" | "countryText" | "email" | "language" | "mobile" | "phone">,
): boolean {
  return [detail.email, detail.phone, detail.mobile, detail.countryCode, detail.countryText, detail.language, detail.address].some(
    (value) => !!value,
  );
}
