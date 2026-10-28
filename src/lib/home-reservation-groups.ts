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

/**
 * 같은 객실의 체크아웃 · 체크인을 **한 줄**로 묶는다(2026-10-28, 대시보드 「오늘 예약」 시안 18tu6H…).
 *
 * 하루 46줄 가운데 18개 방이 「나가고 바로 들어오는」 방이라 두 줄로 따로 그리면 길고, 그 방이 같은 방인지 눈으로 맞춰야 했다.
 * 열쇠는 정규화 건물 이름 + 객실 표시. 같은 방에 체크인(또는 체크아웃)이 둘 이상이면 차례로 짝짓고 남는 것은 따로 한 줄.
 */
export type RoomTurnRow<T> = {
  /** 두 예약 id 로 만든 열쇠 — 실시간 새로 고침에서 방에 체크인이 새로 붙으면 열쇠가 바뀌어 그 줄만 물든다. */
  key: string;
  propertyName: string;
  roomLabel: string;
  checkOut: T | null;
  checkIn: T | null;
};

export function pairByRoom<T extends { id: string; propertyName: string; roomLabel: string }>(
  checkIns: T[],
  checkOuts: T[],
): RoomTurnRow<T>[] {
  const roomKey = (item: T) => `${getCanonicalPropertyName(item.propertyName ?? "")}|${item.roomLabel}`;
  const rows: RoomTurnRow<T>[] = [];
  const openOuts = new Map<string, RoomTurnRow<T>[]>();
  for (const item of checkOuts) {
    const key = roomKey(item);
    const row = { checkIn: null, checkOut: item, key: "", propertyName: item.propertyName, roomLabel: item.roomLabel };
    rows.push(row);
    openOuts.set(key, [...(openOuts.get(key) ?? []), row]);
  }
  for (const item of checkIns) {
    const waiting = openOuts.get(roomKey(item));
    const row = waiting?.shift();
    if (row) row.checkIn = item;
    else rows.push({ checkIn: item, checkOut: null, key: "", propertyName: item.propertyName, roomLabel: item.roomLabel });
  }
  for (const row of rows) row.key = `out:${row.checkOut?.id ?? ""}|in:${row.checkIn?.id ?? ""}`;
  return rows;
}

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
