"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-session";
import { canAccessRoomLinks } from "@/lib/ops-admin";
import { CALENDAR_BUILDING_ORDER } from "@/lib/room-label-normalization";
import { loadBeds24RoomLinkNames } from "@/lib/room-links";
import {
  BUILDING_LINK_CHANNELS,
  type ManualNameError,
  parseRoomLinkInput,
  ROOM_LINK_CHANNELS,
  type RoomLinkChannel,
  type RoomLinkInputError,
  validateManualName,
} from "@/lib/room-links-model";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 룸 링크 저장 — 유닛 하나 × 채널 하나의 호스트 · 게스트 링크 · 메모 (2026-10-02).
 *
 * 도메인 계약: docs/product/35-room-links.md
 *
 * **권한을 매번 다시 본다**(`room_links.access`) — service-role 로 쓰므로 화면에서 버튼을 감추는 것은 막은 게
 * 아니다(CLAUDE.md §6). 유닛이 **이 조직의 것인지**도 직접 확인한다. 입력은 서버가 다시 검증한다
 * (`parseRoomLinkInput` — 채널 도메인 · URL 형식 · 메모 길이). 셋 다 비우면 그 줄을 지운다.
 *
 * 실패 사유는 코드로만 돌려준다 — 문구는 화면이 사전에서 고른다(ko/ja/en).
 */
export type SaveRoomLinkResult =
  | { ok: true; removed: boolean }
  | { ok: false; error: "forbidden" | "not_found" | "save_failed" | RoomLinkInputError };

export async function saveRoomListingLink(input: {
  roomId: string;
  /** `true` 면 `roomId` 는 직접 추가한 객실(`room_link_rooms.id`) — 2026-10-15. */
  manual?: boolean;
  channel: RoomLinkChannel;
  host: string;
  guest: string;
  memo: string;
}): Promise<SaveRoomLinkResult> {
  const session = await requireAdminSession();
  if (!canAccessRoomLinks(session)) return { error: "forbidden", ok: false };
  if (!ROOM_LINK_CHANNELS.includes(input.channel)) return { error: "not_found", ok: false };

  const parsed = parseRoomLinkInput({
    channel: input.channel,
    guest: String(input.guest ?? ""),
    host: String(input.host ?? ""),
    memo: String(input.memo ?? ""),
  });
  if (!parsed.ok) return { error: parsed.error, ok: false };

  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const manual = input.manual === true;
  const room = await supabase
    .from(manual ? "room_link_rooms" : "rooms")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", String(input.roomId ?? ""))
    .maybeSingle();
  if (room.error || !room.data) return { error: "not_found", ok: false };
  const roomColumn = manual ? "manual_room_id" : "room_id";

  if (parsed.empty) {
    const removed = await supabase
      .from("room_listing_links")
      .delete()
      .eq("organization_id", organizationId)
      .eq(roomColumn, room.data.id)
      .eq("channel", input.channel);
    if (removed.error) return { error: "save_failed", ok: false };
    revalidatePath("/admin/ops/room-links");
    return { ok: true, removed: true };
  }

  const saved = await supabase.from("room_listing_links").upsert(
    {
      channel: input.channel,
      guest_url: parsed.guestUrl,
      host_url: parsed.hostUrl,
      listing_id: parsed.listingId,
      memo: parsed.memo,
      organization_id: organizationId,
      ...(manual ? { manual_room_id: room.data.id } : { room_id: room.data.id }),
      updated_at: new Date().toISOString(),
      updated_by: session.user.id,
    },
    { onConflict: `${roomColumn},channel` },
  );
  if (saved.error) {
    console.error("[room-links] save failed", saved.error);
    return { error: "save_failed", ok: false };
  }

  revalidatePath("/admin/ops/room-links");
  return { ok: true, removed: false };
}

/**
 * 건물 단위 링크 저장 — Booking.com 엑스트라넷 · 손님용 페이지 · 메모 (2026-10-02).
 *
 * Booking.com 은 숙소(건물) 하나에 객실 타입이 붙어 링크가 건물마다 하나다(`building_listing_links`). 건물 키는
 * 캘린더와 같은 이름이고, **정해진 건물 목록에 있는 이름만** 받는다(`CALENDAR_BUILDING_ORDER`). 권한 · 입력 검증은
 * 객실 링크와 같다. 셋 다 비우면 그 줄을 지운다.
 */
export async function saveBuildingListingLink(input: {
  building: string;
  /** 직접 추가한 건물이면 그 id — 이때 `building` 은 보지 않는다(2026-10-15). */
  manualBuildingId?: string | null;
  channel: RoomLinkChannel;
  host: string;
  guest: string;
  memo: string;
}): Promise<SaveRoomLinkResult> {
  const session = await requireAdminSession();
  if (!canAccessRoomLinks(session)) return { error: "forbidden", ok: false };
  if (!BUILDING_LINK_CHANNELS.includes(input.channel)) return { error: "not_found", ok: false };
  const building = String(input.building ?? "");
  const manualBuildingId = input.manualBuildingId ? String(input.manualBuildingId) : null;
  if (!manualBuildingId && !CALENDAR_BUILDING_ORDER.includes(building)) return { error: "not_found", ok: false };

  const parsed = parseRoomLinkInput({
    channel: input.channel,
    guest: String(input.guest ?? ""),
    host: String(input.host ?? ""),
    memo: String(input.memo ?? ""),
  });
  if (!parsed.ok) return { error: parsed.error, ok: false };

  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  if (manualBuildingId) {
    const owned = await supabase
      .from("room_link_buildings")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", manualBuildingId)
      .maybeSingle();
    if (owned.error || !owned.data) return { error: "not_found", ok: false };
  }
  // 직접 추가한 건물은 id 로, Beds24 건물은 이름으로 붙는다(체크 제약 — 둘 중 하나만).
  const target = manualBuildingId
    ? { column: "manual_building_id" as const, value: manualBuildingId }
    : { column: "canonical_name" as const, value: building };

  if (parsed.empty) {
    const removed = await supabase
      .from("building_listing_links")
      .delete()
      .eq("organization_id", organizationId)
      .eq(target.column, target.value)
      .eq("channel", input.channel);
    if (removed.error) return { error: "save_failed", ok: false };
    revalidatePath("/admin/ops/room-links");
    return { ok: true, removed: true };
  }

  const saved = await supabase.from("building_listing_links").upsert(
    {
      ...(manualBuildingId ? { manual_building_id: manualBuildingId } : { canonical_name: building }),
      channel: input.channel,
      guest_url: parsed.guestUrl,
      host_url: parsed.hostUrl,
      listing_id: parsed.listingId,
      memo: parsed.memo,
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
      updated_by: session.user.id,
    },
    { onConflict: manualBuildingId ? "manual_building_id,channel" : "organization_id,canonical_name,channel" },
  );
  if (saved.error) {
    console.error("[room-links] building save failed", saved.error);
    return { error: "save_failed", ok: false };
  }

  revalidatePath("/admin/ops/room-links");
  return { ok: true, removed: false };
}

// ── 건물 · 객실 직접 추가 (2026-10-15) ─────────────────────────────────
//
// Beds24 에 없는 건물 · 객실을 룸 링크에서만 만든다(`room_link_buildings` · `room_link_rooms`). 캘린더 · 청소 · 가동률 ·
// 매출은 `properties` / `rooms` 를 읽으므로 여기서 만든 것을 모른다(사용자 결정). 권한은 링크 고치기와 같은
// `room_links.access` — 매번 다시 보고, 대상이 이 조직의 것인지 직접 확인한다. Beds24 건물 · 객실은 지울 수 없다
// (이 표에 없으므로 지우기 액션이 찾지 못한다). 직접 추가한 건물을 지우면 그 객실 · 링크가 함께 지워진다(on delete cascade).

export type ManualEntryResult =
  | { ok: true; id: string }
  | { ok: false; error: "forbidden" | "not_found" | "save_failed" | ManualNameError | RoomLinkInputError };

const UNIQUE_VIOLATION = "23505";

async function manualEntryContext() {
  const session = await requireAdminSession();
  if (!canAccessRoomLinks(session)) return null;
  return { organizationId: session.organization.id, session, supabase: getSupabaseServiceClient() };
}

/** 건물 이름이 겹치면 안 되는 목록 — Beds24 건물 이름 전부 + 다른 직접 추가 건물. */
async function takenBuildingNames(
  ctx: NonNullable<Awaited<ReturnType<typeof manualEntryContext>>>,
  exceptId: string | null,
): Promise<string[] | null> {
  const [beds24, manual] = await Promise.all([
    loadBeds24RoomLinkNames(ctx.organizationId).catch(() => null),
    ctx.supabase.from("room_link_buildings").select("id, name").eq("organization_id", ctx.organizationId),
  ]);
  if (!beds24 || manual.error) return null;
  return [...beds24.keys(), ...(manual.data ?? []).filter((row) => row.id !== exceptId).map((row) => row.name)];
}

/** 객실 이름이 겹치면 안 되는 목록 — 같은 건물의 Beds24 객실(행 이름) + 같은 건물의 다른 직접 추가 객실. */
async function takenRoomNames(
  ctx: NonNullable<Awaited<ReturnType<typeof manualEntryContext>>>,
  building: { canonicalName: string | null; manualBuildingId: string | null },
  exceptId: string | null,
): Promise<string[] | null> {
  const manualQuery = ctx.supabase.from("room_link_rooms").select("id, name").eq("organization_id", ctx.organizationId);
  const [beds24, manual] = await Promise.all([
    building.canonicalName ? loadBeds24RoomLinkNames(ctx.organizationId).catch(() => null) : Promise.resolve(new Map()),
    building.manualBuildingId
      ? manualQuery.eq("manual_building_id", building.manualBuildingId)
      : manualQuery.eq("canonical_name", building.canonicalName ?? ""),
  ]);
  if (!beds24 || manual.error) return null;
  const beds24Labels: Iterable<string> = building.canonicalName ? (beds24.get(building.canonicalName) ?? []) : [];
  return [...beds24Labels, ...(manual.data ?? []).filter((row) => row.id !== exceptId).map((row) => row.name)];
}

function revalidateRoomLinks() {
  revalidatePath("/admin/ops/room-links");
  revalidatePath("/mobile/ops/room-links");
}

export async function addManualBuilding(input: { name: string }): Promise<ManualEntryResult> {
  const ctx = await manualEntryContext();
  if (!ctx) return { error: "forbidden", ok: false };
  const taken = await takenBuildingNames(ctx, null);
  if (!taken) return { error: "save_failed", ok: false };
  const checked = validateManualName(input.name, taken);
  if (!checked.ok) return checked;

  const last = await ctx.supabase
    .from("room_link_buildings")
    .select("sort_order")
    .eq("organization_id", ctx.organizationId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const inserted = await ctx.supabase
    .from("room_link_buildings")
    .insert({
      created_by: ctx.session.user.id,
      name: checked.name,
      organization_id: ctx.organizationId,
      sort_order: (last.data?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();
  if (inserted.error) {
    if (inserted.error.code === UNIQUE_VIOLATION) return { error: "name_taken", ok: false };
    console.error("[room-links] add building failed", inserted.error);
    return { error: "save_failed", ok: false };
  }
  revalidateRoomLinks();
  return { id: inserted.data.id, ok: true };
}

export async function renameManualBuilding(input: { id: string; name: string }): Promise<ManualEntryResult> {
  const ctx = await manualEntryContext();
  if (!ctx) return { error: "forbidden", ok: false };
  const id = String(input.id ?? "");
  const owned = await ctx.supabase
    .from("room_link_buildings")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (owned.error || !owned.data) return { error: "not_found", ok: false };
  const taken = await takenBuildingNames(ctx, id);
  if (!taken) return { error: "save_failed", ok: false };
  const checked = validateManualName(input.name, taken);
  if (!checked.ok) return checked;

  const updated = await ctx.supabase
    .from("room_link_buildings")
    .update({ name: checked.name, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.organizationId)
    .eq("id", id);
  if (updated.error) {
    if (updated.error.code === UNIQUE_VIOLATION) return { error: "name_taken", ok: false };
    return { error: "save_failed", ok: false };
  }
  revalidateRoomLinks();
  return { id, ok: true };
}

/** 직접 추가한 건물 지우기 — 그 객실 · 링크(Airbnb · Booking.com)가 함께 지워진다. 되돌릴 수 없다(화면이 먼저 묻는다). */
export async function deleteManualBuilding(input: { id: string }): Promise<ManualEntryResult> {
  const ctx = await manualEntryContext();
  if (!ctx) return { error: "forbidden", ok: false };
  const id = String(input.id ?? "");
  const removed = await ctx.supabase
    .from("room_link_buildings")
    .delete()
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .select("id");
  if (removed.error) return { error: "save_failed", ok: false };
  if (!removed.data?.length) return { error: "not_found", ok: false };
  revalidateRoomLinks();
  return { id, ok: true };
}

/**
 * 객실 직접 추가 — Beds24 건물(`building` = 캘린더 이름) 또는 직접 추가한 건물(`manualBuildingId`)에.
 * 게스트 링크 · 호스트 링크(리스팅 ID 숫자만도 됨)는 선택이고, 넣으면 같은 검증(`parseRoomLinkInput`)을 거쳐 Airbnb 줄로 저장한다.
 * 링크 저장이 실패하면 방금 만든 객실을 지운다(반쪽 저장 없음).
 */
export async function addManualRoom(input: {
  building: string | null;
  manualBuildingId: string | null;
  name: string;
  guest: string;
  host: string;
}): Promise<ManualEntryResult> {
  const ctx = await manualEntryContext();
  if (!ctx) return { error: "forbidden", ok: false };

  const manualBuildingId = input.manualBuildingId ? String(input.manualBuildingId) : null;
  let canonicalName: string | null = null;
  if (manualBuildingId) {
    const owned = await ctx.supabase
      .from("room_link_buildings")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", manualBuildingId)
      .maybeSingle();
    if (owned.error || !owned.data) return { error: "not_found", ok: false };
  } else {
    canonicalName = String(input.building ?? "");
    const beds24 = await loadBeds24RoomLinkNames(ctx.organizationId).catch(() => null);
    if (!beds24) return { error: "save_failed", ok: false };
    if (!beds24.has(canonicalName)) return { error: "not_found", ok: false };
  }

  const taken = await takenRoomNames(ctx, { canonicalName, manualBuildingId }, null);
  if (!taken) return { error: "save_failed", ok: false };
  const checked = validateManualName(input.name, taken);
  if (!checked.ok) return checked;

  const parsed = parseRoomLinkInput({
    channel: "airbnb",
    guest: String(input.guest ?? ""),
    host: String(input.host ?? ""),
    memo: "",
  });
  if (!parsed.ok) return { error: parsed.error, ok: false };

  const inserted = await ctx.supabase
    .from("room_link_rooms")
    .insert({
      canonical_name: canonicalName,
      created_by: ctx.session.user.id,
      manual_building_id: manualBuildingId,
      name: checked.name,
      organization_id: ctx.organizationId,
    })
    .select("id")
    .single();
  if (inserted.error) {
    if (inserted.error.code === UNIQUE_VIOLATION) return { error: "name_taken", ok: false };
    console.error("[room-links] add room failed", inserted.error);
    return { error: "save_failed", ok: false };
  }

  if (!parsed.empty) {
    const link = await ctx.supabase.from("room_listing_links").insert({
      channel: "airbnb",
      guest_url: parsed.guestUrl,
      host_url: parsed.hostUrl,
      listing_id: parsed.listingId,
      manual_room_id: inserted.data.id,
      memo: null,
      organization_id: ctx.organizationId,
      updated_by: ctx.session.user.id,
    });
    if (link.error) {
      console.error("[room-links] add room link failed", link.error);
      await ctx.supabase.from("room_link_rooms").delete().eq("id", inserted.data.id);
      return { error: "save_failed", ok: false };
    }
  }

  revalidateRoomLinks();
  return { id: inserted.data.id, ok: true };
}

export async function renameManualRoom(input: { id: string; name: string }): Promise<ManualEntryResult> {
  const ctx = await manualEntryContext();
  if (!ctx) return { error: "forbidden", ok: false };
  const id = String(input.id ?? "");
  const owned = await ctx.supabase
    .from("room_link_rooms")
    .select("id, canonical_name, manual_building_id")
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (owned.error || !owned.data) return { error: "not_found", ok: false };
  const taken = await takenRoomNames(
    ctx,
    { canonicalName: owned.data.canonical_name, manualBuildingId: owned.data.manual_building_id },
    id,
  );
  if (!taken) return { error: "save_failed", ok: false };
  const checked = validateManualName(input.name, taken);
  if (!checked.ok) return checked;

  const updated = await ctx.supabase
    .from("room_link_rooms")
    .update({ name: checked.name, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.organizationId)
    .eq("id", id);
  if (updated.error) {
    if (updated.error.code === UNIQUE_VIOLATION) return { error: "name_taken", ok: false };
    return { error: "save_failed", ok: false };
  }
  revalidateRoomLinks();
  return { id, ok: true };
}

/** 직접 추가한 객실 지우기 — 그 링크가 함께 지워진다. 되돌릴 수 없다(화면이 먼저 묻는다). */
export async function deleteManualRoom(input: { id: string }): Promise<ManualEntryResult> {
  const ctx = await manualEntryContext();
  if (!ctx) return { error: "forbidden", ok: false };
  const id = String(input.id ?? "");
  const removed = await ctx.supabase
    .from("room_link_rooms")
    .delete()
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .select("id");
  if (removed.error) return { error: "save_failed", ok: false };
  if (!removed.data?.length) return { error: "not_found", ok: false };
  revalidateRoomLinks();
  return { id, ok: true };
}
