/**
 * 청소 배정 — 제안 규칙(관리자가 켜고 끄고 순서를 바꾼다). 순수 모듈(클라이언트 · 서버 공용).
 *
 * 규칙을 자유롭게 만드는 방식은 쓰기 어렵고 실수가 나기 쉬워서, **정해진 항목을 켜고 끄고 순서만 바꾼다**(2026-10-20 사용자 확정).
 * 위에서부터 먼저 본다. 끌 수 없는 「항상 지키는 것」은 제안 계산(`suggest.ts`)에 박혀 있다.
 * docs/product/37-cleaning-shift-assignment.md 「4-5. 배정 설정」
 */

export const ASSIGN_RULE_KEYS = [
  "fixed_staff",
  "fewest_rooms",
  "priority",
  "same_building",
  "fewest_month_days",
  "late_start_last",
] as const;

export type AssignRuleKey = (typeof ASSIGN_RULE_KEYS)[number];

export type AssignRule = { key: AssignRuleKey; enabled: boolean };

/** 처음 값 — 고정 인력 → 배정 전 · 방 적은 사람 → 우선 배정 → 같은 건물(켜짐), 근무 일수 · 늦은 출근(꺼짐). */
export const DEFAULT_ASSIGN_RULES: readonly AssignRule[] = [
  { key: "fixed_staff", enabled: true },
  { key: "fewest_rooms", enabled: true },
  { key: "priority", enabled: true },
  { key: "same_building", enabled: true },
  { key: "fewest_month_days", enabled: false },
  { key: "late_start_last", enabled: false },
];

export function isAssignRuleKey(value: unknown): value is AssignRuleKey {
  return typeof value === "string" && (ASSIGN_RULE_KEYS as readonly string[]).includes(value);
}

/**
 * 저장된 값 → 규칙 목록. 모르는 키 · 중복은 버리고, 빠진 키는 처음 값으로 **맨 뒤에** 붙인다 — 규칙이 늘어도 예전 설정이 깨지지 않는다.
 */
export function normalizeAssignRules(raw: unknown): AssignRule[] {
  const out: AssignRule[] = [];
  const seen = new Set<AssignRuleKey>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const key = (item as { key?: unknown }).key;
      if (!isAssignRuleKey(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, enabled: Boolean((item as { enabled?: unknown }).enabled) });
    }
  }
  for (const rule of DEFAULT_ASSIGN_RULES) {
    if (!seen.has(rule.key)) out.push({ ...rule });
  }
  return out;
}

/** 월 비교표 「평균에서 N% 넘게 벗어남」 기준. */
export const DEFAULT_FLAG_THRESHOLD = 25;
export const FLAG_THRESHOLD_OPTIONS = [10, 15, 20, 25, 30, 40, 50] as const;

/** 「아직 견습인가요?」 — 처음 묻는 횟수와 「계속 견습」 뒤 다시 묻기까지. */
export const TRAINEE_FIRST_CHECK = 6;
export const TRAINEE_CHECK_STEP = 2;
