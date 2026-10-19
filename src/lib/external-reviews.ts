// External Reviews (Beds24 → Airbnb / Booking.com) — server-only domain helpers.
//
// Reads use the RLS-scoped server client (org isolation via has_active_membership). The
// review rows themselves are never written from here: collection is service-role only and
// lives in `src/lib/beds24/reviews-sync.ts`. The one write this module owns is converting a
// review into a manual complaint, which re-checks the role and the organization first.
//
// Domain contract: docs/product/25-complaint-workflow.md
// Risk rules:      Airbnb <= 3 and Booking.com <= 7.0 are `risk` (boundary included).
//                  Three values only — `unrated` / `normal` / `risk`.
//
// Reviews are stored in full regardless of score; `riskLevel` is a classification, not a
// filter. Building/room averages need the good reviews too.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSession } from "@/lib/session";
import { tokyoDayEndExclusive, tokyoDayStart } from "@/lib/tokyo-date";
import { canWriteComplaint } from "@/lib/complaints";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  localizePropertyName,
} from "@/lib/room-label-normalization";
import { getDictionary } from "@/lib/i18n";
import { readAllReviewPages, type ReviewPageResult } from "@/lib/external-review-pages";
import type { Database } from "@/types/database";

// The generated Database type does not line up with postgrest's select-string inference for
// these tables, so the codebase convention (see `src/lib/complaints.ts`) is to drop the schema
// generic at the call site and cast row shapes explicitly.
function untyped(client: SupabaseClient<Database>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

// 점수 척도와 위험도 판정은 클라이언트 컴포넌트도 표시용으로 필요하다. server-only 모듈에서
// 값을 가져가면 Supabase/`next/headers` 체인이 브라우저 번들로 끌려오므로 순수 규칙은
// `external-review-rules.ts`에 두고 여기서는 다시 내보내기만 한다.
export {
  REVIEW_SCALE,
  calcRiskLevel,
  type ReviewProvider,
  type ReviewRiskLevel,
} from "@/lib/external-review-rules";
import {
  type ReviewProvider,
  type ReviewRiskLevel,
} from "@/lib/external-review-rules";

export type ExternalReview = {
  id: string;
  provider: ReviewProvider;
  externalReviewId: string;
  ratingValue: number | null;
  ratingScale: number | null;
  riskLevel: ReviewRiskLevel;
  ratingBreakdown: unknown;
  reviewedAt: string | null;
  importedAt: string;
  propertyId: string | null;
  propertyName: string | null;
  roomId: string | null;
  /** Beds24 원본 라벨 (`303#`, `501_2` …). 매칭·집계 키로만 쓴다. */
  roomLabel: string | null;
  /**
   * 화면에 보여 주는 객실명. 캘린더·청소와 **같은 정규화**를 거친다
   * (`getCanonicalRoomLabel` → `getDisplayRoomLabel`) — `303#` 의 `#` 이나 아라키초 `_2`
   * 접미사 같은 운영 표기가 사용자 화면까지 새어 나가지 않게 한다.
   */
  displayRoomLabel: string | null;
  /** 우리 `reservations` 행의 uuid. 사람이 읽을 값이 아니므로 화면에 그대로 노출하지 않는다. */
  reservationId: string | null;
  /** 제공자가 쓰는 예약 식별자 (Airbnb 확인 코드 / Booking.com bookingId). 화면에는 이 값을 보여 준다. */
  sourceReservationId: string | null;
  guestDisplayName: string | null;
  headline: string | null;
  sourceLanguageCode: string | null;
  reviewText: string | null;
  positiveReviewText: string | null;
  negativeReviewText: string | null;
  otaReplyText: string | null;
  otaRepliedAt: string | null;
  linkedComplaintId: string | null;
};

/** 상세에서만 추가로 읽는 값. 목록·집계 쿼리는 절대 선택하지 않는다. */
export type ExternalReviewDetail = ExternalReview & {
  /**
   * Airbnb 비공개 피드백. 게스트가 호스트에게만 보낸 내용으로 OTA에 공개되지 않으며
   * 점수가 없다 — 평점·위험도 계산에 넣지 않고 화면에서도 공개 리뷰와 분리해 표시한다.
   */
  privateFeedback: string | null;
};

/**
 * 목록/집계용 컬럼. `private_feedback`과 `raw_payload`는 의도적으로 빠져 있다
 * (docs/engineering/05-rls-permissions.md).
 */
const REVIEW_COLS = `
  id, provider, external_review_id,
  rating_value, rating_scale, risk_level, rating_breakdown,
  reviewed_at, imported_at,
  property_id, property_name, room_id, room_label, reservation_id, source_reservation_id,
  guest_display_name, headline, source_language_code,
  review_text, positive_review_text, negative_review_text,
  ota_reply_text, ota_replied_at, linked_complaint_id
`;

type ReviewRow = {
  id: string;
  provider: ReviewProvider;
  external_review_id: string;
  rating_value: number | null;
  rating_scale: number | null;
  risk_level: ReviewRiskLevel;
  rating_breakdown: unknown;
  reviewed_at: string | null;
  imported_at: string;
  property_id: string | null;
  property_name: string | null;
  room_id: string | null;
  room_label: string | null;
  reservation_id: string | null;
  source_reservation_id: string | null;
  guest_display_name: string | null;
  headline: string | null;
  source_language_code: string | null;
  review_text: string | null;
  positive_review_text: string | null;
  negative_review_text: string | null;
  ota_reply_text: string | null;
  ota_replied_at: string | null;
  linked_complaint_id: string | null;
  private_feedback?: string | null;
};

/**
 * 원본 객실 라벨 → 화면용 라벨. 캘린더·청소가 쓰는 것과 같은 두 단계다.
 *
 * Beds24 원본에는 `303#` 처럼 채널 구분용 `#` 이나 아라키초 `501_2` 같은 리스팅 접미사가 붙어
 * 있다. 이건 운영 식별자이지 사용자에게 보여 줄 이름이 아니다. 정규화에 실패하면 원본을 그대로
 * 돌려준다 — 이름이 사라지는 것보다 낫다.
 */
function toDisplayRoomLabel(propertyName: string | null, roomLabel: string | null): string | null {
  if (!roomLabel) return null;
  if (!propertyName) return roomLabel;
  const canonicalProperty = getCanonicalPropertyName(propertyName);
  const canonicalRoom = getCanonicalRoomLabel(canonicalProperty, roomLabel);
  if (!canonicalRoom) return roomLabel;
  return getDisplayRoomLabel(canonicalProperty, canonicalRoom) || canonicalRoom;
}

function mapReview(row: ReviewRow): ExternalReview {
  return {
    id: row.id,
    provider: row.provider,
    externalReviewId: row.external_review_id,
    ratingValue: row.rating_value,
    ratingScale: row.rating_scale,
    riskLevel: row.risk_level,
    ratingBreakdown: row.rating_breakdown,
    reviewedAt: row.reviewed_at,
    importedAt: row.imported_at,
    propertyId: row.property_id,
    propertyName: row.property_name,
    roomId: row.room_id,
    roomLabel: row.room_label,
    displayRoomLabel: toDisplayRoomLabel(row.property_name, row.room_label),
    reservationId: row.reservation_id,
    sourceReservationId: row.source_reservation_id,
    guestDisplayName: row.guest_display_name,
    headline: row.headline,
    sourceLanguageCode: row.source_language_code,
    reviewText: row.review_text,
    positiveReviewText: row.positive_review_text,
    negativeReviewText: row.negative_review_text,
    otaReplyText: row.ota_reply_text,
    otaRepliedAt: row.ota_replied_at,
    linkedComplaintId: row.linked_complaint_id,
  };
}

function requireOrg(session: AppSession): string {
  if (!session.organization?.id) throw new Error("no_org");
  return session.organization.id;
}

export type ReviewListFilter = {
  provider?: ReviewProvider;
  riskOnly?: boolean;
  propertyId?: string;
  /**
   * 여러 건물을 한 번에 거를 때. 같은 건물이 Beds24 원본 표기만 다르게 여러 `properties` 행으로
   * 들어와 있어(예: `Okubo_A (B棟)`), 화면의 건물 칩 하나가 실제로는 여러 property_id 에 대응한다.
   */
  propertyIds?: string[];
  roomId?: string;
  /**
   * 객실을 특정하지 못한 리뷰만. Booking.com 응답에는 객실이 없어 예약 ID 역조회로만 객실을
   * 얻는데, 실측(2026-08-07) Booking 리뷰의 **65%** 가 역조회에 실패한다. 객실 연결이 안 됐다고
   * 리뷰 내용까지 못 보게 두면 손해라서, 그 리뷰들만 따로 열어보는 경로를 둔다.
   */
  unmappedOnly?: boolean;
  /** 포함 (YYYY-MM-DD) */
  from?: string;
  /** 포함 (YYYY-MM-DD) */
  to?: string;
};

/** 목록 한 페이지 + 전체 건수. 건수를 함께 주지 않으면 «몇 페이지인지»를 화면이 알 수 없다. */
export type ExternalReviewPage = {
  rows: ExternalReview[];
  /** 필터를 적용한 전체 건수(페이지 크기와 무관). */
  total: number;
};

/**
 * 외부 리뷰 목록. 기본 정렬은 콘솔 계약과 동일하게 **위험도 우선 → 낮은 원점수 → 최신**.
 *
 * 정렬은 DB에서 위험도·점수까지만 처리하고, 플랫폼 척도가 다른 원점수의 상호 비교는
 * 하지 않는다 (Airbnb 3점과 Booking 3점은 같은 의미가 아니다). 같은 위험도 안에서는
 * 각 플랫폼 척도로 정규화해 메모리에서 다시 정렬한다.
 */
function applyReviewFilter<T>(query: T, filter: ReviewListFilter): T {
  // supabase-js 의 빌더는 체이닝마다 같은 타입을 돌려주므로 제네릭으로 받아 그대로 넘긴다.
  let q = query as never as {
    eq: (c: string, v: unknown) => typeof q;
    in: (c: string, v: unknown[]) => typeof q;
    is: (c: string, v: unknown) => typeof q;
    gte: (c: string, v: unknown) => typeof q;
    lt: (c: string, v: unknown) => typeof q;
  };
  if (filter.provider) q = q.eq("provider", filter.provider);
  if (filter.riskOnly) q = q.eq("risk_level", "risk");
  if (filter.propertyId) q = q.eq("property_id", filter.propertyId);
  if (filter.propertyIds?.length) q = q.in("property_id", filter.propertyIds);
  if (filter.roomId) q = q.eq("room_id", filter.roomId);
  if (filter.unmappedOnly) q = q.is("room_id", null);
  // **도쿄 경계로 자른다.** `T00:00:00Z` 로 자르면 UTC 자정 기준이라 9시간 밀린다 —
  // 시작일 오전 0~9시(도쿄) 리뷰가 빠지고, 종료일 다음 날 새벽 것이 섞인다.
  // 리뷰 2,617건 중 17.8% 가 UTC 날짜 ≠ 도쿄 날짜다(2026-09-11 실측).
  if (filter.from) q = q.gte("reviewed_at", tokyoDayStart(filter.from));
  if (filter.to) q = q.lt("reviewed_at", tokyoDayEndExclusive(filter.to));
  return q as never as T;
}

/**
 * 조건에 맞는 리뷰 **전부**(PC 콘솔 목록 · 모바일 객실 고르기). 예전엔 `.limit(500)` 이라 최근
 * 90일 511건 중 11건이 목록에서 사라졌다(2026-10-19) — 1,000건 쪽으로 나눠 끝까지 읽는다.
 */
export async function listExternalReviews(input: {
  session: AppSession;
  filter?: ReviewListFilter;
}): Promise<ExternalReview[]> {
  const { session, filter = {} } = input;
  const organizationId = requireOrg(session);

  const supabase = await getSupabaseServerClient();
  const data = await readAllReviewPages<ReviewRow>((start, end, withCount) =>
    applyReviewFilter(
      untyped(supabase)
        .from("external_reviews")
        .select(REVIEW_COLS, withCount ? { count: "exact" } : undefined)
        .eq("organization_id", organizationId),
      filter,
    )
      .order("reviewed_at", { ascending: false })
      .order("id", { ascending: false })
      .range(start, end) as unknown as PromiseLike<ReviewPageResult<ReviewRow>>,
  );

  const rows = data.map(mapReview);
  // 최신 리뷰 우선(reviewed_at desc). 위험도·낮은 점수는 별도 `문제만` 토글과 `문제 객실` 뷰가 맡는다.
  // 날짜가 없는 리뷰(reviewed_at null)는 빈 문자열로 취급돼 맨 뒤로 간다.
  return rows.sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""));
}

/**
 * 외부 리뷰 목록 **한 페이지**.
 *
 * 예전 모바일 목록은 최신 500건만 받아 클라이언트에서 걸렀다 — 나머지는 화면에 존재하지도
 * 않았다. 조용한 누락이다.
 *
 * 그래서 목록은 **서버에서 필터·정렬·페이지**를 끝내고 한 페이지만 내려보낸다. 전체 건수를 함께
 * 주어야 화면이 «몇 페이지인지»를 알 수 있으므로 `count: "exact"` 를 쓴다.
 *
 * 정렬은 `reviewed_at desc` 하나뿐이다. 페이지를 나누는 이상 정렬이 DB 밖에서 바뀌면 페이지
 * 경계가 어긋나므로, 메모리 재정렬은 하지 않는다.
 */
export async function listExternalReviewPage(input: {
  session: AppSession;
  filter?: ReviewListFilter;
  page?: number;
  pageSize?: number;
}): Promise<ExternalReviewPage> {
  const { session, filter = {} } = input;
  const organizationId = requireOrg(session);
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 100);
  const page = Math.max(input.page ?? 1, 1);
  const from = (page - 1) * pageSize;

  const supabase = await getSupabaseServerClient();
  const query = applyReviewFilter(
    untyped(supabase)
      .from("external_reviews")
      .select(REVIEW_COLS, { count: "exact" })
      .eq("organization_id", organizationId),
    filter,
  );

  const { data, error, count } = await query
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    // 같은 `reviewed_at` 이 여러 건일 때 페이지마다 순서가 흔들리면 어떤 리뷰는 두 페이지에
    // 나오고 어떤 리뷰는 어디에도 안 나온다. id 를 2차 정렬로 두어 순서를 고정한다.
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;

  return {
    rows: ((data ?? []) as unknown as ReviewRow[]).map(mapReview),
    total: count ?? 0,
  };
}

/** 건물 필터 칩 하나. 표시는 현지화된 라벨, 필터는 그 건물에 속한 property_id 전부. */
export type ReviewBuildingOption = {
  /** 정규화 건물명 — URL 에 실리는 값. 원본 표기가 바뀌어도 링크가 깨지지 않는다. */
  value: string;
  label: string;
  propertyIds: string[];
};

/**
 * 건물 필터 칩 목록.
 *
 * **현재 페이지의 리뷰에서 뽑지 않는다.** 그러면 2페이지로 넘어갈 때 칩이 사라졌다 나타난다.
 * 조직의 건물 마스터에서 만들어 페이지와 무관하게 고정한다.
 *
 * 같은 건물이 Beds24 원본 표기만 다르게 여러 행으로 들어와 있어(`Okubo_A (B棟)` 등) 정규화
 * 이름으로 묶고, 칩 하나가 그 그룹의 property_id 전부를 필터로 넘긴다.
 */
export async function listReviewBuildingOptions(input: {
  session: AppSession;
  locale: string;
}): Promise<ReviewBuildingOption[]> {
  const organizationId = requireOrg(input.session);
  const supabase = await getSupabaseServerClient();
  const { data, error } = await untyped(supabase)
    .from("properties")
    .select("id, name")
    .eq("organization_id", organizationId);
  if (error) throw error;

  const buildingLabels = getDictionary(input.locale).cleaning.buildingLabels;
  const grouped = new Map<string, ReviewBuildingOption>();
  for (const row of (data ?? []) as { id: string; name: string }[]) {
    if (!row.name || isExcludedOperationalProperty(row.name)) continue;
    const canonical = getCanonicalPropertyName(row.name);
    const existing = grouped.get(canonical);
    if (existing) existing.propertyIds.push(row.id);
    else {
      grouped.set(canonical, {
        value: canonical,
        label: localizePropertyName(canonical, buildingLabels),
        propertyIds: [row.id],
      });
    }
  }

  return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label, input.locale));
}

/** 외부 리뷰 상세. 목록과 달리 비공개 피드백을 포함한다. */
export async function getExternalReview(input: {
  session: AppSession;
  id: string;
}): Promise<ExternalReviewDetail | null> {
  const organizationId = requireOrg(input.session);
  const supabase = await getSupabaseServerClient();
  const { data, error } = await untyped(supabase)
    .from("external_reviews")
    .select(`${REVIEW_COLS}, private_feedback`)
    .eq("organization_id", organizationId)
    .eq("id", input.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as ReviewRow;
  return { ...mapReview(row), privateFeedback: row.private_feedback ?? null };
}

// ────────────────────────────────────────────────────────────
// 기간 집계 (문제 객실)
// ────────────────────────────────────────────────────────────

export type PlatformStat = {
  /** 원점수 평균. 리뷰가 없으면 null — 0점이 아니다. */
  average: number | null;
  reviewCount: number;
  riskCount: number;
};

export type PlaceSummary = {
  key: string;
  name: string;
  airbnb: PlatformStat;
  booking: PlatformStat;
  /** 두 플랫폼 합산 문제 건수 ÷ 합산 리뷰 수. 평점과 달리 척도에 의존하지 않아 합칠 수 있다. */
  riskRatio: number | null;
  riskCount: number;
  reviewCount: number;
  unratedCount: number;
};

export type BuildingSummary = PlaceSummary & {
  propertyId: string | null;
  /**
   * 화면에 보여 주는 건물명. `properties.name` 은 `Okubo_A (B棟)` / `Okubo_C (kr)` 처럼 Beds24
   * 원본 표기라 그대로 쓰면 캘린더·청소와 이름이 갈라진다. 캘린더와 **같은 두 단계**
   * (`getCanonicalPropertyName` → `localizePropertyName`)를 서버에서 끝내, 어드민·모바일이
   * 각자 현지화를 다시 하지 않게 한다. 사전에 없는 건물은 정규화 이름을 그대로 쓴다.
   */
  label: string;
  /** `properties.property_type = 'standalone'` — 독채는 객실 행을 만들지 않는다. */
  standalone: boolean;
  rooms: PlaceSummary[];
  /** 객실을 찾지 못해 건물 합계에만 들어간 리뷰 수 (주로 Booking.com). */
  unmappedCount: number;
};

type Acc = { sum: number; n: number; risk: number };

/** 집계에 필요한 컬럼만 — 본문(리뷰당 ~2KB)은 읽지 않는다. `id` 는 쪽 정렬 · 중복 거르기용. */
const STAT_COLS = "id, provider, rating_value, risk_level, reviewed_at, property_id, property_name, room_id, room_label";

type StatRow = {
  id: string;
  provider: ReviewProvider;
  rating_value: number | null;
  risk_level: ReviewRiskLevel;
  reviewed_at: string | null;
  property_id: string | null;
  property_name: string | null;
  room_id: string | null;
  room_label: string | null;
};

type StatReview = {
  provider: ReviewProvider;
  ratingValue: number | null;
  riskLevel: ReviewRiskLevel;
  reviewedAt: string | null;
  propertyId: string | null;
  propertyName: string | null;
  roomId: string | null;
  roomLabel: string | null;
};

function pushStat(acc: Acc, review: StatReview): void {
  acc.n += 1;
  if (review.riskLevel === "risk") acc.risk += 1;
  if (review.ratingValue !== null && review.riskLevel !== "unrated") acc.sum += review.ratingValue;
}

function toStat(acc: Acc, rated: number): PlatformStat {
  return {
    average: rated > 0 ? Math.round((acc.sum / rated) * 100) / 100 : null,
    reviewCount: acc.n,
    riskCount: acc.risk,
  };
}

/**
 * 선택 기간의 건물·객실 평점 + 문제 건수 집계.
 *
 * 규칙 (docs/product/25-complaint-workflow.md → Period Rating Summary):
 *  - 집계 기준일은 `reviewed_at`. 날짜가 없는 리뷰는 기간 집계에서 제외한다.
 *  - `unrated`는 평균에도 문제 건수에도 넣지 않고 리뷰 수에만 별도로 센다.
 *  - Airbnb(5점)와 Booking.com(10점)은 하나의 평균으로 합치지 않는다.
 *  - 객실이 연결되지 않은 리뷰는 건물 합계에만 넣고 `unmappedCount`로 밝힌다.
 *  - `standalone` 건물은 객실 행을 만들지 않는다 — 건물 이름 문자열로 분기하지 않는다.
 *  - 건물명은 캘린더와 같은 정규화·현지화를 거쳐 `label` 로 내려보낸다(`name` 은 정규화 이름).
 */
export async function summarizeReviewsByPlace(input: {
  session: AppSession;
  from: string;
  to: string;
  /** 건물명 현지화용. 화면마다 다시 매핑하지 않도록 집계 단계에서 라벨을 붙인다. */
  locale: string;
}): Promise<BuildingSummary[]> {
  const { session, from, to } = input;
  const organizationId = requireOrg(session);
  const buildingLabels = getDictionary(input.locale).cleaning.buildingLabels;

  const supabase = await getSupabaseServerClient();
  // 예전엔 `listExternalReviews({ limit: 5000 })` 로 본문까지 읽었는데, PostgREST 가 1,000행에서
  // 조용히 잘라 365일(1,702건) 합계가 틀렸다(2026-10-19). 필요한 컬럼만 쪽으로 나눠 전부 읽는다.
  const [statRows, { data: propertyRows, error: propertyError }] = await Promise.all([
    readAllReviewPages<StatRow>((start, end, withCount) =>
      applyReviewFilter(
        untyped(supabase)
          .from("external_reviews")
          .select(STAT_COLS, withCount ? { count: "exact" } : undefined)
          .eq("organization_id", organizationId),
        { from, to },
      )
        .order("reviewed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(start, end) as unknown as PromiseLike<ReviewPageResult<StatRow>>,
    ),
    untyped(supabase).from("properties").select("id, name").eq("organization_id", organizationId),
  ]);
  if (propertyError) throw propertyError;
  const reviews: StatReview[] = statRows.map((row) => ({
    provider: row.provider,
    ratingValue: row.rating_value,
    riskLevel: row.risk_level,
    reviewedAt: row.reviewed_at,
    propertyId: row.property_id,
    propertyName: row.property_name,
    roomId: row.room_id,
    roomLabel: row.room_label,
  }));

  const nameById = new Map<string, string>();
  const properties = (propertyRows ?? []) as { id: string; name: string }[];
  for (const property of properties) {
    nameById.set(property.id, property.name);
  }

  /**
   * 독채(=객실 행을 만들지 않는 운영 단위) 판정.
   *
   * 문서 초안은 `properties.property_type = 'standalone'`을 쓰라고 했지만 실제 마스터에서는
   * 16개 건물이 전부 `standalone`이다(객실 22개짜리 건물 포함) — 유지되지 않는 기본값이라
   * 그대로 쓰면 모든 건물의 객실 행이 사라진다. 그래서 코드베이스가 이미 쓰는 규칙을 따른다:
   * **정규화된 객실 라벨이 건물명으로 접히면 그 건물은 단일 단위**다
   * (`src/lib/home.ts` 의 "room key == property → 건물만 표시"와 동일. 오쿠보는
   * `getCanonicalRoomLabel` 안에서 이미 그렇게 접힌다).
   */
  function collapsesToBuilding(propertyName: string, roomLabel: string | null): boolean {
    if (!propertyName || !roomLabel) return false;
    return getCanonicalRoomLabel(propertyName, roomLabel) === getCanonicalPropertyName(propertyName);
  }

  type Bucket = {
    propertyId: string | null;
    /** 정규화 건물명 — 객실 정규화(`getCanonicalRoomLabel`)의 입력이자 라벨 조회 키. */
    name: string;
    label: string;
    airbnb: Acc;
    booking: Acc;
    airbnbRated: number;
    bookingRated: number;
    unrated: number;
    unmapped: number;
    collapsed: boolean;
    rooms: Map<string, { name: string; airbnb: Acc; booking: Acc; airbnbRated: number; bookingRated: number; unrated: number }>;
  };
  const buckets = new Map<string, Bucket>();

  for (const review of reviews) {
    if (!review.reviewedAt) continue;
    const buildingKey = review.propertyId ?? `name:${review.propertyName ?? "unknown"}`;
    let bucket = buckets.get(buildingKey);
    if (!bucket) {
      // 원본 표기(`Okubo_A (B棟)`)는 여기서 끝내고, 아래 로직도 화면도 정규화 이름만 본다.
      const rawName =
        (review.propertyId ? nameById.get(review.propertyId) : null) ?? review.propertyName ?? "";
      const canonicalName = rawName ? getCanonicalPropertyName(rawName) : "";
      bucket = {
        propertyId: review.propertyId,
        name: canonicalName,
        label: canonicalName ? localizePropertyName(canonicalName, buildingLabels) : "",
        airbnb: { sum: 0, n: 0, risk: 0 },
        booking: { sum: 0, n: 0, risk: 0 },
        airbnbRated: 0,
        bookingRated: 0,
        unrated: 0,
        unmapped: 0,
        collapsed: false,
        rooms: new Map(),
      };
      buckets.set(buildingKey, bucket);
    }

    const acc = review.provider === "airbnb" ? bucket.airbnb : bucket.booking;
    pushStat(acc, review);
    if (review.riskLevel === "unrated") bucket.unrated += 1;
    else if (review.provider === "airbnb") bucket.airbnbRated += 1;
    else bucket.bookingRated += 1;

    // 객실 라벨이 건물명으로 접히는 운영 단위는 객실 행을 만들지 않는다.
    if (collapsesToBuilding(bucket.name, review.roomLabel)) {
      bucket.collapsed = true;
      continue;
    }
    if (!review.roomId || !review.roomLabel) {
      bucket.unmapped += 1;
      continue;
    }
    // 같은 물리 객실을 두 Beds24 어카운트가 반년씩 번갈아 쓴다(`201` / `201_2`). 리뷰는 어느
    // 어카운트에 달렸는지가 아니라 **어느 방에 달렸는지**가 중요하므로 표시 라벨로 묶는다 —
    // `getDisplayRoomLabel` 이 `_N` 접미사를 떼어 두 어카운트를 한 방으로 만든다. 반면
    // canonical 라벨은 예약 매칭용이라 둘을 구분한 채로 둬야 해서 여기 키로 쓰면 안 된다.
    const canonicalRoom = getCanonicalRoomLabel(bucket.name, review.roomLabel);
    const roomKey = getDisplayRoomLabel(getCanonicalPropertyName(bucket.name), canonicalRoom) || review.roomLabel;
    let room = bucket.rooms.get(roomKey);
    if (!room) {
      room = {
        name: roomKey,
        airbnb: { sum: 0, n: 0, risk: 0 },
        booking: { sum: 0, n: 0, risk: 0 },
        airbnbRated: 0,
        bookingRated: 0,
        unrated: 0,
      };
      bucket.rooms.set(roomKey, room);
    }
    const roomAcc = review.provider === "airbnb" ? room.airbnb : room.booking;
    pushStat(roomAcc, review);
    if (review.riskLevel === "unrated") room.unrated += 1;
    else if (review.provider === "airbnb") room.airbnbRated += 1;
    else room.bookingRated += 1;
  }

  function ratio(airbnb: Acc, booking: Acc, unrated: number): number | null {
    const total = airbnb.n + booking.n - unrated;
    if (total <= 0) return null;
    return Math.round(((airbnb.risk + booking.risk) / total) * 1000) / 10;
  }

  const summaries: BuildingSummary[] = [];
  for (const [key, bucket] of buckets) {
    summaries.push({
      key,
      name: bucket.name,
      label: bucket.label,
      propertyId: bucket.propertyId,
      standalone: bucket.collapsed && bucket.rooms.size === 0,
      airbnb: toStat(bucket.airbnb, bucket.airbnbRated),
      booking: toStat(bucket.booking, bucket.bookingRated),
      riskRatio: ratio(bucket.airbnb, bucket.booking, bucket.unrated),
      riskCount: bucket.airbnb.risk + bucket.booking.risk,
      reviewCount: bucket.airbnb.n + bucket.booking.n,
      unratedCount: bucket.unrated,
      unmappedCount: bucket.unmapped,
      rooms: [...bucket.rooms.entries()]
        .map(([roomKey, room]) => ({
          key: roomKey,
          name: room.name,
          airbnb: toStat(room.airbnb, room.airbnbRated),
          booking: toStat(room.booking, room.bookingRated),
          riskRatio: ratio(room.airbnb, room.booking, room.unrated),
          riskCount: room.airbnb.risk + room.booking.risk,
          reviewCount: room.airbnb.n + room.booking.n,
          unratedCount: room.unrated,
        }))
        .sort((a, b) => (b.riskRatio ?? -1) - (a.riskRatio ?? -1)),
    });
  }

  return summaries.sort((a, b) => (b.riskRatio ?? -1) - (a.riskRatio ?? -1));
}

// ────────────────────────────────────────────────────────────
// 리뷰 → 수동 컴플레인 전환
// ────────────────────────────────────────────────────────────

/**
 * 외부 리뷰를 근거로 수동 컴플레인을 만든다.
 *
 * 낮은 평점이라는 이유만으로 자동 생성하지 않는다 — 권한자가 명시적으로 부를 때만 실행된다.
 * 서버가 다시 확인하는 것: (1) `canWriteComplaint` 역할, (2) 리뷰가 세션 조직 소유,
 * (3) 이미 전환된 리뷰가 아닐 것. (3)은 부분 unique 인덱스로도 강제된다.
 */
export async function convertReviewToComplaint(input: {
  session: AppSession;
  reviewId: string;
  title: string;
  description?: string | null;
}): Promise<{ complaintId: string }> {
  const { session, reviewId } = input;
  const organizationId = requireOrg(session);

  if (!canWriteComplaint(session.user.role)) throw new Error("forbidden");

  const title = input.title.trim();
  if (!title) throw new Error("title_required");

  const service = getSupabaseServiceClient();

  const { data: review, error: reviewError } = await untyped(service)
    .from("external_reviews")
    .select(`${REVIEW_COLS}, organization_id, private_feedback`)
    .eq("id", reviewId)
    .maybeSingle();
  if (reviewError) throw reviewError;
  if (!review) throw new Error("not_found");

  const row = review as unknown as ReviewRow & { organization_id: string };
  if (row.organization_id !== organizationId) throw new Error("forbidden");
  if (row.linked_complaint_id) throw new Error("already_linked");

  // 전환 시점의 점수·본문·문맥을 그대로 보존한다. 리뷰가 다시 동기화되거나 건물/객실
  // 마스터가 바뀌어도 티켓 자체는 그대로 읽힌다.
  const snapshot = {
    provider: row.provider,
    externalReviewId: row.external_review_id,
    ratingValue: row.rating_value,
    ratingScale: row.rating_scale,
    riskLevel: row.risk_level,
    ratingBreakdown: row.rating_breakdown,
    reviewedAt: row.reviewed_at,
    headline: row.headline,
    reviewText: row.review_text,
    positiveReviewText: row.positive_review_text,
    negativeReviewText: row.negative_review_text,
    guestDisplayName: row.guest_display_name,
    sourceReservationId: row.source_reservation_id,
    propertyName: row.property_name,
    roomLabel: row.room_label,
    capturedAt: new Date().toISOString(),
  };

  const { data: created, error: insertError } = await untyped(service)
    .from("customer_complaints")
    .insert({
      organization_id: organizationId,
      created_by_user_id: session.user.id,
      title,
      description: input.description ?? null,
      platform: row.provider,
      status: "open",
      rating: row.rating_value,
      property_id: row.property_id,
      property_name: row.property_name,
      room_id: row.room_id,
      room_label: row.room_label,
      reservation_id: row.reservation_id,
      guest_name: row.guest_display_name,
      image_urls: [],
      external_review_id: row.id,
      external_review_snapshot: snapshot,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const { error: linkError } = await untyped(service)
    .from("external_reviews")
    .update({ linked_complaint_id: (created as { id: string }).id })
    .eq("id", row.id)
    .eq("organization_id", organizationId);
  if (linkError) throw linkError;

  return { complaintId: (created as { id: string }).id };
}
