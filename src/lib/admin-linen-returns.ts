import "server-only";

// 관리자 린넨 반품(Linen Return) 콘솔(/admin/linen-return)의 실데이터 레이어.
// `admin-lost-found.ts` / `admin-maintenance.ts` 를 따른다: 화면용으로 가공된 평평한 뷰 모델,
// 조직 범위 쿼리, 그리고 콘솔이 오류 상태를 보여 줄 수 있게 하는 `loadError` 플래그 —
// 오해를 부르는 빈 목록 대신.
//
// 이 대시보드는 두 번째 등록 흐름이 아니라 기록 관리 콘솔이다: 현장 직원은 계속
// 모바일에서 등록하고, 사무실이 (언제 / 어디서 / 무엇을 / 몇 개 / 누가) 확인하고 바로잡는다.
// `registered_at` / `registered_by_user_id` 는 현장 증거라서 여기서는 절대 수정할 수 없다.
// 참고: docs/product/19-linen-defect-workflow.md → "Admin Dashboard — Linen Return Record Management".

import { organizationRoles, type Role } from "@/config/roles";
import { getDictionary, type Locale } from "@/lib/i18n";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { localizePropertyName } from "@/lib/room-label-normalization";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type RecordRow = Database["public"]["Tables"]["linen_return_records"]["Row"];
type ItemRow = Database["public"]["Tables"]["linen_items"]["Row"];
type LineRow = Database["public"]["Tables"]["linen_return_record_items"]["Row"];

/** 관리자 권한 역할은 모든 기록을 수정/삭제할 수 있다 (RLS 정책 세트와 동일). */

export type AdminLinenLine = {
  itemId: string;
  /** 시드 카탈로그 코드 (건물별 사용자 정의 품목은 null). */
  code: string | null;
  name: string;
  quantity: number;
};

export type AdminLinenRecordVM = {
  id: string;
  /** Short display number — uuid의 앞 6자리(대문자). */
  shortId: string;
  /** 정규 건물명 — 필터 키 / 저장 payload 로 쓰는 값. 화면에는 `buildingLabel` 을 쓴다. */
  buildingName: string;
  /**
   * 표시용 건물명 — 청소·분실물·수리 콘솔과 같은 규칙(`localizePropertyName` + `cleaning.buildingLabels`)
   * 으로 현지화한다. 어드민만 원문 한국어를 보여주던 불일치를 없앤 값.
   */
  buildingLabel: string;
  /** "YYYY-MM-DD HH:MM" (Tokyo) — 현장 증빙값, 수정 불가. */
  registeredAt: string;
  /** 등록자 — 현장 증빙값, 수정 불가. */
  registeredById: string;
  registrantName: string;
  lines: AdminLinenLine[];
  totalQuantity: number;
  note: string | null;
  photos: string[];
  /** 작성자 본인 또는 관리자 역할일 때만 수정·삭제 가능(서버에서 다시 검증한다). */
  canManage: boolean;
};

export type AdminLinenItemOption = {
  id: string;
  code: string | null;
  name: string;
  /** null = 모든 건물에서 선택 가능한 기본 품목. */
  buildingName: string | null;
};

/** 필터 · 수정 폼의 건물 선택지. `name` 이 저장/필터 키, `label` 이 표시값. */
export type AdminLinenBuildingOption = {
  name: string;
  label: string;
};

export type AdminLinenReturnData = {
  records: AdminLinenRecordVM[];
  items: AdminLinenItemOption[];
  buildings: AdminLinenBuildingOption[];
  loadError: boolean;
};

const TOKYO_TZ = "Asia/Tokyo";

// 시드 기본 카탈로그 행은 안정적인 `code` 를 가지며 현지화된 라벨을 보인다. 건물별
// 사용자 정의 품목은 code 가 없다 → 저장된 DB 이름으로 폴백. linen-returns.ts 와 같은 규칙.
function localizeItemName(code: string | null, name: string, locale: Locale): string {
  if (code) {
    const label = getDictionary(locale).linenReturn.items[code];
    if (label) return label;
  }
  return name;
}

/** 도쿄 기준 "YYYY-MM-DD HH:MM" — 콘솔 포매터가 기대하는 형식. */
function tokyoStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 도쿄 기준 오늘의 "YYYY-MM-DD". */
export function todayKeyTokyo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** 기본 조회 기간 — 이번 달(Tokyo) 1일 ~ 말일. 계획 문서의 "current Tokyo calendar month". */
export function defaultRangeTokyo(): { from: string; to: string } {
  const today = todayKeyTokyo();
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

// 양끝 포함 도쿄 날짜 범위 [from 00:00 JST, to+1 00:00 JST). JST 는 UTC+9 이므로 어느 날의 00:00 JST 는
// 그보다 9시간 앞선 UTC 시각이다 — 운영 날짜를 UTC ISO 문자열 자르기로 구하지 말 것.
function tokyoDayRange(from: string, to: string): { fromIso: string; toIso: string } {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return {
    fromIso: new Date(Date.UTC(fy, fm - 1, fd, -9, 0, 0)).toISOString(),
    toIso: new Date(Date.UTC(ty, tm - 1, td + 1, -9, 0, 0)).toISOString(),
  };
}

function isMissingTableError(message: string): boolean {
  return message.includes("does not exist") || message.includes("schema cache");
}

function shortIdOf(id: string): string {
  return id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

/** 작성자 본인 또는 관리자 역할이면 관리 가능. `canManageLinenRecord`(모바일)와 같은 규칙. */
function canManage(session: AppSession, registeredById: string): boolean {
  if (session.user.id === registeredById) return true;
  return session.capabilities.includes("linen.manage");
}

export function isAdminCapableRole(who: { capabilities: readonly string[] }): boolean {
  return who.capabilities.includes("linen.manage");
}

export function isOrganizationRole(role: Role): boolean {
  return (organizationRoles as readonly string[]).includes(role);
}

/** Active linen catalog for the whole organization (필터 + 수정 폼 선택지). */
export async function getOrgLinenItems(session: AppSession): Promise<AdminLinenItemOption[]> {
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
  const locale = session.user.preferredLanguage;
  return ((data ?? []) as ItemRow[]).map((row) => ({
    id: row.id,
    code: row.code,
    name: localizeItemName(row.code, row.name, locale),
    buildingName: row.building_name,
  }));
}

/**
 * 양끝 포함 도쿄 날짜 범위 안에서 등록된 기록, 최근 등록 순.
 * 날짜 범위는 쿼리(서버 측, 조직 범위)에서 적용한다 — 브라우저는
 * 요청한 기간 밖의 행도, 다른 조직의 행도 절대 받지 않는다.
 */
export async function getAdminLinenReturns(
  session: AppSession,
  from: string,
  to: string,
  /** `dictionary.cleaning.buildingLabels` — 청소 콘솔과 같은 건물 표기를 쓰기 위해 받는다. */
  buildingLabels: Record<string, string>,
): Promise<AdminLinenReturnData> {
  const locale = session.user.preferredLanguage;
  const empty: AdminLinenReturnData = { records: [], items: [], buildings: [], loadError: false };

  try {
    const supabase = await getSupabaseServerClient();
    const [start, end] = from <= to ? [from, to] : [to, from];
    const { fromIso, toIso } = tokyoDayRange(start, end);

    const { data, error } = await supabase
      .from("linen_return_records")
      .select("*")
      .eq("organization_id", session.organization.id)
      .gte("registered_at", fromIso)
      .lt("registered_at", toIso)
      .order("registered_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error.message ?? "")) return empty;
      throw new Error(error.message);
    }

    const rows = (data ?? []) as RecordRow[];
    const [items, buildings] = await Promise.all([
      getOrgLinenItems(session),
      getLinenBuildingNames(session, buildingLabels),
    ]);

    if (rows.length === 0) return { records: [], items, buildings, loadError: false };

    const recordIds = rows.map((r) => r.id);
    const { data: lineData, error: lineError } = await supabase
      .from("linen_return_record_items")
      .select("return_record_id, linen_item_id, quantity, sort_order")
      .in("return_record_id", recordIds)
      .order("sort_order", { ascending: true });
    if (lineError) throw new Error(lineError.message);
    const lineRows = (lineData ?? []) as Array<
      Pick<LineRow, "return_record_id" | "linen_item_id" | "quantity" | "sort_order">
    >;

    // 품목 줄이 폐기된 카탈로그 행(is_active=false)을 참조할 수 있다 — 참조된 모든 id 를
    // 해석해서 과거 기록이 품목 라벨을 잃지 않게 한다.
    const itemMeta = new Map<string, { code: string | null; name: string }>();
    for (const item of items) itemMeta.set(item.id, { code: item.code, name: item.name });
    const missingItemIds = [
      ...new Set(lineRows.map((l) => l.linen_item_id).filter((id) => !itemMeta.has(id))),
    ];
    if (missingItemIds.length > 0) {
      const { data: extra } = await supabase
        .from("linen_items")
        .select("id, code, name")
        .in("id", missingItemIds);
      for (const row of (extra ?? []) as Array<Pick<ItemRow, "id" | "code" | "name">>) {
        itemMeta.set(row.id, { code: row.code, name: localizeItemName(row.code, row.name, locale) });
      }
    }

    const registrantIds = [...new Set(rows.map((r) => r.registered_by_user_id))];
    const registrantNames = new Map<string, string>();
    if (registrantIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", registrantIds);
      for (const p of (profiles ?? []) as Array<{ id: string; name: string }>) {
        registrantNames.set(p.id, p.name);
      }
    }

    const linesByRecord = new Map<string, AdminLinenLine[]>();
    for (const line of lineRows) {
      const meta = itemMeta.get(line.linen_item_id);
      const list = linesByRecord.get(line.return_record_id) ?? [];
      list.push({
        itemId: line.linen_item_id,
        code: meta?.code ?? null,
        name: meta?.name ?? "",
        quantity: line.quantity,
      });
      linesByRecord.set(line.return_record_id, list);
    }

    const records: AdminLinenRecordVM[] = rows.map((row) => {
      const lines = linesByRecord.get(row.id) ?? [];
      return {
        id: row.id,
        shortId: shortIdOf(row.id),
        buildingName: row.building_name,
        buildingLabel: localizePropertyName(row.building_name, buildingLabels),
        registeredAt: tokyoStamp(row.registered_at),
        registeredById: row.registered_by_user_id,
        registrantName: registrantNames.get(row.registered_by_user_id) ?? "",
        lines,
        totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
        note: row.note,
        photos: row.image_urls ?? [],
        canManage: canManage(session, row.registered_by_user_id),
      };
    });

    return { records, items, buildings, loadError: false };
  } catch {
    return { records: [], items: [], buildings: [], loadError: true };
  }
}

/** 조직이 운영하는 정규 건물 이름 (주문 / 모바일 린넨 반품과 같은 출처). */
export async function getLinenBuildingNames(
  session: AppSession,
  buildingLabels: Record<string, string>,
): Promise<AdminLinenBuildingOption[]> {
  const catalog = (await getActiveRoomCatalogServer(session.organization.id)) ?? [];
  return [...new Set(catalog.map((item) => item.propertyName))]
    .map((name) => ({ name, label: localizePropertyName(name, buildingLabels) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
}
