import type { Database } from "@/types/database";

type JsonRecord = Record<string, unknown>;
type ReservationStatus = Database["public"]["Enums"]["reservation_status"];

function readString(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function readValue(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && !(typeof value === "string" && value.trim().length === 0)) {
      return value;
    }
  }
  return null;
}

function normalizeBeds24StatusValue(raw: unknown): ReservationStatus {
  if (raw === null || raw === undefined) return "confirmed";

  if (typeof raw === "number") {
    if (raw === 0) return "cancelled";
    if (raw === 1 || raw === 2 || raw === 3 || raw === 5 || raw === -2) return "confirmed";
    if (raw === 4) return "confirmed"; // 검정 — Beds24 에서 여전히 캘린더를 점유함
    return "confirmed";
  }

  if (typeof raw !== "string") return "confirmed";

  const value = raw.trim().toLowerCase();
  if (value.length === 0) return "confirmed";

  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && /^-?\d+$/.test(value)) {
    if (numericValue === 0) return "cancelled";
    if (numericValue === 1 || numericValue === 2 || numericValue === 3 || numericValue === 5) return "confirmed";
    if (numericValue === 4) return "confirmed";
  }

  if (
    ["cancelled", "canceled", "cancel"].includes(value) ||
    value.includes("cancelled") ||
    value.includes("canceled")
  ) {
    return "cancelled";
  }
  if (["checked_in", "checkin", "checked-in", "in_house", "inhouse"].includes(value)) {
    return "checked_in";
  }
  if (["checked_out", "checkout", "checked-out", "departed"].includes(value)) {
    return "checked_out";
  }
  if (["no_show", "noshow", "no-show"].includes(value) || value.includes("no show")) {
    return "no_show";
  }

  if (["new", "request", "inquiry", "confirmed", "modify", "modified", "black"].includes(value)) {
    return "confirmed";
  }

  return "confirmed";
}

// ── 문의 · 예약 요청(2026-11-19) ─────────────────────────────────────────
//
// Beds24 채널 설정을 바꿔 문의(`inquiry` · 5) · 예약 요청(`request` · 3)도 Beds24 로 들어오고, 웹훅 · 백필로 우리 표에도 온다.
// 우리 표는 위 매핑대로 `status = 'confirmed'` 로 적고 **원본 상태는 `raw_payload.status` 에만** 남는다(enum 은 그대로).
// 아직 확정되지 않은 예약이라 청소 · 캘린더 · 홈 · 셀프 체크인 · 건물 지도 · 고르기 목록 같은 **운영 화면은 이 판정으로 뺀다.**
// 손님 메시지함은 빼지 않는다(직원이 문의에 답해야 한다). 확정되면 Beds24 웹훅이 `raw_payload` 를 새로 적어 저절로 나타난다.

/**
 * 문의 · 요청의 원본 상태 값 — Beds24 가 실제로 보내는 형태(소문자 글자 · 숫자 글자 · 숫자) **정확히 이 값만.**
 * JS 판정과 DB 거르기(`excludePendingInquiries`, jsonb 포함은 정확히 같은 값만 맞는다)가 같은 집합을 써서, 한 예약이 화면마다
 * 다르게 보이지 않는다. 대소문자 · 공백이 다른 값(운영 0건, 2026-11-19)은 문의로 보지 않는다 = 센다.
 */
const PENDING_INQUIRY_PAYLOAD_MATCHES: ReadonlyArray<string | number> = ["inquiry", "request", "3", "5", 3, 5];

/** 원본 상태 값이 문의 · 예약 요청인가. 없음(null · 빈 글자)은 문의가 아니다 = 센다. */
export function isPendingBeds24InquiryStatus(rawStatus: unknown): boolean {
  if (typeof rawStatus !== "string" && typeof rawStatus !== "number") return false;
  return PENDING_INQUIRY_PAYLOAD_MATCHES.includes(rawStatus);
}

/**
 * 문의와 예약 요청을 **나눈다**(2026-11-26, 판매 캘린더 「예약 표시」 필터). 같은 값 집합(`PENDING_INQUIRY_PAYLOAD_MATCHES`)만 쓴다 —
 * Beds24 숫자 상태 5 = 문의(inquiry), 3 = 예약 요청(request). 문의 · 요청이 아니면 `null`.
 */
export function pendingBeds24InquiryKind(rawStatus: unknown): "inquiry" | "request" | null {
  if (!isPendingBeds24InquiryStatus(rawStatus)) return null;
  return rawStatus === "request" || rawStatus === "3" || rawStatus === 3 ? "request" : "inquiry";
}

/** 예약 원본(`raw_payload`)이 문의 · 예약 요청인가 — `status` 칸을 본다. */
export function isPendingBeds24Inquiry(rawPayload: unknown): boolean {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return false;
  return isPendingBeds24InquiryStatus((rawPayload as JsonRecord).status);
}

type NotFilterable<Q> = { not(column: string, operator: string, value: unknown): Q };

/**
 * `reservations` 읽기에서 문의 · 요청을 **DB 에서** 뺀다 — 페이지 · `limit` 이 있는 읽기도 건수가 맞는다.
 * `NOT (raw_payload @> '{"status":…}')` 를 값마다 건다. `raw_payload->>status NOT IN (…)` 은 원본 상태가 없는 줄(NULL)까지
 * 떨어뜨려서 쓰지 않는다(운영 3,490줄, 2026-11-19). `raw_payload` 칸은 `NOT NULL default '{}'`(마이그레이션 202605220001)라 칸 자체가 NULL 인 줄은 없다.
 * 다른 `.or()` 와 섞지 않으므로 이미 `.or()` 를 쓰는 읽기에도 그대로 붙는다.
 */
export function excludePendingInquiries<Q extends NotFilterable<Q>>(query: Q): Q {
  let next = query;
  for (const status of PENDING_INQUIRY_PAYLOAD_MATCHES) next = next.not("raw_payload", "cs", JSON.stringify({ status }));
  return next;
}

/** Beds24 가 「살아 있는 예약」에 쓰는 명시적 상태 값 — 이 값이 오면 `cancelTime` 보다 믿는다. */
const ACTIVE_EXPLICIT_STATUSES = new Set(["confirmed", "new", "request", "inquiry", "black", "1", "2", "3", "4", "5"]);

/**
 * Beds24 예약/웹훅 payload 필드를 Foldy 예약 상태로 매핑한다.
 * 참고: Beds24 API v2 는 활성 예약에 statusCode: 0 을 줄 수 있으므로 — statusCode 만으로 판단하지 말 것.
 *
 * **명시적 상태가 살아 있으면 그것을 따른다** (2026-10-07). Beds24 는 취소했다가 되살린 예약에도
 * `cancelTime` 을 지우지 않는다(실측 7건 — `status: "confirmed"` + `cancelTime` 있음, 예: 86444948 ·
 * 91904176). 예전엔 `cancelTime` 만 보고 취소로 적어서 판매 캘린더 · 청소 · 매출에서 그 예약이 빠졌다.
 * `cancelTime` · 취소 `subStatus` 는 **상태 값이 없을 때만**(드문 취소 웹훅) 취소 신호로 쓴다.
 * 노쇼(`subStatus`)는 상태가 살아 있어도 노쇼다.
 */
export function resolveReservationStatusFromBeds24Record(record: JsonRecord): ReservationStatus {
  const explicitRaw = readValue(record, [
    "statusText",
    "status_text",
    "statusName",
    "status_name",
    "bookingStatusText",
    "booking_status_text",
    "bookingStatus",
    "booking_status",
    "status",
  ]);
  const explicit = explicitRaw === null ? null : normalizeBeds24StatusValue(explicitRaw);
  if (explicit === "cancelled") return "cancelled";
  const explicitActive = explicitRaw !== null && ACTIVE_EXPLICIT_STATUSES.has(String(explicitRaw).trim().toLowerCase());

  const subStatusRaw = readString(record, ["subStatus", "sub_status", "substatus"]);
  if (subStatusRaw) {
    const subStatus = subStatusRaw.toLowerCase();
    if (subStatus === "5" || subStatus.includes("no show")) {
      return "no_show";
    }
    if (!explicitActive && (subStatus === "3" || subStatus === "4" || subStatus.includes("cancelled by"))) {
      return "cancelled";
    }
  }

  if (!explicitActive) {
    const cancelTime = readString(record, ["cancelTime", "cancel_time", "cancelledAt", "cancelled_at"]);
    if (cancelTime) return "cancelled";
  }

  return explicit ?? "confirmed";
}

export function readBeds24BookingId(record: JsonRecord): string | null {
  return readString(record, [
    "bookId",
    "book_id",
    "apiReference",
    "api_reference",
    "reservationId",
    "reservation_id",
    "bookingId",
    "booking_id",
    "id",
  ]);
}
