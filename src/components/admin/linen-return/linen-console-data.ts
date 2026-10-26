// Admin 린넨 반품 콘솔 — 표현 헬퍼. lost-found-console-data.ts 와 같은 역할:
// 필터 타입 · Tokyo 포맷터 · 필터 옵션 빌더 · 아바타 색상. 데이터(AdminLinenRecordVM)는 실제
// 값이며 src/lib/admin-linen-returns.ts 에서 만든다.
// 참고: docs/product/19-linen-defect-workflow.md.

import type {
  AdminLinenBuildingOption,
  AdminLinenItemOption,
  AdminLinenRecordVM,
} from "@/lib/admin-linen-returns";
import type { Locale } from "@/lib/i18n";

export type LinenFilters = {
  /** 건물명 또는 "all". */
  building: string;
  /** linen_items.id 또는 "all". */
  item: string;
  /** profiles.id 또는 "all". */
  registrant: string;
  /** 조회 기간(Tokyo, inclusive) — 서버 쿼리 조건이라 URL 로 관리한다. */
  from: string;
  to: string;
};

export function localeTagOf(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

// ── 도쿄 포매터 ────────────────────────────────────────────────────────
// 입력은 모두 admin-linen-returns.ts 가 만든 Tokyo "YYYY-MM-DD[ HH:MM]" 문자열이다.
// 이미 도쿄 벽시계 값이므로 여기서 다시 타임존 변환을 하지 않는다.

/** "2026-07-29" → "2026.07.29" (mono 열 정렬용 고정 포맷). */
export function fmtDate(dateKey: string): string {
  return dateKey.replaceAll("-", ".");
}

/** "2026-07-29 18:24" → "2026.07.29 18:24". */
export function fmtDateTime(stamp: string | null): string {
  if (!stamp) return "—";
  const [day, time] = stamp.split(" ");
  return time ? `${fmtDate(day)} ${time}` : fmtDate(day);
}

export function dayOf(stamp: string): string {
  return stamp.slice(0, 10);
}

export function timeOf(stamp: string): string {
  return stamp.slice(11, 16);
}

/** 요일 짧은 이름 (ko "수" / ja "水" / en "Wed"). */
export function weekdayLabel(dateKey: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", weekday: "short" }).format(
    new Date(`${dateKey}T00:00:00+09:00`),
  );
}

/** 패널 제목용 긴 날짜 (ko "2026년 7월 29일 수"). */
export function fmtDateLong(dateKey: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${dateKey}T00:00:00+09:00`));
}

/** "{n}" 등 자리표시자 치환 — 기존 콘솔들의 tpl 헬퍼와 같은 최소 구현. */
export function tpl(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

// ── 기록 헬퍼 ──────────────────────────────────────────────────────────

/** 행 요약 — "싱글 이불 커버 외 2종". 품목이 하나면 이름만. */
export function summaryOf(record: AdminLinenRecordVM, moreLabel: string, kindsUnit: string): string {
  if (record.lines.length === 0) return "—";
  const first = record.lines[0].name;
  if (record.lines.length === 1) return first;
  return `${first} ${moreLabel} ${record.lines.length - 1}${kindsUnit}`;
}

/** 삭제 확인 모달용 전체 나열 — "타월 8 · 베개 커버 12". */
export function summaryFullOf(record: AdminLinenRecordVM): string {
  return record.lines.map((line) => `${line.name} ${line.quantity}`).join(" · ");
}

export function quantityOfItem(record: AdminLinenRecordVM, itemId: string): number {
  return record.lines.find((line) => line.itemId === itemId)?.quantity ?? 0;
}

// ── filter option builders (로드된 행에서 파생 — 하드코딩 마스터 금지) ──────────

export function buildingOptionsOf(
  records: readonly AdminLinenRecordVM[],
  all: readonly AdminLinenBuildingOption[],
): AdminLinenBuildingOption[] {
  // 조회 기간에 기록이 없는 건물도 고를 수 있어야 "이 건물은 반품이 없다"를 확인할 수 있다.
  const map = new Map<string, AdminLinenBuildingOption>();
  for (const option of all) {
    if (option.name) map.set(option.name, option);
  }
  // 룸 마스터에서 사라진 과거 건물도 기록에 남아 있으면 고를 수 있어야 한다.
  for (const record of records) {
    if (!record.buildingName || map.has(record.buildingName)) continue;
    map.set(record.buildingName, { name: record.buildingName, label: record.buildingLabel });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "ko"));
}

export type RegistrantOption = { id: string; name: string };

/** 등록자 필터 옵션 — 이름만 노출한다(담당 건물 보조줄은 목록을 어지럽혀서 제외). */
export function registrantOptionsOf(records: readonly AdminLinenRecordVM[]): RegistrantOption[] {
  const map = new Map<string, string>();
  for (const record of records) {
    if (!record.registeredById || map.has(record.registeredById)) continue;
    map.set(record.registeredById, record.registrantName);
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 수정 폼에서 고를 수 있는 품목 = 전역 품목 + 이 건물 전용 품목. 서버 검증과 같은 규칙. */
export function itemsForBuilding(
  items: readonly AdminLinenItemOption[],
  building: string,
): AdminLinenItemOption[] {
  return items.filter((item) => item.buildingName === null || item.buildingName === building);
}

// ── item aggregation (품목별 수량 뷰) ────────────────────────────────────────

export type ItemAggregate = {
  itemId: string;
  name: string;
  quantity: number;
  recordCount: number;
  /** "YYYY-MM-DD HH:MM" 또는 null. */
  lastAt: string | null;
};

/**
 * 기간·건물·등록자 조건의 기록을 품목별로 합산한다. 품목 필터는 의도적으로 무시한다 —
 * 이 뷰는 항상 전체 품목 기준의 대조표다. 반품이 없던 품목도 0으로 끝에 남겨서
 * "이 품목은 이 기간에 반품이 없었다"를 확인할 수 있게 한다.
 */
export function aggregateByItem(
  records: readonly AdminLinenRecordVM[],
  catalog: readonly AdminLinenItemOption[],
): ItemAggregate[] {
  const map = new Map<string, ItemAggregate>();
  for (const record of records) {
    for (const line of record.lines) {
      const entry = map.get(line.itemId) ?? {
        itemId: line.itemId,
        name: line.name,
        quantity: 0,
        recordCount: 0,
        lastAt: null,
      };
      entry.quantity += line.quantity;
      entry.recordCount += 1;
      if (!entry.lastAt || record.registeredAt > entry.lastAt) entry.lastAt = record.registeredAt;
      map.set(line.itemId, entry);
    }
  }
  const returned = [...map.values()].sort((a, b) => b.quantity - a.quantity);
  const zeros = catalog
    .filter((item) => !map.has(item.id))
    .map<ItemAggregate>((item) => ({
      itemId: item.id,
      name: item.name,
      quantity: 0,
      recordCount: 0,
      lastAt: null,
    }));
  return [...returned, ...zeros];
}

/** 같은 조건에서 품목별 전체-건물 수량 (건물을 좁혔을 때 나란히 보여주는 대조값). */
export function quantityByItemOf(records: readonly AdminLinenRecordVM[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const record of records) {
    for (const line of record.lines) {
      map.set(line.itemId, (map.get(line.itemId) ?? 0) + line.quantity);
    }
  }
  return map;
}

// ── 내보내기 페이로드 (Excel / PDF) ────────────────────────────────────────
// 콘솔이 화면에 그린 것과 같은 값을 서버 액션에 그대로 넘긴다 — 다른 콘솔(청소·주문·근태)과 같은
// 방식이라, 내보낸 파일은 언제나 "지금 보고 있는 조건 그대로"가 된다. 로케일은 서버가
// `session.user.preferredLanguage` 에서 정하므로 여기서 넘기지 않는다.

export type LinenRecordExportRow = {
  /** "2026.07.30 16:32" */
  registeredAt: string;
  building: string;
  /** "수건 12 · 베개 커버 5" — 전체 품목/수량. */
  items: string;
  kinds: number;
  totalQuantity: number;
  registrant: string;
  note: string;
};

export type LinenItemExportRow = {
  name: string;
  quantity: number;
  /** 건물을 좁혔을 때의 전체 건물 수량. 전체 건물 보기에서는 null. */
  allBuildingQuantity: number | null;
  recordCount: number;
  /** "2026.07.30 16:32" 또는 null. */
  lastAt: string | null;
};

export type LinenExportPayload = {
  from: string;
  to: string;
  /** 건물 필터의 표시 라벨 — 품목 시트의 수량 열 헤더에 쓴다. null = 전체 건물. */
  building: string | null;
  /** "아라키초B · 김현준" 처럼 적용된 필터 요약. 없으면 빈 문자열. */
  scopeLabel: string;
  records: LinenRecordExportRow[];
  items: LinenItemExportRow[];
};

// ── avatar palette (청소/수리/분실물 콘솔과 같은 결정적 해시 → 사용자별 고정 색) ──
const AVATAR_PALETTE = [
  "#3f7d5a",
  "#a86b3c",
  "#4d6db5",
  "#557a8a",
  "#7a5aa8",
  "#2f4d8f",
  "#8a5a5a",
  "#5a8a6f",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function avatarColorFor(id: string): string {
  return AVATAR_PALETTE[hashString(id) % AVATAR_PALETTE.length];
}

export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}
