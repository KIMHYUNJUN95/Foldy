/**
 * 지원서의 **고정 선택지 답**을 보는 사람 언어로 (2026-10-23).
 *
 * 채용 사이트 폼은 한국어라, 동기화(`/api/recruit/sync` → `ingest.ts`)가 `job_applications` 에
 * 선택지 글자를 그대로 넣는다 — `남성` · `3일` · `6개월` · `30분~1시간` · `아르바이트`. 저장값은 원본 그대로
 * 두고(대조 · 거르기 · 이력이 이 글자에 묶여 있다) **그릴 때만** 바꾼다. 아는 선택지가 아니면 들어온 그대로.
 *
 * 국적 · 공고 이름 · 비자 종류처럼 사람이 적거나 공고마다 다른 글자는 건드리지 않는다.
 */
export type RecruitChoiceCopy = {
  genderMale: string;
  genderFemale: string;
  /** `{n}` 자리 — 주 근무 일수 */
  daysPerWeek: string;
  /** `{n}` 자리 — 개월 */
  months: string;
  /** `{n}` 자리 — 년 */
  years: string;
  commuteUnder30: string;
  commute30to60: string;
  commuteOver60: string;
  employmentFullTime: string;
  employmentPartTime: string;
  startImmediately: string;
};

// i18n-ignore-start -- 폼이 저장한 한국어 선택지 — 대조용 키, 화면에 그리지 않는다
const GENDER: Record<string, keyof RecruitChoiceCopy> = {
  남성: "genderMale",
  남: "genderMale",
  여성: "genderFemale",
  여: "genderFemale",
};
const COMMUTE: Record<string, keyof RecruitChoiceCopy> = {
  "30분이내": "commuteUnder30",
  "30분~1시간": "commute30to60",
  "1시간이상": "commuteOver60",
};
const EMPLOYMENT: Record<string, keyof RecruitChoiceCopy> = {
  정사원: "employmentFullTime",
  정규직: "employmentFullTime",
  아르바이트: "employmentPartTime",
  알바: "employmentPartTime",
};
/** 시작 가능일은 자유 입력이지만 대부분(2026-10 기준 117건)이 이 셋 — 이것만 바꾸고 날짜 글은 그대로. */
const START: Record<string, keyof RecruitChoiceCopy> = {
  즉시가능: "startImmediately",
  즉시: "startImmediately",
};
/** 폼이 `work_days` 에 넣는 요일 글자 — 순서가 `copy.weekDays`(월~일) 와 같다. */
export const RECRUIT_WEEK_DAY_KEYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
const DAYS = /^(\d{1,2})\s*일$/;
const MONTHS = /^(\d{1,2})\s*개월$/;
const YEARS = /^(\d{1,2})\s*년$/;
// i18n-ignore-end

const squash = (value: string) => value.replace(/\s+/g, "");

function fromTable(raw: string | null, table: Record<string, keyof RecruitChoiceCopy>, copy: RecruitChoiceCopy) {
  if (!raw) return raw;
  const key = table[squash(raw)];
  return key ? copy[key] : raw;
}

export function localizeRecruitGender(raw: string | null, copy: RecruitChoiceCopy): string | null {
  return fromTable(raw, GENDER, copy);
}

export function localizeRecruitCommute(raw: string | null, copy: RecruitChoiceCopy): string | null {
  return fromTable(raw, COMMUTE, copy);
}

export function localizeRecruitEmployment(raw: string | null, copy: RecruitChoiceCopy): string | null {
  return fromTable(raw, EMPLOYMENT, copy);
}

export function localizeRecruitStartDate(raw: string | null, copy: RecruitChoiceCopy): string | null {
  return fromTable(raw, START, copy);
}

export function localizeRecruitDaysPerWeek(raw: string | null, copy: RecruitChoiceCopy): string | null {
  if (!raw) return raw;
  const matched = DAYS.exec(raw.trim());
  return matched ? copy.daysPerWeek.replace("{n}", String(Number(matched[1]))) : raw;
}

export function localizeRecruitDuration(raw: string | null, copy: RecruitChoiceCopy): string | null {
  if (!raw) return raw;
  const trimmed = raw.trim();
  const months = MONTHS.exec(trimmed);
  if (months) return copy.months.replace("{n}", String(Number(months[1])));
  const years = YEARS.exec(trimmed);
  if (years) return copy.years.replace("{n}", String(Number(years[1])));
  return raw;
}

/**
 * `work_days` 의 요일 글자(`월` · `화` …)를 보는 사람 언어로. 저장 순서를 지키고, 모르는 값은 그대로.
 * `weekDays` 는 `dictionary.recruit.weekDays`(월~일 순).
 */
export function localizeRecruitWorkDays(days: readonly string[], weekDays: readonly string[]): string[] {
  return days.map((day) => {
    const index = (RECRUIT_WEEK_DAY_KEYS as readonly string[]).indexOf(day.trim());
    return index === -1 ? day : (weekDays[index] ?? day);
  });
}
