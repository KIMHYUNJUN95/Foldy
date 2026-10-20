import { roleCan } from "@/config/capabilities";
import { revalidatePath } from "next/cache";
import { organizationRoles, type Role } from "@/config/roles";
import { getDictionary, type Locale } from "@/lib/i18n";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// Seeded default catalog rows carry a stable `code`; show its localized label.
// Building-specific custom items (added later) have no code → fall back to the DB name.
function localizeItemName(code: string | null, name: string, locale: Locale): string {
  if (code) {
    const label = getDictionary(locale).linenReturn.items[code];
    if (label) return label;
  }
  return name;
}

export type LinenItemOption = {
  id: string;
  code: string | null;
  name: string;
};

export type LinenReturnLine = {
  itemId: string;
  name: string;
  quantity: number;
};

export type LinenReturnRecord = {
  id: string;
  buildingName: string;
  note: string | null;
  imageUrls: string[];
  registeredAt: string;
  registeredByUserId: string;
  registrantName: string;
  lines: LinenReturnLine[];
  totalQuantity: number;
};

type RecordRow = Database["public"]["Tables"]["linen_return_records"]["Row"];
type ItemRow = Database["public"]["Tables"]["linen_items"]["Row"];
type LineRow = Database["public"]["Tables"]["linen_return_record_items"]["Row"];
type ProfileName = { id: string; name: string };

/** Author of the record, or an admin-capable org role, may edit/delete it. */
export function canManageLinenRecord(
  session: AppSession,
  record: { registeredByUserId: string },
): boolean {
  if (session.user.id === record.registeredByUserId) return true;
  return roleCan(session.user.role, "linen.manage");
}

function isOrganizationRole(role: Role): boolean {
  return (organizationRoles as readonly string[]).includes(role);
}

// ── Tokyo month range ──────────────────────────────────────────────────────
// Operational ledger periods use Tokyo wall-clock month boundaries, not naive UTC.
export type TokyoYearMonth = { year: number; month: number }; // month: 1-12

export function getCurrentTokyoYearMonth(): TokyoYearMonth {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

// JST is UTC+9: 00:00 JST on the 1st equals the UTC instant 9 hours earlier.
function tokyoMonthRange({ year, month }: TokyoYearMonth) {
  const from = new Date(Date.UTC(year, month - 1, 1, -9, 0, 0)).toISOString();
  const to = new Date(Date.UTC(year, month, 1, -9, 0, 0)).toISOString();
  return { from, to };
}

export function shiftTokyoMonth(ym: TokyoYearMonth, delta: number): TokyoYearMonth {
  const base = new Date(Date.UTC(ym.year, ym.month - 1 + delta, 1));
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1 };
}

function isMissingTableError(message: string): boolean {
  return message.includes("does not exist") || message.includes("schema cache");
}

/**
 * 린넨 반품이 바뀐 뒤 다시 그려야 하는 서버 렌더 경로.
 * 모바일(건물 선택 · 건물 목록 · 상세 · 장부)과 어드민 콘솔이 같은 레코드를 보므로,
 * 어느 쪽에서 등록/수정/삭제하든 같은 목록을 무효화한다. 서버 액션에서만 호출할 것.
 */
export function revalidateLinenReturnPaths(): void {
  revalidatePath("/mobile/linen-return");
  revalidatePath("/mobile/linen-return/list");
  revalidatePath("/mobile/linen-return/ledger");
  revalidatePath("/admin/linen-return");
}

export { LINEN_LAST_BUILDING_COOKIE } from "@/lib/linen-return-constants";

// ── Buildings ───────────────────────────────────────────────────────────────
/** Distinct canonical building names the org operates (same source as orders). */
export async function getLinenBuildings(session: AppSession): Promise<string[]> {
  const catalog = (await getActiveRoomCatalogServer(session.organization.id)) ?? [];
  // 어드민 콘솔(`getLinenBuildingNames`)과 같은 정렬 규칙을 쓴다.
  return Array.from(new Set(catalog.map((item) => item.propertyName))).sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
}

/** Per-building monthly record counts and last-return timestamps for the picker. */
export async function getLinenBuildingStats(
  session: AppSession,
): Promise<Record<string, { count: number; lastAt: string | null }>> {
  const supabase = await getSupabaseServerClient();
  const { from } = tokyoMonthRange(getCurrentTokyoYearMonth());
  const { data, error } = await supabase
    .from("linen_return_records")
    .select("building_name, registered_at")
    .eq("organization_id", session.organization.id)
    .gte("registered_at", from)
    .order("registered_at", { ascending: false });
  if (error) {
    if (isMissingTableError(error.message ?? "")) return {};
    throw new Error(error.message);
  }
  const stats: Record<string, { count: number; lastAt: string | null }> = {};
  for (const row of (data ?? []) as Array<Pick<RecordRow, "building_name" | "registered_at">>) {
    const entry = stats[row.building_name] ?? { count: 0, lastAt: null };
    entry.count += 1;
    if (!entry.lastAt) entry.lastAt = row.registered_at;
    stats[row.building_name] = entry;
  }
  return stats;
}

// ── Linen item master ─────────────────────────────────────────────────────
/** Active linen items available for one building (global items + building-specific). */
export async function getActiveLinenItems(
  session: AppSession,
  building: string,
): Promise<LinenItemOption[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("linen_items")
    .select("id, code, name, building_name, is_active, display_order")
    .eq("organization_id", session.organization.id)
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) {
    if (isMissingTableError(error.message ?? "")) return [];
    throw new Error(error.message);
  }
  // Global items (building_name null) apply everywhere; otherwise match the building.
  const locale = session.user.preferredLanguage;
  return ((data ?? []) as ItemRow[])
    .filter((row) => row.building_name === null || row.building_name === building)
    .map((row) => ({
      id: row.id,
      code: row.code,
      name: localizeItemName(row.code, row.name, locale),
    }));
}

// ── Records ─────────────────────────────────────────────────────────────────
async function hydrateRecords(
  records: RecordRow[],
  locale: Locale,
): Promise<LinenReturnRecord[]> {
  if (records.length === 0) return [];
  const supabase = await getSupabaseServerClient();
  const recordIds = records.map((r) => r.id);

  const { data: lineData } = await supabase
    .from("linen_return_record_items")
    .select("return_record_id, linen_item_id, quantity, sort_order")
    .in("return_record_id", recordIds)
    .order("sort_order", { ascending: true });
  const lines = (lineData ?? []) as Array<
    Pick<LineRow, "return_record_id" | "linen_item_id" | "quantity" | "sort_order">
  >;

  const itemIds = Array.from(new Set(lines.map((l) => l.linen_item_id)));
  const itemNames = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: itemData } = await supabase
      .from("linen_items")
      .select("id, code, name")
      .in("id", itemIds);
    for (const item of (itemData ?? []) as Array<Pick<ItemRow, "id" | "code" | "name">>) {
      itemNames.set(item.id, localizeItemName(item.code, item.name, locale));
    }
  }

  const registrantIds = Array.from(new Set(records.map((r) => r.registered_by_user_id)));
  const registrantNames = new Map<string, string>();
  if (registrantIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", registrantIds);
    for (const p of (profiles ?? []) as ProfileName[]) {
      registrantNames.set(p.id, p.name);
    }
  }

  const linesByRecord = new Map<string, LinenReturnLine[]>();
  for (const line of lines) {
    const list = linesByRecord.get(line.return_record_id) ?? [];
    list.push({
      itemId: line.linen_item_id,
      name: itemNames.get(line.linen_item_id) ?? "",
      quantity: line.quantity,
    });
    linesByRecord.set(line.return_record_id, list);
  }

  return records.map((record) => {
    const recordLines = linesByRecord.get(record.id) ?? [];
    return {
      id: record.id,
      buildingName: record.building_name,
      note: record.note,
      imageUrls: record.image_urls ?? [],
      registeredAt: record.registered_at,
      registeredByUserId: record.registered_by_user_id,
      registrantName: registrantNames.get(record.registered_by_user_id) ?? "",
      lines: recordLines,
      totalQuantity: recordLines.reduce((sum, l) => sum + l.quantity, 0),
    };
  });
}

/** Latest-first return records for one building. */
export async function getLinenReturnsByBuilding(
  session: AppSession,
  building: string,
): Promise<LinenReturnRecord[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("linen_return_records")
    .select("*")
    .eq("organization_id", session.organization.id)
    .eq("building_name", building)
    .order("registered_at", { ascending: false })
    // 이 화면은 기간 필터가 없는 전체 이력이다(기간 조회는 장부 화면의 책임). 건물당 기록이 계속
    // 누적되므로 페이지네이션이 붙기 전까지의 안전장치로 최신 200건만 읽는다(2026-08-03).
    .limit(200);
  if (error) {
    if (isMissingTableError(error.message ?? "")) return [];
    throw new Error(error.message);
  }
  return hydrateRecords((data ?? []) as RecordRow[], session.user.preferredLanguage);
}

/** Single record (header + lines + registrant), scoped to the session org. */
export async function getLinenReturnRecordById(
  session: AppSession,
  id: string,
): Promise<LinenReturnRecord | null> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("linen_return_records")
    .select("*")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error.message ?? "")) return null;
    // A malformed (non-UUID) id in the URL → treat as not-found, not a 500 crash.
    if (error.code === "22P02") return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  const [record] = await hydrateRecords([data as RecordRow], session.user.preferredLanguage);
  return record ?? null;
}

/** Building-scoped records for one Tokyo month (ledger source). */
export async function getLinenLedgerRecords(
  session: AppSession,
  building: string,
  period: TokyoYearMonth,
): Promise<LinenReturnRecord[]> {
  const supabase = await getSupabaseServerClient();
  const { from, to } = tokyoMonthRange(period);
  const { data, error } = await supabase
    .from("linen_return_records")
    .select("*")
    .eq("organization_id", session.organization.id)
    .eq("building_name", building)
    .gte("registered_at", from)
    .lt("registered_at", to)
    .order("registered_at", { ascending: false });
  if (error) {
    if (isMissingTableError(error.message ?? "")) return [];
    throw new Error(error.message);
  }
  return hydrateRecords((data ?? []) as RecordRow[], session.user.preferredLanguage);
}

// Inclusive Tokyo-day range [startDate 00:00 JST, endDate+1 00:00 JST).
function tokyoDayRange(startDate: string, endDate: string) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const from = new Date(Date.UTC(sy, sm - 1, sd, -9, 0, 0)).toISOString();
  const to = new Date(Date.UTC(ey, em - 1, ed + 1, -9, 0, 0)).toISOString();
  return { from, to };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Building-scoped records for an explicit inclusive Tokyo-day range (ledger custom period). */
export async function getLinenLedgerRecordsByRange(
  session: AppSession,
  building: string,
  startDate: string,
  endDate: string,
): Promise<LinenReturnRecord[]> {
  const supabase = await getSupabaseServerClient();
  // Normalize reversed input so start <= end.
  const [start, end] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
  const { from, to } = tokyoDayRange(start, end);
  const { data, error } = await supabase
    .from("linen_return_records")
    .select("*")
    .eq("organization_id", session.organization.id)
    .eq("building_name", building)
    .gte("registered_at", from)
    .lt("registered_at", to)
    .order("registered_at", { ascending: false });
  if (error) {
    if (isMissingTableError(error.message ?? "")) return [];
    throw new Error(error.message);
  }
  return hydrateRecords((data ?? []) as RecordRow[], session.user.preferredLanguage);
}

/** Server-side guard: the building must exist in the org's room catalog. */
export async function isKnownBuilding(
  session: AppSession,
  building: string,
): Promise<boolean> {
  if (!building) return false;
  const buildings = await getLinenBuildings(session);
  // When the catalog is unavailable for non-org (platform) sessions, do not block.
  if (buildings.length === 0) return isOrganizationRole(session.user.role) ? false : true;
  return buildings.includes(building);
}
