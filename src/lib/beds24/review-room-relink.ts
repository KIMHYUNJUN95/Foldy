import type { SupabaseClient } from "@supabase/supabase-js";

import { getOptionalBeds24ApiEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { resolveBeds24AccessToken } from "./access-token";
import { readBeds24Credits } from "./credits";

/**
 * 객실이 비어 있는 외부 리뷰를 사후에 다시 연결한다.
 *
 * 존재 이유
 * ---------------
 * Airbnb 리뷰는 `roomId` 로 조회하므로 객실이 처음부터 확정이다(실측 0/2,215 미연결).
 * **Booking.com 은 건물 단위(`propertyId`)로만 조회**돼서, 객실을 예약을 거쳐 역추적해야 한다.
 * 그 역추적이 2026-08-07 실측에서 165/253(65%) 실패하고 있었고, 원인은 두 가지였다.
 *
 * 1. **예약이 우리 DB에 없다 (128건).** `reservations` 는 «당월 + 향후 2개월» 창으로만 백필돼
 *    체크인 2026-04-22 이전 예약이 아예 없다. 그래서 2026-04 이전 Booking 리뷰는 매핑률 0% 였다.
 * 2. **리뷰가 예약보다 먼저 들어왔다 (34건).** 수집 시점엔 예약이 없어 null 로 저장됐는데,
 *    Booking 리뷰는 `from=최근날짜` 로만 다시 조회되므로 **오래된 리뷰는 파이프라인에 다시
 *    올라오지 않는다.** 재수집으로는 영영 안 채워진다 — 재연결이 따로 있어야 하는 이유다.
 *
 * 리뷰 payload 자체에는 객실 정보가 없다(전 키 실측: url/reply/content/scoring/reviewer/
 * review_id/reservation_id/created_timestamp/last_change_timestamp). 있는 건 예약번호뿐이다.
 * 그래서 2번은 DB 안에서 공짜로, 1번은 Beds24 `/bookings?apiReference=` 로 푼다.
 *
 * 크레딧
 * ------
 * `apiReference` 는 **한 요청에 여러 개**를 실을 수 있다(실측: 40개 배치 = 1크레딧). 128건 전수
 * 조회가 4요청·4크레딧이었다. 상시 경로에서도 배치는 그대로 쓰고, 아래 두 가지로 더 조인다.
 *
 * - `lookupMaxAgeDays`: 오래된 리뷰는 조회하지 않는다. 영영 못 찾는 건(Beds24 에서 삭제된
 *   예약 등)이 **매일 크레딧을 태우는 것**을 막는 장치다. 상태 컬럼을 새로 만드는 대신 나이로
 *   스스로 빠지게 했다.
 * - `maxLookupRequests`: 한 번 실행의 요청 수 상한. 예상 밖으로 대상이 불어나도 비용이 튀지 않는다.
 */

/** 실측으로 확인한 배치 크기 — 40개를 한 요청에 실어도 cost=1 이다. */
const LOOKUP_BATCH = 40;

/**
 * 조회할 예약 상태 전부.
 *
 * **`status` 를 생략하면 Beds24 는 취소 예약을 빼고 준다.** 이걸 몰라서 2026-08-07 첫 백필이
 * 1건을 «Beds24 에도 없다» 고 잘못 결론지었다. 실제로는 `status=cancelled` 인 예약이 멀쩡히
 * 있었고 `roomId` 도 들어 있었다.
 *
 * 취소된 예약에도 리뷰가 달린다 — 일부만 묵고 나머지를 취소하는 식은 흔하다. 리뷰가 존재하는
 * 이상 그 방을 가리키는 것이 맞으므로 취소분도 똑같이 연결한다.
 *
 * 상태를 여러 개 실어도 **비용은 그대로 1** 이다(실측). 요청을 두 번 나눌 이유가 없다.
 */
const LOOKUP_STATUSES = ["new", "request", "confirmed", "cancelled", "black"] as const;
/** 업데이트 왕복을 병렬로 묶는 단위. */
const UPDATE_CHUNK = 25;
const RESERVATION_PAGE = 1000;

export type ReviewRelinkResult = {
  /** 객실이 비어 있어 검사한 리뷰 수. */
  scanned: number;
  /** 우리 DB의 예약만으로 객실을 채운 건수(크레딧 0). */
  linkedFromReservations: number;
  /** Beds24 예약 조회로 객실을 채운 건수. */
  linkedFromBeds24: number;
  /** 객실은 못 찾았지만 예약 링크는 채운 건수. */
  reservationLinked: number;
  lookupRequests: number;
  creditsRemaining: number | null;
  /** 끝내 객실을 못 채운 리뷰 수. */
  unresolved: number;
  skipped: string[];
};

type RoomRow = {
  id: string;
  room_label: string;
  property_id: string;
  external_room_id: string | null;
};

type ReviewRow = {
  id: string;
  provider: string;
  property_id: string | null;
  room_id: string | null;
  reservation_id: string | null;
  source_reservation_id: string | null;
  reviewed_at: string | null;
};

type ReservationRow = {
  id: string;
  source_reservation_id: string;
  room_label: string;
  api_reference: string | null;
};

type Patch = { room_id?: string; room_label?: string; reservation_id?: string };

function untyped(client: SupabaseClient<unknown>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

export async function relinkReviewRooms(input: {
  organizationId: string;
  /**
   * 이 일수보다 오래된 리뷰는 **Beds24 조회 대상에서 뺀다**(DB 안 재연결은 나이와 무관하게 전부).
   * `null` 이면 제한 없음 — 일회성 백필 전용이다.
   */
  lookupMaxAgeDays: number | null;
  /** false 면 크레딧을 한 개도 쓰지 않고 DB 안에서만 재연결한다. */
  allowLookup: boolean;
  maxLookupRequests: number;
}): Promise<ReviewRelinkResult> {
  const { organizationId, lookupMaxAgeDays, allowLookup, maxLookupRequests } = input;
  const skipped: string[] = [];
  const result: ReviewRelinkResult = {
    scanned: 0,
    linkedFromReservations: 0,
    linkedFromBeds24: 0,
    reservationLinked: 0,
    lookupRequests: 0,
    creditsRemaining: null,
    unresolved: 0,
    skipped,
  };

  const db = untyped(getSupabaseServiceClient() as unknown as SupabaseClient<unknown>);

  const { data: reviewData, error: reviewError } = await db
    .from("external_reviews")
    .select("id, provider, property_id, room_id, reservation_id, source_reservation_id, reviewed_at")
    .eq("organization_id", organizationId)
    .is("room_id", null)
    .not("source_reservation_id", "is", null);
  if (reviewError) {
    skipped.push(`relink:reviews-${reviewError.code ?? "failed"}`);
    return result;
  }
  const reviews = (reviewData ?? []) as ReviewRow[];
  result.scanned = reviews.length;
  if (reviews.length === 0) return result;

  const { data: roomData, error: roomError } = await db
    .from("rooms")
    .select("id, room_label, property_id, external_room_id")
    .eq("organization_id", organizationId);
  if (roomError) {
    skipped.push(`relink:rooms-${roomError.code ?? "failed"}`);
    return result;
  }
  const rooms = (roomData ?? []) as RoomRow[];
  const roomByPropertyLabel = new Map(rooms.map((r) => [`${r.property_id}::${r.room_label}`, r]));
  const roomsByExternalId = new Map<string, RoomRow[]>();
  for (const room of rooms) {
    const ext = room.external_room_id?.trim();
    if (!ext) continue;
    const list = roomsByExternalId.get(ext) ?? [];
    list.push(room);
    roomsByExternalId.set(ext, list);
  }

  // 예약 인덱스. **페이지네이션은 선택이 아니다** — PostgREST 는 `range()` 없는 select 를
  // 1000행에서 자르고, 잘린 절반은 조용히 매칭 실패가 된다(2026-08-06 실제 사고).
  const reservations: ReservationRow[] = [];
  for (let offset = 0; ; offset += RESERVATION_PAGE) {
    const { data: page, error } = await db
      .from("reservations")
      .select("id, source_reservation_id, room_label, api_reference:raw_payload->>apiReference")
      .eq("organization_id", organizationId)
      .range(offset, offset + RESERVATION_PAGE - 1);
    if (error) {
      skipped.push(`relink:reservations-${error.code ?? "failed"}`);
      return result;
    }
    const rows = (page ?? []) as ReservationRow[];
    reservations.push(...rows);
    if (rows.length < RESERVATION_PAGE) break;
  }

  // `source_reservation_id` 는 `{예약ID}::room::{객실}` 형태다 — 한 예약이 여러 객실에 걸칠 수
  // 있어 객실별로 행을 나누기 때문이다. 리뷰는 접미사 없는 순수 ID만 주므로 접두 인덱스를 만든다.
  const reservationBySource = new Map<string, ReservationRow>();
  const reservationByApiReference = new Map<string, ReservationRow>();
  for (const reservation of reservations) {
    const raw = reservation.source_reservation_id;
    if (raw) {
      reservationBySource.set(raw, reservation);
      const bare = raw.split("::")[0];
      if (bare !== raw) {
        const seen = reservationBySource.get(bare);
        // 같은 예약이 여러 객실이면 객실은 확정할 수 없다. 임의로 고르면 **틀린 객실에 문제를
        // 귀속**시키게 되므로 빈 라벨로 표시해 두고 객실은 비워 둔다(예약 링크는 채운다).
        if (seen === undefined) reservationBySource.set(bare, reservation);
        else if (seen.room_label !== reservation.room_label) {
          reservationBySource.set(bare, { ...seen, room_label: "" });
        }
      }
    }
    const ref = reservation.api_reference?.trim();
    if (ref && !reservationByApiReference.has(ref)) reservationByApiReference.set(ref, reservation);
  }

  const patches = new Map<string, Patch>();
  const needLookup: ReviewRow[] = [];

  for (const review of reviews) {
    const sourceId = review.source_reservation_id?.trim();
    if (!sourceId) continue;
    // Booking 은 순수 예약번호로, Airbnb 는 확인 코드(`apiReference`)로 들어온다.
    const reservation = reservationBySource.get(sourceId) ?? reservationByApiReference.get(sourceId);
    if (!reservation) {
      needLookup.push(review);
      continue;
    }

    const patch: Patch = {};
    if (!review.reservation_id) patch.reservation_id = reservation.id;
    if (reservation.room_label && review.property_id) {
      const room = roomByPropertyLabel.get(`${review.property_id}::${reservation.room_label}`);
      if (room) {
        patch.room_id = room.id;
        patch.room_label = room.room_label;
      }
    }
    if (patch.room_id) result.linkedFromReservations += 1;
    else if (patch.reservation_id) result.reservationLinked += 1;
    if (Object.keys(patch).length > 0) patches.set(review.id, patch);
  }

  // ── Beds24 조회 (크레딧을 쓰는 유일한 경로) ────────────────────────────────
  if (allowLookup && needLookup.length > 0) {
    const env = getOptionalBeds24ApiEnv();
    if (!env) {
      skipped.push("relink:missing-env");
    } else {
      const cutoff =
        lookupMaxAgeDays === null
          ? null
          : new Date(Date.now() - lookupMaxAgeDays * 24 * 60 * 60 * 1000).toISOString();
      const fresh = cutoff
        ? needLookup.filter((r) => r.reviewed_at !== null && r.reviewed_at >= cutoff)
        : needLookup;
      const aged = needLookup.length - fresh.length;
      // 조용히 빼지 않는다 — 「수집이 되고 있다」는 착각을 만들지 않기 위해 드러낸다.
      if (aged > 0) skipped.push(`relink:aged-out-${aged}`);

      const tokenState = await resolveBeds24AccessToken("relink");
      if (!tokenState.ok) {
        skipped.push(tokenState.skipped);
      } else {
        const base = env.baseUrl.replace(/\/$/, "");
        const byReference = new Map<string, { roomId: string | null }>();

        for (let i = 0; i < fresh.length; i += LOOKUP_BATCH) {
          if (result.lookupRequests >= maxLookupRequests) {
            // 남은 건 다음 주기가 이어받는다. 한 번에 다 하려다 비용이 튀는 쪽이 더 나쁘다.
            skipped.push(`relink:lookup-capped-${fresh.length - i}`);
            break;
          }
          const chunk = fresh.slice(i, i + LOOKUP_BATCH);
          const qs = [
            ...chunk.map((r) => `apiReference=${encodeURIComponent(r.source_reservation_id ?? "")}`),
            ...LOOKUP_STATUSES.map((s) => `status=${s}`),
          ].join("&");
          let json: { data?: unknown } | null = null;
          try {
            const response = await fetch(`${base}/bookings?${qs}`, {
              headers: { accept: "application/json", token: tokenState.token },
              cache: "no-store",
            });
            result.lookupRequests += 1;
            const credits = readBeds24Credits(response.headers);
            if (credits.remaining !== null) result.creditsRemaining = credits.remaining;
            if (!response.ok) {
              skipped.push(`relink:lookup-http-${response.status}`);
              continue;
            }
            json = (await response.json()) as { data?: unknown };
          } catch {
            result.lookupRequests += 1;
            skipped.push("relink:lookup-request-error");
            continue;
          }
          const rows = Array.isArray(json?.data) ? (json.data as Record<string, unknown>[]) : [];
          for (const row of rows) {
            const ref = row.apiReference === null || row.apiReference === undefined ? null : String(row.apiReference);
            if (!ref) continue;
            const roomId = row.roomId === null || row.roomId === undefined ? null : String(row.roomId);
            byReference.set(ref, { roomId });
          }
        }

        for (const review of fresh) {
          const sourceId = review.source_reservation_id?.trim();
          if (!sourceId) continue;
          const booking = byReference.get(sourceId);
          if (!booking?.roomId) continue;
          const candidates = roomsByExternalId.get(booking.roomId) ?? [];
          // 같은 Beds24 객실이 우리 쪽 여러 행에 매핑돼 있을 수 있다(계정이 2개인 객실).
          // 리뷰의 건물과 일치하는 행을 먼저 쓰고, 그래도 못 좁히면 **추정하지 않는다**.
          const room =
            candidates.find((c) => c.property_id === review.property_id) ??
            (candidates.length === 1 ? candidates[0] : null);
          if (!room) {
            if (candidates.length > 1) skipped.push(`relink:ambiguous-room-${booking.roomId}`);
            continue;
          }
          const patch = patches.get(review.id) ?? {};
          patch.room_id = room.id;
          patch.room_label = room.room_label;
          patches.set(review.id, patch);
          result.linkedFromBeds24 += 1;
        }
      }
    }
  }

  // ── 반영 ──────────────────────────────────────────────────────────────────
  const entries = [...patches.entries()];
  for (let i = 0; i < entries.length; i += UPDATE_CHUNK) {
    const chunk = entries.slice(i, i + UPDATE_CHUNK);
    const results = await Promise.all(
      chunk.map(([id, patch]) => db.from("external_reviews").update(patch).eq("id", id)),
    );
    for (const { error } of results) {
      if (error) skipped.push(`relink:update-${error.code ?? "failed"}`);
    }
  }

  const linked = new Set(entries.filter(([, p]) => p.room_id).map(([id]) => id));
  result.unresolved = reviews.length - linked.size;
  return result;
}
