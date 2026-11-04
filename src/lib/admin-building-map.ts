import "server-only";

import type { AppSession } from "@/lib/session";
import type { CleaningSessionWithStaff } from "@/lib/cleaning";
import {
  buildSessionRoomLabel,
  compareRoomLabel,
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
  type ActiveRoomCatalogItem,
} from "@/lib/rooms";
import { dashboardRoomCleanState } from "@/lib/cleaning-record-rules";
import { storedSessionRoomKey, type RoomRecord } from "@/lib/cleaning-assign/room-key";
import { sortBuildings } from "@/lib/admin-calendar-dashboard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { tokyoDayEndExclusive, tokyoDayStart } from "@/lib/tokyo-date";
import type { Database } from "@/types/database";

/**
 * 대시보드 홈 「오늘의 건물」 지도 카드(2026-10-16, 시안 Motion-D-MapDash-PC) — 건물마다 오늘 상태.
 *
 * 예약 → 객실은 홈 체크인 · 아웃 목록(`getHomeCheckInOutReservations`)과 같은 방식으로 풀고(객실 마스터가 기준),
 * 청소 세션 라벨(`아라키초A 402` · `오쿠보A`)은 객실 마스터로 같은 객실에 붙인다.
 * - 객실 상태: 오늘 체크인 → `in` · 오늘 밤 묵는 중 → `stay` · 청소 중 → `clean` · 그 밖 → `vacant`
 * - 빈 방 = 오늘 밤 아무도 안 묵는 객실(예약 캘린더 건물 고르기와 같은 셈)
 * - 청소 = 오늘 체크아웃 객실 ∪ 오늘 청소를 시작한 객실 가운데 끝난 수
 * - 소식 = 오늘 청소 시작 · 완료, 오늘 들어온 예약(새 예약 — `created_at` 도쿄 기준 오늘)
 * 문서: docs/product/05-admin-web-ia.md → 「오늘의 건물」.
 */

export type DashRoomState = "stay" | "in" | "clean" | "vacant";

export type DashBuilding = {
  property: string;
  label: string;
  rooms: Array<{ label: string; state: DashRoomState }>;
  checkIns: number;
  checkOuts: number;
  empty: number;
  cleanDone: number;
  cleanTotal: number;
  inRooms: string[];
  outRooms: string[];
  cleanLeft: string[];
};

export type DashFeedItem = {
  id: string;
  kind: "cleanDone" | "cleanStart" | "booking";
  property: string;
  room: string;
  at: string;
  who: string;
  checkIn?: string;
  checkOut?: string;
  source?: string;
};

export type DashboardBuildingMap = { buildings: DashBuilding[]; feed: DashFeedItem[] };

type ReservationStatus = Database["public"]["Enums"]["reservation_status"];
type ReservationRow = {
  id: string;
  property_name: string | null;
  room_label: string | null;
  source: string | null;
  check_in_date: string;
  check_out_date: string;
  status: ReservationStatus;
  created_at: string;
  raw_payload: Database["public"]["Tables"]["reservations"]["Row"]["raw_payload"];
};

export type BuildingMapSource = {
  catalog: ActiveRoomCatalogItem[] | undefined;
  reservations: ReservationRow[];
  /** 오늘 방 키 → 배정된 사람들(2인 방 「1/2 끝남」 판단, C7). 못 읽었으면 undefined — 배정 없음(빈 객체)과 다르다. */
  assignees?: Record<string, string[]>;
};

const FEED_LIMIT = 8;

/** 오늘에 걸친 예약(오늘 체크인 · 체크아웃 · 묵는 중)과 오늘 들어온 예약 + 객실 마스터. */
export async function fetchBuildingMapSource(session: AppSession, today: string): Promise<BuildingMapSource> {
  const supabase = await getSupabaseServerClient();
  const columns = "id, property_name, room_label, source, check_in_date, check_out_date, status, created_at, raw_payload";
  const [around, fresh, catalog] = await Promise.all([
    supabase
      .from("reservations")
      .select(columns)
      .eq("organization_id", session.organization.id)
      .lte("check_in_date", today)
      .gte("check_out_date", today),
    supabase
      .from("reservations")
      .select(columns)
      .eq("organization_id", session.organization.id)
      .gte("created_at", tokyoDayStart(today))
      .lt("created_at", tokyoDayEndExclusive(today))
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
    getActiveRoomCatalog(session.organization.id, supabase),
  ]);
  if (around.error) throw around.error;
  // `cleaning_assignments` 는 service_role 전용(authenticated 권한 회수, 마이그레이션 202610200007) — 호출자(관리자 웹 접근 확인 뒤)가 조직으로 좁혀 읽는다.
  const assignRes = await getSupabaseServiceClient()
    .from("cleaning_assignments")
    .select("room_key, user_id")
    .eq("organization_id", session.organization.id)
    .eq("work_date", today);
  let assignees: Record<string, string[]> | undefined;
  if (assignRes.error) {
    console.error("[admin-building-map] cleaning_assignments read failed", assignRes.error.message);
  } else {
    assignees = {};
    for (const row of (assignRes.data ?? []) as { room_key: string; user_id: string }[]) {
      (assignees[row.room_key] ??= []).push(row.user_id);
    }
  }
  const seen = new Set<string>();
  const reservations = [...((around.data ?? []) as ReservationRow[]), ...((fresh.data ?? []) as ReservationRow[])].filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  return { catalog, reservations, assignees };
}

export function buildDashboardBuildingMap(
  source: BuildingMapSource,
  sessions: readonly CleaningSessionWithStaff[],
  today: string,
  buildingLabels: Record<string, string>,
): DashboardBuildingMap {
  const catalog = (source.catalog ?? []).filter(
    (item) => !isExcludedOperationalProperty(item.propertyName) && !isExcludedOperationalRoom(item.propertyName, item.roomLabel),
  );
  const lookups = buildPropertyRoomLookups(source.catalog ?? []);
  const globalExternalRoomToCanonical = buildGlobalExternalRoomToCanonical(source.catalog ?? []);
  const isAuthoritative = source.catalog !== undefined;

  const roomsByProperty = new Map<string, Set<string>>();
  for (const item of catalog) {
    const set = roomsByProperty.get(item.propertyName) ?? new Set<string>();
    set.add(item.displayRoomLabel);
    roomsByProperty.set(item.propertyName, set);
  }

  // 예약 → (건물, 표시 객실)
  const place = (r: ReservationRow) => {
    const property = getCanonicalPropertyName((r.property_name ?? "").trim());
    const key =
      resolveReservationCanonicalRoomLabel(
        { property_name: r.property_name ?? "", room_label: r.room_label ?? "", raw_payload: r.raw_payload },
        { lookups, globalExternalRoomToCanonical, isAuthoritative },
      ) || getCanonicalRoomLabel(property, (r.room_label ?? "").trim());
    return { property, room: key ? getDisplayRoomLabel(property, key) : "" };
  };

  // 청소 세션 라벨 → (건물, 표시 객실)
  const norm = (v: string) => v.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const bySessionLabel = new Map<string, { property: string; room: string }>();
  for (const item of catalog) {
    bySessionLabel.set(norm(buildSessionRoomLabel(item.propertyName, item.canonicalRoomLabel)), {
      property: item.propertyName,
      room: item.displayRoomLabel,
    });
  }
  const propertyNames = [...roomsByProperty.keys()].sort((a, b) => b.length - a.length);
  const sessionPlace = (label: string) => {
    const hit = bySessionLabel.get(norm(label));
    if (hit) return hit;
    const trimmed = label.trim();
    const property = propertyNames.find((p) => trimmed === p || trimmed.startsWith(`${p} `));
    if (!property) return null;
    const rest = trimmed.slice(property.length).trim();
    return { property, room: rest ? getDisplayRoomLabel(property, getCanonicalRoomLabel(property, rest)) : property };
  };

  type Acc = { stay: Set<string>; inR: Set<string>; outR: Set<string>; cleaning: Set<string>; done: Set<string>; started: Set<string>; checkIns: number; checkOuts: number };
  const acc = new Map<string, Acc>();
  const get = (property: string) => {
    let a = acc.get(property);
    if (!a) {
      a = { stay: new Set(), inR: new Set(), outR: new Set(), cleaning: new Set(), done: new Set(), started: new Set(), checkIns: 0, checkOuts: 0 };
      acc.set(property, a);
    }
    return a;
  };

  const feed: DashFeedItem[] = [];
  const todayStart = tokyoDayStart(today);
  for (const r of source.reservations) {
    if (r.status === "cancelled" || r.status === "no_show") continue;
    if (isExcludedOperationalProperty(r.property_name ?? "") || isExcludedOperationalRoom(r.property_name ?? "", r.room_label ?? "")) continue;
    const { property, room } = place(r);
    if (!roomsByProperty.has(property)) continue;
    if (r.created_at >= todayStart) {
      feed.push({ id: `booking-${r.id}`, kind: "booking", property, room, at: r.created_at, who: "", checkIn: r.check_in_date, checkOut: r.check_out_date, source: (r.source ?? "").trim() });
    }
    if (r.check_in_date > today || r.check_out_date < today) continue;
    const a = get(property);
    if (r.check_in_date === today) {
      a.checkIns += 1;
      if (room) a.inR.add(room);
    }
    if (r.check_out_date === today) {
      a.checkOuts += 1;
      if (room) a.outR.add(room);
    }
    if (room && r.check_in_date <= today && r.check_out_date > today) a.stay.add(room);
  }

  // 방 상태는 `roomShareState` 하나(docs/product/45 C7): 처리 끝은 끝남, 2인 방 「1/2 끝남」은 안 끝난 방.
  // 활동 피드는 처리 끝 제외(C3).
  const roomGroups = new Map<string, { at: { property: string; room: string }; records: RoomRecord[]; keys: Set<string> }>();
  for (const s of sessions) {
    if (s.status === "cancelled" || s.cleaning_date !== today) continue;
    const at = sessionPlace(s.room_label);
    if (!at) continue;
    const groupKey = `${at.property}\u0000${at.room}`;
    const g = roomGroups.get(groupKey) ?? { at, records: [], keys: new Set<string>() };
    g.records.push({ staffId: s.staff_user_id, status: s.status, closed: Boolean(s.closed_without_cleaning) });
    g.keys.add(storedSessionRoomKey(s));
    roomGroups.set(groupKey, g);
    if (s.closed_without_cleaning) continue;
    feed.push(
      s.status === "completed" && s.completed_at
        ? { id: `clean-${s.id}`, kind: "cleanDone", property: at.property, room: at.room, at: s.completed_at, who: s.staff_name ?? "" }
        : { id: `cleanstart-${s.id}`, kind: "cleanStart", property: at.property, room: at.room, at: s.started_at, who: s.staff_name ?? "" },
    );
  }
  for (const g of roomGroups.values()) {
    const assigneeIds = [...new Set([...g.keys].flatMap((k) => source.assignees?.[k] ?? []))];
    const state = dashboardRoomCleanState(g.records, assigneeIds, source.assignees !== undefined);
    if (state === "none") continue;
    const a = get(g.at.property);
    a.started.add(g.at.room);
    if (state === "done") a.done.add(g.at.room);
    else a.cleaning.add(g.at.room);
  }

  const buildings: DashBuilding[] = sortBuildings([...roomsByProperty.keys()]).map((property) => {
    const a = get(property);
    const labels = [...(roomsByProperty.get(property) ?? [])].sort(compareRoomLabel);
    const rooms = labels.map((label) => ({
      label,
      state: (a.inR.has(label) ? "in" : a.stay.has(label) ? "stay" : a.cleaning.has(label) ? "clean" : "vacant") as DashRoomState,
    }));
    const needs = new Set([...a.outR, ...a.started]);
    const cleanDone = [...needs].filter((r) => a.done.has(r)).length;
    return {
      property,
      label: localizePropertyName(property, buildingLabels),
      rooms,
      checkIns: a.checkIns,
      checkOuts: a.checkOuts,
      empty: labels.filter((l) => !a.stay.has(l)).length,
      cleanDone,
      cleanTotal: needs.size,
      inRooms: [...a.inR].sort(compareRoomLabel),
      outRooms: [...a.outR].sort(compareRoomLabel),
      cleanLeft: [...needs].filter((r) => !a.done.has(r)).sort(compareRoomLabel),
    };
  });

  feed.sort((x, y) => y.at.localeCompare(x.at));
  return { buildings, feed: feed.slice(0, FEED_LIMIT) };
}
