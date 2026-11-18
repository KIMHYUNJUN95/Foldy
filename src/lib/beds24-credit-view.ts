import type { Dictionary } from "@/lib/i18n";
import {
  BEDS24_CREDIT_STOP_BELOW,
  BEDS24_CREDIT_WARN_BELOW,
  type Beds24CreditActorUsage,
  type Beds24CreditDetail,
  type Beds24CreditFeature,
  type Beds24CreditSnapshot,
  type Beds24CreditState,
  type Beds24CreditWindowBar,
} from "@/lib/beds24/credit-usage-types";

/**
 * Beds24 크레딧 게이지 — 화면 판정(순수 함수). 서버가 준 스냅샷을 「지금」 시각으로 다시 읽는다:
 * 30초마다 새 값을 받지만 그 사이에 리셋 · 쉬는 시간이 끝나면 화면이 먼저 알아야 한다.
 *
 * 도메인 계약: docs/product/36-automation-control.md 「Beds24 크레딧」.
 */

export type Beds24CreditView = {
  state: Beds24CreditState;
  /** 지금 남은 양(모르면 null). 리셋이 지났으면 한도. */
  remaining: number | null;
  limit: number;
  /** 0~100 — 막대 길이. 모르면 0. */
  percent: number;
  /** 카운트다운이 가리키는 시각 — 쉬는 중이면 풀리는 때, 아니면 다시 가득 차는 때. 없으면 null. */
  countdownTo: number | null;
};

export function stateOfRemaining(remaining: number): Exclude<Beds24CreditState, "unknown"> {
  if (remaining < BEDS24_CREDIT_STOP_BELOW) return "stop";
  if (remaining < BEDS24_CREDIT_WARN_BELOW) return "warn";
  return "ok";
}

export function creditView(snapshot: Beds24CreditSnapshot | null, now: number): Beds24CreditView {
  const limit = snapshot?.limit ?? 200;
  if (!snapshot) return { state: "unknown", remaining: null, limit, percent: 0, countdownTo: null };

  const paused = snapshot.pausedUntil !== null && snapshot.pausedUntil > now;
  const resetPending = snapshot.resetsAt !== null && snapshot.resetsAt > now;

  let remaining = snapshot.remaining;
  // 리셋 시각이 지났으면 창이 새로 시작됐다 — 다음 기록을 기다리지 않고 가득 찬 것으로 본다.
  if (remaining !== null && snapshot.resetsAt !== null && !resetPending) remaining = limit;

  let state: Beds24CreditState;
  if (paused) state = "stop";
  else if (remaining === null || snapshot.state === "unknown") state = "unknown";
  else state = stateOfRemaining(remaining);

  if (state === "unknown" && !paused) remaining = null;

  const countdownTo = paused ? snapshot.pausedUntil : resetPending ? snapshot.resetsAt : null;
  const percent = remaining === null ? 0 : clampPercent((remaining / Math.max(1, limit)) * 100);
  return { state, remaining, limit, percent, countdownTo };
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** 남은 밀리초 → 「2:40」(1시간 넘으면 「1:02:05」). 음수는 0. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export type DurationCopy = { durHourMin: string; durMinSec: string; durMin: string; durSec: string };

/** 남은 밀리초 → 「2분 40초」 같은 말(i18n 자리 표시 `{h}` `{m}` `{s}`). */
export function formatDurationWords(ms: number, copy: DurationCopy): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const fillIn = (template: string) =>
    template.replace("{h}", String(h)).replace("{m}", String(m)).replace("{s}", String(s));
  if (h > 0) return fillIn(copy.durHourMin);
  if (m > 0) return fillIn(s > 0 ? copy.durMinSec : copy.durMin);
  return fillIn(copy.durSec);
}

/** 비율(0~100 정수). 합이 0 이면 0. */
export function sharePercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round(clampPercent((part / total) * 100));
}

/** `{name}` 자리 표시를 채운다. */
export function fillCopy(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

/** 화면이 다시 값을 받을지 — 탭이 보이고 마지막으로 받은 뒤 `minGapMs` 가 지났을 때. */
export function shouldRefreshCredit(input: { visible: boolean; lastFetchedAt: number; now: number; minGapMs: number }): boolean {
  return input.visible && input.now - input.lastFetchedAt >= input.minGapMs;
}

export type Beds24CreditCopy = Dictionary["beds24Credit"];

export function featureLabel(feature: Beds24CreditFeature, copy: Beds24CreditCopy): string {
  return copy.feature[feature] ?? copy.feature.other;
}

/** 누가 — 사람은 이름, 자동 작업 · Foldy 밖은 i18n. 작은 글씨는 가장 많이 쓴 곳(Foldy 밖은 설명). */
export function actorLines(actor: Beds24CreditActorUsage, copy: Beds24CreditCopy): { name: string; sub: string; initial: string } {
  const name = actor.kind === "user" ? actor.name || "—" : actor.kind === "auto" ? copy.auto : copy.outside;
  const sub =
    actor.kind === "outside"
      ? copy.outsideHint
      : actor.topFeatures
          .slice(0, 3)
          .map((feature) => featureLabel(feature, copy))
          .join(" · ");
  return { name, sub, initial: actor.kind === "user" ? Array.from(name.trim())[0] ?? "·" : "" };
}

/**
 * 화면에 그릴 모양 — **모든 화면(게이지 · 요약 창 · 관제실 칸 · 모바일 한 줄 · 시트)이 이것 하나만 쓴다.**
 * 쉬는 중이면 남은 양이 아니라 풀리는 시각을 보여 주고 막대는 비운다(리셋이 지나 200 으로 보여도 Beds24 를 부르지 않는 중이다).
 * `now` 가 null(붙기 전)이면 카운트다운 자리를 비워 둔다 — 「곧」 → 「2:40」 으로 글자가 바뀌어 흔들리지 않게.
 */
export type CreditHeadline =
  | { kind: "credits"; value: number }
  | { kind: "countdown"; text: string; leftMs: number }
  | { kind: "soon" }
  | { kind: "wait" }
  | { kind: "none" };

export type Beds24CreditDisplay = {
  state: Beds24CreditState;
  limit: number;
  headline: CreditHeadline;
  /** 0~1 막대. 쉬는 중 · 모름은 0. */
  fill: number;
  /** 넉넉 · 주의일 때 다시 가득 차기까지(모르면 null). */
  refillMs: number | null;
};

export function creditDisplay(view: Beds24CreditView, now: number | null): Beds24CreditDisplay {
  const leftMs = view.countdownTo !== null && now !== null ? Math.max(0, view.countdownTo - now) : null;
  const base = { state: view.state, limit: view.limit };
  if (view.state === "unknown") return { ...base, headline: { kind: "none" }, fill: 0, refillMs: null };
  if (view.state === "stop") {
    const headline: CreditHeadline =
      view.countdownTo === null
        ? { kind: "soon" }
        : leftMs === null
          ? { kind: "wait" }
          : { kind: "countdown", text: formatCountdown(leftMs), leftMs };
    return { ...base, headline, fill: 0, refillMs: null };
  }
  return { ...base, headline: { kind: "credits", value: view.remaining ?? 0 }, fill: view.percent / 100, refillMs: leftMs };
}

export type Beds24CreditTexts = {
  fill: number;
  /** PC 상단 줄 — 「Beds24 120 / 200」 · 「Beds24 쉬는 중 2:40」. */
  gauge: { label: string; value: string; suffix: string };
  aria: string;
  /** 요약 창 · 관제실 칸 · 시트의 큰 숫자와 옆 글자. */
  big: { value: string; suffix: string };
  sub: string;
  /** 모바일 판매 캘린더 한 줄 — 주의 · 쉬는 중만, 아니면 null. */
  note: { label: string; value: string } | null;
};

export function creditTexts(d: Beds24CreditDisplay, copy: Beds24CreditCopy): Beds24CreditTexts {
  const h = d.headline;
  const leftOf = fillCopy(copy.leftOf, { limit: d.limit });
  if (h.kind === "none") {
    return {
      fill: 0,
      gauge: { label: copy.name, value: copy.unknownShort, suffix: "" },
      aria: copy.ariaUnknown,
      big: { value: "—", suffix: leftOf },
      sub: copy.unknownBody,
      note: null,
    };
  }
  if (h.kind === "credits") {
    const n = h.value;
    return {
      fill: d.fill,
      gauge: { label: copy.name, value: String(n), suffix: `/ ${d.limit}` },
      aria: fillCopy(d.state === "warn" ? copy.ariaWarn : copy.ariaOk, { n, limit: d.limit }),
      big: { value: String(n), suffix: leftOf },
      sub: d.refillMs !== null ? fillCopy(copy.refillIn, { time: formatDurationWords(d.refillMs, copy) }) : copy.refillFull,
      note: d.state === "warn" ? { label: copy.noteWarn, value: fillCopy(copy.noteValue, { n, limit: d.limit }) } : null,
    };
  }
  // 쉬는 중
  const countdown = h.kind === "countdown" ? h.text : "";
  return {
    fill: 0,
    gauge: { label: copy.paused, value: countdown, suffix: "" },
    aria: h.kind === "countdown" ? fillCopy(copy.ariaStop, { time: formatDurationWords(h.leftMs, copy) }) : copy.ariaStopNoTime,
    big: { value: countdown || "—", suffix: h.kind === "countdown" ? copy.resumeSuffix : "" },
    sub: h.kind === "countdown" ? fillCopy(copy.pausedFor, { time: formatDurationWords(h.leftMs, copy) }) : copy.pausedSoon,
    note: {
      label: copy.noteStop,
      value: h.kind === "countdown" ? fillCopy(copy.noteResumesIn, { time: h.text }) : h.kind === "soon" ? copy.noteResumesSoon : "",
    },
  };
}

/** 차트 점선 — 남은 양이 멈춤 · 주의 문턱에 닿는 「쓴 양」. 숫자는 상수에서 채운다. */
export function chartLines(limit: number, copy: Beds24CreditCopy): Array<{ used: number; label: string }> {
  const all = limit - BEDS24_CREDIT_STOP_BELOW;
  const reviews = limit - BEDS24_CREDIT_WARN_BELOW;
  return [
    { used: all, label: fillCopy(copy.line190, { n: all }) },
    { used: reviews, label: fillCopy(copy.line150, { n: reviews }) },
  ];
}

/** 막대 위 숫자 — 주의 · 멈춤 · 지금 막대만, 0 은 그리지 않는다. */
export function barCaption(bar: Pick<Beds24CreditWindowBar, "used" | "level">, isNow: boolean): { cls: string; text: string } | null {
  if (bar.used <= 0) return null;
  const cls = bar.level !== "ok" ? bar.level : isNow ? "now" : "";
  return cls ? { cls, text: String(bar.used) } : null;
}

/** 「오늘 쉰 횟수」 줄. 길이를 모르면(리셋 시각 없는 429) 「0초」로 보이지 않게 길이를 뺀다. */
export function pauseSummaryLine(
  pauses: Beds24CreditDetail["pausesToday"] | undefined,
  formatTime: (ms: number) => string,
  copy: Beds24CreditCopy,
): string | null {
  if (!pauses) return null;
  if (pauses.count === 0) return copy.pausesNone;
  if (pauses.lastAt === null) return fillCopy(copy.pausesTodayNoLast, { n: pauses.count });
  const time = formatTime(pauses.lastAt);
  if (pauses.lastSeconds === null) return fillCopy(copy.pausesTodayNoDur, { n: pauses.count, time });
  return fillCopy(copy.pausesToday, { n: pauses.count, time, dur: formatDurationWords(pauses.lastSeconds * 1000, copy) });
}

/** 「지금 5분 동안 쓴 곳 · 50」. 0 이면(모름 · 기록 없음 포함) 합계 없이 — 아래 빈 문구와 「· 0」이 겹치지 않게. */
export function windowHeadLine(windowUsed: number, copy: Beds24CreditCopy): string {
  return windowUsed > 0 ? fillCopy(copy.windowHead, { n: windowUsed.toLocaleString() }) : copy.windowHeadPlain;
}
