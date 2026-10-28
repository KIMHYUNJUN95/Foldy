import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 할 일에 연결하는 운영 컨텍스트 id(건물 / 객실 / 예약)가 **이 조직 것인지** 서버에서 확인한다(2026-10-28).
 *
 * 할 일 쓰기는 서비스 키라 RLS 가 막아 주지 않는다 — 예전에는 폼이 보낸 id 를 그대로 저장해서, 다른 조직의
 * 예약 id 를 붙이면 상세 화면이 그 예약(게스트 이름 · 날짜)을 풀어 보여 줄 수 있었다. 선택기는 조직 범위로만
 * 고르게 하지만 UI 를 믿지 않는다. 종류마다 쿼리 한 번(값이 있는 것만), 모두 함께 돈다.
 *
 * 비어 있는 값은 «연결 없음»이라 그대로 통과한다. 하나라도 조직 밖 · 없는 id · uuid 가 아닌 값이면 false.
 */
export async function linkedContextBelongsToOrg(
  organizationId: string,
  ctx: { propertyId: string | null; roomId: string | null; reservationId: string | null },
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const check = async (table: "properties" | "rooms" | "reservations", id: string | null) => {
    if (!id) return true;
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    // uuid 가 아닌 값은 Postgres 가 오류로 돌려준다 — 닫힌 쪽(거절)으로 본다.
    if (error) return false;
    return !!data;
  };
  const results = await Promise.all([
    check("properties", ctx.propertyId),
    check("rooms", ctx.roomId),
    check("reservations", ctx.reservationId),
  ]);
  return results.every(Boolean);
}
