import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import {
  getCanonicalPropertyName,
  isExcludedOperationalProperty,
  localizePropertyName,
} from "@/lib/room-label-normalization";
import {
  TRANSPORT_OFFICE_KEY,
  TRANSPORT_OTHER_KEY,
  type TransportDestination,
} from "@/lib/transport-destinations";
import type { Database } from "@/types/database";

/**
 * 출근지 목록·최근 금액을 **읽어오는** 쪽. 키와 판정은 순수 모듈
 * (`transport-destinations.ts`)에 있고 화면도 그것을 본다.
 */

/**
 * 출근지 목록. 캘린더와 같은 건물 집합 + 사무실 + 기타.
 *
 * 건물이 하나도 없으면(신규 조직) 사무실·기타만 남는다 — 빈 목록을 주는 것보다 낫다.
 */
export async function listTransportDestinations(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  dict: Dictionary,
): Promise<TransportDestination[]> {
  const { data, error } = await supabase
    .from("properties")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) {
    // 목록을 못 읽어도 입력 자체는 막지 않는다 — 사무실·기타로는 넣을 수 있다.
    console.error("[transport/destinations] property read failed", error.message);
  }

  const buildingLabels = dict.cleaning.buildingLabels;
  const ko = getDictionary("ko");
  const properties = (data ?? [])
    .filter((row) => !isExcludedOperationalProperty(row.name))
    .map<TransportDestination>((row) => ({
      key: row.id,
      // **정규화를 먼저 거쳐야 한다.** `localizePropertyName` 은 정규화된 이름(`아라키초A`)을
      // 받아 로케일 라벨을 찾는다. Beds24 원본(`Arakicho A`)을 그대로 넘기면 매핑이 하나도
      // 안 걸려 원본이 그대로 보인다 — 캘린더는 한국어인데 교통비만 영어로 나왔다.
      label: localizePropertyName(getCanonicalPropertyName(row.name), buildingLabels),
      canonicalLabel: getCanonicalPropertyName(row.name),
      propertyId: row.id,
      kind: "property",
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));

  return [
    ...properties,
    {
      key: TRANSPORT_OFFICE_KEY,
      label: dict.transport.buildings.office,
      canonicalLabel: ko.transport.buildings.office,
      propertyId: null,
      kind: "office",
    },
    {
      key: TRANSPORT_OTHER_KEY,
      label: dict.transport.destinationOther,
      canonicalLabel: ko.transport.destinationOther,
      propertyId: null,
      kind: "other",
    },
  ];
}

/**
 * 사용자가 그 출근지에 **마지막으로 넣은 금액**.
 *
 * 「같은 사람이 같은 곳으로 가면 운임은 그대로」라는 현실을 쓴다. 매일 10~20명이 왕복 금액을
 * 손으로 치는 대신, 지난번 값을 미리 채워 준다.
 *
 * **가장 최근 값**을 쓴다(가장 흔한 값이 아니라). 운임이 오르면 다음부터 새 값이 따라와야 하기
 * 때문이다. 대신 화면에는 **언제 것인지 같이 보여준다** — 근거 없이 채우면 틀린 값을 그대로
 * 확정하게 된다.
 *
 * 기타(`other`)는 기억하지 않는다. 매번 다른 목적의 지출이라 지난 금액이 근거가 못 된다.
 */
export async function getRecentTransportAmounts(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  userId: string,
): Promise<Record<string, { amountYen: number; usageDate: string }>> {
  const { data, error } = await supabase
    .from("transport_reimbursement_items")
    .select("property_id, amount_yen, usage_date, work_context")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .order("usage_date", { ascending: false })
    .limit(400);

  if (error) {
    console.error("[transport/destinations] recent amount read failed", error.message);
    return {};
  }

  const recent: Record<string, { amountYen: number; usageDate: string }> = {};
  for (const row of data ?? []) {
    const context = (row.work_context ?? {}) as { destinationKey?: unknown };
    const key =
      row.property_id ??
      (typeof context.destinationKey === "string" ? context.destinationKey : null);
    if (!key || key === TRANSPORT_OTHER_KEY) continue;
    // 정렬이 최신순이므로 처음 만난 것이 가장 최근이다.
    if (!recent[key]) recent[key] = { amountYen: row.amount_yen, usageDate: row.usage_date };
  }
  return recent;
}
