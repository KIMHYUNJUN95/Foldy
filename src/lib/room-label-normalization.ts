import type { ActiveRoomCatalogItem } from "@/lib/rooms";

function normalizeKey(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/[_()\-]/g, "")
    .toLowerCase();
}

function hasAny(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate));
}

function isArakichoA(propertyName: string) {
  const key = normalizeKey(propertyName);
  return hasAny(key, ["아라키초a", "arakichoa", "荒木町a"]);
}

function isArakichoB(propertyName: string) {
  const key = normalizeKey(propertyName);
  return hasAny(key, ["아라키초b", "arakichob", "荒木町b"]);
}

function isKabukicho(propertyName: string) {
  const key = normalizeKey(propertyName);
  return hasAny(key, ["가부키초", "kabukicho", "歌舞伎町"]);
}

function isTakadanobaba(propertyName: string) {
  const key = normalizeKey(propertyName);
  // `타카다노바바`(ㅌ) 도 같은 곳이다 — 高田馬場 의 한글 표기가 사람마다 갈린다. 교통비 기록에
  // 실제로 두 표기가 섞여 있었다(2026-09-11). 별칭을 받아 주면 같은 건물로 모인다.
  return hasAny(key, ["다카다노바바", "타카다노바바", "takadanobaba", "高田馬場"]);
}

function isSano(propertyName: string) {
  const key = normalizeKey(propertyName);
  return hasAny(key, ["사노", "sano", "佐野"]);
}

function isOkuboA(propertyName: string) {
  const key = normalizeKey(propertyName);
  return hasAny(key, ["오쿠보a", "okuboa", "okuboab棟", "okuboab동", "大久保a"]);
}

function isOkuboB(propertyName: string) {
  const key = normalizeKey(propertyName);
  return hasAny(key, ["오쿠보b", "okubob", "okuboba棟", "okuboba동", "大久保b"]);
}

function isOkuboC(propertyName: string) {
  const key = normalizeKey(propertyName);
  return hasAny(key, ["오쿠보c", "okuboc", "okubockr", "大久保c"]);
}

/** 정규 한국어 숙소 이름을 안정적인 i18n 건물 키로 매핑한다. */
export const CANONICAL_TO_BUILDING_KEY: Record<string, string> = {
  // 참고: 값은 dictionary.cleaning.buildingLabels 의 키와 일치해야 한다
  아라키초A: "arakicho_a",
  아라키초B: "arakicho_b",
  가부키초: "kabukicho",
  다카다노바바: "takadanobaba",
  오쿠보A: "okubo_a",
  오쿠보B: "okubo_b",
  오쿠보C: "okubo_c",
  // 2026-09-29 — 판매 캘린더 이력(건물 이름을 보는 사람 언어로)에서 빠져 있던 두 건물.
  "STAY ARI Apartment Hotel": "stay_ari",
  사노: "sano",
};

/** 정규 숙소 이름을 로케일에 맞는 표시 라벨로 바꾼다. */
export function localizePropertyName(
  canonicalPropertyName: string,
  buildingLabels: Record<string, string>,
): string {
  const key = CANONICAL_TO_BUILDING_KEY[canonicalPropertyName];
  return (key ? buildingLabels[key] : undefined) ?? canonicalPropertyName;
}

/**
 * 아무 표기(`가부키초` · `歌舞伎町` · `Kabukicho` · 대소문자 섞임)로 들어온 건물 이름을 보는 사람 언어로(2026-10-22).
 * DB · 집계는 한국어 정규 명칭(`아라키초A`)을 들고 다니므로 **화면에 그릴 때마다** 이걸 거친다 — 그대로 그리면
 * 일본어 · 영어 화면에 한국어가 남는다. 모르는 건물은 들어온 이름 그대로.
 */
export function localizeBuildingName(rawPropertyName: string, buildingLabels: Record<string, string>): string {
  return localizePropertyName(getCanonicalPropertyName(rawPropertyName), buildingLabels);
}

/**
 * 「건물 객실」 한 덩어리 라벨(`아라키초A 201` · 독채는 `오쿠보A` 하나)의 건물 부분만 보는 사람 언어로(2026-10-22).
 * 청소 세션 라벨 · 현장 활동 · 일지처럼 건물과 방이 한 글자열로 저장된 자리에 쓴다. 모르는 건물이면 그대로.
 */
export function localizeRoomPlaceLabel(label: string, buildingLabels: Record<string, string>): string {
  const trimmed = label.trim();
  const space = trimmed.indexOf(" ");
  const head = space === -1 ? trimmed : trimmed.slice(0, space);
  const key = CANONICAL_TO_BUILDING_KEY[getCanonicalPropertyName(head)];
  const localized = key ? buildingLabels[key] : undefined;
  if (!localized) return trimmed;
  return space === -1 ? localized : `${localized} ${trimmed.slice(space + 1)}`;
}

/**
 * 캘린더 세로축의 **건물 순서**. 가나다순이 아니라 **운영 순서**다.
 *
 * 전에는 두 캘린더가 각자 목록을 들고 있었고(어드민은 `PROPERTY_MAP_META` 에서 파생,
 * 모바일은 파일 안에 리터럴), **둘 다 스테이아리와 사노가 빠져 있었다.** 목록에 없는
 * 건물은 `localeCompare` 로 뒤에 붙으므로 스테이아리가 오쿠보 뒤로 밀려 있었다.
 * 현장 기준으로는 **가부키초 바로 뒤**가 맞고 **사노가 맨 뒤**다(2026-09-25 사용자 확인).
 *
 * `PROPERTY_MAP_META` 는 지도 링크가 있는 7개뿐이라 순서의 근거가 될 수 없다 —
 * 그래서 여기에 전부 적는다. 건물이 늘면 여기에 넣어야 하고, 빠뜨리면
 * `room-label-normalization.test.ts` 가 잡는다.
 */
export const CALENDAR_BUILDING_ORDER: readonly string[] = [
  "아라키초A",
  "아라키초B",
  "가부키초",
  "STAY ARI Apartment Hotel",
  "다카다노바바",
  "오쿠보A",
  "오쿠보B",
  "오쿠보C",
  "사노",
];

export function getCanonicalPropertyName(propertyName: string) {
  if (isArakichoA(propertyName)) return "아라키초A";
  if (isArakichoB(propertyName)) return "아라키초B";
  if (isKabukicho(propertyName)) return "가부키초";
  if (isTakadanobaba(propertyName)) return "다카다노바바";
  if (isOkuboA(propertyName)) return "오쿠보A";
  if (isOkuboB(propertyName)) return "오쿠보B";
  if (isOkuboC(propertyName)) return "오쿠보C";
  if (isSano(propertyName)) return "사노";
  return propertyName.trim();
}

function isAnyOkubo(propertyName: string) {
  return isOkuboA(propertyName) || isOkuboB(propertyName) || isOkuboC(propertyName);
}

function isArakichoProperty(canonicalPropertyName: string) {
  return isArakichoA(canonicalPropertyName) || isArakichoB(canonicalPropertyName);
}

/**
 * 서로 다른 아라키초 호실 정체성을 보존한다 (예: A301, 301, 301_2, A301_2).
 * 숫자만으로 합치지 말 것 — Beds24 / 객실 마스터의 서로 다른 행이 합쳐진다.
 */
export function normalizeArakichoRoomKey(raw: string) {
  const compact = raw.trim().replace(/\s+/g, "");
  if (!compact) return compact;

  const withoutPrefix = compact
    .replace(/^(?:荒木町\s*[abAB]?|아라키초\s*[abAB]?|arakicho\s*[abAB]?)/iu, "")
    .replace(/^(?:room|unit|호|号室)/iu, "");

  const cleaned = (withoutPrefix || compact).replace(/-/g, "_").replace(/[()]/g, "");
  // 아라키초 B 객실은 "Ab101" 로 저장된다 — 앞쪽 알파벳 접두사를 대문자로 바꿔 내부 키가
  // Beds24 가 어떻게 대소문자를 썼든 안정적인 "AB101" 이 되게 한다. (아라키초 A 객실은 숫자라서
  // 아라키초 B 의 "Ab" 접두사에만 영향을 준다.) 사용자에게는 `getDisplayRoomLabel` 이 `101` 로 보여준다.
  return cleaned.replace(/^[A-Za-z]+/, (match) => match.toUpperCase());
}

/**
 * 달력 행, 청소 대상, 예약 그룹화에 쓰는 운영 객실 키.
 * 객실 마스터 카탈로그의 `canonicalRoomLabel` 과 계속 맞아야 한다.
 */
export function getCanonicalRoomLabel(propertyName: string, roomLabel: string) {
  const canonicalPropertyName = getCanonicalPropertyName(propertyName);
  const raw = roomLabel.trim();
  if (raw.length === 0) return raw;

  if (isAnyOkubo(canonicalPropertyName)) {
    return canonicalPropertyName;
  }

  if (isArakichoProperty(canonicalPropertyName)) {
    return normalizeArakichoRoomKey(raw);
  }

  if (isKabukicho(canonicalPropertyName)) {
    const digits = raw.match(/\d+/)?.[0];
    if (digits) return digits;
  }

  return raw;
}

/**
 * 아라키초 내부 객실 키에서 숫자 _N 접미사를 떼어 표시용으로 만든다.
 * "402_2" → "402", "A301_2" → "A301", "402" → "402".
 *
 * 알파벳 접두어는 여기서 남긴다 — 이 단계는 아직 **내부 키**다(`A301` 과 `301` 은 서로 다른
 * Beds24 행이라 여기서 합치면 안 된다). 표시용으로 떼는 것은 `stripBuildingCodePrefix` 가 맡는다.
 */
function stripArakichoDisplaySuffix(internalKey: string): string {
  // `_N` 이 **여러 번** 붙을 수 있다: `401_2_2` → `401` (2026-09-16).
  //
  // Beds24 는 아라키초A 401호의 두 번째 유닛을 `401_2` 라고 부르는데, 그 라벨은 이미
  // **다카다노바바 556719** 가 쓰고 있었다 — `rooms` 의 유니크는 건물별이 아니라 **조직 전체**다
  // (`stripBuildingCodePrefix` 주석의 그 제약). 그래서 동기화가 `_2` 를 한 번 더 붙였다.
  //
  // 저장값은 그대로 두고 여기서 뗀다. 이 파일의 다른 규칙과 같은 방침이다 — 라벨을 바꾸면
  // 청소 기록·예약 매칭이 끊긴다.
  return internalKey.replace(/(?:_\d+)+$/, "");
}

/**
 * 방 이름 앞의 건물 구분 알파벳을 뗀다 — **표시할 때만** (2026-09-11).
 *
 * `rooms` 에는 `UNIQUE (organization_id, room_label)` 이 걸려 있다. 방 이름이 건물별이 아니라
 * **조직 전체에서** 유일해야 한다는 뜻이다. 아라키초A 가 맨 번호(201, 302…)를 선점한 탓에 나중에
 * 붙은 건물들은 접두어로 피해 왔다 — 아라키초B `Ab101`, 가부키초 `K202`, 스테이아리 `O102`.
 *
 * 그 접두어는 **DB 제약을 피하려고 붙은 것이지 현장에서 부르는 이름이 아니다.** 청소도 주문도
 * 「101호」라고 부르지 「AB101호」라고 부르지 않는다. 그래서 저장값은 그대로 두고 여기서만 뗀다.
 *
 * **왜 저장값을 안 바꾸는가.** 바꾸면 (1) 스테이아리 `O201·O202·O302` 가 아라키초A 의 운영 중인
 * `201·202·302` 와 유니크 제약에서 정면 충돌하고, (2) 방 이름은 Beds24 가 내려주는 값이라 다음
 * 방 마스터 동기화가 `O102` 를 못 찾아 방을 하나 더 만든다(26 → 52). 표시 계층에서 떼면 둘 다
 * 일어나지 않는다.
 *
 * 가부키초는 이미 이렇게 돌고 있었다 — `getCanonicalRoomLabel` 이 숫자만 뽑아 `K202` 를 `202` 로
 * 보여준다. 이 함수는 그 방식을 나머지 건물로 넓힌 것이다.
 *
 * **뒤가 전부 숫자일 때만 뗀다.** `OkuboCC` 처럼 숫자로 끝나지 않는 이름은 접두어가 아니라 이름
 * 자체이므로 건드리지 않는다.
 *
 * 안전한 이유(2026-09-11 전수 확인): 건물 안에서 접두어를 떼도 겹치는 방이 없고
 * (아라키초B 101~402 · 스테이아리 26개 모두 고유), 묶음 키로 쓰는 자리는 전부 「건물+방」 쌍이라
 * 아라키초A `201` 과 스테이아리 `201` 이 한 칸으로 합쳐지지 않는다.
 */
function stripBuildingCodePrefix(label: string): string {
  const matched = label.match(/^[A-Za-z]+(\d+)$/);
  return matched ? matched[1] : label;
}

/**
 * 달력 행과 운영 UI 에 쓰는 표시용 라벨.
 *
 * 아라키초: _N 숫자 접미사를 떼어 하위 호실이 한 달력 행을 공유한다
 * (내부 키 402 / 402_2 는 모두 402 로 표시).
 *
 * 모든 숙소: 건물 구분용 알파벳 접두사를 뗀다
 * (`AB101` → `101`, `O102` → `102`). `stripBuildingCodePrefix` 참고.
 */
export function getDisplayRoomLabel(propertyName: string, internalRoomKey: string): string {
  const canonical = getCanonicalPropertyName(propertyName);
  const withoutSuffix = isArakichoProperty(canonical)
    ? stripArakichoDisplaySuffix(internalRoomKey)
    : internalRoomKey;
  // 접미사를 먼저 떼야 `AB101_2` 가 `AB101` → `101` 로 이어진다.
  return stripBuildingCodePrefix(withoutSuffix);
}

/**
 * 저장된 청소 **세션** 객실 라벨("아라키초A 201_2")을 표시 형태로 접는다
 * ("아라키초A 201"), 정규 숙소 접두사는 유지한다. Okubo 단일 토큰 라벨(숙소 ===
 * 객실)과 아라키초가 아닌 라벨은 그대로 반환한다. 세션 라벨의 사용자 대상 표시에 쓴다
 * (홈 피드, 교통비 명세, 대시보드 카드). 세션↔예약 매칭은
 * 원래 정규 값을 그대로 쓴다.
 */
export function getDisplaySessionRoomLabel(sessionRoomLabel: string): string {
  const trimmed = sessionRoomLabel.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return trimmed;
  const property = trimmed.slice(0, spaceIndex);
  const room = trimmed.slice(spaceIndex + 1);
  return `${property} ${getDisplayRoomLabel(property, room)}`;
}

/**
 * 운영 직원에게 객실을 나열하는 모든 곳에서 쓰는 표준 객실 라벨 정렬
 * (청소 오늘 현황 / 기록, 셋팅 대상). 숫자 정렬로 숫자 덩어리를 수로 비교한다:
 * `202 < 302 < 402`, `AB201 < AB202 < AB301`, `8 < 9 < 10`. 순수 사전식 `localeCompare` 는
 * 402 를 8 앞에, AB301 을 AB202 앞에 놓아 현장 팀에게 무작위처럼 보인다.
 */
export function compareRoomLabel(a: string, b: string): number {
  return a.localeCompare(b, "ko", { numeric: true });
}

export function isExcludedOperationalProperty(propertyName: string) {
  const canonical = getCanonicalPropertyName(propertyName);
  return canonical === "사노";
}

export function isExcludedOperationalRoom(propertyName: string, roomLabel: string) {
  return operationalRoomAliasOf(propertyName, roomLabel) !== null;
}

/**
 * 운영에서 뺀 유닛이 **실제로 같은 방**이면 그 방의 라벨 (2026-10-07).
 *
 * 다카다노바바 `401_2`(Beds24 556719, 2025 년에 잠깐 쓴 두 번째 계정)는 401호(라벨 `4`)와 같은 방이다.
 * 격자 · 청소 · 홈에서는 계속 숨기지만(`isExcludedOperationalRoom`), **지난 예약의 매출 · 가동률**은 401호로
 * 센다 — 저쪽(STAY ARI)도 두 계정을 `401호` 하나로 셌고, 빼면 2025-04 · 05 · 06 · 10, 2026-06 매출이 그만큼 빈다.
 */
export function operationalRoomAliasOf(propertyName: string, roomLabel: string): string | null {
  const canonicalPropertyName = getCanonicalPropertyName(propertyName);
  const raw = roomLabel.trim();
  if (canonicalPropertyName === "다카다노바바" && /^401[_-]2$/i.test(raw)) {
    return "4";
  }
  return null;
}

/* ============================================================
   세션 객실 라벨 ↔ roomKey 해석 — 모바일 청소 큐
   (src/app/mobile/cleaning/page.tsx)와 관리자 청소 콘솔
   (src/lib/admin-cleaning.ts)이 공유한다. 전에는 모바일 페이지에 비공개로 중복돼 있었고, 여기로 꺼내
   구현을 하나로 만들었다. 참고: docs/product/07-cleaning-workflow.md → roomKey 해석
   우선순위.
   ============================================================ */

/** 객실 키 = 정규 숙소 + "_" + 정규 객실 — 중복 제거/회전/세션 매칭에 쓴다. */
export function buildRoomKey(canonicalPropertyName: string, canonicalRoomLabel: string): string {
  return `${canonicalPropertyName}_${canonicalRoomLabel}`;
}

/**
 * `cleaning_sessions.room_label` 에 저장되는 라벨. Okubo 건물은 숙소 이름을 정규
 * 객실로 반환하므로(단일 호실 건물) 객실 접미사를 붙이지 않는다.
 */
export function buildSessionRoomLabel(canonicalPropertyName: string, canonicalRoomLabel: string): string {
  return canonicalRoomLabel === canonicalPropertyName
    ? canonicalRoomLabel
    : `${canonicalPropertyName} ${canonicalRoomLabel}`;
}

/**
 * 청소 세션 라벨(`cleaning_sessions.room_label` 모양 — 「아라키초A 401」) → **실제 방** 키 (2026-10-15).
 *
 * 아라키초는 한 방에 Beds24 계정이 둘이다(`401` 쉬는 계정 · `401_2_2` 판매 중). 예약은 어느 계정으로도 들어오므로
 * 청소 대상은 이미 실제 방으로 접어서 계산한다(`getCleaningTargets` 의 `physicalKey`). 그런데 「청소 시작」 검사는 판매 중
 * 계정 라벨만 받아, **쉬는 계정으로 들어온 예약은 카드는 뜨는데 시작이 늘 거절됐다**(`invalid_selection`, 10/15 아라키초A 401).
 * 시작 검사 · 「이미 시작/완료한 방」 판정은 이 키로 한다. 모르는 건물이면 null.
 */
export function physicalRoomKeyOfSessionLabel(sessionRoomLabel: string): string | null {
  const label = sessionRoomLabel.trim();
  for (const cp of Object.keys(CANONICAL_TO_BUILDING_KEY)) {
    if (label === cp) return buildRoomKey(cp, cp);
    if (label.startsWith(`${cp} `)) {
      const canonicalRoom = getCanonicalRoomLabel(cp, label.slice(cp.length + 1));
      return buildRoomKey(cp, getDisplayRoomLabel(cp, canonicalRoom));
    }
  }
  return null;
}

function normalizeRoomLabelInput(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** sessionRoomLabel → roomKey, 활성 객실 카탈로그에서 만든다 (1차 조회). */
export function buildSessionLabelToRoomKeyMap(
  catalog: readonly ActiveRoomCatalogItem[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of catalog) {
    const sessionLabel = buildSessionRoomLabel(item.propertyName, item.canonicalRoomLabel);
    map.set(sessionLabel, buildRoomKey(item.propertyName, item.canonicalRoomLabel));
  }
  return map;
}

/** 정규화된(NFKC/공백/소문자) 별칭 → roomKey, 과거 ko/ja/en 라벨 변형을 포함한다. */
export function buildLegacyAliasToRoomKeyMap(
  catalog: readonly ActiveRoomCatalogItem[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of catalog) {
    const roomKey = buildRoomKey(item.propertyName, item.canonicalRoomLabel);
    const aliases = [
      item.propertyName,
      item.canonicalRoomLabel,
      item.roomLabel,
      buildSessionRoomLabel(item.propertyName, item.canonicalRoomLabel),
      item.roomLabel === item.propertyName ? item.roomLabel : `${item.propertyName} ${item.roomLabel}`,
    ];
    for (const raw of aliases) {
      const key = normalizeRoomLabelInput(raw);
      if (!key) continue;
      if (!map.has(key)) map.set(key, roomKey);
    }
  }
  return map;
}

export type ResolveRoomKeyResult = {
  roomKey: string | null;
  matchedBy: "catalog_exact" | "canonical_prefix" | "legacy_alias" | "unknown";
};

/**
 * `cleaning_sessions.room_label` 을 다음이 쓰는 정규 roomKey 로 해석한다.
 * CleaningTarget/SettingTarget. 알 수 없는 라벨은 null 을 반환해 호출자가 잘못된 매칭 대신 제외할 수 있다.
 * 3단계 폴백: 카탈로그 정확 일치 → 정규 접두사
 * 파싱 → 레거시 별칭 맵.
 */
export function resolveRoomKey(
  roomLabel: string,
  catalogMap: Map<string, string>,
  legacyAliasMap: Map<string, string>,
): ResolveRoomKeyResult {
  const fromCatalog = catalogMap.get(roomLabel);
  if (fromCatalog !== undefined) return { roomKey: fromCatalog, matchedBy: "catalog_exact" };

  for (const cp of Object.keys(CANONICAL_TO_BUILDING_KEY)) {
    if (roomLabel === cp) return { roomKey: `${cp}_${cp}`, matchedBy: "canonical_prefix" };
    if (roomLabel.startsWith(`${cp} `)) {
      return { roomKey: `${cp}_${roomLabel.slice(cp.length + 1)}`, matchedBy: "canonical_prefix" };
    }
  }

  const fromAlias = legacyAliasMap.get(normalizeRoomLabelInput(roomLabel));
  if (fromAlias !== undefined) return { roomKey: fromAlias, matchedBy: "legacy_alias" };

  return { roomKey: null, matchedBy: "unknown" };
}
