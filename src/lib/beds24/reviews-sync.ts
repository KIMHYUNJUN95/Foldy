// Beds24 → external_reviews 수집. 서버 전용, service-role, UI 에서 절대 호출하지 않음.
//
// 엔드포인트 계약(2026-08-04 에 https://beds24.com/api/v2/apiV2.yaml 대조 측정 —
// docs/engineering/01-beds24-integration.md → External Reviews 참고):
//
//   GET /channels/airbnb/reviews?roomId={int}        Beta   — 날짜 필터 없음, 방당 HARD CAP 50
//   GET /channels/booking/reviews?propertyId={int}&from=YYYY-MM-DD
//                                                   Alpha  — 페이지당 100
//
// 두 엔드포인트 모두 단위 파라미터가 필요하므로 "채널당 1회"는 불가능하다: 한
// 사이클에 (Airbnb 연결 객실 유형) + (Booking 연결 숙소) 만큼 요청한다. 스케줄은
// 단위당 하루 두 번이다.
//
// 필드 제공 여부는 비대칭이며, 제공자가 보내지 않은 것은 절대 추정하지 않는다:
//   * Airbnb  — 조회한 roomId 가 방을 고정한다. 리뷰어 이름은 없고(숫자 `reviewer_id`
//               뿐), 대신 `reservation_confirmation_code` 를 보내며 이것이 우리
//               예약의 `raw_payload->>apiReference` 와 일치한다 — 이 매칭이
//               예약 연결과 게스트 이름을 모두 채운다. 리뷰는 양방향이므로
//               게스트가 쓴, 제출된, 숨기지 않은 것만 저장한다.
//   * Booking — 방 정보가 전혀 없다. `reservation_id` 를 로컬
//               reservations.source_reservation_id 로 해석해 방을 복원하며, 못 찾으면 null 로 남는다.
// 어느 쪽이든 매칭되지 않은 리뷰는 추측하지 않고 NULL 로 둔다.
//
// 두 엔드포인트 모두 Beta/Alpha 이므로 `raw_payload` 를 항상 보관하고, 파싱에 실패한 행은
// 실행 전체를 중단하지 않고 개별로 건너뛴다.
//
// AIRBNB 리뷰 50건 상한(2026-08-05 측정, 스펙은 이 부분이 틀림)
// ------------------------------------------------------------------------
// 스펙은 "한 번에 최대 100건 반환"이라 하고 `pages`
// 객체도 노출하지만, 이 엔드포인트에서는 둘 다 맞지 않다:
//   * 리뷰가 50건을 넘는 방도 정확히 50건만 돌려주면서 여전히
//     `pages.nextPageExists: false` 를 보고한다 — 이 플래그는 거짓말이다;
//   * `?page=2` 와 `?page=3` 이 같은 50행(첫 id 동일)을 돌려주므로
//     문서화된 페이지네이션 파라미터는 그냥 무시된다.
// Beds24 로는 51번째 이후 리뷰에 닿을 방법이 없다. 결과:
//   * Airbnb 전체 이력 백필은 불가능하다. 이미 50건인 방은 우리가 영영 가져올 수 없는
//     오래된 리뷰가 있다. `truncatedTargets` 가 어느 방이 그 상태인지 보고해서
//     공백이 조용히 완전해 보이는 대신 드러나게 한다.
//   * 이후 수집은 영향이 없다 — 하루 한 번 실행에서 하루에 새 리뷰 50건이 나올 일은 없다.
// Booking.com 은 영향이 없다: 실제 `from` 날짜를 받고 제대로 페이지를 나눈다.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOptionalBeds24ApiEnv } from "@/lib/env";
import {
  BOOKING_SCORING_KEYS,
  calcRiskLevel,
  REVIEW_SCALE,
  type ReviewProvider,
} from "@/lib/external-review-rules";
import { isExcludedOperationalProperty } from "@/lib/room-label-normalization";
import { isInactiveBeds24Room } from "@/lib/rooms";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { resolveBeds24AccessToken } from "./access-token";
import { readBeds24Credits, type Beds24CreditInfo } from "./credits";
import { relinkReviewRooms, type ReviewRelinkResult } from "./review-room-relink";

/** 토큰 해석·캐시는 `access-token.ts` 가 갖는다 — 재연결 모듈과 캐시를 공유하기 위해서다. */
const resolveAccessToken = () => resolveBeds24AccessToken("reviews-sync");

/**
 * 응답 헤더의 크레딧 정보. 잔여가 낮으면 남은 대상을 다음 주기로 미룬다.
 *
 * 헤더 이름은 `credits.ts` 가 갖는다 — 2026-08-07 까지 여기 적혀 있던 이름이 전부 틀려서
 * 잔여 크레딧이 항상 null 이었고 저크레딧 가드가 한 번도 발동하지 않았다. 자세한 내용은 그쪽 주석.
 */
type CreditInfo = Beds24CreditInfo;
const readCredits = readBeds24Credits;

/** 이 값 아래로 떨어지면 남은 대상을 건너뛰고 다음 주기가 이어받는다. */
const MIN_REMAINING_CREDITS = 50;

/** Airbnb가 한 룸타입에 대해 돌려주는 최대 리뷰 수 (실측). 페이지로 넘길 방법이 없다. */
const AIRBNB_REVIEW_CAP = 50;

type PageResult = { rows: unknown[]; credits: CreditInfo; nextPage: string | null };

async function fetchPage(url: string, token: string): Promise<PageResult | { error: string }> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", token },
      cache: "no-store",
    });
    const credits = readCredits(response.headers);
    if (!response.ok) return { error: `http-${response.status}` };
    const json = (await response.json()) as {
      data?: unknown;
      pages?: { nextPageExists?: unknown; nextPageLink?: unknown };
    };
    const rows = Array.isArray(json.data) ? json.data : [];
    const nextPage =
      json.pages?.nextPageExists === true && typeof json.pages.nextPageLink === "string"
        ? json.pages.nextPageLink
        : null;
    return { rows, credits, nextPage };
  } catch {
    return { error: "request-error" };
  }
}

// ────────────────────────────────────────────────────────────
// payload → 행
// ────────────────────────────────────────────────────────────

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function iso(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  // Booking.com 은 "2018-05-13 12:16:33"(시간대 표시 없음)을 보내고, Airbnb 는 ISO 를 보낸다.
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export type ParsedReview = {
  provider: ReviewProvider;
  externalReviewId: string;
  ratingValue: number | null;
  ratingScale: number;
  riskLevel: ReturnType<typeof calcRiskLevel>;
  ratingBreakdown: unknown;
  reviewedAt: string | null;
  sourceUpdatedAt: string | null;
  guestDisplayName: string | null;
  headline: string | null;
  sourceLanguageCode: string | null;
  reviewText: string | null;
  positiveReviewText: string | null;
  negativeReviewText: string | null;
  privateFeedback: string | null;
  otaReplyText: string | null;
  otaRepliedAt: string | null;
  /**
   * 제공자가 쓰는 예약 식별자. 두 플랫폼이 서로 다른 값을 주고 역조회하는 컬럼도 다르다.
   *   airbnb  → `reservation_confirmation_code` ("HMRWNK5RQW") ↔ `reservations.raw_payload->>apiReference`
   *   booking → `reservation_id` (Beds24 bookingId, 숫자) ↔ `reservations.source_reservation_id`
   * 값 자체가 운영자가 OTA 익스트라넷에서 검색할 수 있는 문자열이라 그대로 저장·표시한다.
   */
  sourceReservationId: string | null;
  raw: unknown;
};

/**
 * Airbnb `airbnbReview` → 행.
 *
 * Airbnb 리뷰는 양방향이다. 호스트가 쓴, 미제출, 숨김
 * 항목에 null 을 돌려주는 것이 우리가 게스트에 대해 쓴 리뷰가 테이블에 들어오지 않게 한다.
 */
export function parseAirbnbReview(payload: unknown): ParsedReview | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;

  const id = str(row.id);
  if (!id) return null;
  if (row.submitted === false) return null;
  if (row.hidden === true) return null;

  const reviewerRole = (str(row.reviewer_role) ?? "").toLowerCase();
  // 게스트가 우리에 대해 쓴 것만 보관한다. Beds24 는 Airbnb 의 역할을 그대로 넘기므로
  // 예상치 못한 값은 조용히 수집하지 않고 "게스트 리뷰 아님"으로 취급한다.
  if (reviewerRole && reviewerRole !== "guest") return null;

  const rating = num(row.overall_rating);
  return {
    provider: "airbnb",
    externalReviewId: id,
    ratingValue: rating,
    ratingScale: REVIEW_SCALE.airbnb,
    riskLevel: calcRiskLevel("airbnb", rating),
    ratingBreakdown: Array.isArray(row.category_ratings) ? { category_ratings: row.category_ratings } : {},
    reviewedAt: iso(row.submitted_at) ?? iso(row.first_completed_at),
    sourceUpdatedAt: null,
    // Airbnb는 작성자 이름을 주지 않는다 (`reviewer_id` 숫자 ID만). 이름은 아래에서 확인 코드로
    // 찾은 로컬 예약의 `guest_name`으로 채운다 — 페이로드에서 추정하는 것이 아니다.
    guestDisplayName: null,
    headline: null, // Airbnb 에는 리뷰 제목이 없음
    sourceLanguageCode: null, // 언어 코드 없음 → DeepL 자동 감지
    reviewText: str(row.public_review),
    positiveReviewText: null,
    negativeReviewText: null,
    privateFeedback: str(row.private_feedback),
    otaReplyText: null,
    otaRepliedAt: null,
    // Airbnb 확인 코드. Beds24 bookingId가 아니라서 `source_reservation_id` 역조회로는 안 잡히지만,
    // 우리 예약의 `raw_payload->>apiReference`에 같은 값이 들어 있다 (2026-08-06 실측: 2214/2214건 보유).
    sourceReservationId: str(row.reservation_confirmation_code),
    raw: payload,
  };
}

/** Booking.com `bookingReview` → 행. 점수만 있는 리뷰(본문 없음)도 유효하며 오류가 아니다. */
export function parseBookingReview(payload: unknown): ParsedReview | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;

  const id = str(row.review_id);
  if (!id) return null;

  const scoring = (row.scoring ?? {}) as Record<string, unknown>;
  const content = (row.content ?? {}) as Record<string, unknown>;
  const reviewer = (row.reviewer ?? {}) as Record<string, unknown>;
  const reply = (row.reply ?? {}) as Record<string, unknown>;

  const rating = num(scoring.review_score);
  const breakdown: Record<string, number> = {};
  // 실제 payload 키 (2026-08-07 실측, booking 리뷰 253건 전수):
  //   clean / staff / value / comfort / location / facilities / review_score
  // 기획서에 적혀 있던 `services` 는 **존재하지 않는다** — 253건 전부에 없어 화면에 빈 줄만
  // 만들고 있었다. 반대로 `comfort` 는 245건에 값이 있는데 읽지 않아 통째로 버려지고 있었다.
  for (const key of BOOKING_SCORING_KEYS) {
    const value = num(scoring[key]);
    if (value !== null) breakdown[key] = value;
  }

  const reservation = num(row.reservation_id);
  return {
    provider: "booking",
    externalReviewId: id,
    ratingValue: rating,
    ratingScale: REVIEW_SCALE.booking,
    riskLevel: calcRiskLevel("booking", rating),
    ratingBreakdown: Object.keys(breakdown).length > 0 ? { scoring: breakdown } : {},
    reviewedAt: iso(row.created_timestamp),
    sourceUpdatedAt: iso(row.last_change_timestamp),
    guestDisplayName: str(reviewer.name),
    headline: str(content.headline),
    sourceLanguageCode: str(content.language_code),
    reviewText: null,
    positiveReviewText: str(content.positive),
    negativeReviewText: str(content.negative),
    privateFeedback: null, // Booking.com 에는 대응 항목이 없음
    otaReplyText: str(reply.text),
    otaRepliedAt: iso(reply.last_change_timestamp),
    sourceReservationId: reservation === null ? null : String(reservation),
    raw: payload,
  };
}

// ────────────────────────────────────────────────────────────
// 동기화
// ────────────────────────────────────────────────────────────

export type ReviewSyncResult = {
  upserted: number;
  skipped: string[];
  requests: number;
  creditsRemaining: number | null;
  stoppedEarly: boolean;
  /**
   * Airbnb 50건 상한에 걸린 룸타입. 이 방들은 51번째 이후 과거 리뷰를 영구히 가져올 수 없다 —
   * 데이터가 불완전하다는 사실을 조용히 감추지 않기 위해 남긴다.
   */
  truncatedTargets: string[];
  /**
   * 휴면으로 판단해 이번 주기에 부르지 않은 룸타입. 조용히 빼면 «수집이 되고 있다»는 착각을
   * 만들므로 반드시 드러낸다 — `truncatedTargets` 와 같은 이유다.
   */
  dormantTargets: string[];
  /** 이 조직의 전체 대상 수. 호출부가 진행률·남은 조각을 계산한다. */
  totalTargets: number;
  /**
   * 다음 호출이 시작할 대상 인덱스. `null` 이면 이 조직은 끝났다.
   *
   * 60초 함수 상한 때문에 한 번에 전부 돌 수 없어(실측 126초) 조각내어 이어받는다.
   * 크레딧이 바닥나 중단된 경우에도 **처리하지 못한 첫 대상**을 가리키므로, 다음 주기가
   * 정확히 그 지점부터 이어받아 건너뛰는 대상이 생기지 않는다.
   */
  nextOffset: number | null;
  /** 수집 뒤 사후 재연결 결과. 조직의 마지막 조각에서만 채워진다. */
  relink?: ReviewRelinkResult;
};

/**
 * 상시 경로에서 Beds24 예약 조회를 허용할 리뷰 나이 상한.
 *
 * 영영 못 찾는 건(Beds24 에서 삭제된 예약 등)이 **매일 크레딧을 태우는 것**을 막는 장치다.
 * 상태 컬럼을 새로 만들지 않고 나이로 스스로 빠지게 했다 — 새 리뷰는 45일이면 예약이 들어올
 * 시간으로 충분하고, 그때까지 못 찾았다면 앞으로도 못 찾는다.
 */
const RELINK_LOOKUP_MAX_AGE_DAYS = 45;
/** 한 주기에 허용할 재연결 조회 요청 수. 40건/요청이라 상시 운영에는 넉넉하다. */
const RELINK_MAX_LOOKUP_REQUESTS = 3;

type SyncTarget =
  | { provider: "airbnb"; externalId: string; propertyId: string; propertyName: string; roomId: string; roomLabel: string }
  | { provider: "booking"; externalId: string; propertyId: string; propertyName: string };

function untyped(client: SupabaseClient<unknown>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

/**
 * 조직의 리뷰를 수집한다. 90일 제한은 Booking.com만 서버 측(`from`)에서 되고,
 * Airbnb는 날짜 파라미터가 없어 전량을 받은 뒤 여기서 잘라낸다.
 */
export async function syncOrganizationReviews(input: {
  organizationId: string;
  /** 초기 도입/복구용. 기본 90일. */
  sinceDays?: number;
  /** 이번 호출이 처리할 첫 대상 인덱스 (이어받기용). */
  offset?: number;
  /** 이번 호출이 처리할 최대 대상 수. 없으면 전량 — 로컬/스크립트 전용. */
  limit?: number;
}): Promise<ReviewSyncResult> {
  const { organizationId } = input;
  const sinceDays = input.sinceDays ?? 90;
  const offset = Math.max(0, input.offset ?? 0);
  const limit = input.limit && input.limit > 0 ? input.limit : null;
  const skipped: string[] = [];
  const result: ReviewSyncResult = {
    upserted: 0,
    skipped,
    requests: 0,
    creditsRemaining: null,
    stoppedEarly: false,
    truncatedTargets: [],
    dormantTargets: [],
    totalTargets: 0,
    nextOffset: null,
  };

  const env = getOptionalBeds24ApiEnv();
  if (!env) {
    skipped.push("reviews-sync:missing-env");
    return result;
  }
  const tokenState = await resolveAccessToken();
  if (!tokenState.ok) {
    skipped.push(tokenState.skipped);
    return result;
  }
  const token = tokenState.token;
  const base = env.baseUrl.replace(/\/$/, "");

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();
  const sinceDate = sinceIso.slice(0, 10);

  const service = getSupabaseServiceClient();
  const db = untyped(service as unknown as SupabaseClient<unknown>);

  // 연동 키가 있는 대상만 호출한다.
  //
  // **정렬은 필수다.** 대상 목록을 조각내어 이어받으므로(`offset`), 호출마다 순서가 흔들리면
  // 어떤 대상은 두 번 돌고 어떤 대상은 영영 안 돈다 — 조용한 누락이 된다. PostgREST 는 정렬을
  // 지정하지 않으면 순서를 보장하지 않으므로 `id` 로 고정한다.
  const { data: propertyRows } = await db
    .from("properties")
    .select("id, name, external_property_id")
    .eq("organization_id", organizationId)
    .order("id", { ascending: true });
  const properties = (propertyRows ?? []) as {
    id: string;
    name: string;
    external_property_id: string | null;
  }[];

  const { data: roomRows } = await db
    .from("rooms")
    .select("id, room_label, property_id, external_room_id, external_minimum_stay, status")
    .eq("organization_id", organizationId)
    .order("id", { ascending: true });
  const rooms = (roomRows ?? []) as {
    id: string;
    room_label: string;
    property_id: string;
    external_room_id: string | null;
    external_minimum_stay: number | null;
    status: string;
  }[];

  const propertyById = new Map(properties.map((p) => [p.id, p]));

  /**
   * 휴면 룸타입 제외 (2026-08-07).
   *
   * **문제:** 같은 물리 객실을 두 어카운트가 번갈아 쓰는 구조라 항상 절반이 비활성이다. 비활성
   * 어카운트는 예약이 안 들어오니 새 리뷰도 안 생기는데, 매 주기 부르느라 크레딧의 약 30%가
   * 낭비되고 있었다(실측: 64개 룸타입 중 21개).
   *
   * **왜 «마지막 리뷰가 오래됨» 하나로는 안 되는가:** 폴링을 끊으면 새 리뷰를 볼 방법이 없어
   * 한 번 빠진 대상은 영원히 돌아오지 못한다. 실제로 `Arakicho A / 701` 은 **활성인데도**
   * Airbnb 리뷰가 314일째 없다(예약이 Booking 쪽으로만 들어온다). 이런 방을 빼면 나중에
   * Airbnb 리뷰가 달려도 영영 못 가져온다.
   *
   * **그래서 두 조건을 AND 로 건다:** 비활성 어카운트(`minStay >= 50`) **이면서** 최근
   * `DORMANT_AFTER_DAYS` 안에 리뷰가 하나도 없을 때만 뺀다. `external_minimum_stay` 는
   * **웹훅**이 갱신하므로 리뷰 폴링과 무관하다 — 어카운트가 다시 활성화되면 그 즉시 대상에
   * 복귀한다. 이것이 진짜 자기 교정이다.
   *
   * 리뷰 이력이 아예 없는 방을 따로 지키지 않는 이유: 그런 방이 «비활성» 이기까지 하면 예약이
   * 안 들어와 리뷰가 생길 수 없고, 활성화되는 순간 웹훅이 minStay 를 되돌려 대상에 복귀한다.
   */
  const DORMANT_AFTER_DAYS = 90;
  const dormantCutoff = new Date(Date.now() - DORMANT_AFTER_DAYS * 864e5).toISOString();
  const roomIdsWithRecentReview = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data: recent, error } = await db
      .from("external_reviews")
      .select("room_id")
      .eq("organization_id", organizationId)
      .eq("provider", "airbnb")
      .gte("reviewed_at", dormantCutoff)
      .range(offset, offset + 999);
    if (error) {
      // 판단 근거를 못 얻으면 **아무것도 빼지 않는다.** 조회 실패로 수집이 조용히 줄어드는
      // 것이 이 최적화로 아끼는 크레딧보다 훨씬 비싸다.
      skipped.push(`reviews-sync:dormant-probe-${error.code ?? "failed"}`);
      roomIdsWithRecentReview.clear();
      break;
    }
    const rows = (recent ?? []) as { room_id: string | null }[];
    for (const row of rows) if (row.room_id) roomIdsWithRecentReview.add(row.room_id);
    if (rows.length < 1000) break;
  }
  const dormantProbeOk = !skipped.some((s) => s.startsWith("reviews-sync:dormant-probe"));
  /** 같은 external_room_id 에 매핑된 우리 객실 행 전부 — 그중 하나라도 최근 리뷰가 있으면 살아 있다. */
  const roomRowsByExternalId = new Map<string, string[]>();
  for (const room of rooms) {
    if (!room.external_room_id) continue;
    const list = roomRowsByExternalId.get(room.external_room_id) ?? [];
    list.push(room.id);
    roomRowsByExternalId.set(room.external_room_id, list);
  }

  const targets: SyncTarget[] = [];
  const seenRoomIds = new Set<string>();
  for (const room of rooms) {
    if (!room.external_room_id) continue;
    // 비활성 어카운트도 **일부러** 수집한다.
    //
    // 예약 캘린더·청소는 "지금 예약을 받는 방"만 봐야 하므로 `isInactiveBeds24Room()` 으로
    // 걸러내지만, 리뷰는 성격이 다르다. 같은 물리 객실을 두 어카운트가 반년씩 번갈아 쓰므로
    // 지금 쉬는 어카운트에도 그 방의 지난 반년치 리뷰가 그대로 쌓여 있다. 활성만 부르면
    // 그 방 이력의 절반을 통째로 잃는다. 리뷰에서 중요한 건 "어느 어카운트인가"가 아니라
    // "이 방에 어떤 리뷰가 달렸는가"이므로 두 어카운트를 모두 부르고 아래에서 한 방으로 합친다.
    const property = propertyById.get(room.property_id);
    if (!property) continue;
    if (isExcludedOperationalProperty(property.name)) continue;
    // 같은 Beds24 룸타입에 여러 객실 행이 매핑돼 있으면 응답이 동일하므로 한 번만 호출한다.
    if (seenRoomIds.has(room.external_room_id)) continue;
    seenRoomIds.add(room.external_room_id);

    // 휴면 판정 — 위 DORMANT_AFTER_DAYS 주석 참고. 조회가 실패했으면 아무것도 빼지 않는다.
    if (dormantProbeOk && room.external_minimum_stay !== null) {
      const mappedRoomIds = roomRowsByExternalId.get(room.external_room_id) ?? [];
      const hasRecentReview = mappedRoomIds.some((id) => roomIdsWithRecentReview.has(id));
      if (isInactiveBeds24Room(room.external_minimum_stay) && !hasRecentReview) {
        result.dormantTargets.push(`${property.name} / ${room.room_label}`);
        continue;
      }
    }
    targets.push({
      provider: "airbnb",
      externalId: room.external_room_id,
      propertyId: property.id,
      propertyName: property.name,
      roomId: room.id,
      roomLabel: room.room_label,
    });
  }
  for (const property of properties) {
    if (!property.external_property_id) continue;
    if (isExcludedOperationalProperty(property.name)) continue;
    targets.push({
      provider: "booking",
      externalId: property.external_property_id,
      propertyId: property.id,
      propertyName: property.name,
    });
  }

  if (targets.length === 0) {
    skipped.push("reviews-sync:no-linked-units");
    return result;
  }

  result.totalTargets = targets.length;

  // 이번 호출이 맡을 조각. `offset` 이 끝을 넘어서면 할 일이 없다(= 이 조직 완료).
  const slice = limit === null ? targets.slice(offset) : targets.slice(offset, offset + limit);
  if (slice.length === 0) {
    return result;
  }

  // 리뷰 ↔ 예약 매칭용 인덱스. 조직 안에서만 찾는다.
  //
  // **페이지네이션은 선택이 아니다.** PostgREST는 `range()` 없는 select를 1000행에서 자른다.
  // 예약이 2000건을 넘는 조직에서는 인덱스 절반이 비어 매칭이 조용히 실패했다 (2026-08-06 발견).
  type ReservationRow = {
    id: string;
    source_reservation_id: string;
    room_label: string;
    property_name: string;
    guest_name: string | null;
    api_reference: string | null;
  };
  const reservations: ReservationRow[] = [];
  const RESERVATION_PAGE = 1000;
  for (let offset = 0; ; offset += RESERVATION_PAGE) {
    const { data: page, error } = await db
      .from("reservations")
      // `api_reference`는 Airbnb 확인 코드다. 전체 `raw_payload`를 끌어오면 조직당 수 MB라
      // 필요한 키 하나만 뽑는다.
      .select("id, source_reservation_id, room_label, property_name, guest_name, api_reference:raw_payload->>apiReference")
      .eq("organization_id", organizationId)
      .range(offset, offset + RESERVATION_PAGE - 1);
    if (error) {
      skipped.push(`reviews-sync:reservations-${error.code ?? "failed"}`);
      break;
    }
    const rows = (page ?? []) as ReservationRow[];
    reservations.push(...rows);
    if (rows.length < RESERVATION_PAGE) break;
  }
  // `reservations.source_reservation_id` 는 순수 예약 ID가 아니라 `{id}::room::{객실}` 형태다 —
  // 한 Beds24 예약이 여러 객실에 걸칠 수 있어 객실별로 행을 나누기 때문이다(`reconcile` 도 같은
  // 규약을 쓴다). Booking.com 리뷰는 접미사 없는 순수 ID만 주므로, 접두 매칭용 인덱스를 따로 만든다.
  // 접미사에 객실 라벨이 들어 있어 매칭되는 순간 객실까지 함께 확정된다.
  const reservationBySource = new Map<string, (typeof reservations)[number]>();
  for (const reservation of reservations) {
    const raw = reservation.source_reservation_id;
    if (!raw) continue;
    reservationBySource.set(raw, reservation);
    const bare = raw.split("::")[0];
    // 같은 예약 ID의 객실이 여러 개면 첫 행만 남긴다 — 리뷰는 예약 단위라 객실을 하나로 특정할 수
    // 없고, 임의로 고르면 틀린 객실에 문제를 귀속시키게 된다. 그런 경우 객실은 null로 남긴다.
    if (bare !== raw) {
      const seen = reservationBySource.get(bare);
      if (seen === undefined) reservationBySource.set(bare, reservation);
      else if (seen.room_label !== reservation.room_label) reservationBySource.set(bare, { ...seen, room_label: "" });
    }
  }
  // Airbnb 확인 코드 → 예약. 한 예약이 여러 객실 행으로 쪼개져 있어도 코드는 같으므로 첫 행만 쓴다
  // (Airbnb 리뷰의 객실은 조회한 roomId로 이미 확정돼 있어 예약에서 객실을 다시 얻을 필요가 없다).
  const reservationByAirbnbCode = new Map<string, ReservationRow>();
  for (const reservation of reservations) {
    const code = reservation.api_reference?.trim();
    if (!code) continue;
    if (!reservationByAirbnbCode.has(code)) reservationByAirbnbCode.set(code, reservation);
  }
  const roomIdByKey = new Map(rooms.map((r) => [`${r.property_id}::${r.room_label}`, r.id]));

  // 조각 안에서 몇 번째까지 실제로 처리했는지. 크레딧 부족으로 중단하면 이 값이 그대로
  // 다음 호출의 시작점이 되어, 못 돈 대상이 조용히 건너뛰어지지 않는다.
  let processedInSlice = 0;

  for (const target of slice) {
    if (result.creditsRemaining !== null && result.creditsRemaining < MIN_REMAINING_CREDITS) {
      // 남은 대상은 다음 주기가 이어받는다. 예약 웹훅 처리보다 우선하지 않는다.
      result.stoppedEarly = true;
      skipped.push("reviews-sync:low-credits");
      break;
    }
    processedInSlice += 1;

    let url =
      target.provider === "airbnb"
        ? `${base}/channels/airbnb/reviews?roomId=${encodeURIComponent(target.externalId)}`
        : `${base}/channels/booking/reviews?propertyId=${encodeURIComponent(target.externalId)}&from=${sinceDate}`;

    let guard = 0;
    while (url && guard < 20) {
      guard += 1;
      const page = await fetchPage(url, token);
      result.requests += 1;
      if ("error" in page) {
        skipped.push(`reviews-sync:${target.provider}-${target.externalId}-${page.error}`);
        break;
      }
      if (page.credits.remaining !== null) result.creditsRemaining = page.credits.remaining;

      // 정확히 50건이면 상한에 닿았다는 뜻이다(`nextPageExists`는 이 경우에도 false를 준다).
      if (target.provider === "airbnb" && page.rows.length >= AIRBNB_REVIEW_CAP) {
        result.truncatedTargets.push(`${target.propertyName} / ${target.roomLabel}`);
      }

      const parsed: ParsedReview[] = [];
      for (const raw of page.rows) {
        const review =
          target.provider === "airbnb" ? parseAirbnbReview(raw) : parseBookingReview(raw);
        // 파싱 실패는 해당 리뷰 1건만 건너뛰고 나머지 수집을 계속한다.
        if (!review) continue;
        // Airbnb는 날짜 파라미터가 없고 최대 50건만 오므로 절대 잘라내지 않는다. 잘라내면
        // 같은 크레딧을 쓰고 받은 데이터를 버리는 셈이고, 50건 상한 탓에 그 데이터는 다시
        // 가져올 방법도 없다. 기간 제한은 `from`을 실제로 지원하는 Booking.com에만 적용된다.
        parsed.push(review);
      }

      if (parsed.length > 0) {
        const payload = parsed.map((review) => {
          let roomId: string | null = target.provider === "airbnb" ? target.roomId : null;
          let roomLabel: string | null = target.provider === "airbnb" ? target.roomLabel : null;
          let reservationId: string | null = null;
          let guestDisplayName = review.guestDisplayName;

          if (target.provider === "airbnb" && review.sourceReservationId) {
            // 객실은 건드리지 않는다 — 조회한 roomId가 이미 확정값이고 예약보다 신뢰도가 높다.
            // 예약에서 가져오는 건 링크와 게스트 이름뿐이다. 못 찾으면 null로 둔다(추정 금지).
            const reservation = reservationByAirbnbCode.get(review.sourceReservationId);
            if (reservation) {
              reservationId = reservation.id;
              const name = reservation.guest_name?.trim();
              if (name) guestDisplayName = name;
            }
          }

          if (target.provider === "booking" && review.sourceReservationId) {
            const reservation = reservationBySource.get(review.sourceReservationId);
            if (reservation) {
              reservationId = reservation.id;
              // room_label 이 빈 문자열이면 그 예약이 여러 객실에 걸쳐 있다는 뜻 — 추정하지 않는다.
              if (reservation.room_label) {
                const resolved = roomIdByKey.get(`${target.propertyId}::${reservation.room_label}`);
                if (resolved) {
                  roomId = resolved;
                  roomLabel = reservation.room_label;
                }
              }
            }
          }

          return {
            organization_id: organizationId,
            provider: review.provider,
            external_review_id: review.externalReviewId,
            rating_value: review.ratingValue,
            rating_scale: review.ratingValue === null ? null : review.ratingScale,
            risk_level: review.riskLevel,
            rating_breakdown: review.ratingBreakdown,
            reviewed_at: review.reviewedAt,
            source_updated_at: review.sourceUpdatedAt,
            property_id: target.propertyId,
            property_name: target.propertyName,
            room_id: roomId,
            room_label: roomLabel,
            reservation_id: reservationId,
            source_reservation_id: review.sourceReservationId,
            guest_display_name: guestDisplayName,
            headline: review.headline,
            source_language_code: review.sourceLanguageCode,
            review_text: review.reviewText,
            positive_review_text: review.positiveReviewText,
            negative_review_text: review.negativeReviewText,
            private_feedback: review.privateFeedback,
            ota_reply_text: review.otaReplyText,
            ota_replied_at: review.otaRepliedAt,
            raw_payload: review.raw,
          };
        });

        const { error } = await db
          .from("external_reviews")
          .upsert(payload, { onConflict: "organization_id,provider,external_review_id" });
        if (error) skipped.push(`reviews-sync:upsert-${error.code ?? "failed"}`);
        else result.upserted += payload.length;
      }

      // Airbnb는 `page` 파라미터가 무시되고 `nextPageExists`도 항상 false다 — 루프를 돌면
      // 같은 50건을 다시 받으며 크레딧만 쓴다. 페이지네이션은 Booking.com에만 적용한다.
      url = target.provider === "airbnb" ? "" : (page.nextPage ?? "");
    }
  }

  // 이 조직에 아직 남은 대상이 있으면 그 인덱스를 돌려준다. 호출부(라우트 → 워크플로)가
  // `nextOffset` 이 null 이 될 때까지 반복해 부르면 전량이 정확히 한 번씩 처리된다.
  const consumed = offset + processedInSlice;
  result.nextOffset = consumed < targets.length ? consumed : null;

  // 조직의 마지막 조각에서만 재연결을 돌린다. 조각마다 돌리면 예약 인덱스를 매번 다시 읽고
  // Beds24 조회도 중복된다 — 재연결은 «수집이 한 바퀴 끝난 뒤»에 한 번이면 충분하다.
  //
  // 이게 왜 수집과 별개인가: 리뷰가 예약보다 먼저 도착하면 수집 시점엔 객실을 알 수 없는데,
  // Booking 리뷰는 `from=최근날짜` 로만 다시 조회되므로 **오래된 리뷰는 다시 올라오지 않는다.**
  // 재수집으로는 영영 안 채워지고, 사후 재연결만이 채운다(2026-08-07 실측 34건).
  if (result.nextOffset === null && !result.stoppedEarly) {
    const relink = await relinkReviewRooms({
      organizationId,
      lookupMaxAgeDays: RELINK_LOOKUP_MAX_AGE_DAYS,
      allowLookup: true,
      maxLookupRequests: RELINK_MAX_LOOKUP_REQUESTS,
    });
    result.relink = relink;
    result.requests += relink.lookupRequests;
    if (relink.creditsRemaining !== null) result.creditsRemaining = relink.creditsRemaining;
    skipped.push(...relink.skipped);
  }

  return result;
}
