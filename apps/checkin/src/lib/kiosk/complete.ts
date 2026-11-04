// 태블릿 「체크인 완료」 판정(DB 없음 — 테스트로 덮는다). 44 FR-K04 · K13 · K16, 16 §5-4.
import { nameMatchesPassport } from "./find";
import { parseMrzStrip } from "./mrz";
import { roomForm } from "./rooms";

export type CompletionBlock = "consent" | "roster" | null;

// 사진은 막지 않는다 — 여권 없음 사유가 있으면 번호 · 사진 칸은 missingFields 가 이미 빼 준다(어린이 · 직원 확인 포함).
const NON_BLOCKING_MISSING = new Set(["passport_photo"]);

/**
 * 막는 것: 약관 동의 없음 · 명부가 인원보다 적음 · 명부에 이름이 없거나 필수 칸(missing, 사진 제외)이 빈 사람이 있음 → roster.
 * 예약 이름이 자동으로 채워진 대표자 줄이라 이름만으로는 안 채운 사람을 못 거른다. 얼굴 영상 · 여권 사진 · 직원 확인 필요는 막지 않는다.
 */
export function completionBlock(stay: {
  consented: boolean;
  partySize: number;
  guests: { name: string | null; missing: string[] }[];
}): CompletionBlock {
  if (!stay.consented) return "consent";
  if (stay.guests.length < Math.max(1, stay.partySize)) return "roster";
  const unfilled = stay.guests.some(
    (guest) => !guest.name || !guest.name.trim() || guest.missing.some((field) => !NON_BLOCKING_MISSING.has(field)),
  );
  return unfilled ? "roster" : null;
}

export type StaffCheckGuest = {
  hasFaceVideo: boolean;
  noPassportReason: string | null;
  mrzValid: boolean | null;
  missing: string[];
};

/** 직원이 한 번 봐야 하는 분: 얼굴 영상 없음 · 여권 없음 사유 · 검사 숫자가 틀린 MRZ · 빠진 칸. 전용 칸은 따로 두지 않고 이 판정으로 센다. */
export function needsStaffCheck(guest: StaffCheckGuest): boolean {
  return !guest.hasFaceVideo || !!guest.noPassportReason || guest.mrzValid === false || guest.missing.length > 0;
}

export function staffCheckCount(guests: StaffCheckGuest[]): number {
  return guests.filter(needsStaffCheck).length;
}

export type RoomCode = { label: string; code: string | null; unit_name: boolean };

/**
 * 방마다 번호를 찾는다. 예약 이름과 번호표 이름을 건물별 규칙(rooms.ts)으로 접어 맞추고,
 * 손님에게는 접은 이름(`K202` → `202`)을 보낸다. 같은 이름으로 접히는 방(`201` · `201_2`)은 하나로 합친다.
 * 못 찾으면 code 는 null — 요청은 그래도 성공한다.
 */
export function matchRoomCodes(propertyKey: string, rooms: string[], roomAccess: unknown): RoomCode[] {
  const byKey = new Map<string, string>();
  if (Array.isArray(roomAccess)) {
    for (const entry of roomAccess) {
      if (!entry || typeof entry !== "object") continue;
      const { roomLabel, code } = entry as Record<string, unknown>;
      if (typeof roomLabel !== "string" || typeof code !== "string" || !code.trim()) continue;
      const key = roomForm(propertyKey, roomLabel).matchKey;
      if (key && !byKey.has(key)) byKey.set(key, code.trim());
    }
  }
  const result = new Map<string, RoomCode>();
  for (const label of rooms) {
    const form = roomForm(propertyKey, label);
    const code = byKey.get(form.matchKey) ?? null;
    const existing = result.get(form.matchKey);
    if (!existing) result.set(form.matchKey, { label: form.display, code, unit_name: form.unitName });
    else if (existing.code === null && code !== null) existing.code = code;
  }
  return [...result.values()];
}

export type SharedCode = { label_key: string; code: string; prefix_key: string | null; note_key: string | null };

// 손님에게 보여도 되는 공용 번호만. 창고 · 린넨 창고 같은 직원용 번호와 모르는 새 키는 모두 버린다.
const ALWAYS_SHARED_LABEL_KEYS = new Set(["doorPassword", "roomPassword"]);
const KEYBOX_LABEL_KEYS = new Set(["keyBox", "keyBoxPassword"]);

// 열쇠 보관함 번호를 손님에게 보여도 되는 건물(건물 키). 건물마다 달라 사용자가 정했다(2026-11-04): STAY ARI · 오쿠보 A/B/C · 다카다노바바. 가부키초 · 아라키초 A/B 는 숨긴다.
export const GUEST_KEYBOX_BUILDINGS: readonly string[] = ["stay_ari", "okubo_a", "okubo_b", "okubo_c", "takadanobaba"];

/** 공용 출입 번호(`shared_access`) — 허용 목록 밖의 키, 라벨 키와 번호가 없는 줄은 버린다. */
export function sharedCodesOf(sharedAccess: unknown, propertyKey: string): SharedCode[] {
  const keyBoxAllowed = GUEST_KEYBOX_BUILDINGS.includes(propertyKey);
  if (!Array.isArray(sharedAccess)) return [];
  const result: SharedCode[] = [];
  for (const entry of sharedAccess) {
    if (!entry || typeof entry !== "object") continue;
    const { labelKey, code, prefixKey, noteKey } = entry as Record<string, unknown>;
    if (typeof labelKey !== "string" || !(ALWAYS_SHARED_LABEL_KEYS.has(labelKey) || (keyBoxAllowed && KEYBOX_LABEL_KEYS.has(labelKey))) || typeof code !== "string" || !code.trim()) continue;
    result.push({
      label_key: labelKey,
      code: code.trim(),
      prefix_key: typeof prefixKey === "string" && prefixKey ? prefixKey : null,
      note_key: typeof noteKey === "string" && noteKey ? noteKey : null,
    });
  }
  return result;
}

export function addressOf(row: { address_ko?: unknown; address_ja?: unknown; address_en?: unknown } | null) {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return { ko: text(row?.address_ko), ja: text(row?.address_ja), en: text(row?.address_en) };
}

// ── 체크인 끝난 뒤 다시 보기 ────────────────────────────────────────────────

/** 응답을 못 받은 손님이 다시 부를 수 있는 시간 — 끝난 세션이라도 이 안에서는 같은 기기에서 받아 준다. */
export const FINISHED_SESSION_WINDOW_MS = 10 * 60_000;

export function finishedWithinWindow(finishedAt: string | null, now: Date): boolean {
  if (!finishedAt) return false;
  const at = Date.parse(finishedAt);
  return Number.isFinite(at) && at <= now.getTime() && now.getTime() - at <= FINISHED_SESSION_WINDOW_MS;
}

/** 조건부 갱신이 0줄일 때 — 지금 상태를 다시 읽고 판단. 정말 체크인된 경우만 「이미」, 아니면 막힘. */
export function raceOutcome(statusNow: string | null): { already: true } | { blocked: "cancelled" | "expired" } {
  if (statusNow === "checked_in") return { already: true };
  return { blocked: statusNow === "cancelled" ? "cancelled" : "expired" };
}

const INACTIVE_RESERVATION = new Set(["cancelled", "no_show"]);

/**
 * 체크인 뒤에 예약이 바뀌었을 수 있다 — stay_rooms 의 옛 이름 대신 지금 예약의 방을 쓰고, 전부 취소됐으면 null(번호를 주지 않는다).
 * stay_rooms 줄 자체는 바꾸지 않는다(명부 기록 유지). 예약 줄이 지워졌으면 그 방은 뺀다.
 */
export function currentRoomLabels(
  stayRooms: { reservation_id: string; room_label: string }[],
  reservations: { id: string; status: string; room_label: string | null }[],
): string[] | null {
  const byId = new Map(reservations.map((row) => [row.id, row]));
  const labels: string[] = [];
  for (const room of stayRooms) {
    const live = byId.get(room.reservation_id);
    if (!live || INACTIVE_RESERVATION.has(live.status)) continue;
    labels.push(live.room_label?.trim() || room.room_label);
  }
  if (stayRooms.length > 0 && labels.length === 0) return null;
  return labels;
}

// ── 번호를 주기 전 본인 확인(2026-11-04 결정, 체크인 전 · 후 같은 규칙) ─────
// 증명은 **지금 이 찾기**의 것이지 예약의 것이 아니다. 찾을 때마다 세션의 `step_payload` 가 `{ found_by }` 로 새로 시작된다.
//  - 코드(`code`) · 여권(`passport`)으로 찾았으면 그 자체가 증명.
//  - 이름(`name`)으로 찾았으면 증명 없음 — 이 찾기 안에서 **검사 숫자가 맞는 MRZ 의 이름이 예약 이름과 맞는** 여권이 저장되면
//    서버가 `passport_proof: true` 를 쓴다(guests 라우트). 명부에 남은 옛 MRZ · 사진은 보지 않는다.
export type FoundBy = "code" | "name" | "passport";

export type SessionProof = { found_by: FoundBy; passport_proof?: true };

/** 새 찾기의 시작 상태 — 앞의 증명은 모두 지운다. */
export function freshProof(foundBy: FoundBy): SessionProof {
  return { found_by: foundBy };
}

export function identityProven(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const { found_by: foundBy, passport_proof: passportProof } = payload as Record<string, unknown>;
  if (foundBy === "code" || foundBy === "passport") return true;
  return foundBy === "name" && passportProof === true;
}

/**
 * 이름으로 찾은 세션에서 저장된 여권이 예약 이름과 맞는지. 이름 · 검사 결과는 태블릿이 보낸 값이 아니라 서버가 `raw` 띠를 직접
 * 읽어(검사 숫자 전부 통과 + 줄1 에서 성 · 이름) 얻는다. `raw` 가 없거나 못 읽으면 증명 없음.
 */
export function grantsPassportProof(payload: unknown, mrzRaw: unknown, reservationNames: string[]): boolean {
  if (!payload || typeof payload !== "object") return false;
  const { found_by: foundBy, passport_proof: passportProof } = payload as Record<string, unknown>;
  if (foundBy !== "name" || passportProof === true) return false;
  const strip = parseMrzStrip(mrzRaw);
  if (!strip) return false;
  return reservationNames.some((name) => nameMatchesPassport(name, strip.surname, strip.givenNames));
}
