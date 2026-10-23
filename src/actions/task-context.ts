"use server";

import { getDictionary } from "@/lib/i18n";
import { collectBlockedRooms } from "@/lib/room-blocks";
import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  isExcludedOperationalRoom,
  localizePropertyName,
} from "@/lib/room-label-normalization";
import {
  buildGlobalExternalRoomToCanonical,
  buildPropertyRoomLookups,
  getActiveRoomCatalog,
  resolveReservationCanonicalRoomLabel,
} from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

export type PickerBuilding = {
  /** Canonical property name — used as the building identifier passed back to room/reservation fetches. */
  id: string;
  /** properties.id UUID for the building (persisted on a room-only context link). */
  propertyId: string | null;
  /** Localized display name. */
  name: string;
  totalRooms: number;
  todayGuests: number;
};

export type PickerRoom = {
  /** Display label (sub-units already merged, e.g. 201_2 → 201). */
  label: string;
  /** rooms.id UUID of the representative room row (persisted on a context link). */
  roomId: string | null;
  /** properties.id UUID of the owning building. */
  propertyId: string | null;
  occupied: boolean;
  /**
   * Beds24 캘린더에서 오늘 판매가 막혀 있는가.
   *
   * `occupied` 와 별개다 — 판매만 막고 예약은 안 넣는 운영이 자주 쓰여서, 그 방은 손님이 없는데도
   * 팔 수 없다. 둘을 하나로 합치면 「손님이 있다」와 「팔 수 없다」가 섞인다.
   */
  blocked: boolean;
};

export type RoomReservation = {
  id: string;
  guestName: string;
  initials: string;
  channel: "airbnb" | "booking" | "direct";
  /** Display string e.g. "6/1 – 6/4" */
  dateRange: string;
  nightsCount: number;
  checkinDate: string; // YYYY-MM-DD
  checkoutDate: string; // YYYY-MM-DD
  isLive: boolean;
};

export type FetchRoomReservationsResult = {
  reservations: RoomReservation[];
  /** e.g. "6/1 – 7/31" */
  periodLabel: string;
};

// Row shapes — explicit casts work around a supabase-js v2 bug where chained filter methods
// on the enum `status` column collapse the inferred row type to `never`.
type LiveResolveRow = {
  property_name: string;
  room_label: string;
  raw_payload: Database["public"]["Tables"]["reservations"]["Row"]["raw_payload"];
};
type ResWindowRow = LiveResolveRow & {
  id: string;
  guest_name: string;
  source: string;
  check_in_date: string;
  check_out_date: string;
};

function tokyoYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function ymdToMD(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}`;
}

/** Sorts display room labels numerically where possible (201 < 202 < 301), lexically otherwise. */
function compareRoomLabel(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** Today's live reservations (checked in, not yet departed) for resolving occupancy/guest counts. */
async function loadLiveTodayRows(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  orgId: string,
  todayYmd: string,
): Promise<LiveResolveRow[]> {
  const res = await supabase
    .from("reservations")
    .select("property_name, room_label, raw_payload")
    .eq("organization_id", orgId)
    .lte("check_in_date", todayYmd)
    .gt("check_out_date", todayYmd)
    .not("status", "in", "(cancelled,no_show)");
  return (res.data as LiveResolveRow[] | null) ?? [];
}

/** 오늘 막혀 있는 방(표시 라벨 기준). 블락 구간은 양끝을 포함한다 — `blockCoversDate` 참고. */
async function loadBlockedRoomLabels(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  orgId: string,
  todayYmd: string,
): Promise<Set<string>> {
  const res = await supabase
    .from("room_blocks")
    .select("property_name, room_label, start_date, end_date")
    .eq("organization_id", orgId)
    .lte("start_date", todayYmd)
    .gte("end_date", todayYmd);
  if (res.error) {
    // 블락을 못 읽었다고 객실 선택 자체를 막지는 않는다. 차단 표시만 빠진다.
    console.error("[tasks/context] room block read failed", res.error);
    return new Set();
  }
  return collectBlockedRooms(
    (res.data ?? []).map((row) => {
      const canonProp = getCanonicalPropertyName(row.property_name);
      const canonical = getCanonicalRoomLabel(canonProp, row.room_label) || row.room_label.trim();
      return {
        endDate: row.end_date,
        startDate: row.start_date,
        label: getDisplayRoomLabel(canonProp, canonical) || canonical,
      };
    }),
    todayYmd,
    (block) => block.label,
  );
}

/**
 * Active buildings for the org, mirroring the reservation calendar's active-room catalog.
 * Only buildings with active rooms appear; sub-units are merged; Sano is excluded.
 * Falls back to the raw `properties` list when the org has no classified room-master rows.
 */
export async function fetchPickerBuildings(): Promise<PickerBuilding[]> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return [];

  const orgId = session.organization.id;
  const locale = session.user.preferredLanguage;
  const buildingLabels = getDictionary(locale).cleaning.buildingLabels;
  const todayYmd = tokyoYmd();
  const supabase = getSupabaseServiceClient();

  const catalog = await getActiveRoomCatalog(orgId, supabase);
  if (catalog === undefined) {
    return fetchLegacyBuildings(supabase, orgId);
  }

  // Group active rooms by canonical property; count unique display labels and capture a
  // representative property UUID (rooms in one canonical building share the same property_id).
  const displayLabelsByProperty = new Map<string, Set<string>>();
  const propertyIdByCanon = new Map<string, string>();
  for (const item of catalog) {
    if (isExcludedOperationalProperty(item.propertyName)) continue;
    if (isExcludedOperationalRoom(item.propertyName, item.roomLabel)) continue;
    const set = displayLabelsByProperty.get(item.propertyName) ?? new Set<string>();
    set.add(item.displayRoomLabel);
    displayLabelsByProperty.set(item.propertyName, set);
    if (!propertyIdByCanon.has(item.propertyName)) {
      propertyIdByCanon.set(item.propertyName, item.propertyId);
    }
  }

  // Today's live guests per canonical property (resolved through the same lookups as the calendar).
  const lookups = buildPropertyRoomLookups(catalog);
  const globalExternalRoomToCanonical = buildGlobalExternalRoomToCanonical(catalog);
  const liveRows = await loadLiveTodayRows(supabase, orgId, todayYmd);
  const guestCounts = new Map<string, number>();
  for (const row of liveRows) {
    const canonProp = getCanonicalPropertyName(row.property_name);
    if (!displayLabelsByProperty.has(canonProp)) continue;
    const canonical = resolveReservationCanonicalRoomLabel(row, {
      lookups,
      globalExternalRoomToCanonical,
      isAuthoritative: true,
    });
    if (!canonical) continue;
    guestCounts.set(canonProp, (guestCounts.get(canonProp) ?? 0) + 1);
  }

  return [...displayLabelsByProperty.entries()]
    .map(([canonProp, labels]) => ({
      id: canonProp,
      propertyId: propertyIdByCanon.get(canonProp) ?? null,
      name: localizePropertyName(canonProp, buildingLabels),
      totalRooms: labels.size,
      todayGuests: guestCounts.get(canonProp) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Active rooms for a building (display labels, sub-units merged), with today's occupancy flag. */
export async function fetchPickerRooms(propertyId: string): Promise<PickerRoom[]> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return [];

  const orgId = session.organization.id;
  const todayYmd = tokyoYmd();
  const supabase = getSupabaseServiceClient();
  const canonProp = propertyId; // building.id is the canonical property name

  const catalog = await getActiveRoomCatalog(orgId, supabase);
  if (catalog === undefined) {
    return fetchLegacyRooms(supabase, orgId, propertyId);
  }

  // Unique display labels for this property, each with a representative room UUID. Sub-units
  // (201 / 201_2) collapse to one cell; prefer the base unit (canonical key === display label).
  const repByDisplay = new Map<string, { roomId: string; propertyId: string; isBase: boolean }>();
  for (const item of catalog) {
    if (item.propertyName !== canonProp) continue;
    if (isExcludedOperationalRoom(item.propertyName, item.roomLabel)) continue;
    const isBase = item.canonicalRoomLabel === item.displayRoomLabel;
    const existing = repByDisplay.get(item.displayRoomLabel);
    if (!existing || (isBase && !existing.isBase)) {
      repByDisplay.set(item.displayRoomLabel, {
        roomId: item.roomId,
        propertyId: item.propertyId,
        isBase,
      });
    }
  }

  // Occupancy: today's live reservations resolved to display labels.
  const lookups = buildPropertyRoomLookups(catalog);
  const globalExternalRoomToCanonical = buildGlobalExternalRoomToCanonical(catalog);
  const [liveRows, blockedLabels] = await Promise.all([
    loadLiveTodayRows(supabase, orgId, todayYmd),
    loadBlockedRoomLabels(supabase, orgId, todayYmd),
  ]);
  const occupied = new Set<string>();
  for (const row of liveRows) {
    if (getCanonicalPropertyName(row.property_name) !== canonProp) continue;
    const canonical = resolveReservationCanonicalRoomLabel(row, {
      lookups,
      globalExternalRoomToCanonical,
      isAuthoritative: true,
    });
    if (!canonical) continue;
    occupied.add(getDisplayRoomLabel(canonProp, canonical));
  }

  return [...repByDisplay.entries()]
    .sort(([a], [b]) => compareRoomLabel(a, b))
    .map(([label, rep]) => ({
      label,
      roomId: rep.roomId,
      propertyId: rep.propertyId,
      occupied: occupied.has(label),
      blocked: blockedLabels.has(label),
    }));
}

/**
 * Reservations for one display room across the 2-month window (current + next month, Tokyo).
 * Reservations are resolved through the active-room catalog so sub-unit bookings (201 / 201_2)
 * surface under the merged display label.
 */
export async function fetchRoomReservations(
  propertyId: string,
  displayRoomLabel: string,
): Promise<FetchRoomReservationsResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) {
    return { reservations: [], periodLabel: "" };
  }

  const orgId = session.organization.id;
  const canonProp = propertyId;
  const todayYmd = tokyoYmd();
  const [year, month] = todayYmd.split("-").map(Number);

  // Window: 1st of current month → last day of next month (Tokyo).
  const windowStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const lastDayOfNext = new Date(nextYear, nextMonth, 0).getDate();
  const windowEndDisplay = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(lastDayOfNext).padStart(2, "0")}`;
  const monthAfterNext = nextMonth === 12 ? 1 : nextMonth + 1;
  const yearAfterNext = nextMonth === 12 ? nextYear + 1 : nextYear;
  const windowEndExclusive = `${yearAfterNext}-${String(monthAfterNext).padStart(2, "0")}-01`;
  const periodLabel = `${ymdToMD(windowStart)} – ${ymdToMD(windowEndDisplay)}`;

  const supabase = getSupabaseServiceClient();

  const rawResult = await supabase
    .from("reservations")
    .select(
      "id, guest_name, source, check_in_date, check_out_date, property_name, room_label, raw_payload",
    )
    .eq("organization_id", orgId)
    .lt("check_in_date", windowEndExclusive)
    .gte("check_out_date", windowStart)
    .not("status", "in", "(cancelled,no_show)")
    .order("check_in_date", { ascending: true });

  const rows = (rawResult.data as ResWindowRow[] | null) ?? [];
  if (rawResult.error || rows.length === 0) {
    return { reservations: [], periodLabel };
  }

  const catalog = await getActiveRoomCatalog(orgId, supabase);

  let matched: ResWindowRow[];
  if (catalog === undefined) {
    // Provisional org (no room master): fall back to exact raw room_label match.
    matched = rows.filter((r) => r.room_label === displayRoomLabel);
  } else {
    const lookups = buildPropertyRoomLookups(catalog);
    const globalExternalRoomToCanonical = buildGlobalExternalRoomToCanonical(catalog);
    matched = rows.filter((r) => {
      if (getCanonicalPropertyName(r.property_name) !== canonProp) return false;
      if (isExcludedOperationalRoom(getCanonicalPropertyName(r.property_name), r.room_label)) {
        return false;
      }
      const canonical = resolveReservationCanonicalRoomLabel(r, {
        lookups,
        globalExternalRoomToCanonical,
        isAuthoritative: true,
      });
      if (!canonical) return false;
      return getDisplayRoomLabel(canonProp, canonical) === displayRoomLabel;
    });
  }

  const reservations: RoomReservation[] = matched.map((r) => {
    const src = (r.source ?? "").toLowerCase();
    const channel: "airbnb" | "booking" | "direct" = src.includes("airbnb")
      ? "airbnb"
      : src.includes("booking")
        ? "booking"
        : "direct";
    const initials = (r.guest_name ?? "?").trim().charAt(0).toUpperCase();
    const msPerDay = 1000 * 60 * 60 * 24;
    const nightsCount = Math.round(
      (new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / msPerDay,
    );
    const isLive = r.check_in_date <= todayYmd && r.check_out_date > todayYmd;
    const dateRange = `${ymdToMD(r.check_in_date)} – ${ymdToMD(r.check_out_date)}`;
    return {
      id: r.id,
      guestName: r.guest_name ?? "",
      initials,
      channel,
      dateRange,
      nightsCount,
      checkinDate: r.check_in_date,
      checkoutDate: r.check_out_date,
      isLive,
    };
  });

  return { reservations, periodLabel };
}

// ── Reservation search ────────────────────────────────────────────────────────────────────────

type ReservationSearchRow = LiveResolveRow & {
  id: string;
  guest_name: string;
  source: string;
  source_reservation_id: string | null;
  check_in_date: string;
  check_out_date: string;
};

export type ReservationSearchResult = {
  id: string;
  sourceReservationId: string | null;
  guestName: string;
  initials: string;
  channel: "airbnb" | "booking" | "direct";
  dateRange: string;
  nightsCount: number;
  checkinDate: string;
  checkoutDate: string;
  isLive: boolean;
  /** Canonical Korean property name. */
  propertyName: string;
  propertyId: string | null;
  roomId: string | null;
  /** Localized display room label (same value as getDisplayRoomLabel result). */
  displayRoomLabel: string;
};

/** Months-based date arithmetic: returns YYYY-MM-01 for (year, month) offset by `delta` months. */
function offsetYm(year: number, month: number, delta: number): string {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * Cross-building reservation search by guest name or Beds24 reservation number.
 * Searches a 4-month window (1 month back → 3 months ahead, Tokyo) and returns up to 20 results.
 */
export async function searchReservations(query: string): Promise<ReservationSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return [];

  const orgId = session.organization.id;
  const todayYmd = tokyoYmd();
  const [yr, mo] = todayYmd.split("-").map(Number);
  const windowStart = offsetYm(yr, mo, -1);
  const windowEnd = offsetYm(yr, mo, 3);

  const supabase = getSupabaseServiceClient();

  const rawResult = await supabase
    .from("reservations")
    .select(
      "id, guest_name, source, source_reservation_id, check_in_date, check_out_date, property_name, room_label, raw_payload",
    )
    .eq("organization_id", orgId)
    .not("status", "in", "(cancelled,no_show)")
    .gte("check_out_date", windowStart)
    .lt("check_in_date", windowEnd)
    .or(`guest_name.ilike.%${q}%,source_reservation_id.ilike.%${q}%`)
    .order("check_in_date", { ascending: false })
    .limit(20);

  const rows = (rawResult.data as ReservationSearchRow[] | null) ?? [];
  if (rawResult.error || rows.length === 0) return [];

  const catalog = await getActiveRoomCatalog(orgId, supabase);

  // Build UUID lookup: "<canonProp>::<canonRoom>" → { propertyId, roomId }
  const catalogUuidByKey = new Map<string, { propertyId: string; roomId: string }>();
  if (catalog) {
    for (const item of catalog) {
      const key = `${item.propertyName}::${item.canonicalRoomLabel}`;
      if (!catalogUuidByKey.has(key)) {
        catalogUuidByKey.set(key, { propertyId: item.propertyId, roomId: item.roomId });
      }
    }
  }

  const lookups = catalog ? buildPropertyRoomLookups(catalog) : undefined;
  const globalExternalRoomToCanonical = catalog
    ? buildGlobalExternalRoomToCanonical(catalog)
    : undefined;

  const msPerDay = 1000 * 60 * 60 * 24;

  return rows.map((r) => {
    const src = (r.source ?? "").toLowerCase();
    const channel: "airbnb" | "booking" | "direct" = src.includes("airbnb")
      ? "airbnb"
      : src.includes("booking")
        ? "booking"
        : "direct";

    const canonProp = getCanonicalPropertyName(r.property_name);
    let displayRoomLabel = r.room_label;
    let propertyId: string | null = null;
    let roomId: string | null = null;

    if (catalog && lookups && globalExternalRoomToCanonical) {
      const canonical = resolveReservationCanonicalRoomLabel(r, {
        lookups,
        globalExternalRoomToCanonical,
        isAuthoritative: true,
      });
      if (canonical) {
        displayRoomLabel = getDisplayRoomLabel(canonProp, canonical);
        const uuids = catalogUuidByKey.get(`${canonProp}::${canonical}`);
        if (uuids) {
          propertyId = uuids.propertyId;
          roomId = uuids.roomId;
        }
      }
    }

    const nightsCount = Math.round(
      (new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / msPerDay,
    );
    const isLive = r.check_in_date <= todayYmd && r.check_out_date > todayYmd;

    return {
      id: r.id,
      sourceReservationId: r.source_reservation_id ?? null,
      guestName: r.guest_name ?? "",
      initials: (r.guest_name ?? "?").trim().charAt(0).toUpperCase(),
      channel,
      dateRange: `${ymdToMD(r.check_in_date)} – ${ymdToMD(r.check_out_date)}`,
      nightsCount,
      checkinDate: r.check_in_date,
      checkoutDate: r.check_out_date,
      isLive,
      propertyName: canonProp,
      propertyId,
      roomId,
      displayRoomLabel,
    };
  });
}

// ── Legacy fallbacks (org without classified room-master rows) ────────────────────────────────
// Mirrors the calendar's provisional mode: lean directly on the properties/rooms tables.

type LegacyPropertyRow = { id: string; name: string };
type LegacyRoomRow = { id: string; property_id: string; room_label: string };

async function fetchLegacyBuildings(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  orgId: string,
): Promise<PickerBuilding[]> {
  const todayYmd = tokyoYmd();
  const [propertiesRes, roomsRes] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .order("name"),
    supabase.from("rooms").select("property_id").eq("organization_id", orgId).eq("status", "active"),
  ]);
  const properties = (propertiesRes.data ?? []) as LegacyPropertyRow[];
  const rooms = (roomsRes.data ?? []) as Array<{ property_id: string }>;
  const liveRows = await loadLiveTodayRows(supabase, orgId, todayYmd);

  const roomCounts = new Map<string, number>();
  for (const r of rooms) roomCounts.set(r.property_id, (roomCounts.get(r.property_id) ?? 0) + 1);
  const guestCounts = new Map<string, number>();
  for (const r of liveRows) {
    guestCounts.set(r.property_name, (guestCounts.get(r.property_name) ?? 0) + 1);
  }

  return properties.map((p) => ({
    id: p.name, // legacy: identify by raw property name
    propertyId: p.id,
    name: p.name,
    totalRooms: roomCounts.get(p.id) ?? 0,
    todayGuests: guestCounts.get(p.name) ?? 0,
  }));
}

async function fetchLegacyRooms(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  orgId: string,
  propertyName: string,
): Promise<PickerRoom[]> {
  const todayYmd = tokyoYmd();
  const [roomsRes, liveRows, blockedLabels] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, property_id, room_label, properties!inner(name)")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .eq("properties.name", propertyName)
      .order("room_label"),
    loadLiveTodayRows(supabase, orgId, todayYmd),
    loadBlockedRoomLabels(supabase, orgId, todayYmd),
  ]);
  const rooms = (roomsRes.data as LegacyRoomRow[] | null) ?? [];
  const occupied = new Set(
    liveRows.filter((r) => r.property_name === propertyName).map((r) => r.room_label),
  );
  return rooms.map((r) => ({
    label: r.room_label,
    roomId: r.id,
    propertyId: r.property_id,
    occupied: occupied.has(r.room_label),
    blocked: blockedLabels.has(r.room_label),
  }));
}
