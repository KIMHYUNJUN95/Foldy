import {
  CHANNEL_KEY_PATTERN,
  isHhmm,
  parseLocales,
  parseSettings,
  parseWeekdays,
  type AutomationDestination,
  type AutomationSettings,
} from "@/lib/automation/jobs";

/** 설정 저장이 다루는 칸 — 화면 초안(`Draft`)과 같은 모양 · 같은 키 순서(직렬화 비교가 맞도록). */
export type AutomationSaveFields = {
  destinations: AutomationDestination[];
  retryUntil: string;
  sendTime: string;
  settings: AutomationSettings;
  weekdays: number[];
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const keyOf = (item: unknown) => (isPlainObject(item) && typeof item.channelKey === "string" ? item.channelKey : null);
const isKeyedList = (value: unknown): value is Record<string, unknown>[] => Array.isArray(value) && value.every((item) => keyOf(item) !== null);

/**
 * 칸 단위 3방향 합치기 — **화면 초안(`alignDraft` · `settleDraft`)과 서버 저장(`mergeAutomationSave`)이 같이 쓰는 유일한 칸 규칙**
 * (2026-11-19). `draft` 의 칸이 `previous`(기준)와 같으면(손대지 않음) `next`, 다르면(손댐) `draft`.
 * - 객체는 안쪽 칸까지 내려간다(설정 → 재발송 네 칸 따로).
 * - `channelKey` 를 든 항목의 목록(받는 곳)은 **항목마다** 한 칸 — 있음/없음과 언어 목록이 그 칸이다. 순서는 `next` 를 따르고,
 *   `next` 에 없는데 남는 항목(내가 추가)은 뒤에 붙는다.
 * - 그 밖의 목록(요일 · 채널 · 뺄 건물)과 글자 · 숫자는 통째로 한 칸.
 * - `next` 에서 없어진 칸은 손대지 않았으면 빼고, 손댔으면 남긴다.
 */
export function mergeFields<T>(draft: T, previous: T, next: T): T {
  if (isPlainObject(draft) && isPlainObject(previous) && isPlainObject(next)) {
    const merged: Record<string, unknown> = {};
    for (const key of Object.keys(next)) merged[key] = key in draft ? mergeFields(draft[key], previous[key], next[key]) : next[key];
    for (const key of Object.keys(draft)) if (!(key in next) && !same(draft[key], previous[key])) merged[key] = draft[key];
    return merged as T;
  }
  if (isKeyedList(draft) && isKeyedList(previous) && isKeyedList(next) && draft.length + previous.length + next.length > 0) {
    const find = (list: Record<string, unknown>[], key: string) => list.find((item) => keyOf(item) === key);
    const keys = [...new Set([...next, ...draft, ...previous].map((item) => keyOf(item) as string))];
    const merged: Record<string, unknown>[] = [];
    for (const key of keys) {
      const mine = find(draft, key);
      const item = same(mine, find(previous, key)) ? find(next, key) : mine;
      if (item) merged.push(item);
    }
    return merged as T;
  }
  return same(draft, previous) ? next : draft;
}

function orderedFields(fields: AutomationSaveFields): AutomationSaveFields {
  const { resend } = fields.settings;
  return {
    destinations: [...fields.destinations]
      .sort((a, b) => (a.channelKey < b.channelKey ? -1 : a.channelKey > b.channelKey ? 1 : 0))
      .map((item) => ({ channelKey: item.channelKey, locales: item.locales })),
    retryUntil: fields.retryUntil,
    sendTime: fields.sendTime,
    settings: {
      channels: fields.settings.channels,
      excludedProperties: fields.settings.excludedProperties,
      resend: { debounceMinutes: resend.debounceMinutes, enabled: resend.enabled, maxPerDay: resend.maxPerDay, until: resend.until },
    },
    weekdays: fields.weekdays,
  };
}

/**
 * 클라이언트가 보낸 값(초안 · 기준)을 믿지 않고 다시 읽는다. 시각 · 채널 키 모양이 틀리거나 같은 채널이 두 번이면 null.
 * `known` 을 주면 그 밖의 채널도 null(초안). 기준은 그 사이 연결이 끊긴 채널을 들 수 있어 `null` 로 부른다.
 * 언어가 하나도 없는 받는 곳은 「없음」과 같아 뺀다.
 */
export function parseSaveFields(raw: unknown, known: ReadonlySet<string> | null): AutomationSaveFields | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!isHhmm(record.sendTime) || !isHhmm(record.retryUntil)) return null;
  const destinations: AutomationDestination[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(record.destinations) ? record.destinations : []) {
    const channelKey = String((item as Record<string, unknown> | null)?.channelKey ?? "");
    if (!CHANNEL_KEY_PATTERN.test(channelKey) || (known && !known.has(channelKey)) || seen.has(channelKey)) return null;
    seen.add(channelKey);
    const locales = parseLocales((item as Record<string, unknown>).locales);
    if (locales.length > 0) destinations.push({ channelKey, locales });
  }
  return orderedFields({
    destinations,
    retryUntil: record.retryUntil,
    sendTime: record.sendTime,
    settings: parseSettings(record.settings),
    weekdays: parseWeekdays(record.weekdays),
  });
}

/**
 * 저장 때 지금 DB 값(`current`) 위에 **내가 바꾼 칸만** 얹는다 — 칸 규칙은 화면과 같은 `mergeFields`. 결과 받는 곳은 채널 이름순.
 */
export function mergeAutomationSave(input: {
  base: AutomationSaveFields;
  current: AutomationSaveFields;
  draft: AutomationSaveFields;
}): AutomationSaveFields {
  return orderedFields(mergeFields(input.draft, input.base, input.current));
}
