import type { SupabaseClient } from "@supabase/supabase-js";
import { getOptionalBeds24ApiEnv } from "@/lib/env";
import {
  chooseStoredReservationId,
  isSameBeds24Booking,
  readBeds24MasterId,
  readBeds24OwnBookingId,
  toOriginalReservationId,
  toStoredReservationId,
  type StoredReservationKeyCandidate,
} from "@/lib/beds24/reservation-id";
import {
  readBeds24BookingId,
  resolveReservationStatusFromBeds24Record,
} from "@/lib/beds24/reservation-status";
import { extractBeds24BookingCandidates } from "@/lib/beds24/booking-payload";
import { normalizeReservationSource } from "@/lib/beds24/source-normalization";
import type { Database } from "@/types/database";
import { signalBeds24Change } from "@/lib/beds24/live-signal";

type JsonRecord = Record<string, unknown>;
type ReservationStatus = Database["public"]["Enums"]["reservation_status"];

type Beds24AccessTokenState =
  | { ok: true; token: string }
  | { ok: false; skipped: string };

type BookingRow = {
  externalRoomId: string | null;
  sourceReservationId: string;
  /** Beds24 자기 예약번호. 그룹(다객실) 예약은 채널 번호가 같아도 이 값이 방마다 다르다. */
  beds24BookingId: string | null;
  masterId: string | null;
  source: string;
  propertyExternalId: string | null;
  propertyName: string;
  roomLabel: string;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
  status: ReservationStatus;
  rawPayload: Database["public"]["Tables"]["reservations"]["Insert"]["raw_payload"];
};

export type BackfillSkippedReason = {
  sourceReservationId: string | null;
  guestName: string | null;
  propertyName: string | null;
  checkInDate: string | null;
  reason: string;
};

export type Beds24ReservationsBackfillResult = {
  attempted: boolean;
  /**
   * 「지난번 이후 바뀐 것만」으로 돌았는가.
   *
   * 증분에서 **0건은 정상**이다(조용한 날). 창 훑기에서 0건은 이상 신호다. 둘을 구분하지 않으면
   * 정상인 실행이 매번 「데이터 없음」으로 보고돼 워크플로 로그가 늑대소년이 된다.
   */
  incremental: boolean;
  endpointTried: string | null;
  from: string;
  toExclusive: string;
  partial: boolean;
  failedPageUrl: string | null;
  fetchedRows: number;
  upsertedRows: number;
  cancelledUpsertedRows: number;
  skippedRows: number;
  recoveredRows: number;
  skipped: string[];
  skippedReasons: BackfillSkippedReason[];
};

/**
 * 이름이 지워진 예약의 자리표시. 방 이름을 못 찾을 때와 같은 표기를 쓴다 — 화면에서 「값이 없다」는
 * 뜻으로 이미 통용되는 말이라 새 표기를 만들 이유가 없다.
 */
const UNKNOWN_GUEST_NAME = "(unknown)";

let cachedBeds24AccessToken: { token: string; expiresAt: number } | null = null;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function readString(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}


function toIsoDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function lastNightToCheckout(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return d.toISOString().slice(0, 10);
}

function sanitizeRawPayload(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value)) as Database["public"]["Tables"]["reservations"]["Insert"]["raw_payload"];
  } catch {
    return {};
  }
}

function toJstDateString(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// 운영 완결성 구간(Asia/Tokyo). 예약일이 아니라 ARRIVAL/숙박 겹침 기준이다
// — 예약일이 아니다. 1년 전에 예약했더라도 체크인이 이 구간 안이면 여전히 가져온다,
// 쿼리가 생성 시각이 아니라 `arrivalTo`/`departureFrom` 으로 거르기 때문이다. 구간은 이번 달
// + 다음 두 달(총 3개월)을 덮는다: "당월 + 미래 2달" 의 체크인은 절대 빠지면 안 된다.
// `month` 는 여기서 1부터 시작하고 Date.UTC 의 month 인자는 0부터 시작한다. 그래서 `month + 2` 는
// 세 번째로 덮는 달의 다음 달 1일이 된다(예: 7월 → 10월 1일, 7/8/9월을 덮음).
function getOperationalWindow() {
  const today = toJstDateString(new Date());
  const currentJstMonth = today.slice(0, 7);
  const [year, month] = currentJstMonth.split("-").map(Number);
  const from = `${currentJstMonth}-01`;
  const toExclusive = new Date(Date.UTC(year, month + 2, 1)).toISOString().slice(0, 10);
  return { from, toExclusive };
}

/**
 * 커서를 뒤로 물리는 여유 (2026-09-16).
 *
 * 기준 시각은 **우리 서버가 기록한 시각**이고 `modifiedTime` 은 **Beds24 가 찍는다** — 두 시계가
 * 정확히 같지 않다. 게다가 우리가 수집하는 **중에** 수정된 예약도 있다. 딱 잘라 그 시각 이후만
 * 보면 그런 예약이 영원히 안 잡힌다.
 *
 * 겹치면 같은 예약을 한두 번 더 읽을 뿐이고(수신은 재전송에 안전하다 — 유니크 키 upsert),
 * 놓치는 것보다 언제나 낫다. 채용 동기화에서 같은 이유로 같은 장치를 썼다.
 */
const MODIFIED_CURSOR_OVERLAP_MINUTES = 30;

/**
 * 「지난번 이후 바뀐 것만」 URL.
 *
 * 날짜 창과 달리 **기간 제한이 없다** — 2022년 예약이 오늘 취소돼도 잡힌다. 창 방식으로는
 * 창 밖의 변경을 영원히 못 본다.
 *
 * **취소분은 따로 불러야 한다** (2026-10-01 실측). `status` 없이 `modifiedFrom` 만 주면 Beds24 는
 * 취소 예약을 빼고 준다(974건 중 취소 0건, 같은 커서에 `&status=cancelled` 는 319건). 웹훅을 놓친
 * 취소(API 로 만든 예약에서 실제로 봤다)가 정합성에서도 영원히 안 잡혔다.
 */
export function buildModifiedSinceUrls(baseUrl: string, sinceIso: string, status?: "cancelled") {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const since = encodeURIComponent(sinceIso);
  if (status === "cancelled") {
    return [`${normalizedBase}/bookings?modifiedFrom=${since}&status=cancelled`];
  }
  return [
    `${normalizedBase}/bookings?modifiedFrom=${since}&includeInvoiceItems=false`,
    `${normalizedBase}/bookings?modifiedFrom=${since}`,
  ];
}

/**
 * 창 훑기 URL — **형식은 하나뿐이다** (2026-09-16).
 *
 * 예전에는 파라미터 이름을 모르니 여러 형식을 차례로 시도하고 「행이 나오면 그 형식이 맞다」고
 * 판단했다. 그 판단이 **「0건」과 「형식이 안 통함」을 같은 것으로 본다.**
 *
 * 2022년 1분기(실제로 예약이 0건인 구간)를 훑다가 드러났다 — 첫 형식이 정직하게 0건을 냈는데
 * 「안 통하나 보다」 하고 다음 형식(`from`/`to`)으로 넘어갔고, Beds24 는 **모르는 파라미터를
 * 무시**하고 기본 목록 1,315건을 돌려줬다. 엉뚱한 구간의 데이터를 그 구간의 결과로 받은 셈이다.
 *
 * `arrivalTo` / `departureFrom` / `arrivalFrom` 이 실제로 동작하는 것은 확인했다(2026-09-16 실측).
 * 추측용 폴백은 득보다 실이 크므로 없앤다. **형식이 틀리면 0건이 아니라 오류로 드러나야 한다.**
 *
 * 취소분을 따로 부르는 것은 남긴다 — 창 훑기는 기본 조회에서 취소를 빼는 경우가 있다.
 */
function buildBookingsUrls(baseUrl: string, from: string, toExclusive: string, status?: "cancelled") {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const query = `arrivalTo=${toExclusive}&departureFrom=${from}${status === "cancelled" ? "&status=cancelled" : ""}`;
  return [`${normalizedBase}/bookings?${query}`];
}

async function resolveBeds24AccessToken(): Promise<Beds24AccessTokenState> {
  const env = getOptionalBeds24ApiEnv();
  if (!env) return { ok: false, skipped: "reservations:missing-env" };
  if (env.accessToken) return { ok: true, token: env.accessToken };
  if (!env.refreshToken) return { ok: false, skipped: "reservations:missing-token" };

  if (cachedBeds24AccessToken && cachedBeds24AccessToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: cachedBeds24AccessToken.token };
  }

  try {
    const response = await fetch(`${env.baseUrl.replace(/\/$/, "")}/authentication/token`, {
      method: "GET",
      headers: { accept: "application/json", refreshToken: env.refreshToken },
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ok: false,
        skipped:
          response.status === 401 || response.status === 403
            ? "reservations:refresh-token-invalid"
            : `reservations:refresh-http-${response.status}`,
      };
    }
    const json = (await response.json()) as { token?: unknown; expiresIn?: unknown };
    const token = typeof json.token === "string" && json.token.trim().length > 0 ? json.token.trim() : null;
    const expiresIn = typeof json.expiresIn === "number" && Number.isFinite(json.expiresIn) ? json.expiresIn : 3600;
    if (!token) return { ok: false, skipped: "reservations:refresh-missing-token" };
    cachedBeds24AccessToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return { ok: true, token };
  } catch {
    return { ok: false, skipped: "reservations:refresh-request-error" };
  }
}

type Beds24BookingsEnvelope = {
  count?: number;
  data?: unknown;
  items?: unknown;
  results?: unknown;
  pages?: {
    nextPageExists?: boolean;
    nextPageLink?: string;
  } | null;
};

export function mergeBookingRows(primary: JsonRecord[], secondary: JsonRecord[]) {
  const merged = new Map<string, JsonRecord>();
  for (const row of [...primary, ...secondary]) {
    // Beds24 자기 번호로 합친다. `readBeds24BookingId` 는 채널 번호(`apiReference`)를 먼저 읽어서
    // 그룹 예약의 방들이 하나로 합쳐졌다 (2026-10-01).
    const id = readBeds24OwnBookingId(row) ?? readBeds24BookingId(row);
    if (!id) continue;
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, row);
      continue;
    }
    const existingCancelled = resolveReservationStatusFromBeds24Record(existing) === "cancelled";
    const nextCancelled = resolveReservationStatusFromBeds24Record(row) === "cancelled";
    if (nextCancelled && !existingCancelled) {
      merged.set(id, row);
    }
  }
  return [...merged.values()];
}

async function fetchBookingsFromUrl(
  url: string,
  token: string,
): Promise<{
  rows: JsonRecord[];
  partial: boolean;
  failedPageUrl: string | null;
  skippedReason: string | null;
}> {
  const rows: JsonRecord[] = [];
  const seenPageUrls = new Set<string>();
  let nextUrl: string | null = url;
  let pageCount = 0;
  let failedPageUrl: string | null = null;
  let skippedReason: string | null = null;

  while (nextUrl && !seenPageUrls.has(nextUrl) && pageCount < 50) {
    seenPageUrls.add(nextUrl);
    pageCount += 1;

    const response = await fetch(nextUrl, {
      headers: { accept: "application/json", token },
      cache: "no-store",
    });
    if (!response.ok) {
      skippedReason = `reservations:http-${response.status}`;
      failedPageUrl = nextUrl;
      return { rows: [], partial: true, failedPageUrl, skippedReason };
    }

    const json = (await response.json()) as Beds24BookingsEnvelope | unknown;
    rows.push(...extractBeds24BookingCandidates(json));

    const envelope = asRecord(json) as Beds24BookingsEnvelope | null;
    const nextPageLink =
      envelope?.pages?.nextPageExists && typeof envelope.pages.nextPageLink === "string"
        ? envelope.pages.nextPageLink
        : null;
    nextUrl = nextPageLink;
  }

  return { rows, partial: false, failedPageUrl: null, skippedReason: null };
}

async function fetchBookingsVariant(
  urls: string[],
  token: string,
): Promise<{
  endpointTried: string | null;
  rows: JsonRecord[];
  partial: boolean;
  failedPageUrl: string | null;
  skippedReason: string | null;
}> {
  let lastEndpoint: string | null = null;
  let lastSkippedReason: string | null = null;

  for (const url of urls) {
    lastEndpoint = url;
    try {
      const result = await fetchBookingsFromUrl(url, token);
      if (result.partial) {
        return {
          endpointTried: url,
          rows: result.rows,
          partial: true,
          failedPageUrl: result.failedPageUrl,
          skippedReason: result.skippedReason ?? "reservations:partial-pagination-failed",
        };
      }
      if (result.rows.length > 0) {
        return {
          endpointTried: url,
          rows: result.rows,
          partial: false,
          failedPageUrl: null,
          skippedReason: null,
        };
      }
      lastSkippedReason = "reservations:no-bookings";
    } catch {
      lastSkippedReason = "reservations:request-error";
    }
  }

  return {
    endpointTried: lastEndpoint,
    rows: [],
    partial: false,
    failedPageUrl: null,
    skippedReason: lastSkippedReason ?? "reservations:no-bookings",
  };
}

async function fetchBeds24Bookings(from: string, toExclusive: string) {
  const env = getOptionalBeds24ApiEnv();
  if (!env) {
    return {
      endpointTried: null,
      rows: [] as JsonRecord[],
      skippedReason: "reservations:missing-env",
      partial: false,
      failedPageUrl: null as string | null,
    };
  }
  const tokenState = await resolveBeds24AccessToken();
  if (!tokenState.ok) {
    return {
      endpointTried: null,
      rows: [] as JsonRecord[],
      skippedReason: tokenState.skipped,
      partial: false,
      failedPageUrl: null as string | null,
    };
  }

  const activeUrls = buildBookingsUrls(env.baseUrl, from, toExclusive);
  const cancelledUrls = buildBookingsUrls(env.baseUrl, from, toExclusive, "cancelled");

  const activeResult = await fetchBookingsVariant(activeUrls, tokenState.token);
  const cancelledResult = await fetchBookingsVariant(cancelledUrls, tokenState.token);
  const rows = mergeBookingRows(activeResult.rows, cancelledResult.rows);

  const partial = activeResult.partial || cancelledResult.partial;
  const failedPageUrl = activeResult.failedPageUrl ?? cancelledResult.failedPageUrl;
  const endpointTried = cancelledResult.endpointTried ?? activeResult.endpointTried;
  const skippedReason =
    rows.length > 0
      ? null
      : activeResult.skippedReason ?? cancelledResult.skippedReason ?? "reservations:no-bookings";

  return {
    endpointTried,
    rows,
    skippedReason,
    partial: partial && rows.length === 0,
    failedPageUrl,
  };
}

/**
 * 커서를 읽는다. 없으면 `null` — 호출부가 창 훑기로 떨어진다.
 *
 * 커서가 없을 수 있는 경우: 첫 실행, 또는 커서가 깨진 경우.
 */
async function readModifiedCursor(supabase: SupabaseClient<Database>): Promise<string | null> {
  const { data, error } = await supabase
    .from("beds24_sync_state")
    .select("last_modified_cursor")
    .eq("id", true)
    .maybeSingle();
  if (error) {
    console.error("[beds24/reconcile] cursor read failed", error.message);
    return null;
  }
  return (data as { last_modified_cursor: string | null } | null)?.last_modified_cursor ?? null;
}

/**
 * 커서를 옮긴다. **수집이 성공했을 때만** 부른다.
 *
 * 실패했는데 옮기면 그 사이의 변경을 영원히 건너뛴다 — 조용히 빠지는 종류라 제일 나쁘다.
 */
async function writeModifiedCursor(
  supabase: SupabaseClient<Database>,
  cursorIso: string,
  fullSweep: boolean,
): Promise<void> {
  const patch: Database["public"]["Tables"]["beds24_sync_state"]["Update"] = {
    last_modified_cursor: cursorIso,
    updated_at: new Date().toISOString(),
    ...(fullSweep ? { last_full_sweep_at: new Date().toISOString() } : {}),
  };
  const { error } = await supabase.from("beds24_sync_state").update(patch).eq("id", true);
  if (error) console.error("[beds24/reconcile] cursor write failed", error.message);
}

/** 겹침 여유를 뺀 기준 시각. */
function cursorWithOverlap(cursorIso: string): string {
  const base = new Date(cursorIso).getTime();
  const shifted = new Date(base - MODIFIED_CURSOR_OVERLAP_MINUTES * 60_000);
  // Beds24 는 `YYYY-MM-DDTHH:MM:SS` 를 받는다. 밀리초·Z 를 붙이면 거절당한다.
  return shifted.toISOString().slice(0, 19);
}

async function fetchBeds24BookingsModifiedSince(sinceIso: string) {
  const env = getOptionalBeds24ApiEnv();
  if (!env) {
    return {
      endpointTried: null,
      rows: [] as JsonRecord[],
      partial: false,
      failedPageUrl: null,
      skippedReason: "reservations:missing-env",
    };
  }
  const tokenState = await resolveBeds24AccessToken();
  if (!tokenState.ok) {
    return {
      endpointTried: null,
      rows: [] as JsonRecord[],
      partial: false,
      failedPageUrl: null,
      skippedReason: tokenState.skipped,
    };
  }
  const activeResult = await fetchBookingsVariant(buildModifiedSinceUrls(env.baseUrl, sinceIso), tokenState.token);
  const cancelledResult = await fetchBookingsVariant(
    buildModifiedSinceUrls(env.baseUrl, sinceIso, "cancelled"),
    tokenState.token,
  );
  return combineModifiedSinceResults(activeResult, cancelledResult);
}

type BookingsVariantResult = Awaited<ReturnType<typeof fetchBookingsVariant>>;

/**
 * 증분 경로의 활성분 + 취소분을 합친다.
 *
 * 창 훑기와 달리 **어느 한쪽이라도 실패하면(끊김·요청 오류) 전체를 partial 로 본다** — 커서가 그대로 남아야 다음 번에
 * 같은 구간을 다시 묻는다. 한쪽만 반영하고 커서를 옮기면 그 사이 취소가 영원히 빠진다.
 */
export function combineModifiedSinceResults(active: BookingsVariantResult, cancelled: BookingsVariantResult) {
  const isEmptyOk = (reason: string | null) => reason === null || reason === "reservations:no-bookings";
  const failed = (result: BookingsVariantResult) => result.partial || !isEmptyOk(result.skippedReason);
  const partial = failed(active) || failed(cancelled);
  const rows = partial ? [] : mergeBookingRows(active.rows, cancelled.rows);
  const skippedReason = partial
    ? (failed(active) ? active.skippedReason : cancelled.skippedReason) ?? "reservations:partial-pagination-failed"
    : rows.length > 0
      ? null
      : "reservations:no-bookings";
  return {
    endpointTried: cancelled.endpointTried ?? active.endpointTried,
    rows,
    partial,
    failedPageUrl: active.failedPageUrl ?? cancelled.failedPageUrl,
    skippedReason,
  };
}

/** 대표 예약(masterId 없음) 먼저, 그다음 Beds24 번호 오름차순. 번호가 없으면 맨 뒤. */
function compareBookingPriority(
  a: { beds24BookingId: string | null; masterId: string | null },
  b: { beds24BookingId: string | null; masterId: string | null },
) {
  const aChild = a.masterId ? 1 : 0;
  const bChild = b.masterId ? 1 : 0;
  if (aChild !== bChild) return aChild - bChild;
  const aId = Number(a.beds24BookingId ?? Number.POSITIVE_INFINITY);
  const bId = Number(b.beds24BookingId ?? Number.POSITIVE_INFINITY);
  if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return aId - bId;
  return (a.beds24BookingId ?? "").localeCompare(b.beds24BookingId ?? "");
}

/**
 * 후보 키(평문 · `::bid::`)를 **이미 쓰고 있는 행**과 그 행의 Beds24 번호를 읽는다.
 * 반환: `조직:채널번호` → 그 채널 번호로 저장된 행들(후보 키에 해당하는 것만).
 *
 * 정확한 키 `in` 조회라 창 훑기 수천 건도 몇 번의 왕복으로 끝난다.
 */
async function readExistingKeyOwners(
  supabase: SupabaseClient<Database>,
  candidates: Array<{ organizationId: string; key: string }>,
): Promise<Map<string, StoredReservationKeyCandidate[]>> {
  const owners = new Map<string, StoredReservationKeyCandidate[]>();
  const keysByOrg = new Map<string, Set<string>>();
  for (const { organizationId, key } of candidates) {
    const set = keysByOrg.get(organizationId) ?? new Set<string>();
    set.add(key);
    keysByOrg.set(organizationId, set);
  }

  const CHUNK = 150;
  for (const [organizationId, keySet] of keysByOrg) {
    const keys = [...keySet];
    for (let offset = 0; offset < keys.length; offset += CHUNK) {
      const result = await supabase
        .from("reservations")
        .select("source_reservation_id, raw_book_id:raw_payload->>bookId, raw_id:raw_payload->>id")
        .eq("organization_id", organizationId)
        .in("source_reservation_id", keys.slice(offset, offset + CHUNK));
      if (result.error) {
        throw new Error(`beds24 reservations backfill key owner query failed: ${result.error.message}`);
      }
      for (const row of (result.data ?? []) as unknown as Array<{
        source_reservation_id: string;
        raw_book_id: string | null;
        raw_id: string | null;
      }>) {
        const mapKey = `${organizationId}:${toOriginalReservationId(row.source_reservation_id)}`;
        const list = owners.get(mapKey) ?? [];
        list.push({
          source_reservation_id: row.source_reservation_id,
          bookingId: row.raw_book_id?.trim() || row.raw_id?.trim() || null,
        });
        owners.set(mapKey, list);
      }
    }
  }
  return owners;
}

function isIsoDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function backfillBeds24Reservations(
  supabase: SupabaseClient<Database>,
  options?: { organizationId?: string; dryRun?: boolean; from?: string; toExclusive?: string },
): Promise<Beds24ReservationsBackfillResult> {
  // 기본 구간 = 이번 + 다음 운영 월(일일 정합 크론과 웹훅이 사용).
  // 한 번짜리 넓은 따라잡기(예: 개발 backfill 라우트)는 두 경계를 모두 덮어써서 먼 미래의
  // 예약까지 가져올 수 있다(좁은 구간으로는 닿지 않음). 두 경계는 함께 줘야 한다.
  const explicitFrom = isIsoDate(options?.from) ? options.from : null;
  const explicitTo = isIsoDate(options?.toExclusive) ? options.toExclusive : null;
  const explicitWindow = explicitFrom !== null && explicitTo !== null;
  const { from, toExclusive } =
    explicitFrom !== null && explicitTo !== null
      ? { from: explicitFrom, toExclusive: explicitTo }
      : getOperationalWindow();

  /**
   * **기본은 「지난번 이후 바뀐 것만」이다** (2026-09-16).
   *
   * 예전에는 날짜 창(당월 + 2개월)만 훑었다. 그런데 예약 웹훅은 날짜와 무관하게 들어와서 창 밖
   * 예약이 이미 223건 쌓여 있었고(가장 먼 것 2027-05-03), 그것들은 **안전망 밖**이었다 — 웹훅을
   * 한 번 놓치면 영영 안 들어온다. 2026-09-11 에 크리스마스 예약 3건이 그렇게 빠져 있었다.
   *
   * 창을 넓히는 대신 **질문을 바꿨다.** `modifiedFrom` 은 기간 제한이 없어서 2022년 예약이 오늘
   * 취소돼도 잡히고, 바뀐 게 없으면 거의 공짜다(실측: 24시간치 34건, 요청 비용 1).
   *
   * 창 훑기는 **대비책으로 남는다**:
   *  · 커서가 없을 때(첫 실행·커서 손상)
   *  · 호출부가 기간을 명시했을 때(일회성 넓은 백필)
   */
  const cursor = explicitWindow ? null : await readModifiedCursor(supabase);
  const useIncremental = cursor !== null;
  // 커서는 **수집을 시작하기 전** 시각으로 잡는다. 수집하는 동안 바뀐 것은 다음 번에 잡혀야 한다.
  const runStartedAt = new Date().toISOString();

  const fetched = useIncremental
    ? await fetchBeds24BookingsModifiedSince(cursorWithOverlap(cursor))
    : await fetchBeds24Bookings(from, toExclusive);
  const { endpointTried, rows, skippedReason, partial, failedPageUrl } = fetched;

  // 바뀐 것이 없으면 정상이다 — 커서만 옮기고 끝낸다. 창 방식에서는 「0건 = 이상」이었지만
  // 증분에서는 「0건 = 조용한 날」이라, 이것을 실패로 보고하면 매번 빨간불이 된다.
  if (useIncremental && !partial && rows.length === 0 && skippedReason === "reservations:no-bookings") {
    await writeModifiedCursor(supabase, runStartedAt, false);
    return {
      attempted: true,
      incremental: true,
      endpointTried,
      from,
      toExclusive,
      partial: false,
      failedPageUrl: null,
      fetchedRows: 0,
      upsertedRows: 0,
      cancelledUpsertedRows: 0,
      skippedRows: 0,
      recoveredRows: 0,
      skipped: [],
      skippedReasons: [],
    };
  }
  if (rows.length === 0 || partial) {
    const skipReasons = [skippedReason ?? "reservations:no-bookings"];
    if (partial) {
      skipReasons.unshift("reservations:partial-pagination-failed");
    }
    return {
      attempted: skippedReason !== "reservations:missing-env",
      incremental: useIncremental,
      endpointTried,
      from,
      toExclusive,
      partial,
      failedPageUrl,
      fetchedRows: 0,
      upsertedRows: 0,
      cancelledUpsertedRows: 0,
      skippedRows: 0,
      recoveredRows: 0,
      skipped: skipReasons,
      skippedReasons: [],
    };
  }

  let propertyQuery = supabase
    .from("properties")
    .select("organization_id, name, external_property_id")
    .eq("external_provider", "beds24")
    .not("external_property_id", "is", null);

  if (options?.organizationId) {
    propertyQuery = propertyQuery.eq("organization_id", options.organizationId);
  }

  const propertiesResult = await propertyQuery;
  if (propertiesResult.error) {
    throw new Error(`beds24 reservations backfill property query failed: ${propertiesResult.error.message}`);
  }

  const propertyRows = (propertiesResult.data ?? []) as Array<{
    organization_id: string;
    name: string;
    external_property_id: string | null;
  }>;
  const orgByExternalPropertyId = new Map<string, string>();
  const propertyNameByExternalPropertyId = new Map<string, string>();
  for (const row of propertyRows) {
    const ext = row.external_property_id?.trim();
    if (!ext) continue;
    orgByExternalPropertyId.set(ext, row.organization_id);
    propertyNameByExternalPropertyId.set(ext, row.name);
  }

  const bookingRows: BookingRow[] = [];
  const skippedReasons: BackfillSkippedReason[] = [];

  for (const row of rows) {
    const sourceReservationId = readString(row, [
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
    const checkInDate = toIsoDate(readString(row, ["firstNight", "first_night", "checkIn", "arrival", "startDate"]));
    const checkOutDate =
      lastNightToCheckout(readString(row, ["lastNight", "last_night"])) ??
      toIsoDate(readString(row, ["checkOut", "departure", "endDate"]));
    const propertyExternalId = readString(row, ["propId", "prop_id", "propertyId", "property_id"]);
    const propertyName = readString(row, ["propName", "prop_name", "propertyName", "property_name"]);
    // 이 계정의 실제 Beds24 /bookings 페이로드는 조인 가능한 방
    // 식별자를 roomId 에 담는다. unitId 는 로컬 유닛 인덱스이므로 폴백으로만 써야 한다.
    const externalRoomId = readString(row, ["roomId", "room_id", "unitId", "unit_id"]);
    const roomLabel = readString(row, ["unitName", "unit_name", "roomName", "room_name", "roomLabel"]);
    const guestFirstName = readString(row, ["guestFirstName", "guest_first_name", "firstName", "first_name"]);
    const guestLastName = readString(row, ["guestLastName", "guest_last_name", "lastName", "last_name"]);
    const guestFullName = [guestFirstName, guestLastName].filter(Boolean).join(" ").trim();
    const guestName = guestFullName.length > 0 ? guestFullName : readString(row, ["guestName", "customerName", "name"]);
    const source = normalizeReservationSource(
      readString(row, ["referer", "source", "channel", "bookingSource", "booking_source"]) ?? "beds24",
    );
    const status = resolveReservationStatusFromBeds24Record(row);

    /**
     * **이름이 없다고 예약을 버리지 않는다** (2026-09-16).
     *
     * 오래된 예약은 OTA 가 개인정보 보관기간이 지나면 이름을 지운다 — 2022년 예약을 받아 보면
     * `firstName: ""`, `lastName: ""` 이다. 그런데 `guest_name` 이 필수라 **189건이 통째로
     * 거부됐다.** 날짜·건물·금액은 멀쩡한데도.
     *
     * 이름이 없는 것은 **실제 숙박이 없었다는 뜻이 아니다.** 그 예약은 매출을 냈고 객실을
     * 차지했다. 버리면 매출과 가동률이 조용히 낮아진다 — 안 보이는 것보다 나쁘다.
     *
     * 그래서 자리를 채우고 살린다. 방 이름을 못 찾을 때와 같은 표기를 쓴다.
     * 정말로 못 쓰는 것(식별자·날짜 없음)만 버린다.
     */
    const resolvedGuestName = guestName ?? UNKNOWN_GUEST_NAME;

    if (!sourceReservationId || !checkInDate || !checkOutDate) {
      const missing = [
        !sourceReservationId && "sourceReservationId",
        !checkInDate && "checkInDate",
        !checkOutDate && "checkOutDate",
      ].filter(Boolean);
      console.warn("[beds24/backfill] skip:missing_required_fields", {
        sourceReservationId,
        guestName,
        propertyName,
        propertyExternalId,
        checkInDate,
        checkOutDate,
        missing,
      });
      skippedReasons.push({ sourceReservationId, guestName, propertyName, checkInDate, reason: "missing_required_fields" });
      continue;
    }

    // 예약별 페이로드의 propName 보다 운영자가 관리하는 property MASTER 이름(외부
    // property id 로 해석)을 우선한다. Beds24 응답은
    // propName 이 일관되지 않다 — 일부 예약은 빠져 있고 원시
    // property id 로 폴백한다 — 그래서 페이로드를 믿으면 한 건물("Kabukicho")이
    // 둘("Kabukicho" + "176431")로 갈라졌다. 마스터 이름이 유일한 기준이다.
    // docs/planning/01-decision-log.md → 2026-07-22 참고.
    const masterPropertyName = propertyExternalId
      ? propertyNameByExternalPropertyId.get(propertyExternalId) ?? null
      : null;
    const resolvedPropertyName = masterPropertyName || propertyName || null;
    if (!resolvedPropertyName) {
      console.warn("[beds24/backfill] skip:property_name_unresolved", {
        sourceReservationId,
        propertyExternalId,
        guestName,
        checkInDate,
      });
      skippedReasons.push({ sourceReservationId, guestName, propertyName: null, checkInDate, reason: "property_name_unresolved" });
      continue;
    }

    bookingRows.push({
      externalRoomId,
      sourceReservationId,
      beds24BookingId: readBeds24OwnBookingId(row),
      masterId: readBeds24MasterId(row),
      source,
      propertyExternalId,
      propertyName: resolvedPropertyName,
      roomLabel: roomLabel ?? "",
      guestName: resolvedGuestName,
      checkInDate,
      checkOutDate,
      status,
      rawPayload: sanitizeRawPayload(row),
    });
  }

  let upsertedRows = 0;
  let cancelledUpsertedRows = 0;
  let skippedRows = 0;
  const dryRun = options?.dryRun ?? false;

  const roomResult = await supabase
    .from("rooms")
    .select("organization_id, external_room_id, room_label")
    .eq("external_provider", "beds24")
    .not("external_room_id", "is", null);
  if (roomResult.error) {
    throw new Error(`beds24 reservations backfill room query failed: ${roomResult.error.message}`);
  }
  const roomRows = (roomResult.data ?? []) as Array<{
    organization_id: string;
    external_room_id: string | null;
    room_label: string;
  }>;
  const roomLabelByExternalRoom = new Map<string, string>();
  for (const row of roomRows) {
    const ext = row.external_room_id?.trim();
    if (!ext) continue;
    roomLabelByExternalRoom.set(`${row.organization_id}:${ext}`, row.room_label);
  }

  // 모든 예약을 먼저 메모리에서 최종 예약 행으로 풀고, 그다음
  // 한꺼번에 쓴다. 행마다 upsert(왕복 한 번씩)가 병목이었다: 수백 번의
  // 서버리스 함수 순차 왕복이 60초 타임아웃을 넘겼다.
  // 청크로 나눈 벌크 upsert 는 이를 몇 번의 왕복으로 줄인다.
  type PreparedRow = {
    row: Database["public"]["Tables"]["reservations"]["Insert"];
    cancelled: boolean;
  };
  const preparedByKey = new Map<string, PreparedRow>();

  const resolvedBookings: Array<{ organizationId: string; booking: BookingRow; finalRoomLabel: string }> = [];
  for (const booking of bookingRows) {
    const organizationId =
      (booking.propertyExternalId ? orgByExternalPropertyId.get(booking.propertyExternalId) : undefined) ??
      options?.organizationId;
    if (!organizationId) {
      skippedRows += 1;
      console.warn("[beds24/backfill] skip:organization_id_not_found", {
        sourceReservationId: booking.sourceReservationId,
        propertyExternalId: booking.propertyExternalId,
        propertyName: booking.propertyName,
        guestName: booking.guestName,
        checkInDate: booking.checkInDate,
      });
      skippedReasons.push({
        sourceReservationId: booking.sourceReservationId,
        guestName: booking.guestName,
        propertyName: booking.propertyName,
        checkInDate: booking.checkInDate,
        reason: "organization_id_not_found",
      });
      continue;
    }

    const resolvedRoomLabelFromExternalId =
      booking.externalRoomId && roomLabelByExternalRoom.has(`${organizationId}:${booking.externalRoomId}`)
        ? roomLabelByExternalRoom.get(`${organizationId}:${booking.externalRoomId}`) ?? null
        : null;
    const resolvedRoomLabel = (resolvedRoomLabelFromExternalId ?? booking.roomLabel).trim();

    // 방 라벨을 풀 수 없으면 조용히 버리지 않고 "(unknown)" 으로 저장한다.
    // 예약 레코드가 보존되고, 나중에 recoverReservationsRoomLabels 가 고칠 수 있다.
    const finalRoomLabel = resolvedRoomLabel || "(unknown)";
    if (!resolvedRoomLabel) {
      console.warn("[beds24/backfill] warn:room_label_unresolved — storing as (unknown)", {
        sourceReservationId: booking.sourceReservationId,
        guestName: booking.guestName,
        propertyName: booking.propertyName,
        externalRoomId: booking.externalRoomId,
        checkInDate: booking.checkInDate,
      });
      skippedReasons.push({
        sourceReservationId: booking.sourceReservationId,
        guestName: booking.guestName,
        propertyName: booking.propertyName,
        checkInDate: booking.checkInDate,
        reason: "room_label_unresolved_stored_as_unknown",
      });
    }

    resolvedBookings.push({ organizationId, booking, finalRoomLabel });
  }

  // 키 충돌 판정용 — 평문 키 / `::bid::` 키를 **이미 누가 쓰고 있는가** (2026-10-01).
  // 같은 채널 번호·같은 방에 다른 Beds24 예약이 있을 때만 꼬리표 키로 나눈다(`chooseStoredReservationId`).
  const existingKeyOwners = await readExistingKeyOwners(
    supabase,
    resolvedBookings.flatMap(({ organizationId, booking, finalRoomLabel }) => {
      const keys = [toStoredReservationId(booking.sourceReservationId, finalRoomLabel)];
      if (booking.beds24BookingId) {
        keys.push(toStoredReservationId(booking.sourceReservationId, finalRoomLabel, booking.beds24BookingId));
      }
      return keys.map((key) => ({ organizationId, key }));
    }),
  );

  // 대표 예약(masterId 없음)이 먼저, 그다음 번호 순 — 같은 방을 두 예약이 나눠 쓸 때 평문 키를
  // 누가 갖는지가 실행마다 바뀌지 않게 한다.
  resolvedBookings.sort((a, b) => compareBookingPriority(a.booking, b.booking));

  for (const { organizationId, booking, finalRoomLabel } of resolvedBookings) {
    const ownersKey = `${organizationId}:${toOriginalReservationId(booking.sourceReservationId)}`;
    const owners = existingKeyOwners.get(ownersKey) ?? [];
    const storedReservationId = chooseStoredReservationId({
      sourceReservationId: booking.sourceReservationId,
      roomLabel: finalRoomLabel,
      bookingId: booking.beds24BookingId,
      existingRows: owners,
    });
    if (!owners.some((row) => row.source_reservation_id === storedReservationId)) {
      owners.push({ source_reservation_id: storedReservationId, bookingId: booking.beds24BookingId });
      existingKeyOwners.set(ownersKey, owners);
    }
    // 테이블의 유니크 키로 중복을 제거해서 벌크 문 하나가 같은 행을
    // 두 번 건드리지 않게 한다(Postgres ON CONFLICT 가 거부함). 마지막 쓰기가 이긴다.
    preparedByKey.set(`${organizationId}:${booking.source}:${storedReservationId}`, {
      cancelled: booking.status === "cancelled",
      row: {
        organization_id: organizationId,
        source: booking.source,
        source_reservation_id: storedReservationId,
        property_name: booking.propertyName,
        room_label: finalRoomLabel,
        guest_name: booking.guestName,
        check_in_date: booking.checkInDate,
        check_out_date: booking.checkOutDate,
        status: booking.status,
        raw_payload: booking.rawPayload,
      },
    });
  }

  const prepared = [...preparedByKey.values()];

  if (dryRun) {
    upsertedRows = prepared.length;
    cancelledUpsertedRows = prepared.filter((item) => item.cancelled).length;
  } else {
    const CHUNK_SIZE = 500;
    for (let offset = 0; offset < prepared.length; offset += CHUNK_SIZE) {
      const chunk = prepared.slice(offset, offset + CHUNK_SIZE);
      const upsertResult = await supabase
        .from("reservations")
        .upsert(chunk.map((item) => item.row), {
          onConflict: "organization_id,source,source_reservation_id",
        });

      if (upsertResult.error) {
        skippedRows += chunk.length;
        console.error("[beds24/backfill] skip:bulk_upsert_failed", {
          chunkSize: chunk.length,
          error: upsertResult.error.message,
        });
        skippedReasons.push({
          sourceReservationId: null,
          guestName: null,
          propertyName: null,
          checkInDate: null,
          reason: `bulk_upsert_failed:${upsertResult.error.message}`,
        });
        continue;
      }
      upsertedRows += chunk.length;
      cancelledUpsertedRows += chunk.filter((item) => item.cancelled).length;
    }
  }

  if (process.env.NODE_ENV === "development") {
    const trueSkipped = skippedRows + (bookingRows.length - upsertedRows - skippedRows);
    if (rows.length > 0 && trueSkipped > rows.length * 0.1) {
      console.warn("[beds24/backfill] high skip rate detected", {
        fetchedRows: rows.length,
        parsedRows: bookingRows.length,
        upsertedRows,
        skippedRows: trueSkipped,
        skipRate: `${Math.round((trueSkipped / rows.length) * 100)}%`,
      });
    }
  }

  let recoveredRows = 0;
  if (!dryRun) {
    try {
      const recoveryResult = await recoverReservationsRoomLabels(supabase, options?.organizationId);
      recoveredRows = recoveryResult.recovered;
      if (recoveryResult.errors.length > 0) {
        console.error("[beds24/backfill] recovery routine encountered errors", recoveryResult.errors);
      }
    } catch (err) {
      console.error("[beds24/backfill] failed to run recovery routine", err);
    }
  }

  // **여기까지 왔으면 성공이다 — 그때만 커서를 옮긴다.**
  // 실패했는데 옮기면 그 사이의 변경을 영원히 건너뛴다. 조용히 빠지는 종류라 제일 나쁘다.
  // 기간을 명시한 일회성 백필은 커서를 건드리지 않는다 — 그건 과거를 메우는 작업이지
  // 「어디까지 봤는가」를 앞당기는 작업이 아니다.
  if (!explicitWindow) {
    await writeModifiedCursor(supabase, runStartedAt, !useIncremental);
  }

  if (!dryRun && upsertedRows + recoveredRows > 0) {
    await signalBeds24Change(
      [options?.organizationId, ...prepared.map((item) => item.row.organization_id)],
      "reservations",
    );
  }

  return {
    attempted: true,
    incremental: useIncremental,
    endpointTried,
    from,
    toExclusive,
    partial: false,
    failedPageUrl: null,
    fetchedRows: rows.length,
    upsertedRows,
    cancelledUpsertedRows,
    skippedRows: skippedRows + Math.max(0, bookingRows.length - upsertedRows - skippedRows),
    recoveredRows,
    skipped: [],
    skippedReasons,
  };
}

/**
 * 방 이름을 바로잡을 때 옮겨 갈 키를 고른다 (2026-10-01).
 *
 * 옮겨 갈 자리에 이미 행이 있으면 예전엔 무조건 「같은 예약의 중복」으로 보고 **지금 행을 지웠다.**
 * 그 자리의 주인이 같은 채널 번호의 **다른 Beds24 예약**(그룹의 다른 방)이면 멀쩡한 예약이 사라진다.
 * 이제는 같은 Beds24 예약일 때만 「중복」(`sameBookingRow`)이고, 아니면 `::bid::` 키로 비켜 간다.
 *
 * `source` 가 있으면 그 채널 행끼리만 본다(유니크 키가 채널을 포함한다). `null` 이면 채널 무관.
 */
async function resolveRelabelTarget(
  supabase: SupabaseClient<Database>,
  params: {
    organizationId: string;
    source: string | null;
    reservationId: string;
    originalId: string;
    roomLabel: string;
    bookingId: string | null;
  },
): Promise<{ correctedSourceId: string; sameBookingRow: { id: string } | null } | { error: string }> {
  const plainKey = toStoredReservationId(params.originalId, params.roomLabel);
  const keys = params.bookingId
    ? [plainKey, toStoredReservationId(params.originalId, params.roomLabel, params.bookingId)]
    : [plainKey];

  let query = supabase
    .from("reservations")
    .select("id, source_reservation_id, raw_book_id:raw_payload->>bookId, raw_id:raw_payload->>id")
    .eq("organization_id", params.organizationId)
    .in("source_reservation_id", keys)
    .neq("id", params.reservationId);
  if (params.source !== null) query = query.eq("source", params.source);
  const result = await query;
  if (result.error) return { error: result.error.message };

  const rows = ((result.data ?? []) as unknown as Array<{
    id: string;
    source_reservation_id: string;
    raw_book_id: string | null;
    raw_id: string | null;
  }>).map((row) => ({
    id: row.id,
    source_reservation_id: row.source_reservation_id,
    bookingId: row.raw_book_id?.trim() || row.raw_id?.trim() || null,
  }));

  const correctedSourceId = chooseStoredReservationId({
    sourceReservationId: params.originalId,
    roomLabel: params.roomLabel,
    bookingId: params.bookingId,
    existingRows: rows,
  });
  const sameBookingRow =
    rows.find(
      (row) =>
        row.source_reservation_id === correctedSourceId && isSameBeds24Booking(row.bookingId, params.bookingId),
    ) ?? null;
  return { correctedSourceId, sameBookingRow };
}

export async function recoverReservationsRoomLabels(
  supabase: SupabaseClient<Database>,
  organizationId?: string,
): Promise<{ processed: number; recovered: number; errors: string[] }> {
  // 1. 활성 방을 가져와 external_room_id -> room_label 매핑을 만든다
  let roomQuery = supabase
    .from("rooms")
    .select("organization_id, external_room_id, room_label")
    .eq("external_provider", "beds24")
    .not("external_room_id", "is", null);

  if (organizationId) {
    roomQuery = roomQuery.eq("organization_id", organizationId);
  }

  const roomResult = await roomQuery;
  if (roomResult.error) {
    return { processed: 0, recovered: 0, errors: [roomResult.error.message] };
  }

  const roomMap = new Map<string, string>(); // 키: "orgId:externalRoomId", 값: room_label
  const recoveryRoomRows = (roomResult.data ?? []) as Array<{
    organization_id: string;
    external_room_id: string | null;
    room_label: string;
  }>;
  for (const r of recoveryRoomRows) {
    const ext = r.external_room_id?.trim();
    if (!ext) continue;
    roomMap.set(`${r.organization_id}:${ext}`, r.room_label);
  }

  // 2. 매핑 불일치를 확인하려고 기존 예약을 가져온다.
  // source = "beds24" 로 거르지 않는다: 실제 행은 Booking.com / Airbnb 같은 채널 이름으로
  // 저장되므로 과거의 깨진 행이 건너뛰어지게 된다.
  //
  // **페이지로 끝까지 읽는다.** PostgREST 는 상한을 주지 않으면 **1,000행**만 돌려준다 — 조용히,
  // 오류 없이. 예약이 3,505건인 상태에서 복구를 돌렸더니 앞의 1,000건만 보고 나머지는 손도 대지
  // 못했다(2026-09-11, 스테이아리 건물 데이터를 채우다 발견). 복구는 「고칠 게 없다」와 「보지
  // 못했다」가 겉보기에 같아서, 상한에 걸린 줄 모르고 넘어가기 쉽다.
  //
  // **필요한 키만, 키셋으로 읽는다**(2026-10-19). 예전엔 `raw_payload` 통째(17k행 · 25MB)를 OFFSET 1000행씩
  // 읽었다 — 매 실행 18번 직렬, 뒤 페이지일수록 앞 행을 다시 훑었다. 방 번호 키만 뽑고 `id > 마지막` 으로 넘긴다.
  // 고칠 행(드물다)만 원문을 따로 읽어 Beds24 예약번호를 꺼낸다.
  const PAGE = 1000;
  const reservationRows: Array<{
    id: string;
    organization_id: string;
    source: string;
    source_reservation_id: string;
    room_label: string;
    raw_room_id: string | null;
  }> = [];

  let lastId: string | null = null;
  for (;;) {
    let resQuery = supabase
      .from("reservations")
      .select(
        "id, organization_id, source, source_reservation_id, room_label, " +
          "k1:raw_payload->roomId, k2:raw_payload->room_id, k3:raw_payload->unitId, k4:raw_payload->unit_id",
      )
      .not("raw_payload", "is", null)
      .order("id", { ascending: true })
      .limit(PAGE);

    if (organizationId) {
      resQuery = resQuery.eq("organization_id", organizationId);
    }
    if (lastId) {
      resQuery = resQuery.gt("id", lastId);
    }

    const page = await resQuery;
    if (page.error) {
      return { processed: 0, recovered: 0, errors: [page.error.message] };
    }
    const rows = (page.data ?? []) as unknown as Array<{
      id: string;
      organization_id: string;
      source: string;
      source_reservation_id: string;
      room_label: string;
      k1: unknown;
      k2: unknown;
      k3: unknown;
      k4: unknown;
    }>;
    for (const row of rows) {
      reservationRows.push({
        id: row.id,
        organization_id: row.organization_id,
        source: row.source,
        source_reservation_id: row.source_reservation_id,
        room_label: row.room_label,
        raw_room_id: readString({ roomId: row.k1, room_id: row.k2, unitId: row.k3, unit_id: row.k4 }, [
          "roomId",
          "room_id",
          "unitId",
          "unit_id",
        ]),
      });
    }
    if (rows.length < PAGE) break;
    lastId = rows[rows.length - 1].id;
  }

  let processed = 0;
  let recovered = 0;
  const errors: string[] = [];
  for (const res of reservationRows) {
    processed++;
    // 과거 행은 페이로드 형태가 섞여 있을 수 있지만 조인 가능한 방 키는
    // 있으면 roomId 다. unitId 는 최후의 폴백으로만 둔다.
    const rawRoomId = res.raw_room_id;
    if (!rawRoomId) continue;

    const expectedRoomLabel = roomMap.get(`${res.organization_id}:${rawRoomId}`);
    if (expectedRoomLabel && expectedRoomLabel !== res.room_label) {
      const rawResult = await supabase.from("reservations").select("raw_payload").eq("id", res.id).maybeSingle();
      if (rawResult.error) {
        errors.push(`Failed to read raw payload for ${res.id}: ${rawResult.error.message}`);
        continue;
      }
      const raw = asRecord((rawResult.data as { raw_payload: unknown } | null)?.raw_payload);
      if (!raw) continue;
      // 해석된 방 라벨로 올바른 source_reservation_id 를 계산한다.
      // 중복 행을 막기 위해서다: room_label 만 고치고 source_reservation_id 를
      // "...::room::(unknown)" 으로 두면 다음 backfill/웹훅이 기존 행을 갱신하지 않고
      // 새 "...::room::5F" 행을 만들게 된다.
      const originalId = toOriginalReservationId(res.source_reservation_id);
      const target = await resolveRelabelTarget(supabase, {
        organizationId: res.organization_id,
        source: res.source,
        reservationId: res.id,
        originalId,
        roomLabel: expectedRoomLabel,
        bookingId: readBeds24OwnBookingId(raw),
      });
      if ("error" in target) {
        errors.push(`Failed to resolve relabel target for ${res.id}: ${target.error}`);
        continue;
      }
      const correctedSourceId = target.correctedSourceId;
      const conflictRow = target.sameBookingRow;

      if (conflictRow) {
        // 같은 Beds24 예약의 제대로 라벨링된 행이 이미 있다 — 오래된 행을 삭제한다.
        const keptId = conflictRow.id;
        console.warn("[beds24/recovery] dedup: deleting stale (unknown) row in favor of resolved row", {
          staleId: res.id,
          keptId,
          originalId,
          correctedSourceId,
        });

        // **지우기 전에 리뷰를 옮긴다.** `external_reviews.reservation_id` 의 FK 는 `SET NULL` 이라
        // 그냥 지우면 오류 없이 리뷰의 예약 연결만 끊긴다 — 같은 예약의 살아있는 행이 바로 옆에
        // 있는데도. 2026-09-11 스테이아리 정리에서 실제로 2건이 걸렸다.
        const reviewResult = await supabase
          .from("external_reviews")
          .update({ reservation_id: keptId })
          .eq("reservation_id", res.id);
        if (reviewResult.error) {
          // 옮기지 못했으면 지우지 않는다. 중복 한 행보다 끊긴 리뷰가 나쁘다.
          errors.push(
            `Failed to move reviews off stale reservation ${res.id}: ${reviewResult.error.message}`,
          );
          continue;
        }

        const deleteResult = await supabase
          .from("reservations")
          .delete()
          .eq("id", res.id);
        if (deleteResult.error) {
          errors.push(`Failed to delete stale reservation ${res.id}: ${deleteResult.error.message}`);
        } else {
          recovered++;
        }
      } else {
        // 충돌 없음 — room_label 과 source_reservation_id 를 원자적으로 갱신한다.
        const updateResult = await supabase
          .from("reservations")
          .update({ room_label: expectedRoomLabel, source_reservation_id: correctedSourceId })
          .eq("id", res.id);
        if (updateResult.error) {
          errors.push(`Failed to update reservation ${res.id}: ${updateResult.error.message}`);
        } else {
          recovered++;
        }
      }
    }
  }

  return { processed, recovered, errors };
}

export async function recoverReservationRoomLabelById(
  supabase: SupabaseClient<Database>,
  reservationId: string,
  organizationId: string,
): Promise<{ recovered: boolean; roomLabel: string | null }> {
  const reservationResult = await supabase
    .from("reservations")
    .select("id, organization_id, source, source_reservation_id, room_label, raw_payload")
    .eq("id", reservationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (reservationResult.error || !reservationResult.data) {
    return { recovered: false, roomLabel: null };
  }

  const reservation = reservationResult.data as {
    id: string;
    organization_id: string;
    source: string;
    source_reservation_id: string;
    room_label: string;
    raw_payload: unknown;
  };

  const raw = asRecord(reservation.raw_payload);
  if (!raw) return { recovered: false, roomLabel: null };

  const rawRoomId = readString(raw, ["roomId", "room_id", "unitId", "unit_id"]);
  if (!rawRoomId) return { recovered: false, roomLabel: null };

  const roomResult = await supabase
    .from("rooms")
    .select("room_label")
    .eq("organization_id", organizationId)
    .eq("external_room_id", rawRoomId)
    .limit(1)
    .maybeSingle();

  const expectedRoomLabel = (roomResult.data as { room_label: string } | null)?.room_label ?? null;
  if (!expectedRoomLabel || expectedRoomLabel === reservation.room_label) {
    return { recovered: false, roomLabel: expectedRoomLabel };
  }

  const originalId = toOriginalReservationId(reservation.source_reservation_id);
  const target = await resolveRelabelTarget(supabase, {
    organizationId,
    source: null,
    reservationId: reservation.id,
    originalId,
    roomLabel: expectedRoomLabel,
    bookingId: readBeds24OwnBookingId(raw),
  });
  if ("error" in target) return { recovered: false, roomLabel: null };
  const correctedSourceId = target.correctedSourceId;
  const conflictRow = target.sameBookingRow;

  if (conflictRow) {
    console.warn("[beds24/recovery] dedup: deleting stale row during single recovery", {
      staleId: reservation.id,
      keptId: conflictRow.id,
      originalId,
      correctedSourceId,
    });
    const deleteResult = await supabase.from("reservations").delete().eq("id", reservation.id);
    if (deleteResult.error) {
      return { recovered: false, roomLabel: null };
    }
    return { recovered: true, roomLabel: expectedRoomLabel };
  }

  const updateResult = await supabase
    .from("reservations")
    .update({ room_label: expectedRoomLabel, source_reservation_id: correctedSourceId })
    .eq("id", reservation.id);

  if (updateResult.error) {
    return { recovered: false, roomLabel: null };
  }

  return { recovered: true, roomLabel: expectedRoomLabel };
}
