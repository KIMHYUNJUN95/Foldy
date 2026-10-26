import { EMPTY_PREP_MANUAL, type PrepManual } from "@/lib/payroll-prep";

/**
 * 「지난달 값 가져오기」 순수 계산(DB 없음). docs/product/39 §5-A · 40 §3(3~5일).
 *
 * - 고른 칸만, **이번 달에 비어 있는 칸만** 채운다 — 이미 적은 값은 덮지 않는다.
 * - 가져오는 칸: 특별수당(손 입력분) · 원천세 직접 입력 + 사유 · 메모 · 잔업 / 주말(손 입력분).
 * - 가져오지 않는 칸: 지난달 조정 · 연말정산 · 그 달만 지급 방식 · 고용보험 덮어쓰기 — 그 달에만 있는 값.
 * - 되돌리기: 채운 값이 아직 그대로인 칸만 다시 비운다(그 사이 손으로 고친 칸은 둔다).
 */

export type CarryField = "special" | "withholding" | "memo" | "overtimeWeekend";
export const CARRY_FIELDS: readonly CarryField[] = ["special", "withholding", "memo", "overtimeWeekend"];
/** 확인 창에서 처음부터 체크된 칸(2026-10-26 결정 1). */
export const CARRY_DEFAULT_FIELDS: readonly CarryField[] = ["special", "withholding", "memo"];

export type CarryPatch = Partial<
  Pick<PrepManual, "special" | "overtime" | "weekend" | "withholdingOverride" | "withholdingOverrideReason" | "memo">
>;

export type CarryEntry = { userId: string; patch: CarryPatch };

export type CarryPlan = {
  entries: CarryEntry[];
  /** 칸 종류마다 채워질 사람 수. */
  counts: Record<CarryField, number>;
  people: number;
  cells: number;
};

const emptyCounts = (): Record<CarryField, number> => ({ special: 0, withholding: 0, memo: 0, overtimeWeekend: 0 });

export function planCarryOver(
  source: ReadonlyMap<string, PrepManual>,
  target: ReadonlyMap<string, PrepManual>,
  targetUserIds: readonly string[],
  fields: readonly CarryField[],
): CarryPlan {
  const want = new Set(fields);
  const counts = emptyCounts();
  const entries: CarryEntry[] = [];
  let cells = 0;
  for (const userId of targetUserIds) {
    const from = source.get(userId);
    if (!from) continue;
    const to = { ...EMPTY_PREP_MANUAL, ...target.get(userId) };
    const patch: CarryPatch = {};
    let n = 0;
    if (want.has("special") && from.special !== 0 && to.special === 0) {
      patch.special = from.special;
      counts.special += 1;
      n += 1;
    }
    if (want.has("withholding") && from.withholdingOverride != null && to.withholdingOverride == null) {
      patch.withholdingOverride = from.withholdingOverride;
      if (from.withholdingOverrideReason && !to.withholdingOverrideReason) patch.withholdingOverrideReason = from.withholdingOverrideReason;
      counts.withholding += 1;
      n += 1;
    }
    if (want.has("memo") && from.memo && !to.memo) {
      patch.memo = from.memo;
      counts.memo += 1;
      n += 1;
    }
    if (want.has("overtimeWeekend")) {
      let hit = false;
      if (from.overtime !== 0 && to.overtime === 0) {
        patch.overtime = from.overtime;
        n += 1;
        hit = true;
      }
      if (from.weekend !== 0 && to.weekend === 0) {
        patch.weekend = from.weekend;
        n += 1;
        hit = true;
      }
      if (hit) counts.overtimeWeekend += 1;
    }
    if (n > 0) {
      entries.push({ userId, patch });
      cells += n;
    }
  }
  return { entries, counts, people: entries.length, cells };
}

/** 되돌리기 — 채운 값과 지금 값이 같은 칸만 비우는 패치(없으면 null). */
export function undoPatch(current: PrepManual, filled: CarryPatch): CarryPatch | null {
  const out: CarryPatch = {};
  if (filled.special !== undefined && current.special === filled.special) out.special = 0;
  if (filled.overtime !== undefined && current.overtime === filled.overtime) out.overtime = 0;
  if (filled.weekend !== undefined && current.weekend === filled.weekend) out.weekend = 0;
  if (filled.withholdingOverride !== undefined && current.withholdingOverride === filled.withholdingOverride) {
    out.withholdingOverride = null;
  }
  if (
    filled.withholdingOverrideReason !== undefined &&
    current.withholdingOverrideReason === filled.withholdingOverrideReason
  ) {
    out.withholdingOverrideReason = null;
  }
  if (filled.memo !== undefined && current.memo === filled.memo) out.memo = null;
  return Object.keys(out).length > 0 ? out : null;
}
