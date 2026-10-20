import type { AssignRule, AssignRuleKey } from "@/lib/cleaning-assign/rules";

/**
 * 청소 배정 — 자동 제안 계산. 순수 함수(DB 를 모른다) — 하루 보기 「제안대로 넣기」 · 「고정 인력 먼저 넣기」 · 월 보기 「자동 제안」이 같은 계산을 쓴다.
 *
 * ## 항상 지키는 것(규칙 순서와 상관없이 · 끌 수 없음)
 * - 그날 **신청한 사람만** 제안한다(신청 안 한 사람은 관리자가 「대신 넣기」로).
 * - 같은 사람을 같은 방에 두 번 넣지 않는다.
 * - 큰 방은 **보통 인원**까지 채운다(`need`).
 * - **견습은 혼자 두지 않는다** — 견습 담당(현장 매니저 · 견습 담당 표시)이 이미 있는 방에만 붙인다.
 * - **고르게** — 한 사람이 그날 몫(`ceil(채울 자리 ÷ 사람 수)`)을 넘으면, 몫이 남은 사람이 있는 동안은 뽑지 않는다. 고정 인력을 맨 앞에
 *   두어도 그 건물 방을 혼자 다 가져가지 않게 하는 장치다(「고르게 나누되 고정 인력 먼저」).
 *
 * ## 관리자가 정하는 것 — 규칙 순서(위에서부터 먼저 본다)
 * fixed_staff(그 방 건물의 고정 순위가 높은 사람) · fewest_rooms(그날 방이 적은 사람) · priority(「우선 배정」) ·
 * same_building(그 건물에 이미 방이 있는 사람) · fewest_month_days(이번 달 근무 일수가 적은 사람) · late_start_last(늦게 나오는 사람은 뒤로).
 *
 * docs/product/37-cleaning-shift-assignment.md 「3. 핵심 아이디어」 · 「4-5. 배정 설정」
 */

export type SuggestRoom = {
  roomKey: string;
  propertyName: string;
  /** 더 채울 인원(보통 인원 − 이미 들어간 사람). 0 이하면 건너뛴다. */
  need: number;
  /** 이미 들어간 사람. */
  assigned: readonly string[];
};

export type SuggestPerson = {
  userId: string;
  /** 그날 이미 받은 방 수. */
  roomsToday: number;
  /** 그날 이미 방이 있는 건물. */
  propertiesToday: readonly string[];
  priority: boolean;
  trainee: boolean;
  /** 견습 담당 — 현장 매니저 또는 「견습 담당」 표시. */
  trainer: boolean;
  /** 이번 달 근무(배정) 일수. */
  monthDays: number;
  /** 그날 출근 시각(분, 0 시 기준). 모르면 null(앞으로 둔다). */
  startMinutes: number | null;
};

export type SuggestInput = {
  rooms: readonly SuggestRoom[];
  people: readonly SuggestPerson[];
  rules: readonly AssignRule[];
  /** 건물 → (사람 → 고정 순위 1, 2, 3 …). 없으면 고정 인력이 아니다. */
  fixedTiers: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** 이 사람들만 고른다(「고정 인력 먼저 넣기」). 없으면 전원. */
  onlyFixed?: boolean;
};

export type Suggestion = { roomKey: string; userId: string };

type State = { rooms: number; properties: Set<string> };

const NOT_FIXED = 99;

function compareBy(key: AssignRuleKey, a: SuggestPerson, b: SuggestPerson, room: SuggestRoom, input: SuggestInput, state: Map<string, State>): number {
  const sa = state.get(a.userId)!;
  const sb = state.get(b.userId)!;
  switch (key) {
    case "fixed_staff": {
      const tiers = input.fixedTiers[room.propertyName] ?? {};
      return (tiers[a.userId] ?? NOT_FIXED) - (tiers[b.userId] ?? NOT_FIXED);
    }
    case "fewest_rooms":
      return sa.rooms - sb.rooms;
    case "priority":
      return Number(b.priority) - Number(a.priority);
    case "same_building":
      return Number(sb.properties.has(room.propertyName)) - Number(sa.properties.has(room.propertyName));
    case "fewest_month_days":
      return a.monthDays - b.monthDays;
    case "late_start_last":
      return (a.startMinutes ?? 0) - (b.startMinutes ?? 0);
    default:
      return 0;
  }
}

export function suggestAssignments(input: SuggestInput): Suggestion[] {
  const people = input.onlyFixed
    ? input.people.filter((person) => Object.values(input.fixedTiers).some((tiers) => tiers[person.userId] !== undefined))
    : [...input.people];
  if (people.length === 0) return [];

  const order = input.rules.filter((rule) => rule.enabled).map((rule) => rule.key);
  if (input.onlyFixed && !order.includes("fixed_staff")) order.unshift("fixed_staff");

  const state = new Map<string, State>(
    people.map((person) => [person.userId, { rooms: person.roomsToday, properties: new Set(person.propertiesToday) }]),
  );
  const byId = new Map(people.map((person) => [person.userId, person]));
  const indexOf = new Map(people.map((person, index) => [person.userId, index]));

  const totalSlots = input.rooms.reduce((sum, room) => sum + Math.max(0, room.need), 0);
  const existing = people.reduce((sum, person) => sum + person.roomsToday, 0);
  const share = Math.max(1, Math.ceil((totalSlots + existing) / people.length));

  const out: Suggestion[] = [];
  for (const room of input.rooms) {
    if (room.need <= 0) continue;
    const inRoom = new Set(room.assigned);
    for (let slot = 0; slot < room.need; slot++) {
      const hasTrainer = [...inRoom].some((id) => byId.get(id)?.trainer);
      const roomTiers = input.fixedTiers[room.propertyName] ?? {};
      let candidates = people.filter((person) => {
        if (inRoom.has(person.userId)) return false;
        // 「고정 인력 먼저 넣기」는 그 건물의 고정 인력만.
        if (input.onlyFixed && roomTiers[person.userId] === undefined) return false;
        // 견습은 견습 담당이 이미 있는 방에만(혼자 두지 않기).
        if (person.trainee && !hasTrainer) return false;
        return true;
      });
      if (candidates.length === 0) break;
      const underShare = candidates.filter((person) => state.get(person.userId)!.rooms < share);
      if (underShare.length > 0) candidates = underShare;
      candidates.sort((a, b) => {
        for (const key of order) {
          const diff = compareBy(key, a, b, room, input, state);
          if (diff !== 0) return diff;
        }
        return indexOf.get(a.userId)! - indexOf.get(b.userId)!;
      });
      const pick = candidates[0];
      inRoom.add(pick.userId);
      const s = state.get(pick.userId)!;
      s.rooms += 1;
      s.properties.add(room.propertyName);
      out.push({ roomKey: room.roomKey, userId: pick.userId });
    }
  }
  return out;
}
