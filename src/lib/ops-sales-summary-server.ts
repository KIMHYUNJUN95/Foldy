import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toJstDateString } from "@/lib/admin-calendar-dashboard";
import { opsCalendarWindow, readOpsSalesInputs } from "@/lib/ops-calendar";
import { buildOpsSalesSummary, type OpsSalesSummary, type SalesRawPayload } from "@/lib/ops-sales-summary";
import { shiftDateYear, type SalesYoyPrevious } from "@/lib/ops-sales-yoy";
import { getCanonicalPropertyName } from "@/lib/room-label-normalization";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServer = Awaited<ReturnType<typeof getSupabaseServerClient>>;

/**
 * 판매 캘린더 「매출 요약」의 읽기 — **격자와 같은 창 · 같은 객실 축 · 같은 차단 판정**.
 *
 * 읽기는 `readOpsSalesInputs`(ops-calendar.ts — 격자의 매칭·제외 객실·차단 규칙을 그대로 쓰되 요약에 필요한
 * 열만, 조회 넷을 동시에), 계산은 순수 모듈(`ops-sales-summary.ts`). 원본 JSON 은 금액·수수료·채널·상태 키만
 * 받는다 — 결제 토큰 등은 서버 밖으로 나가지 않는다.
 *
 * **전년 동기**(2026-10-05): 같은 날짜 1년 전 창을 **같은 식 · 같은 객실 축으로 동시에** 읽어 객실별 매출만 넘기고,
 * 건물마다 첫 손님 날짜(「운영 전」 판정)도 같이 읽는다. 비교 자체는 화면이 한다(`buildSalesYoy` — 합계에 넣을 건물을
 * 바꿔도 다시 부르지 않게).
 */
export async function getOpsSalesSummary(
  session: AppSession,
  filters: { mode: "rolling" | "monthly"; start: string; month: string; properties: readonly string[] },
): Promise<OpsSalesSummary & { properties: string[]; previous: SalesYoyPrevious }> {
  const today = toJstDateString(new Date());
  const window = opsCalendarWindow(filters);
  const previousWindow = { endExclusive: shiftDateYear(window.endExclusive, -1), start: shiftDateYear(window.start, -1) };
  const supabase = await getSupabaseServerClient();
  const read = (target: { start: string; endExclusive: string }) =>
    readOpsSalesInputs({ organizationId: session.organization.id, properties: filters.properties, supabase, window: target });
  const [inputs, previousInputs, firstStayRaw] = await Promise.all([
    read(window),
    read(previousWindow),
    readFirstStays(supabase, session.organization.id),
  ]);
  const summarize = (source: typeof inputs, target: { start: string; endExclusive: string }) =>
    buildOpsSalesSummary({
      blocks: source.blocks,
      endExclusive: target.endExclusive,
      properties: source.properties,
      reservations: source.reservations.map((reservation) => ({
        ...reservation,
        raw: reservation.raw as SalesRawPayload,
      })),
      rooms: source.rooms,
      start: target.start,
      today,
    });
  const summary = summarize(inputs, window);
  const previousSummary = summarize(previousInputs, previousWindow);

  // 요약의 건물 이름 ↔ 예약 원본 이름(「Arakicho A」 등)은 정규화 이름으로 맞춘다.
  const firstStay: Record<string, string | null> = {};
  for (const row of summary.byProperty) {
    const canonical = getCanonicalPropertyName(row.propertyName);
    let earliest: string | null = null;
    for (const [rawName, date] of firstStayRaw) {
      if (getCanonicalPropertyName(rawName) !== canonical) continue;
      if (earliest === null || date < earliest) earliest = date;
    }
    firstStay[row.propertyName] = earliest;
  }

  return {
    ...summary,
    previous: {
      endExclusive: previousWindow.endExclusive,
      firstStay,
      rooms: previousSummary.byProperty.flatMap((row) =>
        row.rooms.map((room) => ({ key: room.key, propertyName: row.propertyName, revenue: room.revenue })),
      ),
      start: previousWindow.start,
    },
    properties: inputs.properties,
  };
}

/** RPC 가 아직 DB 에 없다(마이그레이션 적용 전) — PostgREST 스키마 캐시에 없음 · Postgres 함수 없음. */
function isMissingRpc(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/**
 * 건물(예약 원본 이름)마다 첫 손님 체크인 — 취소 제외.
 *
 * DB 함수 `reservation_first_check_ins`(마이그레이션 `202610190004`) 한 번으로 묻는다 — 건물마다 부분 인덱스 한 칸만 읽는다
 * (2026-10-19 속도, 전에는 건물 수만큼 조회를 동시에 보내 예약이 없는 건물은 표 전체를 훑었다). 함수가 아직 없으면 예전
 * 방식(건물마다 한 줄 조회)으로 읽는다 — 결과는 같다.
 */
async function readFirstStays(supabase: SupabaseServer, organizationId: string): Promise<Map<string, string>> {
  const { data: properties, error } = await supabase.from("properties").select("name").eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  const names = [...new Set((properties ?? []).map((row) => row.name))];
  const result = new Map<string, string>();
  if (names.length === 0) return result;

  const rpc = await (supabase as unknown as SupabaseClient).rpc("reservation_first_check_ins", {
    p_organization_id: organizationId,
    p_property_names: names,
  });
  if (!rpc.error) {
    for (const row of (rpc.data ?? []) as Array<{ property_name: string; first_check_in: string | null }>) {
      if (row.first_check_in) result.set(row.property_name, row.first_check_in);
    }
    return result;
  }
  if (!isMissingRpc(rpc.error)) throw new Error(rpc.error.message);

  const firsts = await Promise.all(
    names.map(async (name) => {
      const { data, error: readError } = await supabase
        .from("reservations")
        .select("check_in_date")
        .eq("organization_id", organizationId)
        .eq("property_name", name)
        .neq("status", "cancelled")
        .order("check_in_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      return [name, data?.check_in_date ?? null] as const;
    }),
  );
  for (const [name, date] of firsts) if (date) result.set(name, date);
  return result;
}
