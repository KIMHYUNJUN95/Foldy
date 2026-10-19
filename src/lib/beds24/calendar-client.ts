import { resolveBeds24AccessToken } from "@/lib/beds24/access-token";
import { getOptionalBeds24ApiEnv } from "@/lib/env";

/**
 * Beds24 `inventory/rooms/calendar` 한 곳으로 모은 호출부.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md
 * 원본: STAY ARI Manager `functions/index.js` — `beds24GetRoomCalendarAllPages`,
 *       `beds24PostV2WithRetry`, `beds24PostV2WithGuard`
 *
 * 요금 동기화 · 쓰기 · 되읽기 검증이 **같은 엔드포인트**를 쓴다. 쪽 넘기기와 크레딧 처리를
 * 각자 들고 있으면 한쪽에만 고치는 일이 생긴다 — 실제로 저쪽이 쪽 넘기기를 가격 조회에만
 * 빠뜨려 「잘린 뒤쪽이 조용히 사라져 영구 미동기화」가 됐다.
 */

export type JsonRecord = Record<string, unknown>;

/** 한 건물 12개월이 여기까지 갈 일은 없지만, 없으면 응답이 이상할 때 무한히 돈다. */
export const CALENDAR_MAX_PAGES = 20;

/** 잔여 크레딧이 이보다 적으면 선제적으로 쉰다. 저쪽과 같은 값. */
export const LOW_CREDIT_THRESHOLD = 10;

export class Beds24HttpError extends Error {
  constructor(
    readonly status: number,
    readonly resetInSec: number | null,
    readonly isRateLimit: boolean,
  ) {
    super(`beds24 http ${status}`);
  }
}

export function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function readHeaderInt(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 응답 헤더에서 읽은 5분 크레딧 상태. */
export type CreditSignal = { remaining: number | null; resetInSec: number | null };

export function readCreditSignal(headers: Headers): CreditSignal {
  return {
    remaining: readHeaderInt(headers, "x-five-min-limit-remaining"),
    resetInSec: readHeaderInt(headers, "x-five-min-limit-resets-in"),
  };
}

async function resolveBase(): Promise<{ base: string; token: string } | { skipped: string }> {
  const env = getOptionalBeds24ApiEnv();
  if (!env) return { skipped: "beds24:missing-env" };
  const tokenState = await resolveBeds24AccessToken("beds24");
  if (!tokenState.ok) return { skipped: tokenState.skipped };
  return { base: env.baseUrl.replace(/\/$/, ""), token: tokenState.token };
}

export type CalendarQuery = {
  /** 건물 단위 조회. `roomIds` 와 하나만 쓴다. */
  externalPropertyId?: string;
  /** 객실 단위 조회 — 되읽기 검증이 쓴다. 반복 파라미터로 직렬화한다. */
  externalRoomIds?: string[];
  startDate: string;
  endDate: string;
  includePrices?: boolean;
  /** **가격을 읽을 때는 거의 항상 `true`** — 연결로 퍼진 값이 여기 있다. */
  includeLinkedPrices?: boolean;
  includeMinStay?: boolean;
  includeMaxStay?: boolean;
  includeNumAvail?: boolean;
  includeOverride?: boolean;
};

function buildCalendarUrl(base: string, query: CalendarQuery): string {
  const params = new URLSearchParams();
  if (query.externalPropertyId) params.set("propertyId", query.externalPropertyId);
  // Beds24 는 여러 roomId 를 **반복 파라미터**로 받는다 (`roomId=A&roomId=B`).
  for (const roomId of query.externalRoomIds ?? []) params.append("roomId", roomId);
  params.set("startDate", query.startDate);
  params.set("endDate", query.endDate);
  for (const flag of [
    "includePrices",
    "includeLinkedPrices",
    "includeMinStay",
    "includeMaxStay",
    "includeNumAvail",
    "includeOverride",
  ] as const) {
    if (query[flag]) params.set(flag, "true");
  }
  // 매번 다른 주소로 읽는다 — 같은 주소에 옛 응답이 돌아온 정황이 있었다(2026-09-30,
  // `recent-write-guard.ts`). Beds24 는 모르는 파라미터를 무시한다(실측).
  params.set("_ts", String(Date.now()));
  return `${base}/inventory/rooms/calendar?${params.toString()}`;
}

export type CalendarRoomData = { roomId: string; calendar: JsonRecord[] };

export type CalendarFetchResult = {
  roomsById: Map<string, CalendarRoomData>;
  /** 쪽 상한에 닿아 **뒤가 잘렸다.** 「일치한다」를 증명할 수 없다는 뜻이다. */
  truncated: boolean;
  credit: CreditSignal;
};

/**
 * `pages.nextPageExists` 를 따라 끝까지 읽고 roomId 로 합친다.
 *
 * **잘린 응답으로는 「일치한다」를 증명할 수 없다.** 그래서 `truncated` 를 숨기지 않고
 * 올려보낸다 — 검증 쪽은 이걸 실패로 다룬다.
 */
export async function fetchBeds24Calendar(
  query: CalendarQuery,
  /** `timeoutMs` — 사람이 기다리는 경로(수기 예약 가용 재확인)만 준다. 넘으면 `AbortSignal` 이 던진다. */
  options?: { timeoutMs?: number },
): Promise<CalendarFetchResult | { skipped: string }> {
  const resolved = await resolveBase();
  if ("skipped" in resolved) return resolved;

  const headers = { accept: "application/json", token: resolved.token };
  const roomsById = new Map<string, CalendarRoomData>();
  let credit: CreditSignal = { remaining: null, resetInSec: null };
  let url: string | null = buildCalendarUrl(resolved.base, query);
  let pages = 0;

  while (url && pages < CALENDAR_MAX_PAGES) {
    const response: Response = await fetch(url, {
      cache: "no-store",
      headers,
      signal: options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    });
    credit = readCreditSignal(response.headers);
    if (!response.ok) {
      throw new Beds24HttpError(response.status, credit.resetInSec, response.status === 429);
    }
    const root = asRecord(await response.json());
    if (!root) break;
    pages += 1;

    for (const roomValue of Array.isArray(root.data) ? root.data : []) {
      const room = asRecord(roomValue);
      const roomId = room ? String(room.roomId ?? room.id ?? "") : "";
      if (!room || !roomId) continue;
      const calendar = (Array.isArray(room.calendar) ? room.calendar : [])
        .map(asRecord)
        .filter((entry): entry is JsonRecord => entry !== null);
      const existing = roomsById.get(roomId);
      // 같은 roomId 가 여러 쪽에 걸쳐 오면 이어 붙인다.
      if (existing) existing.calendar.push(...calendar);
      else roomsById.set(roomId, { calendar, roomId });
    }

    const paging = asRecord(root.pages);
    const nextLink = paging?.nextPageExists === true ? paging.nextPageLink : null;
    url = typeof nextLink === "string" && nextLink ? nextLink : null;
  }

  return { credit, roomsById, truncated: url !== null };
}

/** 한 객실에 보낼 쓰기 묶음. `calendar` 는 이미 구간으로 합쳐진 상태다. */
export type CalendarWritePayloadItem = { roomId: number; calendar: unknown[] };

export type CalendarWriteItemResult = {
  externalRoomId: string;
  accepted: boolean;
  /** Beds24 가 준 원문. 원문이 없으면 `errorCode` 와 같은 값. */
  error: string | null;
  errorCode: "bad_response" | "room_rejected" | null;
};

export type CalendarWriteResult = {
  items: CalendarWriteItemResult[];
  credit: CreditSignal;
};

/**
 * `POST /inventory/rooms/calendar`.
 *
 * **응답이 성공이어도 값이 들어갔다는 뜻은 아니다.** 여기서는 「Beds24 가 요청을
 * 받아들였는가」까지만 판정하고, 실제 반영은 부르는 쪽이 되읽어 확인한다
 * (`price-write-verification.ts`).
 *
 * 429 는 던진다 — 쿨다운을 켤지는 부르는 쪽이 정한다.
 */
export async function postBeds24Calendar(
  payload: CalendarWritePayloadItem[],
): Promise<CalendarWriteResult | { skipped: string }> {
  const resolved = await resolveBase();
  if ("skipped" in resolved) return resolved;

  const response = await fetch(`${resolved.base}/inventory/rooms/calendar`, {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      token: resolved.token,
    },
    method: "POST",
  });
  const credit = readCreditSignal(response.headers);
  if (!response.ok) {
    throw new Beds24HttpError(response.status, credit.resetInSec, response.status === 429);
  }

  const body = (await response.json()) as unknown;
  const root = asRecord(body);
  // V2 는 요청 payload 와 **같은 순서**로 객실별 결과를 돌려준다.
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(root?.data)
      ? root.data
      : null;

  if (!rows || rows.length !== payload.length) {
    // 개수가 안 맞으면 어느 객실이 실패했는지 알 수 없다. 전부 실패로 본다 —
    // 성공으로 치면 반영 안 된 값이 「적용됨」으로 남는다.
    console.warn("[beds24/calendar] unexpected write response", {
      expected: payload.length,
      got: rows?.length ?? null,
    });
    return {
      credit,
      items: payload.map((item) => ({
        accepted: false,
        error: "bad_response",
        errorCode: "bad_response" as const,
        externalRoomId: String(item.roomId),
      })),
    };
  }

  return {
    credit,
    items: payload.map((item, index) => {
      const row = asRecord(rows[index]);
      const errors = Array.isArray(row?.errors) ? row.errors : [];
      const accepted = row?.success !== false && errors.length === 0;
      const message = errors
        .map((entry) => asRecord(entry)?.message)
        .filter((entry): entry is string => typeof entry === "string")
        .join("; ");
      return {
        accepted,
        error: accepted ? null : message || "room_rejected",
        errorCode: accepted ? null : ("room_rejected" as const),
        externalRoomId: String(item.roomId),
      };
    }),
  };
}

/** `POST /bookings` 로 만든 예약. `id` 는 Beds24 예약번호다. */
export type BookingCreateResult =
  | { ok: true; bookingId: string; raw: JsonRecord }
  | { ok: false; error: string };

export type BookingCreatePayload = {
  propertyId: number;
  roomId: number;
  arrival: string;
  departure: string;
  firstName: string;
  lastName: string;
  numAdult: number;
  numChild: number;
  email: string;
  phone: string;
  comments: string;
  /** 채널 이름이 아니라 **출처 표기**다. 저쪽은 `"Direct"` 를 쓴다. */
  apiSource: string;
  price: number;
};

/**
 * 예약을 만든다.
 *
 * **응답이 성공이어도 만들어졌다는 뜻은 아니다** — 가격 쓰기와 같다. `errors` 배열이 비어
 * 있고 새 id 가 돌아왔을 때만 성공으로 본다. 부르는 쪽은 그 id 로 다시 읽어 확인한다.
 *
 * 저쪽은 `guestName` 을 한 덩어리로 받아 서버에서 쪼갰다. 우리는 **쪼개서 보낸다** —
 * `splitGuestName` 이 순수 함수라 테스트로 고정돼 있다.
 */
export async function postBeds24Booking(
  payload: BookingCreatePayload,
  /**
   * `timeoutMs` — 넘으면 `AbortSignal` 이 던진다. **던졌다고 안 만들어진 것은 아니다**(요청은 이미 갔을 수 있다) —
   * 부르는 쪽이 「모름」으로 다뤄야 한다(`classifyBookingCreateError`).
   */
  options?: { timeoutMs?: number },
): Promise<BookingCreateResult | { skipped: string }> {
  const resolved = await resolveBase();
  if ("skipped" in resolved) return resolved;

  const response = await fetch(`${resolved.base}/bookings`, {
    body: JSON.stringify([payload]),
    cache: "no-store",
    signal: options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      token: resolved.token,
    },
    method: "POST",
  });
  const credit = readCreditSignal(response.headers);
  if (!response.ok) {
    throw new Beds24HttpError(response.status, credit.resetInSec, response.status === 429);
  }

  const body = (await response.json()) as unknown;
  const root = asRecord(body);
  const rows = Array.isArray(body) ? body : Array.isArray(root?.data) ? root.data : null;
  const row = asRecord(rows?.[0]);
  if (!row) return { error: "unexpected_response", ok: false };

  const errors = Array.isArray(row.errors) ? row.errors : [];
  if (row.success === false || errors.length > 0) {
    const detail = errors
      .map((entry) => asRecord(entry)?.message)
      .filter((message): message is string => typeof message === "string")
      .join(", ");
    return { error: detail || "rejected", ok: false };
  }

  // V2 는 만든 예약을 `new` 아래에 돌려준다. 옛 응답은 평평하게 오므로 둘 다 본다.
  const created = asRecord(row.new) ?? row;
  const bookingId = created.id;
  if (typeof bookingId !== "number" && typeof bookingId !== "string") {
    return { error: "missing_booking_id", ok: false };
  }
  return { bookingId: String(bookingId), ok: true, raw: created };
}

/**
 * 예약을 취소한다 — `POST /bookings` 에 `status: "cancelled"`.
 *
 * **되돌릴 수 없다.** 채널에도 그대로 나가고, Beds24 에서 다시 `confirmed` 로 바꿔도 손님에게
 * 간 취소 통지는 취소되지 않는다. 그래서 부르는 쪽이 확인 단계를 둔다.
 *
 * 저쪽은 사유를 받으면 `comments` 에 `"Cancelled: {사유}"` 로 적고, 없으면
 * `"Cancelled by User"` 를 넣는다. 같은 규칙을 쓴다 — Beds24 화면에서 두 시스템의 취소가
 * 같은 모양으로 보여야 병행 기간에 헷갈리지 않는다.
 */
export async function postBeds24BookingCancel(args: {
  bookingId: string;
  reason?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string } | { skipped: string }> {
  const resolved = await resolveBase();
  if ("skipped" in resolved) return resolved;

  const reason = args.reason?.trim();
  const response = await fetch(`${resolved.base}/bookings`, {
    body: JSON.stringify([
      {
        comments: reason ? `Cancelled: ${reason}` : "Cancelled by User",
        id: Number(args.bookingId),
        status: "cancelled",
      },
    ]),
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      token: resolved.token,
    },
    method: "POST",
  });
  const credit = readCreditSignal(response.headers);
  if (!response.ok) {
    throw new Beds24HttpError(response.status, credit.resetInSec, response.status === 429);
  }

  const body = (await response.json()) as unknown;
  const root = asRecord(body);
  const rows = Array.isArray(body) ? body : Array.isArray(root?.data) ? root.data : null;
  const row = asRecord(rows?.[0]);
  if (!row) return { error: "unexpected_response", ok: false };

  const errors = Array.isArray(row.errors) ? row.errors : [];
  if (row.success === false || errors.length > 0) {
    const detail = errors
      .map((entry) => asRecord(entry)?.message)
      .filter((message): message is string => typeof message === "string")
      .join(", ");
    return { error: detail || "rejected", ok: false };
  }
  return { ok: true };
}

/**
 * 예약을 고친다 — `POST /bookings` 에 `id` + **바뀐 필드만**(`buildBeds24BookingUpdate`).
 *
 * 취소와 같은 응답 규칙이다: `errors` 가 비어 있어야 성공. 성공해도 **무엇이 들어갔는지는
 * 되읽어야 안다** — 부르는 쪽이 `fetchBeds24BookingById` 로 다시 읽어 우리 표를 맞춘다.
 */
export async function postBeds24BookingUpdate(
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string } | { skipped: string }> {
  const resolved = await resolveBase();
  if ("skipped" in resolved) return resolved;

  const response = await fetch(`${resolved.base}/bookings`, {
    body: JSON.stringify([payload]),
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      token: resolved.token,
    },
    method: "POST",
  });
  const credit = readCreditSignal(response.headers);
  if (!response.ok) {
    throw new Beds24HttpError(response.status, credit.resetInSec, response.status === 429);
  }

  const body = (await response.json()) as unknown;
  const root = asRecord(body);
  const rows = Array.isArray(body) ? body : Array.isArray(root?.data) ? root.data : null;
  const row = asRecord(rows?.[0]);
  if (!row) return { error: "unexpected_response", ok: false };

  const errors = Array.isArray(row.errors) ? row.errors : [];
  if (row.success === false || errors.length > 0) {
    const detail = errors
      .map((entry) => asRecord(entry)?.message)
      .filter((message): message is string => typeof message === "string")
      .join(", ");
    return { error: detail || "rejected", ok: false };
  }
  return { ok: true };
}

/**
 * 예약 한 건을 Beds24 예약번호로 읽는다. 수정 직후 우리 표를 맞추는 데 쓴다 —
 * 웹훅을 기다리면 방금 고친 것이 화면에 안 보여 사람은 한 번 더 고친다.
 */
export async function fetchBeds24BookingById(
  bookingId: string,
  options?: { timeoutMs?: number },
): Promise<{ ok: true; booking: JsonRecord } | { ok: false; error: string } | { skipped: string }> {
  const resolved = await resolveBase();
  if ("skipped" in resolved) return resolved;

  const response = await fetch(`${resolved.base}/bookings?id=${encodeURIComponent(bookingId)}`, {
    cache: "no-store",
    signal: options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    headers: { accept: "application/json", token: resolved.token },
  });
  const credit = readCreditSignal(response.headers);
  if (!response.ok) {
    throw new Beds24HttpError(response.status, credit.resetInSec, response.status === 429);
  }
  const body = (await response.json()) as unknown;
  const root = asRecord(body);
  const rows = Array.isArray(body) ? body : Array.isArray(root?.data) ? root.data : null;
  const booking = asRecord(rows?.[0]);
  if (!booking || String(booking.id ?? "") !== bookingId) return { error: "not_found", ok: false };
  return { booking, ok: true };
}
