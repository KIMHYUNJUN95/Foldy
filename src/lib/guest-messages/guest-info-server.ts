/**
 * 건물 정보 손님용 칸 — 읽기 · 저장(서버 전용, service_role + 조직 필터 명시). docs/product/47-guest-messaging.md §6-3
 *
 * 권한은 부르는 쪽이 먼저 본다(읽기: 메시지 보기 · 답장, 저장: `property_info.edit`).
 * 저장은 **손님용 칸(`guest_info`)만** 쓴다 — 출입 코드 · 운영 메모는 건드리지 않는다. 버전은 `guest_info_updated_at`
 * (202611130003 트리거가 손님용 칸이 바뀔 때만 올린다). 줄이 아직 없으면 코드 기본값(출입 코드 포함)으로 만든다 —
 * 빈 출입 코드 목록으로 만들면 기본값이 사라진다(`property-operation-info-rules.ts` 규칙).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PROPERTY_MAP_META, type PropertyAccessInfo, type PropertyMapMeta, type PropertyRoomCode } from "@/lib/property-map-links";
import { mergePropertyMapMeta, type PropertyOperationInfoOverride } from "@/lib/property-operation-info-rules";
import { getCanonicalPropertyName } from "@/lib/room-label-normalization";
import { sanitizeGuestInfo, validateGuestInfoInput, type GuestInfo } from "@/lib/guest-messages/guest-info-model";
import type { Database, Json } from "@/types/database";

type Client = SupabaseClient<Database>;

const COLUMNS =
  "canonical_name, address_ko, address_ja, address_en, shared_access, room_access, note, updated_at, guest_info, guest_info_updated_at";

type Row = PropertyOperationInfoOverride & { guest_info: unknown; guest_info_updated_at: string | null };

export type BuildingGuestInfo = {
  canonicalName: string;
  guestInfo: GuestInfo;
  /** 손님용 칸 버전 — 저장할 때 「내가 본 버전」으로 다시 보낸다. null = 아직 저장 안 함. */
  guestInfoUpdatedAt: string | null;
  /** 직원용 — 출입 코드(따로 표시) · 운영 메모 있음 여부. */
  sharedAccess: PropertyAccessInfo[];
  roomAccess: PropertyRoomCode[];
  hasNote: boolean;
};

/**
 * 브라우저로 보내는 모양 — **출입 코드 값은 빼고 개수만**(고치기 패널은 「직원만 보는 정보: 공용 출입 코드 3개」만 보인다).
 * 코드 값은 서버 안(답장 칸 넣기 목록 — 권한 따로)에서만 쓴다.
 */
export type BuildingGuestInfoView = {
  canonicalName: string;
  guestInfo: GuestInfo;
  guestInfoUpdatedAt: string | null;
  sharedCodeCount: number;
  roomCodeCount: number;
  hasNote: boolean;
};

export function toGuestInfoView(building: BuildingGuestInfo): BuildingGuestInfoView {
  return {
    canonicalName: building.canonicalName,
    guestInfo: building.guestInfo,
    guestInfoUpdatedAt: building.guestInfoUpdatedAt,
    sharedCodeCount: building.sharedAccess.filter((access) => access.code.trim()).length,
    roomCodeCount: building.roomAccess.filter((room) => room.code.trim()).length,
    hasNote: building.hasNote,
  };
}

function untyped(client: Client): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function toBuilding(base: PropertyMapMeta, row: Row | null): BuildingGuestInfo {
  const merged = mergePropertyMapMeta(base, row ?? undefined);
  return {
    canonicalName: base.canonicalName,
    guestInfo: sanitizeGuestInfo(row?.guest_info),
    guestInfoUpdatedAt: row?.guest_info_updated_at ?? null,
    sharedAccess: merged.sharedAccess,
    roomAccess: merged.roomAccess ?? [],
    hasNote: Boolean(merged.note?.trim()),
  };
}

/** 대화의 건물 이름(저장된 이름 · 별칭) → 건물 정보 기본값. 모르는 건물이면 null. */
export function buildingBaseFor(propertyName: string | null): PropertyMapMeta | null {
  if (!propertyName?.trim()) return null;
  const canonical = getCanonicalPropertyName(propertyName.trim());
  return PROPERTY_MAP_META.find((item) => item.canonicalName === canonical) ?? null;
}

/** 모든 건물(코드 목록 순서). 읽기 실패면 던진다 — 옛 출입 코드를 보이지 않게(15 「건물 정보」). */
export async function loadBuildingGuestInfos(db: Client, organizationId: string): Promise<BuildingGuestInfo[]> {
  const { data, error } = await untyped(db).from("property_operation_infos").select(COLUMNS).eq("organization_id", organizationId);
  if (error) throw new Error(`property info read failed: ${error.code ?? "unknown"}`);
  const rows = new Map(((data ?? []) as Row[]).map((row) => [row.canonical_name, row]));
  return PROPERTY_MAP_META.map((base) => toBuilding(base, rows.get(base.canonicalName) ?? null));
}

export async function loadBuildingGuestInfo(db: Client, organizationId: string, propertyName: string | null): Promise<BuildingGuestInfo | null> {
  const base = buildingBaseFor(propertyName);
  if (!base) return null;
  const { data, error } = await untyped(db)
    .from("property_operation_infos")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .eq("canonical_name", base.canonicalName)
    .maybeSingle();
  if (error) throw new Error(`property info read failed: ${error.code ?? "unknown"}`);
  return toBuilding(base, (data as Row | null) ?? null);
}

export type SaveGuestInfoResult =
  | { ok: true; building: BuildingGuestInfo }
  | { ok: false; error: "conflict"; current: BuildingGuestInfo }
  | { ok: false; error: "invalid_input" | "invalid_property" | "too_long" | "save_failed" };

/**
 * 손님용 칸 저장 — 화면이 본 버전(`expectedUpdatedAt`)일 때만.
 * - `null`: 손님용 칸을 아직 저장한 적 없는 화면. 줄이 없으면 만들고(기본 출입 코드와 함께), 있으면 `guest_info_updated_at is null` 일 때만 고친다.
 * - 값: 그 버전일 때만 고친다. 0줄 → 누가 먼저 저장 → 충돌 + 최신 값.
 */
export async function saveBuildingGuestInfo(
  db: Client,
  organizationId: string,
  input: { canonicalName: string; guestInfo: unknown; expectedUpdatedAt: string | null },
): Promise<SaveGuestInfoResult> {
  const base = PROPERTY_MAP_META.find((item) => item.canonicalName === input.canonicalName);
  if (!base) return { ok: false, error: "invalid_property" };
  const checked = validateGuestInfoInput(input.guestInfo);
  if (!checked.ok) return { ok: false, error: checked.error };
  const value = checked.value as unknown as Json;
  const client = untyped(db);

  const conflict = async (): Promise<SaveGuestInfoResult> => {
    try {
      const current = await loadBuildingGuestInfo(db, organizationId, base.canonicalName);
      return current ? { ok: false, error: "conflict", current } : { ok: false, error: "save_failed" };
    } catch {
      return { ok: false, error: "save_failed" };
    }
  };

  if (input.expectedUpdatedAt === null) {
    const inserted = await client
      .from("property_operation_infos")
      .insert({
        organization_id: organizationId,
        canonical_name: base.canonicalName,
        address_ko: base.address.ko,
        address_ja: base.address.ja,
        address_en: base.address.en,
        shared_access: base.sharedAccess as unknown as Json,
        room_access: (base.roomAccess ?? []) as unknown as Json,
        note: base.note ?? "",
        guest_info: value,
        // 직원이 저장한 줄이 아니다 — 「줄 없음」 화면에서 연 출입 코드 저장이 이 줄을 고칠 수 있게(property-operation-info.ts).
        staff_info_saved: false,
      })
      .select(COLUMNS)
      .maybeSingle();
    if (!inserted.error && inserted.data) return { ok: true, building: toBuilding(base, inserted.data as Row) };
    if (inserted.error && inserted.error.code !== "23505") {
      console.error("[guest-info] insert failed", { code: inserted.error.code });
      return { ok: false, error: "save_failed" };
    }
    const updated = await client
      .from("property_operation_infos")
      .update({ guest_info: value })
      .eq("organization_id", organizationId)
      .eq("canonical_name", base.canonicalName)
      .is("guest_info_updated_at", null)
      .select(COLUMNS)
      .maybeSingle();
    if (updated.error) {
      console.error("[guest-info] update failed", { code: updated.error.code });
      return { ok: false, error: "save_failed" };
    }
    return updated.data ? { ok: true, building: toBuilding(base, updated.data as Row) } : conflict();
  }

  const updated = await client
    .from("property_operation_infos")
    .update({ guest_info: value })
    .eq("organization_id", organizationId)
    .eq("canonical_name", base.canonicalName)
    .eq("guest_info_updated_at", input.expectedUpdatedAt)
    .select(COLUMNS)
    .maybeSingle();
  if (updated.error) {
    console.error("[guest-info] update failed", { code: updated.error.code });
    return { ok: false, error: "save_failed" };
  }
  return updated.data ? { ok: true, building: toBuilding(base, updated.data as Row) } : conflict();
}
