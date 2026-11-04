// 예약의 건물 이름(public.reservations.property_name, 자유 글) → 건물 키.
// Foldy `src/lib/room-label-normalization.ts` 의 판별과 같은 규칙을 따로 둔다 — 체크인 앱은 Foldy 코드를 가져오지 않는다(16 §2).
// 건물이 늘면 두 곳을 같이 고친다.
function normalize(value: string) {
  return value.replace(/\s+/g, "").replace(/[_()\-]/g, "").toLowerCase();
}

const RULES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["arakicho_a", ["아라키초a", "arakichoa", "荒木町a"]],
  ["arakicho_b", ["아라키초b", "arakichob", "荒木町b"]],
  ["kabukicho", ["가부키초", "kabukicho", "歌舞伎町"]],
  ["takadanobaba", ["다카다노바바", "타카다노바바", "takadanobaba", "高田馬場"]],
  ["okubo_a", ["오쿠보a", "okuboa", "okuboab棟", "okuboab동", "大久保a"]],
  ["okubo_b", ["오쿠보b", "okubob", "okuboba棟", "okuboba동", "大久保b"]],
  ["okubo_c", ["오쿠보c", "okuboc", "okubockr", "大久保c"]],
  ["sano", ["사노", "sano", "佐野"]],
  ["stay_ari", ["stayariapartmenthotel"]],
];

export function buildingKeyOf(propertyName: string): string | null {
  const key = normalize(propertyName);
  for (const [buildingKey, candidates] of RULES) {
    if (candidates.some((candidate) => key.includes(candidate))) return buildingKey;
  }
  return null;
}

/** 건물 고정 링크 `/p/<키>` 로 열 수 있는 키. */
export const BUILDING_KEYS: readonly string[] = RULES.map(([buildingKey]) => buildingKey);

export function isBuildingKey(value: string): boolean {
  return BUILDING_KEYS.includes(value);
}

// 건물 키 → Foldy 의 정규 숙소 이름(`public.property_operation_infos.canonical_name` 이 이 이름으로 저장된다).
// Foldy `CANONICAL_TO_BUILDING_KEY`(room-label-normalization.ts)의 거꾸로 — 건물이 늘면 두 곳을 같이 고친다.
const CANONICAL_NAME_BY_KEY: Readonly<Record<string, string>> = {
  arakicho_a: "아라키초A",
  arakicho_b: "아라키초B",
  kabukicho: "가부키초",
  takadanobaba: "다카다노바바",
  okubo_a: "오쿠보A",
  okubo_b: "오쿠보B",
  okubo_c: "오쿠보C",
  stay_ari: "STAY ARI Apartment Hotel",
  sano: "사노",
};

export function canonicalNameOf(buildingKey: string): string | null {
  return CANONICAL_NAME_BY_KEY[buildingKey] ?? null;
}
