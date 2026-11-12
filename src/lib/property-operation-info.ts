import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSession } from "@/lib/session";
import { PROPERTY_MAP_META, type PropertyMapMeta } from "@/lib/property-map-links";
import {
  classifyPropertyInfoReadError,
  cloneBasePropertyMapMeta,
  mergePropertyMapMeta,
  type PropertyInfoInput,
  type PropertyOperationInfoOverride,
  validatePropertyInfoInput,
} from "@/lib/property-operation-info-rules";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/types/database";

// 규칙(합치기 · 검사 · 오류 나누기)은 `property-operation-info-rules.ts` — 여기는 DB 읽기 · 쓰기만.

const SELECT_COLUMNS =
  "canonical_name, address_ko, address_ja, address_en, shared_access, room_access, note, updated_at";

function untyped(client: SupabaseClient<Database>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

/**
 * 건물 운영 정보 — 읽기 실패를 **숨기지 않는다**(2026-11-12).
 *
 * 표가 없을 때(마이그레이션 전)만 코드 기본값. 다른 오류면 `loadFailed: true` 와 빈 목록 — 옛 출입 코드를 보이지 않는다.
 */
export async function loadPropertyMapMeta(
  session: AppSession,
): Promise<{ items: PropertyMapMeta[]; loadFailed: boolean }> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await untyped(supabase)
    .from("property_operation_infos")
    .select(SELECT_COLUMNS)
    .eq("organization_id", session.organization.id);

  if (error) {
    if (classifyPropertyInfoReadError(error) === "missing_table") {
      return { items: PROPERTY_MAP_META.map(cloneBasePropertyMapMeta), loadFailed: false };
    }
    console.error("[property-operation-info] read failed", { code: error.code });
    return { items: [], loadFailed: true };
  }

  const overrideMap = new Map(
    ((data ?? []) as PropertyOperationInfoOverride[]).map((row) => [row.canonical_name, row]),
  );
  return {
    items: PROPERTY_MAP_META.map((item) => mergePropertyMapMeta(item, overrideMap.get(item.canonicalName))),
    loadFailed: false,
  };
}

/** 예전 모양(목록만) — 읽기 실패면 던진다(부르는 쪽이 `.catch` 로 처리, 룸 링크). */
export async function listPropertyMapMeta(session: AppSession): Promise<PropertyMapMeta[]> {
  const result = await loadPropertyMapMeta(session);
  if (result.loadFailed) throw new Error("property_info_read_failed");
  return result.items;
}

export type SavePropertyOperationInfoResult =
  | { ok: true; info: PropertyMapMeta }
  | { ok: false; error: "conflict"; current: PropertyMapMeta }
  | { ok: false; error: "invalid_input" | "invalid_property" | "save_failed" | "too_long" };

async function readCurrent(
  service: SupabaseClient,
  organizationId: string,
  base: PropertyMapMeta,
): Promise<PropertyMapMeta | null> {
  const { data, error } = await service
    .from("property_operation_infos")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("canonical_name", base.canonicalName)
    .maybeSingle();
  if (error) return null;
  return mergePropertyMapMeta(base, (data ?? undefined) as PropertyOperationInfoOverride | undefined);
}

/**
 * 저장 — 화면이 본 버전(`expectedUpdatedAt`)일 때만 고친다(2026-11-12).
 *
 * - `null` = 저장된 줄이 없던 화면 → 아직 없을 때만 만든다(겹치면 23505 → 충돌).
 * - 값 = 그 `updated_at` 이 그대로일 때만 update. 0줄이면 누가 먼저 고친 것 → 충돌 + 최신 값.
 */
export async function savePropertyOperationInfo(input: {
  canonicalName: string;
  data: PropertyInfoInput;
  expectedUpdatedAt: string | null;
  session: AppSession;
}): Promise<SavePropertyOperationInfoResult> {
  const base = PROPERTY_MAP_META.find((item) => item.canonicalName === input.canonicalName);
  if (!base) return { ok: false, error: "invalid_property" };

  const checked = validatePropertyInfoInput(base, input.data);
  if (!checked.ok) return { ok: false, error: checked.error };

  const organizationId = input.session.organization.id;
  const service = untyped(getSupabaseServiceClient());
  const values = {
    ...checked.value,
    room_access: checked.value.room_access as unknown as Json,
    shared_access: checked.value.shared_access as unknown as Json,
  };

  const conflict = async (): Promise<SavePropertyOperationInfoResult> => {
    const current = await readCurrent(service, organizationId, base);
    return current ? { ok: false, error: "conflict", current } : { ok: false, error: "save_failed" };
  };

  if (input.expectedUpdatedAt === null) {
    const { data, error } = await service
      .from("property_operation_infos")
      .insert({ ...values, canonical_name: input.canonicalName, organization_id: organizationId })
      .select(SELECT_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") return conflict();
      console.error("[property-operation-info] insert failed", { code: error.code });
      return { ok: false, error: "save_failed" };
    }
    return { ok: true, info: mergePropertyMapMeta(base, data as PropertyOperationInfoOverride) };
  }

  const { data, error } = await service
    .from("property_operation_infos")
    .update(values)
    .eq("organization_id", organizationId)
    .eq("canonical_name", input.canonicalName)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (error) {
    console.error("[property-operation-info] update failed", { code: error.code });
    return { ok: false, error: "save_failed" };
  }
  if (!data) return conflict();
  return { ok: true, info: mergePropertyMapMeta(base, data as PropertyOperationInfoOverride) };
}
