import { useEffect, useState, useSyncExternalStore } from "react";
import { previewAutomationMessage } from "@/actions/ops-automation";
import type { AutomationJobView, AutomationPageData, AutomationRunView } from "@/lib/automation/console-data";
import type { AutomationJobKey, AutomationLocale } from "@/lib/automation/jobs";
import type { AlertCard } from "@/lib/automation/messages";
import { nextScheduledSend, tokyoClock } from "@/lib/automation/schedule";
import type { Dictionary } from "@/lib/i18n";
import { ymdShift } from "@/lib/tokyo-date";

/**
 * 자동화 화면 공용 조각 — PC 관제실(`automation-console.tsx`)과 모바일(`mobile/ops/mobile-automation.tsx`)이 같이 쓴다.
 *
 * 도메인 계약: docs/product/36-automation-control.md 「화이트 리디자인」 · 「모바일 자동화」
 *
 * **모양(클래스)은 여기 두지 않는다** — 문구 만들기 · 시각 계산 · 타임라인 묶기 · 미리보기 읽기처럼 두 화면이 같은 답을 내야
 * 하는 것만. 그래서 PC 와 모바일의 「오늘 발송」 묶는 규칙 · 「다음 발송」 · 「정정본으로 나감」 판정이 어긋나지 않는다.
 */

export type AutomationCopy = Dictionary["automation"];
export type AutomationWhiteCopy = AutomationCopy["white"];
export type RunStatus = AutomationRunView["status"];

export const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [key, value]) => out.split(`{${key}}`).join(String(value)), template);

export const LANG_LABEL: Record<AutomationLocale, string> = { en: "English", ja: "日本語", ko: "한국어" };

/** `*굵게*` 표시를 나눈다(Slack mrkdwn 과 같은 규칙 — 화면 문구의 강조에도 쓴다). */
export function segments(line: string) {
  return line.split("*").map((text, index) => ({ bold: index % 2 === 1, text }));
}

export function Rich({ text }: { text: string }) {
  return (
    <>
      {segments(text).map((part, index) => (part.bold ? <b key={index}>{part.text}</b> : <span key={index}>{part.text}</span>))}
    </>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 도쿄 "HH:MM". */
export function hhmmOf(iso: string | Date) {
  const minutes = tokyoClock(typeof iso === "string" ? new Date(iso) : iso).minutes;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
export const tokyoDayOf = (iso: string | Date) => tokyoClock(typeof iso === "string" ? new Date(iso) : iso).date;
/** "2026-10-09" → "10/9" */
export const mdOf = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/** 날짜 단추 글자 — 10월 14일 (수) · 10月14日(水) · Wed, Oct 14 */
export function dayLabel(ymd: string, localeTag: string) {
  return new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "long", timeZone: "Asia/Tokyo", weekday: "short" }).format(
    new Date(`${ymd}T12:00:00+09:00`),
  );
}

/** 오늘 06:30 · 어제 06:30 · 10/7 06:30 */
export function relWhen(iso: string | Date, today: string, w: AutomationWhiteCopy) {
  const day = tokyoDayOf(iso);
  const time = hhmmOf(iso);
  if (day === today) return fill(w.todayAt, { time });
  if (day === ymdShift(today, -1)) return fill(w.yesterdayAt, { time });
  return fill(w.dateAt, { date: mdOf(day), time });
}
/** 앞으로의 시각 — 오늘이면 시각만, 내일 06:30, 10/17 06:30 */
export function aheadWhen(at: Date, today: string, w: AutomationWhiteCopy) {
  const day = tokyoDayOf(at);
  const time = hhmmOf(at);
  if (day === today) return time;
  if (day === ymdShift(today, 1)) return fill(w.tomorrowAt, { time });
  return fill(w.dateAt, { date: mdOf(day), time });
}

// 지금(분 단위) — 서버에선 null(시각에 기대는 표시는 붙은 뒤에만 그린다 · 하이드레이션 어긋남 방지).
function subscribeMinute(onChange: () => void) {
  const id = window.setInterval(onChange, 15_000);
  return () => window.clearInterval(id);
}
const minuteNow = () => Math.floor(Date.now() / 60_000);
const minuteServer = () => null;
export function useNowMinute(): number | null {
  return useSyncExternalStore<number | null>(subscribeMinute, minuteNow, minuteServer);
}
// 붙었나 — 서버와 브라우저의 Intl(ICU) 결과가 달라(「AM 7:00」 vs 「오전 7:00」) 날짜 · 시각 글자는 붙은 뒤에 Intl 로 바꾼다.
const noopSubscribe = () => () => {};
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function statusClass(status: RunStatus) {
  return status === "sent" ? "is-ok" : status === "failed" ? "is-bad" : "is-warn";
}

export function errorTextOf(copy: AutomationCopy, code: string) {
  return (copy.errors as Record<string, string>)[code] ?? copy.errors.save_failed;
}

export function FoldyMark({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 100 100" width={size}>
      <rect fill="#5B2BD6" height="17" rx="8.5" width="64" x="18" y="62" />
      <rect fill="#8A63F0" height="17" rx="8.5" width="50" x="25" y="43" />
      <rect fill="#B9A0FA" height="17" rx="8.5" width="36" x="32" y="24" />
    </svg>
  );
}

// ── 상태 줄 · 목록 줄 ─────────────────────────────────────────────────────

/** 위 상태 줄 첫 칸 — 예약 데이터가 얼마나 새것인가. */
export function gateLine(data: AutomationPageData, w: AutomationWhiteCopy): { cls: string; text: string } {
  return data.gate.ok
    ? { cls: "is-ok", text: fill(w.dataOk, { n: data.gate.ageMinutes ?? 0 }) }
    : data.gate.ageMinutes === null
      ? { cls: "is-warn", text: w.dataUnknown }
      : { cls: "is-bad", text: fill(w.dataStale, { h: Math.round((data.gate.ageMinutes ?? 0) / 60) }) };
}

export function eventLineOf(jobKey: AutomationJobKey, w: AutomationWhiteCopy) {
  return w.eventLine[jobKey as keyof AutomationWhiteCopy["eventLine"]] ?? "";
}

/** 목록 둘째 줄 — 매일 06:30 · 다음 내일 06:30 / 매일 07:00 · 정정본 18:00까지 / 예약이 취소될 때마다. */
export function scheduleLineOf(item: AutomationJobView, copy: AutomationCopy, today: string, now: Date | null) {
  const w = copy.white;
  if (item.kind !== "scheduled") return eventLineOf(item.jobKey, w);
  const base = fill(copy.whenDaily, { time: item.sendTime });
  if (!item.enabled) return base;
  if (item.jobKey === "cleaning_list" && item.settings.resend.enabled) {
    return `${base} · ${fill(w.correctionUntil, { time: item.settings.resend.until })}`;
  }
  const next = now ? nextScheduledSend(item, now) : null;
  return next ? `${base} · ${fill(w.nextAt, { at: relWhen(next, today, w) })}` : base;
}

/** 목록 셋째 줄 — 마지막 결과. 실패 알림은 오늘 것이 없으면 「오늘 실패 없음」. */
export function lastLineOf(item: AutomationJobView, copy: AutomationCopy, today: string): { text: string; status: RunStatus | null } {
  const w = copy.white;
  const last = item.runs[0];
  if (item.jobKey === "failure_alert" && (!last || tokyoDayOf(last.createdAt) !== today)) return { status: null, text: w.failureNone };
  if (!last) return { status: null, text: copy.noRuns };
  return { status: last.status, text: relWhen(last.createdAt, today, w) };
}

export const messageCountOf = (job: AutomationJobView) => job.destinations.reduce((sum, item) => sum + item.locales.length, 0);

/** 상세 머리 둘째 줄의 받는 곳 — 받는 곳 DAILY_REPORT (한국어) / 받는 곳 2곳 · 메시지 3통. */
export function destLineOf(job: AutomationJobView, w: AutomationWhiteCopy) {
  return job.destinations.length === 0
    ? w.destNone
    : job.destinations.length === 1
      ? fill(w.destOne, {
          name: `${job.destinations[0].channelKey} (${job.destinations[0].locales.map((item) => LANG_LABEL[item]).join(" · ")})`,
        })
      : fill(w.destMany, { m: messageCountOf(job), n: job.destinations.length });
}

// ── 오늘 발송 타임라인 ─────────────────────────────────────────────────────

export const MAX_PAST_POINTS = 6;
export const MAX_NEXT_POINTS = 3;

export type TodayPoint = { jobKey: AutomationJobKey; time: string; ts: number; status: RunStatus };

/** 오늘(도쿄) 실제 실행 기록 — 같은 자동화 · 같은 분은 한 점(받는 곳 · 언어마다 한 줄씩 쌓이므로). */
export function todayRunPoints(jobs: AutomationJobView[], today: string) {
  const groups = new Map<string, { jobKey: AutomationJobKey; time: string; ts: number; statuses: RunStatus[] }>();
  let sent = 0;
  let failed = 0;
  for (const item of jobs) {
    for (const run of item.runs) {
      if (tokyoDayOf(run.createdAt) !== today) continue;
      if (run.status === "sent") sent += 1;
      if (run.status === "failed") failed += 1;
      const time = hhmmOf(run.createdAt);
      const key = `${item.jobKey}|${time}`;
      const ts = new Date(run.createdAt).getTime();
      const group = groups.get(key) ?? { jobKey: item.jobKey, statuses: [], time, ts };
      group.statuses.push(run.status);
      group.ts = Math.min(group.ts, ts);
      groups.set(key, group);
    }
  }
  const points: TodayPoint[] = [...groups.values()]
    .sort((a, b) => a.ts - b.ts)
    .map((group) => ({
      jobKey: group.jobKey,
      status: (group.statuses.includes("sent") ? "sent" : group.statuses.includes("failed") ? "failed" : "skipped") as RunStatus,
      time: group.time,
      ts: group.ts,
    }));
  return { failed, points, sent };
}

/** 켜진 정시 발송의 다음 시각 — 가까운 순으로 몇 개. */
export function upcomingSends(jobs: AutomationJobView[], now: Date | null) {
  if (!now) return [];
  return jobs
    .filter((item) => item.kind === "scheduled")
    .map((item) => ({ at: nextScheduledSend(item, now), jobKey: item.jobKey }))
    .filter((item): item is { at: Date; jobKey: AutomationJobKey } => item.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_NEXT_POINTS);
}

// ── 미리보기 ─────────────────────────────────────────────────────────────

/** 미리보기 처음 날짜 — 일일 리포트는 어제 몫, 나머지는 오늘. */
export const previewDefaultDate = (job: AutomationJobView, data: AutomationPageData) =>
  job.jobKey === "daily_report" ? data.yesterday : data.today;

/**
 * 이 날짜 몫을 이미 보냈나(정시 · 재시도 · 손 · 정정본 무엇이든 「보냄」 한 줄) · 지금 보내면 정정본인가.
 * 청소 명단은 이미 보냈으면 정정본으로(서버 `correction` — 담당자 탭의 정정본 보내기와 같은 길).
 */
export function previewSendState(job: AutomationJobView, date: string) {
  const timed = job.kind === "scheduled";
  const sentRun = timed ? (job.runs.find((run) => run.targetDate === date && run.status === "sent") ?? null) : null;
  return { asCorrection: job.jobKey === "cleaning_list" && !!sentRun, sentRun, timed };
}

/** 미리보기 아래 한 줄 — 오늘 06:30에 보냄 · 지금 보내면 *정정본*으로 나가요 / 아직 안 보냄 … / 형식 미리보기. */
export function previewFootText(job: AutomationJobView, date: string, copy: AutomationCopy, today: string) {
  const w = copy.white;
  const { timed, sentRun, asCorrection } = previewSendState(job, date);
  return timed
    ? sentRun
      ? `${fill(w.sentAt, { when: relWhen(sentRun.createdAt, today, w) })} · ${asCorrection ? w.sendsCorrection : w.sendsAgain}`
      : w.notSent
    : job.jobKey === "failure_alert"
      ? copy.preview.failureSample
      : copy.preview.eventSample;
}

/** 미리보기 메시지 읽기 — 조건(자동화 · 날짜 · 언어)이 바뀌면 다시. 결과가 지금 조건의 것이 아니면 「만드는 중」. */
export function useAutomationPreview(
  jobKey: AutomationJobKey,
  date: string,
  lang: AutomationLocale,
  onError: (code: string) => void,
): { loading: boolean; text: string | null; card: AlertCard | null } {
  const [preview, setPreview] = useState<{ key: string; text: string | null; card: AlertCard | null } | null>(null);
  const requestKey = `${jobKey}|${date}|${lang}`;
  // effect 안에서 상태를 미리 비우지 않는다 — 키가 다르면 「만드는 중」으로 본다.
  const loading = preview?.key !== requestKey;

  useEffect(() => {
    let alive = true;
    previewAutomationMessage({ date, jobKey, locale: lang }).then((result) => {
      if (!alive) return;
      setPreview({ card: result.ok ? result.card : null, key: requestKey, text: result.ok ? result.text : null });
      if (!result.ok) onError(result.error);
    });
    return () => {
      alive = false;
    };
  }, [date, jobKey, lang, onError, requestKey]);

  return {
    card: loading ? null : (preview?.card ?? null),
    loading,
    text: loading ? null : (preview?.text ?? null),
  };
}

/** 미리보기 메시지 머리의 시각 — 보낸 시각, 아직이면 그날 발송 시각, 이벤트형은 마지막 실행. */
export function previewStampAt(job: AutomationJobView, date: string, today: string): Date | null {
  const { timed, sentRun } = previewSendState(job, date);
  return sentRun
    ? new Date(sentRun.createdAt)
    : timed
      ? new Date(`${today}T${job.sendTime}:00+09:00`)
      : job.runs[0]
        ? new Date(job.runs[0].createdAt)
        : null;
}

// ── 실행 기록 ─────────────────────────────────────────────────────────────

export function runReasonText(reason: string | null, copy: AutomationCopy) {
  if (!reason) return "—";
  if (reason.startsWith("http_")) return fill(copy.history.reasons.http, { code: reason.slice(5) });
  return (copy.history.reasons as Record<string, string>)[reason] ?? reason;
}

export const runTriggerText = (trigger: string, copy: AutomationCopy) =>
  (copy.history.triggers as Record<string, string>)[trigger] ?? trigger;

/** 10/9 06:30 */
export const runAtText = (iso: string) => `${mdOf(tokyoDayOf(iso))} ${hhmmOf(iso)}`;
