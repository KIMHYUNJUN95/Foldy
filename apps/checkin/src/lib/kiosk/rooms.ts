// 방 이름 맞추기(DB 없음 — 테스트로 덮는다). 예약의 `room_label` 과 출입 번호표의 `roomLabel` 은 표기가 다르다.
// Foldy `src/lib/room-label-normalization.ts` 의 `getCanonicalRoomLabel` · `normalizeArakichoRoomKey` · 아라키초 접미사 떼기 ·
// `stripBuildingCodePrefix` · `operationalRoomAliasOf` 와 같은 규칙을 따로 둔다 — 체크인 앱은 Foldy 코드를 가져오지 않는다(16 §2).
// 규칙이 바뀌면 두 곳을 같이 고친다. 저장된 stay_rooms 이름은 그대로 두고, 맞출 때와 이 응답에서만 접는다.
import { canonicalNameOf } from "../building-key";

export type RoomForm = {
  /** 손님에게 보일 방 이름(`K202` → `202`). 독채는 건물 정규 이름. */
  display: string;
  /** 번호표와 맞출 때 쓰는 키 */
  matchKey: string;
  /** 독채(건물 하나가 방 하나) — 태블릿이 건물 이름을 자기 언어로 그린다. */
  unitName: boolean;
};

function normalizeArakichoRoomKey(raw: string): string {
  const compact = raw.trim().replace(/\s+/g, "");
  if (!compact) return compact;
  const withoutPrefix = compact
    .replace(/^(?:荒木町\s*[abAB]?|아라키초\s*[abAB]?|arakicho\s*[abAB]?)/iu, "")
    .replace(/^(?:room|unit|호|号室)/iu, "");
  const cleaned = (withoutPrefix || compact).replace(/-/g, "_").replace(/[()]/g, "");
  return cleaned.replace(/^[A-Za-z]+/, (match) => match.toUpperCase());
}

// 뒤가 전부 숫자일 때만 앞 알파벳을 뗀다(`Ab101` → `101`, `O101` → `101`, `OkuboCC` 는 그대로).
function stripBuildingCodePrefix(label: string): string {
  const matched = label.match(/^[A-Za-z]+(\d+)$/);
  return matched ? matched[1] : label;
}

export function roomForm(propertyKey: string, rawLabel: string): RoomForm {
  const raw = rawLabel.trim();
  let display = raw;
  let unitName = false;

  if (propertyKey.startsWith("okubo_")) {
    display = canonicalNameOf(propertyKey) ?? raw;
    unitName = true;
  } else if (propertyKey === "arakicho_a" || propertyKey === "arakicho_b") {
    display = stripBuildingCodePrefix(normalizeArakichoRoomKey(raw).replace(/(?:_\d+)+$/, ""));
  } else if (propertyKey === "kabukicho") {
    display = raw.match(/\d+/)?.[0] ?? raw;
  } else if (propertyKey === "takadanobaba" && /^401[_-]2$/i.test(raw)) {
    display = "4";
  } else {
    display = stripBuildingCodePrefix(raw);
  }

  let matchKey = display.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
  // 다카다노바바는 예약에 층 숫자만(`2`), 번호표에 층 표기(`2f`)로 적혀 있다.
  if (propertyKey === "takadanobaba") matchKey = matchKey.replace(/(?<=\d)F$/, "");
  return { display, matchKey, unitName };
}
