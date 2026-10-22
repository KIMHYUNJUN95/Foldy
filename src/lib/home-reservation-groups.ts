import {
  CALENDAR_BUILDING_ORDER,
  compareRoomLabel,
  getCanonicalPropertyName,
  localizePropertyName,
} from "@/lib/room-label-normalization";

/**
 * 홈 「오늘 체크인 · 체크아웃」을 **건물별로** 묶는다(2026-10-22).
 *
 * 어드민 대시보드 홈과 모바일 홈이 같은 규칙을 쓴다 — 건물 순서는 판매 캘린더와 같은 운영 순서
 * (`CALENDAR_BUILDING_ORDER`), 목록에 없는 건물은 뒤에 이름순, 건물 안에서는 객실 번호순.
 * 들어온 순서(체크인 먼저 · 체크아웃 나중)는 같은 객실 안에서 그대로 둔다.
 */
export type BuildingGroup<T> = {
  /** 정규화된 건물 이름(`getCanonicalPropertyName`). React key 로 쓴다. */
  key: string;
  /** 보는 사람 언어의 건물 이름. */
  label: string;
  items: T[];
};

export function groupByBuilding<T>(
  items: T[],
  getProperty: (item: T) => string,
  getRoom: (item: T) => string,
  buildingLabels: Record<string, string>,
): BuildingGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getCanonicalPropertyName(getProperty(item) ?? "");
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const rank = (key: string) => {
    const index = CALENDAR_BUILDING_ORDER.indexOf(key);
    return index === -1 ? CALENDAR_BUILDING_ORDER.length : index;
  };

  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, list]) => ({
      items: list
        .map((item, index) => ({ index, item }))
        .sort((a, b) => compareRoomLabel(getRoom(a.item), getRoom(b.item)) || a.index - b.index)
        .map(({ item }) => item),
      key,
      label: localizePropertyName(key, buildingLabels),
    }));
}
