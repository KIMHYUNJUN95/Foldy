/**
 * 룸 링크 — 순수 규칙(묶기 · 링크 검증). DB · 세션을 모른다 — 테스트로 고정한다(`room-links-model.test.ts`).
 *
 * 도메인 계약: docs/product/35-room-links.md
 *
 * ## 한 줄 = 유닛 하나 × 채널 하나, 화면은 캘린더 행으로 다시 묶는다
 *
 * 같은 물리 객실을 두 Airbnb 계정이 번갈아 판다(아라키초A `201` / `201_2`, 가부키초 `202#` / `K202`). 링크는 유닛에
 * 붙고(`room_listing_links.room_id`), 화면은 판매 캘린더와 **같은 행 키**(`opsUnitRoomKey`)로 묶어 한 카드에 보여 준다.
 */
import { opsUnitRoomKey, ROOM_AXIS_SEPARATOR } from "@/lib/ops-room-key";

export type RoomLinkChannel = "airbnb" | "booking";
/**
 * 채널마다 붙는 단위가 다르다(2026-10-02 사용자 지적). Airbnb 는 **객실(계정)마다** 리스팅이 있고, Booking.com 은
 * **숙소(건물) 하나**에 객실 타입이 붙는다 — 엑스트라넷 · 손님용 페이지가 건물마다 하나다.
 */
export const ROOM_LINK_CHANNELS: readonly RoomLinkChannel[] = ["airbnb"];
export const BUILDING_LINK_CHANNELS: readonly RoomLinkChannel[] = ["booking"];

/** 메모 최대 길이 — DB 체크 제약(`room_listing_links_memo_len`)과 같다. */
export const ROOM_LINK_MEMO_MAX = 200;

/** 최소숙박이 이 값 이상이면 「쉬는 계정」(Beds24 잠금) — `BEDS24_INACTIVE_MIN_STAY_THRESHOLD` 와 같은 규칙. */
const INACTIVE_MIN_STAY = 50;

/** 「지금 판매 중」을 가릴 때 앞으로 볼 날 수(오늘 포함). */
export const ROOM_LINK_SELLING_WINDOW_DAYS = 30;

export type RoomLinkRecord = {
  roomId: string;
  channel: RoomLinkChannel;
  listingId: string | null;
  hostUrl: string | null;
  guestUrl: string | null;
  memo: string | null;
  updatedAt: string | null;
};

export type RoomLinkUnitInput = {
  id: string;
  propertyName: string | null | undefined;
  roomLabel: string;
  status: string;
  externalMinimumStay: number | null;
  /**
   * 오늘부터 `ROOM_LINK_SELLING_WINDOW_DAYS` 일 중 **판매 캘린더가 활성으로 보는 밤** 수(날짜별 최소숙박 1~49).
   * 요금 칸이 하나도 없으면 `null` — 그때만 `externalMinimumStay` 로 대신한다.
   */
  activeNights?: number | null;
};

export type RoomLinkUnit = {
  roomId: string;
  unitLabel: string;
  /**
   * 지금 이 계정으로 팔고 있나. 유닛이 하나인 방에도 표시한다(2026-10-02) — 번갈아 파는 방에선 어느 계정이 지금인지.
   * 판정은 `pickSellingUnits` — 오늘 하루가 아니라 **앞으로 30일 중 활성 밤이 가장 많은 계정**이다.
   */
  selling: boolean;
  /** 룸 링크에서 직접 추가한 객실(`room_link_rooms`) — Beds24 유닛이 아니다. 이때 `roomId` 는 그 객실의 id. */
  manual: boolean;
  links: Partial<Record<RoomLinkChannel, RoomLinkRecord>>;
};

export type RoomLinkRow = {
  key: string;
  label: string;
  /** 직접 추가한 객실이면 그 id(`room_link_rooms.id`), Beds24 객실이면 `null`. */
  manualRoomId: string | null;
  units: RoomLinkUnit[];
};
export type RoomLinkBuilding = {
  name: string;
  /** 직접 추가한 건물이면 그 id(`room_link_buildings.id`), Beds24 건물이면 `null`. */
  manualId: string | null;
  rows: RoomLinkRow[];
};

/** 캘린더와 같은 객실 이름 순서(숫자 인식). */
function compareLabels(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

/**
 * 유닛 + 링크를 건물 → 행 → 유닛으로 묶는다.
 *
 * - 운영 종료(`status !== 'active'`) 유닛도 **링크가 있으면** 넣는다 — 번갈아 파는 쉬는 계정이 대개 이 상태다
 *   (오쿠보C `오쿠보 2-1`). 링크도 없고 운영도 안 하면 뺀다(쓰지 않는 ID — 다카다노바바 `401_2`).
 * - 행 키를 못 만드는 유닛(건물 이름 없음)은 뺀다.
 * - 건물 순서는 `buildingOrder`(캘린더 탭 순서)를 따르고, 목록에 없는 건물은 이름순으로 뒤에 붙인다.
 */
export function groupRoomLinks(args: {
  units: readonly RoomLinkUnitInput[];
  links: readonly RoomLinkRecord[];
  buildingOrder: readonly string[];
}): RoomLinkBuilding[] {
  const linksByRoom = new Map<string, Partial<Record<RoomLinkChannel, RoomLinkRecord>>>();
  for (const link of args.links) {
    const bucket = linksByRoom.get(link.roomId) ?? {};
    bucket[link.channel] = link;
    linksByRoom.set(link.roomId, bucket);
  }

  const rowsByBuilding = new Map<string, Map<string, RoomLinkRow>>();
  const inputByRoom = new Map<string, RoomLinkUnitInput>();
  for (const unit of args.units) {
    const links = linksByRoom.get(unit.id) ?? {};
    const hasLink = Object.keys(links).length > 0;
    if (unit.status !== "active" && !hasLink) continue;
    const key = opsUnitRoomKey({ propertyName: unit.propertyName, roomLabel: unit.roomLabel });
    if (!key) continue;
    const separator = key.indexOf(ROOM_AXIS_SEPARATOR);
    const building = key.slice(0, separator);
    const label = key.slice(separator + ROOM_AXIS_SEPARATOR.length);
    const rows = rowsByBuilding.get(building) ?? new Map<string, RoomLinkRow>();
    const row = rows.get(key) ?? { key, label, manualRoomId: null, units: [] };
    row.units.push({ links, manual: false, roomId: unit.id, selling: false, unitLabel: unit.roomLabel });
    inputByRoom.set(unit.id, unit);
    rows.set(key, row);
    rowsByBuilding.set(building, rows);
  }
  for (const rows of rowsByBuilding.values()) {
    for (const row of rows.values()) {
      const selling = pickSellingUnits(row.units.map((unit) => inputByRoom.get(unit.roomId)!));
      row.units = row.units.map((unit) => ({ ...unit, selling: selling.has(unit.roomId) }));
    }
  }

  const orderIndex = new Map(args.buildingOrder.map((name, index) => [name, index]));
  return [...rowsByBuilding.entries()]
    .sort(([a], [b]) => {
      const ai = orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ai !== bi ? ai - bi : a.localeCompare(b, "ko");
    })
    .map(([name, rows]) => ({
      manualId: null,
      name,
      rows: [...rows.values()]
        .sort((a, b) => compareLabels(a.label, b.label))
        .map((row) => ({ ...row, units: [...row.units].sort((a, b) => compareLabels(a.unitLabel, b.unitLabel)) })),
    }));
}

/**
 * 한 행(같은 물리 객실)의 유닛 중 **지금 판매 중인 계정**.
 *
 * 판매 캘린더의 활성 · 비활성(Beds24 날짜별 최소숙박 1~49 = 활성)을 그대로 쓰되, **오늘 하루로 정하지 않는다** —
 * 계정이 바뀌는 무렵엔 두 계정이 며칠 겹쳐 열려 있다(2026-10-01~04 아라키초A `201` · `201_2` 둘 다 활성). 그래서
 * 앞으로 30일 중 활성 밤이 **가장 많은** 계정을 판매 중으로 본다(같으면 둘 다). 사용자 결정(2026-10-02): 날짜는
 * 보여 주지 않고 판매 중인지 아닌지만.
 *
 * 요금 칸이 하나도 없는 유닛은 객실 표의 최소숙박(`externalMinimumStay`)이 잠금이 아니면 활성 30일로 친다.
 * 운영 종료(`status !== 'active'`) 유닛은 판매 중이 아니다.
 */
export function pickSellingUnits(units: readonly RoomLinkUnitInput[]): Set<string> {
  const nights = units.map((unit) => {
    if (unit.status !== "active") return 0;
    if (unit.activeNights !== undefined && unit.activeNights !== null) return unit.activeNights;
    const min = unit.externalMinimumStay;
    return min === null || min < INACTIVE_MIN_STAY ? ROOM_LINK_SELLING_WINDOW_DAYS : 0;
  });
  const best = Math.max(0, ...nights);
  const selling = new Set<string>();
  if (best === 0) return selling;
  units.forEach((unit, index) => {
    if (nights[index] === best) selling.add(unit.id);
  });
  return selling;
}

/**
 * 같은 리스팅 ID 가 **두 유닛 이상**에 붙어 있으면 그 ID 들. 저쪽 원본 데이터에 실제로 있었던 복사 실수
 * (가부키초 K202 · KK202 가 같은 ID)를 화면이 경고하는 근거다.
 */
export function findDuplicateListingIds(links: readonly RoomLinkRecord[]): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const link of links) {
    if (!link.listingId) continue;
    const key = `${link.channel}:${link.listingId}`;
    const rooms = seen.get(key) ?? new Set<string>();
    rooms.add(link.roomId);
    seen.set(key, rooms);
  }
  const duplicates = new Set<string>();
  for (const [key, rooms] of seen) {
    if (rooms.size > 1) duplicates.add(key.slice(key.indexOf(":") + 1));
  }
  return duplicates;
}

// ── 직접 추가한 건물 · 객실 (2026-10-15) ──────────────────────────────

/** 직접 추가하는 건물 · 객실 이름 최대 길이 — DB 체크 제약(`room_link_*_name_len`)과 같다. */
export const ROOM_LINK_NAME_MAX = 40;

export type ManualNameError = "name_empty" | "name_long" | "name_taken";

/** 앞뒤 공백을 떼고 안쪽 공백은 하나로. */
export function normalizeManualName(raw: string | null | undefined): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

/** 같은 이름인가 — 공백 정리 · 대소문자 무시(「Sky 101」 = 「SKY  101」). */
function nameKey(name: string) {
  return normalizeManualName(name).toLowerCase();
}

/**
 * 직접 추가하는 이름 검사 — 1~40자, `taken`(같은 건물의 객실 이름 · 또는 모든 건물 이름)과 겹치지 않게.
 * 이름 바꾸기는 호출부가 자기 이름을 `taken` 에서 빼고 부른다.
 */
export function validateManualName(
  raw: string | null | undefined,
  taken: Iterable<string>,
): { ok: true; name: string } | { ok: false; error: ManualNameError } {
  const name = normalizeManualName(raw);
  if (!name) return { error: "name_empty", ok: false };
  if (name.length > ROOM_LINK_NAME_MAX) return { error: "name_long", ok: false };
  const key = nameKey(name);
  for (const other of taken) {
    if (nameKey(other) === key) return { error: "name_taken", ok: false };
  }
  return { name, ok: true };
}

export type ManualBuildingInput = { id: string; name: string; sortOrder: number; createdAt: string };
export type ManualRoomInput = {
  id: string;
  name: string;
  /** Beds24 건물에 붙인 객실이면 그 건물 이름(캘린더와 같은 이름). */
  canonicalName: string | null;
  /** 직접 추가한 건물에 붙인 객실이면 그 건물 id. */
  manualBuildingId: string | null;
};

/**
 * Beds24 묶음(`groupRoomLinks`)에 직접 추가한 건물 · 객실을 붙인다. 룸 링크 화면에만 보인다 — 다른 화면은 이 표를 모른다.
 *
 * - 직접 추가한 객실은 한 줄 = 유닛 하나(`manual: true`, 판매 중 표시 없음). 링크는 `links` 의 `roomId` 가 그 객실 id 인 것.
 * - Beds24 건물에 붙인 객실은 그 건물의 Beds24 객실 **뒤**에 이름순(숫자 인식). 객실이 하나도 안 잡힌 Beds24 건물이면
 *   그 건물을 새로 만들어 `buildingOrder` 자리에 둔다.
 * - 직접 추가한 건물은 Beds24 건물 **뒤**에 `sortOrder` → 만든 순서 → 이름순.
 * - 어디에도 붙지 않는 객실(건물이 지워지는 중 등)은 뺀다.
 */
export function mergeManualRoomLinks(args: {
  buildings: readonly RoomLinkBuilding[];
  manualBuildings: readonly ManualBuildingInput[];
  manualRooms: readonly ManualRoomInput[];
  links: readonly RoomLinkRecord[];
  buildingOrder: readonly string[];
}): RoomLinkBuilding[] {
  const linksByRoom = new Map<string, Partial<Record<RoomLinkChannel, RoomLinkRecord>>>();
  for (const link of args.links) {
    const bucket = linksByRoom.get(link.roomId) ?? {};
    bucket[link.channel] = link;
    linksByRoom.set(link.roomId, bucket);
  }
  const toRow = (room: ManualRoomInput): RoomLinkRow => ({
    key: `manual:${room.id}`,
    label: room.name,
    manualRoomId: room.id,
    units: [{ links: linksByRoom.get(room.id) ?? {}, manual: true, roomId: room.id, selling: false, unitLabel: room.name }],
  });
  const byName = (a: ManualRoomInput, b: ManualRoomInput) => compareLabels(a.name, b.name);

  const beds24 = new Map(args.buildings.map((building) => [building.name, { ...building, rows: [...building.rows] }]));
  for (const room of [...args.manualRooms].sort(byName)) {
    if (!room.canonicalName) continue;
    const target = beds24.get(room.canonicalName) ?? { manualId: null, name: room.canonicalName, rows: [] };
    target.rows.push(toRow(room));
    beds24.set(room.canonicalName, target);
  }
  const orderIndex = new Map(args.buildingOrder.map((name, index) => [name, index]));
  // `groupRoomLinks` 와 같은 순서 — 새로 생긴 건물도 제자리에 들어간다.
  const fixed = [...beds24.values()].sort((a, b) => {
    const ao = orderIndex.get(a.name) ?? Number.MAX_SAFE_INTEGER;
    const bo = orderIndex.get(b.name) ?? Number.MAX_SAFE_INTEGER;
    return ao !== bo ? ao - bo : a.name.localeCompare(b.name, "ko");
  });

  const manual = [...args.manualBuildings]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name, "ko"))
    .map((building) => ({
      manualId: building.id,
      name: building.name,
      rows: args.manualRooms
        .filter((room) => room.manualBuildingId === building.id)
        .sort(byName)
        .map(toRow),
    }));
  return [...fixed, ...manual];
}

// ── 링크 입력 검증 ─────────────────────────────────────────────────────

/** 앞뒤 공백 제거 · 스킴 없으면 https 를 붙여 URL 로 읽는다. http(s) 가 아니면 null. */
export function normalizeLinkUrl(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** 채널에 맞는 주소인가 — Airbnb 는 `airbnb.*`(나라별 도메인), Booking.com 은 `booking.com`. */
export function isChannelUrl(url: string, channel: RoomLinkChannel): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (channel === "airbnb") return /(^|\.)airbnb\.[a-z.]+$/.test(host) || host === "abnb.me" || host.endsWith(".abnb.me");
  return host === "booking.com" || host.endsWith(".booking.com");
}

/**
 * Airbnb 리스팅 ID 를 링크에서 읽는다 — 호스트 편집(`/hosting/listings/editor/<id>`), 공개 페이지(`/rooms/<id>`),
 * 옛 관리 화면(`/manage-your-space/<id>`). 짧은 손님용 링크(`/h/…`)에는 ID 가 없다.
 */
export function parseAirbnbListingId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/(?:hosting\/listings\/(?:editor\/)?|rooms\/(?:plus\/)?|manage-your-space\/)(\d{5,})/.exec(url);
  return match ? match[1] : null;
}

/** 리스팅 ID → Airbnb 호스트 편집 화면 주소(저쪽 데이터와 같은 형식). */
export function airbnbHostUrlFor(listingId: string): string {
  return `https://www.airbnb.co.kr/hosting/listings/editor/${listingId}/details/photo-tour`;
}

/** Booking.com 숙소 ID — 엑스트라넷 주소의 `hotel_id` 값. */
export function parseBookingHotelId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const id = new URL(url).searchParams.get("hotel_id");
    return id && /^\d{4,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * 숙소 ID → 엑스트라넷 홈. 붙여 넣은 주소의 **세션 값(`ses=`)은 버린다** — 로그인 세션 토큰이라 남겨 두면
 * 안 되고, 어차피 곧 만료된다. 엑스트라넷은 로그인 뒤 이 주소로 돌아온다.
 */
export function bookingExtranetUrlFor(hotelId: string): string {
  return `https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/home.html?hotel_id=${hotelId}`;
}

/**
 * Booking.com 손님용 페이지를 깨끗하게 — 추적 · 세션 값(`label` · `sid` 등 쿼리 전부)과 언어 꼬리(`.ko.html`)를 뗀다.
 * 언어를 떼면 손님 쪽 언어로 열린다. 숙소 페이지(`/hotel/<나라>/<이름>`)가 아니면 그대로 둔다.
 */
export function cleanBookingGuestUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/\/hotel\/[a-z]{2}\//.test(parsed.pathname)) return url;
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\.[a-z]{2}(?:-[a-z]{2})?\.html$/i, ".html");
    return parsed.toString();
  } catch {
    return url;
  }
}

export type RoomLinkInputError = "host_invalid" | "guest_invalid" | "host_channel" | "guest_channel" | "memo_long";

/**
 * 편집 패널 입력을 저장할 값으로 바꾼다. 호스트 칸에 **ID 숫자만** 넣어도 된다 — Airbnb 는 리스팅 편집 화면,
 * Booking.com 은 엑스트라넷 주소를 만든다.
 * 셋 다 비면 `{ empty: true }` — 그 줄을 지운다는 뜻이다.
 */
export function parseRoomLinkInput(input: {
  channel: RoomLinkChannel;
  host: string;
  guest: string;
  memo: string;
}):
  | { ok: true; empty: true }
  | { ok: true; empty: false; listingId: string | null; hostUrl: string | null; guestUrl: string | null; memo: string | null }
  | { ok: false; error: RoomLinkInputError } {
  const memo = input.memo.trim() || null;
  if (memo && memo.length > ROOM_LINK_MEMO_MAX) return { error: "memo_long", ok: false };

  const hostRaw = input.host.trim();
  let hostUrl: string | null = null;
  let listingId: string | null = null;
  if (hostRaw) {
    if (/^\d{4,}$/.test(hostRaw)) {
      listingId = hostRaw;
      hostUrl = input.channel === "airbnb" ? airbnbHostUrlFor(hostRaw) : bookingExtranetUrlFor(hostRaw);
    } else {
      hostUrl = normalizeLinkUrl(hostRaw);
      if (!hostUrl) return { error: "host_invalid", ok: false };
      if (!isChannelUrl(hostUrl, input.channel)) return { error: "host_channel", ok: false };
      if (input.channel === "airbnb") {
        listingId = parseAirbnbListingId(hostUrl);
      } else {
        listingId = parseBookingHotelId(hostUrl);
        if (listingId) hostUrl = bookingExtranetUrlFor(listingId);
      }
    }
  }

  let guestUrl: string | null = null;
  if (input.guest.trim()) {
    guestUrl = normalizeLinkUrl(input.guest);
    if (!guestUrl) return { error: "guest_invalid", ok: false };
    if (!isChannelUrl(guestUrl, input.channel)) return { error: "guest_channel", ok: false };
    if (input.channel === "booking") guestUrl = cleanBookingGuestUrl(guestUrl);
    if (!listingId && input.channel === "airbnb") listingId = parseAirbnbListingId(guestUrl);
  }

  if (!hostUrl && !guestUrl && !memo) return { empty: true, ok: true };
  return { empty: false, guestUrl, hostUrl, listingId, memo, ok: true };
}
