// 입사일 기준 연차 발생 계산.
// 정책 2026-07-06 확정 (docs/product/26-annual-leave-workflow.md 참고):
//   - 첫 부여는 6개월 시점에 10일, 이후 그 부여의 다음 두 기념일마다 11일/12일,
//     그다음부터 매년 +2일, 상한 20일 — 이것이
//     "유급 휴가" 풀이며 "paid" 휴가 신청 유형으로 사용한다
//   - 4년 시점에 별도로 한 번 +4일 보너스 (20일 상한 밖) — 이 묶음은
//     독립된 풀이며 "특별휴가" 휴가 신청
//     유형으로만 소진하고, 유급휴가 풀과 절대 섞이지 않는다
//   - 쓰지 않은 연차는 부여일로부터 2년 뒤 소멸 (2년까지 확정,
//     2년 이후 정책은 아직 회사 확인 대기)
//   - 경조 휴가("경조휴가", "annual" 신청 유형)와 무급 휴가
//     ("기타")는 이 입사일 기준 발생에 전혀 포함되지 않는다 — leave-form.tsx 참고
//
// 이 모듈은 순수(Supabase/세션 import 없음)라 서버와 클라이언트 모두에서 실행할 수 있다.
// `hire_date` 는 `profiles` 에 있고, 본인이 입력한 시작 잔여는
// `annual_leave_baselines`(마이그레이션 202607060001)에 있다 — DB 읽기/쓰기 쪽은 src/lib/annual-leave-server.ts,
// 셀프서비스 액션은 src/app/mobile/attendance/leave/actions.ts 를 본다.

const BASE_SCHEDULE_MONTHS = [6, 18, 30, 42, 54, 66, 78];
const BASE_SCHEDULE_AMOUNTS = [10, 11, 12, 14, 16, 18, 20];
const BASE_SCHEDULE_STEP_MONTHS = 12;
const BASE_SCHEDULE_CAP = 20;

const BONUS_AT_MONTHS = 48;
const BONUS_AMOUNT = 4;

export const LEAVE_EXPIRY_YEARS = 2;

export type LeaveGrantEvent = {
  kind: "base" | "bonus";
  date: string; // ISO 날짜 (YYYY-MM-DD)
  amount: number;
};

export type LeaveBucketKind = "baseline" | "base" | "bonus";

export type LeaveBucket = {
  id: string;
  kind: LeaveBucketKind;
  grantedOn: string;
  amount: number;
  expiresOn: string | null; // null = 엔진이 이 묶음의 소멸을 관리하지 않음 (기준 잔여)
};

export type LeaveBucketState = LeaveBucket & { remaining: number; expired: boolean };

/** 승인된 사용 하나 — 시작일 기준으로 그날 살아 있는 묶음에서 빠진다(2026-11-11, H3). */
export type LeaveUsage = { date: string; days: number; pool: "base" | "bonus" };

/**
 * 승인된 신청 행 → 사용 목록. 유급(paid) → base, 특별(special) → bonus. 경조(annual) · 기타(other)는
 * 잔여와 무관해 빠진다. 서버 읽기(`annual-leave-server.ts`)와 승인 판정이 이 함수 하나를 쓴다.
 */
export function leaveUsagesFromRows(
  rows: readonly { leave_type: string; days_count: number | string; start_date: string }[],
): LeaveUsage[] {
  const out: LeaveUsage[] = [];
  for (const r of rows) {
    if (r.leave_type !== "paid" && r.leave_type !== "special") continue;
    out.push({ date: r.start_date, days: Number(r.days_count), pool: r.leave_type === "paid" ? "base" : "bonus" });
  }
  return out;
}

export type AnnualLeaveSummary = {
  /** "유급 휴가" 풀 잔여 — 기준 + 기본 일정 부여분만. */
  baseRemaining: number;
  /** "특별휴가" 풀 잔여 — 4년 시점 일회성 보너스이며 별도로 소진한다. */
  bonusRemaining: number;
  /** baseRemaining + bonusRemaining. 합계 하나만 필요한 호출자용. */
  remaining: number;
  /** 어느 묶음도 받지 못한 사용 일수(초과 승인). 잔여는 이만큼 음수로 내려간다. */
  baseOverflow: number;
  bonusOverflow: number;
  buckets: LeaveBucketState[];
  /** 두 풀을 통틀어 가장 이른 다가오는 부여일. 일반적인 "다음 부여" 표시용. */
  nextGrant: LeaveGrantEvent | null;
  /** Earliest upcoming "유급 휴가" (base-schedule) grant only. */
  nextBaseGrant: LeaveGrantEvent | null;
  /** 4년 보너스 부여 — 아직 다가오는 동안에만 있다 (이미 들어왔으면 null). */
  nextBonusGrant: LeaveGrantEvent | null;
};

/**
 * 달을 더한다. 그 달에 같은 날이 없으면 **그 달 말일**로 맞춘다(2026-11-11) — 예전에는 8/31 + 6개월이
 * 3/3 으로 굴러가 첫 부여가 사흘 늦었다.
 */
function addMonthsUTC(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

function addYearsUTC(iso: string, years: number): string {
  return addMonthsUTC(iso, years * 12);
}

function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 입사일부터 `asOf` 직후까지 발생하는 모든 자동 기본 + 보너스 부여 이벤트. */
export function getScheduledGrants(hireDate: string, asOf: string): LeaveGrantEvent[] {
  const events: LeaveGrantEvent[] = BASE_SCHEDULE_MONTHS.map((months, i) => ({
    kind: "base" as const,
    date: addMonthsUTC(hireDate, months),
    amount: BASE_SCHEDULE_AMOUNTS[i],
  }));

  let months = BASE_SCHEDULE_MONTHS[BASE_SCHEDULE_MONTHS.length - 1] + BASE_SCHEDULE_STEP_MONTHS;
  for (let guard = 0; guard < 200; guard += 1) {
    const date = addMonthsUTC(hireDate, months);
    events.push({ kind: "base", date, amount: BASE_SCHEDULE_CAP });
    if (compareISO(date, asOf) > 0) break;
    months += BASE_SCHEDULE_STEP_MONTHS;
  }

  events.push({ kind: "bonus", date: addMonthsUTC(hireDate, BONUS_AT_MONTHS), amount: BONUS_AMOUNT });

  return events.sort((a, b) => compareISO(a.date, b.date));
}

/**
 * 기준 잔여를 그날 살아 있던 부여분에 나눠 소멸일을 붙인다(2026-11-11, M9).
 *
 * 기준 잔여는 「기준일까지의 부여 − 사용」을 대신하는 숫자다. 예전에는 소멸일이 없어(null) 영원히 남았다 —
 * 관리자가 잔여를 다시 저장할 때마다 이미 있던 소멸 예정분이 사라졌다. 오래된 것부터 쓰는(FIFO) 규칙이라
 * 남은 잔여는 **가장 새 부여분**의 것으로 보고, 새 것부터 채운다. 살아 있는 부여분보다 많으면(관리자가
 * 더 넣음) 남는 몫은 가장 새 부여분의 소멸일을 따른다. 기준일에 살아 있는 부여가 없으면(입사 6개월 전
 * 수동 입력 등) 소멸일을 모른다 — null.
 */
function splitBaseline(
  id: string,
  kind: "baseline" | "bonus",
  amount: number,
  baselineDate: string,
  validGrants: LeaveGrantEvent[],
): LeaveBucket[] {
  if (amount <= 0) return [];
  const newestFirst = [...validGrants].sort((a, b) => compareISO(b.date, a.date));
  if (newestFirst.length === 0) {
    return [{ id, kind, grantedOn: baselineDate, amount, expiresOn: null }];
  }
  const parts: LeaveBucket[] = [];
  let left = amount;
  newestFirst.forEach((g, i) => {
    if (left <= 0) return;
    const take = Math.min(left, g.amount);
    parts.push({
      id: `${id}-${i}`,
      kind,
      grantedOn: baselineDate,
      amount: take,
      expiresOn: addYearsUTC(g.date, LEAVE_EXPIRY_YEARS),
    });
    left -= take;
  });
  if (left > 0) parts[0].amount += left;
  return parts;
}

/**
 * 기준 묶음(직원이 입력한 현재 잔여)과, 기준이 기록된 *이후*에 들어오는
 * 모든 자동 부여. 그 날짜 당일이거나 이전인 부여는
 * 이미 기준 숫자에 반영된 것으로 간주한다. `asOf` 까지의 부여만 넣는다.
 */
export function buildLeaveBuckets(params: {
  hireDate: string;
  baselineDate: string;
  baselineAmount: number;
  bonusBaselineAmount?: number;
  asOf: string;
}): LeaveBucket[] {
  const { hireDate, baselineDate, baselineAmount, bonusBaselineAmount = 0, asOf } = params;
  const horizon = compareISO(asOf, baselineDate) > 0 ? asOf : baselineDate;
  const grants = getScheduledGrants(hireDate, horizon);
  const aliveAtBaseline = (g: LeaveGrantEvent) =>
    compareISO(g.date, baselineDate) <= 0 && compareISO(addYearsUTC(g.date, LEAVE_EXPIRY_YEARS), baselineDate) >= 0;

  const buckets: LeaveBucket[] = [
    ...splitBaseline("baseline", "baseline", baselineAmount, baselineDate, grants.filter((g) => g.kind === "base" && aliveAtBaseline(g))),
    // 직원이 이미 가지고 있던 기존 특별휴가 잔여 — 같은 규칙으로 그날 살아 있던 보너스 부여분의 소멸일을 따른다.
    ...splitBaseline("baseline-bonus", "bonus", bonusBaselineAmount, baselineDate, grants.filter((g) => g.kind === "bonus" && aliveAtBaseline(g))),
  ];
  if (baselineAmount <= 0) {
    // 잔여 0 이어도 기준 묶음 자리는 남긴다(화면이 기준 행을 찾는다).
    buckets.unshift({ id: "baseline", kind: "baseline", grantedOn: baselineDate, amount: 0, expiresOn: null });
  }

  grants
    .filter((g) => compareISO(g.date, baselineDate) > 0 && compareISO(g.date, asOf) <= 0)
    .forEach((g, i) => {
      buckets.push({
        id: `${g.kind}-${i}-${g.date}`,
        kind: g.kind,
        grantedOn: g.date,
        amount: g.amount,
        expiresOn: addYearsUTC(g.date, LEAVE_EXPIRY_YEARS),
      });
    });

  return buckets.sort((a, b) => compareISO(a.grantedOn, b.grantedOn));
}

/** 그 날짜에 이 묶음을 쓸 수 있는가. 기준 묶음은 기준일 전 사용도 받는다(기준 숫자가 앱 기록 사용을 빼기 전 값). */
function bucketUsableOn(b: LeaveBucket, date: string): boolean {
  if (b.id.startsWith("baseline")) {
    return b.expiresOn === null || compareISO(date, b.expiresOn) <= 0;
  }
  return compareISO(b.grantedOn, date) <= 0 && (b.expiresOn === null || compareISO(date, b.expiresOn) <= 0);
}

/**
 * 사용을 **사용일 순서대로**, 그날 살아 있는 묶음 중 먼저 소멸하는 것부터(FIFO) 차감한 뒤,
 * 남은 것 중 만료가 지난 것을 소멸시킨다(2026-11-11, H3). 예전에는 날짜와 상관없이 가장 오래된 묶음부터
 * 빼서, 이미 소멸한 묶음이 그 뒤에 쓴 휴가를 떠안고 잔여가 부풀었다.
 *
 * `usages` 가 정본이다. 예전 호출용 `usedDays` / `specialUsedDays` 는 `asOf` 날짜의 사용으로 본다.
 * base(유급) 사용은 기준/기본 풀에서만, bonus(특별) 사용은 보너스 풀에서만 — 두 풀은 절대 섞이지 않는다.
 * 앞으로의 사용(사용일 > asOf)이 그날 이미 소멸한 지금 묶음 대신 그 뒤 새 부여분에서 빠지면 오늘 잔여는
 * 그대로다. 어느 묶음도 받지 못한 몫은 `baseOverflow` / `bonusOverflow` 로 남고 잔여를 음수로 만든다.
 */
/**
 * 모바일 연차 홈의 「부여 · 사용」 막대(유급 풀). **살아 있는 묶음만** 센다(2026-11-11) — 소멸된 묶음의 부여 일수까지 더하면
 * 「사용」이 부풀어 보였다. 사용 = 살아 있는 묶음에서 빠진 일수 + 넘침(잔여가 음수면 그만큼 더 쓴 것).
 */
export function baseLeaveBarTotals(summary: AnnualLeaveSummary): { granted: number; used: number } {
  const live = summary.buckets.filter((b) => b.kind !== "bonus" && !b.expired);
  const granted = live.reduce((sum, b) => sum + b.amount, 0);
  return { granted, used: Math.max(0, granted - summary.baseRemaining) };
}

export function computeAnnualLeaveSummary(params: {
  hireDate: string;
  baselineDate: string;
  baselineAmount: number;
  bonusBaselineAmount?: number;
  usedDays?: number;
  specialUsedDays?: number;
  usages?: readonly LeaveUsage[];
  asOf: string;
}): AnnualLeaveSummary {
  const { hireDate, baselineDate, baselineAmount, bonusBaselineAmount = 0, usedDays = 0, specialUsedDays = 0, asOf } =
    params;
  const usages: LeaveUsage[] = [...(params.usages ?? [])];
  if (usedDays > 0) usages.push({ date: asOf, days: usedDays, pool: "base" });
  if (specialUsedDays > 0) usages.push({ date: asOf, days: specialUsedDays, pool: "bonus" });
  usages.sort((a, b) => compareISO(a.date, b.date));

  // 앞으로의 사용이 받을 수 있게 그날까지의 부여를 만든다. 결과에는 asOf 까지의 묶음만 보인다.
  const horizon = usages.reduce((h, u) => (compareISO(u.date, h) > 0 ? u.date : h), asOf);
  const all = buildLeaveBuckets({ hireDate, baselineDate, baselineAmount, bonusBaselineAmount, asOf: horizon });
  const left = new Map(all.map((b) => [b.id, b.amount]));
  const byExpiry = [...all].sort((a, b) => {
    if (a.expiresOn !== b.expiresOn) {
      if (a.expiresOn === null) return 1;
      if (b.expiresOn === null) return -1;
      return compareISO(a.expiresOn, b.expiresOn);
    }
    return compareISO(a.grantedOn, b.grantedOn);
  });

  let baseOverflow = 0;
  let bonusOverflow = 0;
  for (const u of usages) {
    let need = Math.max(0, u.days);
    for (const b of byExpiry) {
      if (need <= 0) break;
      if ((b.kind === "bonus") !== (u.pool === "bonus")) continue;
      if (!bucketUsableOn(b, u.date)) continue;
      const have = left.get(b.id) ?? 0;
      const take = Math.min(have, need);
      left.set(b.id, have - take);
      need -= take;
    }
    if (u.pool === "bonus") bonusOverflow += need;
    else baseOverflow += need;
  }

  const stated: LeaveBucketState[] = all
    .filter((b) => compareISO(b.grantedOn, asOf) <= 0 || b.id.startsWith("baseline"))
    .map((b) => {
      const expired = b.expiresOn !== null && compareISO(b.expiresOn, asOf) < 0;
      return { ...b, remaining: expired ? 0 : left.get(b.id) ?? 0, expired };
    });

  const baseRemaining =
    stated.filter((b) => b.kind !== "bonus").reduce((sum, b) => sum + b.remaining, 0) - baseOverflow;
  const bonusRemaining =
    stated.filter((b) => b.kind === "bonus").reduce((sum, b) => sum + b.remaining, 0) - bonusOverflow;
  const upcoming = getScheduledGrants(hireDate, asOf)
    .filter((g) => compareISO(g.date, asOf) > 0)
    .sort((a, b) => compareISO(a.date, b.date));
  const nextGrant = upcoming[0] ?? null;
  const nextBaseGrant = upcoming.find((g) => g.kind === "base") ?? null;
  const nextBonusGrant = upcoming.find((g) => g.kind === "bonus") ?? null;

  return {
    baseRemaining,
    bonusRemaining,
    remaining: baseRemaining + bonusRemaining,
    baseOverflow,
    bonusOverflow,
    buckets: stated,
    nextGrant,
    nextBaseGrant,
    nextBonusGrant,
  };
}

/**
 * Tokyo 오늘 — 정본은 순수 모듈 `@/lib/tokyo-date` 다. 연차 모듈이 이 이름으로 8곳에 퍼져 있어
 * 호출부를 건드리지 않으려고 여기서 재수출한다(투두 `@/lib/tasks` 와 같은 처리, 2026-09-08).
 */
export { tokyoToday } from "@/lib/tokyo-date";

// ── 신청 일수 정규화 (2026-10-01) ─────────────────────────────────────────────
// 일수는 **서버가 날짜·유형에서 다시 계산한다.** 예전에는 직원 신청이 화면이 보낸 `daysCount` 를 그대로
// 저장해서, 10일짜리 기간을 0.5일로 내도 그대로 들어갔다(관리자 대리 신청만 서버에서 계산했다).
// 두 경로가 이 함수 하나를 쓴다.

/** 경조휴가(`annual` 유형) — 회사 부여 고정 일수. */
export const LEAVE_BEREAVEMENT_DAYS = 3;

/**
 * 신청 하나의 최대 일수(2026-11-11). 예전에는 상한이 없어 몇 년짜리 기간이 `days_count numeric(4,1)` 을
 * 넘쳐 알 수 없는 저장 오류가 났다. 넘으면 `too_long` 으로 분명히 거절한다.
 */
export const MAX_LEAVE_REQUEST_DAYS = 60;

export function leaveDaysTooLong(daysCount: number): boolean {
  return daysCount > MAX_LEAVE_REQUEST_DAYS;
}

const LEAVE_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function leaveAddDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function leaveRangeDaysInclusive(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
}

function isRealLeaveDate(ymd: string): boolean {
  if (!LEAVE_ISO_DATE.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export type NormalizedLeaveRequest = {
  startDate: string;
  endDate: string;
  durationUnit: "full" | "am" | "pm";
  daysCount: number;
  /** 원래 휴무라 뺀 날짜(정렬). 종일 유급 · 특별 · 기타만. */
  excludedDates: string[];
};

/** 그 해(도쿄 연도 「YYYY」)에 걸친 신청 수 — 모바일 신청 내역 머리글(2026-11-11). */
export function countLeaveRequestsInYear(
  rows: readonly { startDate: string; endDate: string }[],
  year: string,
): number {
  return rows.filter((r) => r.startDate.slice(0, 4) <= year && r.endDate.slice(0, 4) >= year).length;
}

/**
 * 결재 패널에 잔여 초과 사유 칸이 필요한가(2026-11-11). 상세가 넘는다고 했거나, **승인 시도에 서버가 over_balance 를 줬으면** —
 * 상세를 다시 읽다 실패해 옛 상세가 남아 있어도 사유 칸이 뜬다.
 */
export function leaveApproveNeedsReason(input: {
  status: string;
  detailOverBalance: boolean;
  serverSaidOverBalance: boolean;
}): boolean {
  return input.status === "requested" && (input.detailOverBalance || input.serverSaidOverBalance);
}

/** 일수 입력칸 → 숫자. 빈 칸 · 음수 · 숫자 아님 · 0.5 단위 아님이면 null(2026-11-11 — `Number("")` 가 0 으로 저장되던 것). */
export function parseLeaveDayAmount(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n * 2)) return null;
  return n;
}

/** 기간의 날짜를 하루씩(안 A 화면의 날짜 줄). 끝 < 시작 · 60일 초과 · 없는 날짜면 빈 줄. */
export function leaveRangeDates(startDate: string, endDate: string): string[] {
  if (!isRealLeaveDate(startDate) || !isRealLeaveDate(endDate)) return [];
  const n = leaveRangeDaysInclusive(startDate, endDate);
  if (n < 1 || leaveDaysTooLong(n)) return [];
  return Array.from({ length: n }, (_, i) => leaveAddDaysISO(startDate, i));
}

/**
 * 「원래 휴무」 빼기/넣기. 남는 날이 0일이 되면 바꾸지 않고 **같은 배열**을 돌려준다(0일 금지 — 화면은 이걸로 진동 · 안내를 고른다).
 */
export function toggleExcludedDate(
  excluded: readonly string[],
  date: string,
  startDate: string,
  endDate: string,
): readonly string[] {
  if (excluded.includes(date)) return excluded.filter((d) => d !== date);
  const range = leaveRangeDates(startDate, endDate);
  if (!range.includes(date)) return excluded;
  if (excluded.length + 1 >= range.length) return excluded;
  return [...excluded, date].sort();
}

/** 기간이 바뀐 뒤 — 기간 밖 날짜를 버리고, 전부 빠지게 되면 비운다. */
export function pruneExcludedDates(excluded: readonly string[], startDate: string, endDate: string): string[] {
  const range = new Set(leaveRangeDates(startDate, endDate));
  const kept = [...new Set(excluded)].filter((d) => range.has(d)).sort();
  return kept.length >= range.size ? [] : kept;
}

/**
 * 화면이 **보여 주기 · 보내기에 함께 쓰는** 뺀 날짜(2026-11-11). 뺄 수 없는 단위(반차 · 경조)면 빈 목록, 아니면 지금 기간으로 정리한 목록.
 * 상태(뺀 날짜 목록)는 그대로 두고 매번 여기서 계산해서, 종류 · 단위 · 기간이 어떻게 바뀌어도 어긋난 날짜가 서버로 가지 않는다.
 */
export function effectiveExcludedDates(
  excluded: readonly string[],
  allowExclude: boolean,
  startDate: string,
  endDate: string,
): string[] {
  return allowExclude ? pruneExcludedDates(excluded, startDate, endDate) : [];
}

/**
 * 신청 기간 · 단위 · 일수를 규칙대로 맞춘다 — **일수 계산은 이 함수 하나**(모바일 신청 · 관리자 대신 신청이 저장하고,
 * 승인 · 잔여 · 내보내기 · 휴가계는 저장된 `days_count` 를 읽는다).
 *  - 경조(`annual`): 시작일부터 고정 3일, 종일. 뺀 날짜 없음.
 *  - 반차(`am`/`pm`): 시작일 하루, 0.5일. 뺀 날짜 없음.
 *  - 종일: 기간의 날짜 수 − 원래 휴무로 뺀 날짜 수(2026-11-11 사용자 결정 안 A — 현장 · 일부 직원은 주말 출근 ·
 *    평일 휴무라 요일 규칙을 쓰지 않고, 신청할 때 직원이 원래 휴무일을 빼고 결재자가 확인한다).
 *    뺀 날짜는 기간 안 · 실제 날짜 · 중복 없음 · 전부 뺄 수 없음(0일 금지).
 *  - 기간(달력 날짜 수)이 `MAX_LEAVE_REQUEST_DAYS` 를 넘으면 `too_long`.
 */
export function normalizeLeaveRequest(input: {
  leaveType: "annual" | "paid" | "special" | "other";
  startDate: string;
  endDate: string;
  durationUnit: "full" | "am" | "pm";
  excludedDates?: readonly string[] | null;
}):
  | { ok: true; value: NormalizedLeaveRequest }
  | { ok: false; error: "invalid_dates" | "invalid_excluded_dates" | "too_long" } {
  const { leaveType, startDate } = input;
  const excluded = [...(input.excludedDates ?? [])];
  if (!isRealLeaveDate(startDate)) return { ok: false, error: "invalid_dates" };

  if (leaveType === "annual") {
    if (excluded.length > 0) return { ok: false, error: "invalid_excluded_dates" };
    return {
      ok: true,
      value: {
        startDate,
        endDate: leaveAddDaysISO(startDate, LEAVE_BEREAVEMENT_DAYS - 1),
        durationUnit: "full",
        daysCount: LEAVE_BEREAVEMENT_DAYS,
        excludedDates: [],
      },
    };
  }

  if (input.durationUnit === "am" || input.durationUnit === "pm") {
    if (excluded.length > 0) return { ok: false, error: "invalid_excluded_dates" };
    return {
      ok: true,
      value: { startDate, endDate: startDate, durationUnit: input.durationUnit, daysCount: 0.5, excludedDates: [] },
    };
  }

  const { endDate } = input;
  if (!isRealLeaveDate(endDate)) return { ok: false, error: "invalid_dates" };
  const rangeDays = leaveRangeDaysInclusive(startDate, endDate);
  if (rangeDays < 1) return { ok: false, error: "invalid_dates" };
  if (leaveDaysTooLong(rangeDays)) return { ok: false, error: "too_long" };

  const unique = new Set(excluded);
  if (
    unique.size !== excluded.length ||
    excluded.some((d) => typeof d !== "string" || !isRealLeaveDate(d) || d < startDate || d > endDate) ||
    excluded.length >= rangeDays
  ) {
    return { ok: false, error: "invalid_excluded_dates" };
  }
  return {
    ok: true,
    value: {
      startDate,
      endDate,
      durationUnit: "full",
      daysCount: rangeDays - excluded.length,
      excludedDates: [...excluded].sort(),
    },
  };
}

/** `normalizeLeaveRequest` 의 값만(뺀 날짜 칸 없이). 틀리면 null. */
export function normalizeLeaveDays(input: {
  leaveType: "annual" | "paid" | "special" | "other";
  startDate: string;
  endDate: string;
  durationUnit: "full" | "am" | "pm";
  excludedDates?: readonly string[] | null;
}): { startDate: string; endDate: string; durationUnit: "full" | "am" | "pm"; daysCount: number } | null {
  const res = normalizeLeaveRequest(input);
  if (!res.ok) return null;
  const { startDate, endDate, durationUnit, daysCount } = res.value;
  return { startDate, endDate, durationUnit, daysCount };
}

// ── 같은 사람 휴가 겹침 (2026-10-26) ──────────────────────────────────────────
// 같은 사람의 승인된 휴가가 날짜가 겹치면 잔여가 두 번 빠진다. 승인 직전에 이 규칙으로 막는다.
// 반차는 하루짜리라 오전 · 오후가 서로 다르면 겹치지 않는다(같은 날 오전 + 오후 = 하루).
// 원래 휴무로 뺀 날짜도 **기간 안으로 본다**(2026-11-11) — 뺀 날짜에 다른 휴가를 끼워 넣는 일은 드물고,
// 기간 기준이 단순하고 안전하다(DB 함수 `approve_annual_leave_request_atomic` 도 같은 기준).

export type LeaveSpan = { startDate: string; endDate: string; durationUnit: "full" | "am" | "pm" };

export function leaveSpansOverlap(a: LeaveSpan, b: LeaveSpan): boolean {
  if (a.startDate > b.endDate || b.startDate > a.endDate) return false;
  const aHalf = a.durationUnit === "am" || a.durationUnit === "pm";
  const bHalf = b.durationUnit === "am" || b.durationUnit === "pm";
  if (aHalf && bHalf && a.durationUnit !== b.durationUnit) return false;
  return true;
}

// ── 이력(ledger) 거르기 (2026-10-26) ──────────────────────────────────────────
// 화면과 내보내기가 같은 규칙을 쓴다. 내보내기는 화면이 보낸 줄을 믿지 않고, 이 조건만 받아 서버에서 다시 읽은
// 이력을 거른다(`exportLeaveLedger*`). 처리 시각(`processedAt`)은 도쿄 "YYYY/MM/DD HH:mm".

export type LeaveLedgerFilter = {
  status: "requested" | "approved" | "rejected" | "cancelled" | null;
  query: string;
  /** 도쿄 YYYY-MM-DD, 양끝 포함. */
  from: string;
  to: string;
};

export type LeaveLedgerFilterable = {
  status: string;
  processedAt: string;
  applicantName: string;
  reason: string;
  documentNumber: string | null;
  processorName: string | null;
};

export function leaveLedgerProcessedKey(entry: { processedAt: string }): string {
  return entry.processedAt.slice(0, 10).replace(/\//g, "-");
}

export function filterLeaveLedger<T extends LeaveLedgerFilterable>(entries: readonly T[], f: LeaveLedgerFilter): T[] {
  const q = f.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.status && e.status !== f.status) return false;
    const key = leaveLedgerProcessedKey(e);
    if (key && (key < f.from || key > f.to)) return false;
    if (q) {
      const hay = `${e.applicantName} ${e.reason} ${e.documentNumber ?? ""} ${e.processorName ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
