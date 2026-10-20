"use server";

import { requireAdminSession } from "@/lib/admin-session";
import { toJstDateString } from "@/lib/admin-calendar-dashboard";
import {
  buildGuestSearchPlan,
  escapeIlikeFragment,
  matchesDigits,
  matchesGuestName,
} from "@/lib/guest-search";
import { canAccessOpsAdmin } from "@/lib/ops-admin";
import { resolveOpsReservationPlacements, type OpsReservationPlacement } from "@/lib/ops-calendar";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 어드민 상단 검색 — 고객명 · 예약번호 · 전화번호로 예약을 찾는다(2026-09-30).
 *
 * 판매 캘린더의 예약 상세 패널을 여는 것이 목적이라 같은 권한(`ops_admin.access`)을 건다.
 * service-role 로 읽으므로 **조직을 직접 건다** — RLS 가 막아 주지 않는다.
 */

/** 이름 후보를 DB 에서 넓게 받는 상한. 최종 판정은 `matchesGuestName`. */
const NAME_CANDIDATE_LIMIT = 1500;
const RESULT_LIMIT = 20;

const DETAIL_SELECT =
  "id, guest_name, check_in_date, check_out_date, property_name, room_label, source, status, raw_payload";

type CandidateRow = {
  id: string;
  guest_name: string;
  check_in_date: string;
  status: string;
};

export type ReservationSearchResult =
  | { ok: true; results: OpsReservationPlacement[] }
  | { ok: false; error: "forbidden" };

async function requireOpsReader() {
  const session = await requireAdminSession();
  if (!canAccessOpsAdmin(session)) return null;
  return session;
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
}

export async function searchOpsReservations(rawQuery: string): Promise<ReservationSearchResult> {
  const session = await requireOpsReader();
  if (!session) return { error: "forbidden", ok: false };

  const plan = buildGuestSearchPlan(rawQuery);
  if (!plan) return { ok: true, results: [] };

  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const candidates = new Map<string, CandidateRow>();

  const lookups: Promise<void>[] = [];

  if (plan.nameFragments.length > 0) {
    let query = supabase
      .from("reservations")
      .select("id, guest_name, check_in_date, status")
      .eq("organization_id", organizationId);
    for (const fragment of plan.nameFragments) {
      const safe = escapeIlikeFragment(fragment);
      if (safe) query = query.ilike("guest_name", `%${safe}%`);
    }
    lookups.push(
      Promise.resolve(
        query.order("check_in_date", { ascending: false }).limit(NAME_CANDIDATE_LIMIT),
      ).then(({ data, error }) => {
        if (error) {
          console.error("[ops-search] name lookup failed", error);
          return;
        }
        for (const row of data ?? []) {
          if (matchesGuestName(rawQuery, row.guest_name)) candidates.set(row.id, row);
        }
      }),
    );
  }

  if (plan.reference) {
    const ref = escapeIlikeFragment(plan.reference);
    const filters = [
      `raw_payload->>id.eq.${ref}`,
      `raw_payload->>masterId.eq.${ref}`,
      `raw_payload->>apiReference.ilike.%${ref}%`,
      `source_reservation_id.ilike.${ref}%`,
    ];
    if (/^[0-9a-f-]{36}$/i.test(ref)) filters.push(`id.eq.${ref}`);
    lookups.push(
      Promise.resolve(
        supabase
          .from("reservations")
          .select("id, guest_name, check_in_date, status")
          .eq("organization_id", organizationId)
          .or(filters.join(","))
          .order("check_in_date", { ascending: false })
          .limit(100),
      ).then(({ data, error }) => {
        if (error) {
          console.error("[ops-search] reference lookup failed", error);
          return;
        }
        for (const row of data ?? []) candidates.set(row.id, row);
      }),
    );
  }

  // 전화번호는 하이픈·공백·국가번호가 섞여 저장된다 — 숫자 사이에 `%` 를 끼워 넓게 받고
  // `matchesDigits` 로 다시 본다. 6자리 미만은 우연히 맞는 번호가 너무 많다.
  if (plan.digits && plan.digits.length >= 6) {
    const core = plan.digits.startsWith("0") ? plan.digits.slice(1) : plan.digits;
    const pattern = `%${core.split("").join("%")}%`;
    lookups.push(
      Promise.resolve(
        supabase
          .from("reservations")
          .select("id, guest_name, check_in_date, status, raw_payload->>phone, raw_payload->>mobile")
          .eq("organization_id", organizationId)
          .or(`raw_payload->>phone.ilike.${pattern},raw_payload->>mobile.ilike.${pattern}`)
          .order("check_in_date", { ascending: false })
          .limit(200),
      ).then(({ data, error }) => {
        if (error) {
          console.error("[ops-search] phone lookup failed", error);
          return;
        }
        for (const row of (data ?? []) as unknown as (CandidateRow & { phone: string | null; mobile: string | null })[]) {
          if (matchesDigits(rawQuery, row.phone) || matchesDigits(rawQuery, row.mobile)) {
            candidates.set(row.id, row);
          }
        }
      }),
    );
  }

  await Promise.all(lookups);
  if (candidates.size === 0) return { ok: true, results: [] };

  // 살아 있는 예약 먼저, 그다음 오늘과 가까운 순 — 찾는 사람은 대개 지금·곧 묵는 손님이다.
  const today = toJstDateString(new Date());
  const picked = [...candidates.values()]
    .sort((a, b) => {
      const aDead = a.status === "cancelled" || a.status === "no_show" ? 1 : 0;
      const bDead = b.status === "cancelled" || b.status === "no_show" ? 1 : 0;
      if (aDead !== bDead) return aDead - bDead;
      return dayDistance(a.check_in_date, today) - dayDistance(b.check_in_date, today);
    })
    .slice(0, RESULT_LIMIT);

  const detail = await supabase
    .from("reservations")
    .select(DETAIL_SELECT)
    .eq("organization_id", organizationId)
    .in(
      "id",
      picked.map((row) => row.id),
    );
  if (detail.error || !detail.data) {
    console.error("[ops-search] detail read failed", detail.error);
    return { ok: true, results: [] };
  }
  const order = new Map(picked.map((row, index) => [row.id, index]));
  const rows = [...detail.data].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return { ok: true, results: await resolveOpsReservationPlacements(organizationId, supabase, rows) };
}

/** 다른 화면에서 검색 결과를 골라 판매 캘린더로 넘어왔을 때(`?resv=`) — 그 예약 한 건. */
export async function loadOpsReservationPlacement(
  reservationId: string,
): Promise<{ ok: true; placement: OpsReservationPlacement } | { ok: false; error: "forbidden" | "not_found" }> {
  const session = await requireOpsReader();
  if (!session) return { error: "forbidden", ok: false };
  if (!/^[0-9a-f-]{36}$/i.test(reservationId)) return { error: "not_found", ok: false };

  const supabase = getSupabaseServiceClient();
  const result = await supabase
    .from("reservations")
    .select(DETAIL_SELECT)
    .eq("organization_id", session.organization.id)
    .eq("id", reservationId)
    .maybeSingle();
  if (result.error || !result.data) return { error: "not_found", ok: false };

  const [placement] = await resolveOpsReservationPlacements(session.organization.id, supabase, [result.data]);
  return placement ? { ok: true, placement } : { error: "not_found", ok: false };
}
