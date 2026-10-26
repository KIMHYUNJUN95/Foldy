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
  /** 정규 건물명 — 객실/예약 조회에 다시 넘기는 건물 식별자로 쓴다. */
  id: string;
  /** 건물의 properties.id UUID (객실만 연결한 컨텍스트 링크에 저장됨). */
  propertyId: string | null;
  /** 현지화된 표시 이름. */
  name: string;
  totalRooms: number;
  todayGuests: number;
};

export type PickerRoom = {
  /** 표시용 라벨 (하위 호실은 이미 병합됨, 예: 201_2 → 201). */
  label: string;
  /** 대표 객실 행의 rooms.id UUID (컨텍스트 링크에 저장됨). */
  roomId: string | null;
  /** 소속 건물의 properties.id UUID. */
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
  /** 표시 문자열 (예: "6/1 – 6/4") */
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

// 행 모양 — supabase-js v2 버그(enum `status` 컬럼에 필터 메서드를 이어 붙이면 추론된 행 타입이 `never`로
// 무너짐)를 피하려고 명시적으로 캐스팅한다.
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

/** 표시용 객실 라벨을 가능하면 숫자순(201 < 202 < 301), 아니면 사전순으로 정렬한다. */
function compareRoomLabel(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** 오늘의 유효 예약(체크인했고 아직 퇴실 전) — 점유/투숙객 수 계산용. */
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
 * 조직의 활성 건물 — 예약 캘린더의 활성 객실 카탈로그와 같은 기준이다.
 * 활성 객실이 있는 건물만 나오고, 하위 호실은 병합되며, 사노는 제외된다.
 * 조직에 분류된 객실 마스터 행이 없으면 원본 `properties` 목록으로 대체한다.
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

  // 활성 객실을 정규 건물별로 묶어 고유 표시 라벨 수를 세고, 대표
  // property UUID를 잡는다 (같은 정규 건물의 객실은 property_id가 같다).
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

  // 정규 건물별 오늘의 투숙객 (캘린더와 같은 조회로 계산).
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

/** 건물의 활성 객실 (표시 라벨, 하위 호실 병합) + 오늘 점유 여부. */
export async function fetchPickerRooms(propertyId: string): Promise<PickerRoom[]> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return [];

  const orgId = session.organization.id;
  const todayYmd = tokyoYmd();
  const supabase = getSupabaseServiceClient();
  const canonProp = propertyId; // building.id 가 정규 건물명이다

  const catalog = await getActiveRoomCatalog(orgId, supabase);
  if (catalog === undefined) {
    return fetchLegacyRooms(supabase, orgId, propertyId);
  }

  // 이 건물의 고유 표시 라벨과 각각의 대표 객실 UUID. 하위 호실
  // (201 / 201_2)은 한 칸으로 합치고, 기본 호실(정규 키 === 표시 라벨)을 우선한다.
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

  // 점유: 오늘의 유효 예약을 표시 라벨로 변환한다.
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
 * 한 표시 객실의 2개월 구간(이번 달 + 다음 달, 도쿄) 예약.
 * 예약은 활성 객실 카탈로그를 거쳐 매칭하므로 하위 호실(201 / 201_2) 예약도
 * 병합된 표시 라벨 아래에 나타난다.
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

  // 구간: 이번 달 1일 → 다음 달 말일 (도쿄).
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
    // 임시 조직(객실 마스터 없음): 원본 room_label 정확 일치로 대체한다.
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

// ── 예약 검색 ────────────────────────────────────────────────────────────────────────

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
  /** 정규 한국어 건물명. */
  propertyName: string;
  propertyId: string | null;
  roomId: string | null;
  /** 현지화된 표시 객실 라벨 (getDisplayRoomLabel 결과와 같은 값). */
  displayRoomLabel: string;
};

/** 월 단위 날짜 계산: (year, month)에서 `delta`개월 이동한 YYYY-MM-01 을 반환한다. */
function offsetYm(year: number, month: number, delta: number): string {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * 게스트 이름 또는 Beds24 예약번호로 하는 건물 간 예약 검색.
 * 4개월 구간(1개월 전 → 3개월 후, 도쿄)을 검색해 최대 20건을 반환한다.
 */
export async function searchReservations(query: string): Promise<ReservationSearchResult[]> {
  // PostgREST `or()` 필터 문법 글자(`,` `(` `)` `%` …)를 뺀다(2026-10-26) — 손님 이름에 쉼표나 괄호가
  // 들어가면 필터 문자열이 깨져 검색이 통째로 실패하거나 다른 조건으로 읽혔다.
  // `or()` 문법을 깨는 글자(쉼표 · 괄호 · 따옴표 · 역슬래시)와 와일드카드(% *)만 뺀다 — `.` `_` 는 이름(J. Smith) · 예약 번호에 쓰여 남긴다.
  const q = String(query ?? "").replace(/[,()"\\%*]/g, "").trim();
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

  // UUID 조회표 생성: "<canonProp>::<canonRoom>" → { propertyId, roomId }
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

// ── 레거시 대체 경로 (객실 마스터 분류가 없는 조직) ────────────────────────────────
// 캘린더의 임시 모드와 같다: properties/rooms 테이블에 직접 의존한다.

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
    id: p.name, // 레거시: 원본 property 이름으로 식별
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
