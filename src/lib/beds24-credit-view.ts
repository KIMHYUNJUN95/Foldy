import type { Dictionary } from "@/lib/i18n";
import {
  BEDS24_CREDIT_STOP_BELOW,
  BEDS24_CREDIT_WARN_BELOW,
  type Beds24CreditActorUsage,
  type Beds24CreditCall,
  type Beds24CreditCallCursor,
  type Beds24CreditCallFilter,
  type Beds24CreditCallPage,
  type Beds24CreditDetail,
  type Beds24CreditFeature,
  type Beds24CreditRange,
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
  /** 갱신이 실패하는 중이라 값이 낡았다 — 모름으로 내려 보낸 경우. */
  stale: boolean;
};

/** 갱신이 이만큼 이어서 실패하면(30초 주기 기준 약 1분 반) 값이 낡았다고 본다. */
export const CREDIT_STALE_AFTER_FAILURES = 3;

/** 자동 갱신 간격 — 7일은 장마다 전체 계산이라 무거워 60초, 나머지는 10초. */
export function creditPollMs(range: Beds24CreditRange): number {
  return range === "7d" ? 60_000 : 10_000;
}

/** 응답 판정 — **나중에 보낸 요청의 응답이 이긴다**(요약 · 상세가 같은 순번을 쓴다). 기록 시각은 보지 않는다. */
export function isNewerResponse(token: number, appliedToken: number): boolean {
  return token > appliedToken;
}

/** 값 받기 한 번의 결과 — 순번에 밀려 버려진 응답(`dropped`)은 성공 · 실패 어느 쪽으로도 세지 않는다. */
export type CreditRefreshResult = "ok" | "failed" | "dropped";

export function creditRefreshResult(ok: boolean, newer: boolean): CreditRefreshResult {
  return !newer ? "dropped" : ok ? "ok" : "failed";
}

/** 오류 띠 — 사용자가 누른 요청이 실패했거나, 조용한 갱신이 낡은 값 기준만큼 이어서 실패했을 때. */
export function showCreditLoadError(userFailed: boolean, failures: number): boolean {
  return userFailed || failures >= CREDIT_STALE_AFTER_FAILURES;
}

export function stateOfRemaining(remaining: number): Exclude<Beds24CreditState, "unknown"> {
  if (remaining < BEDS24_CREDIT_STOP_BELOW) return "stop";
  if (remaining < BEDS24_CREDIT_WARN_BELOW) return "warn";
  return "ok";
}

/** `failures` — 값 받기가 이어서 실패한 횟수. 낡은 값 판정은 여기 한 곳(모든 화면이 이 결과를 쓴다). */
export function creditView(snapshot: Beds24CreditSnapshot | null, now: number, failures = 0): Beds24CreditView {
  const limit = snapshot?.limit ?? 200;
  if (!snapshot) return { state: "unknown", remaining: null, limit, percent: 0, countdownTo: null, stale: false };

  // 갱신이 실패하는데 리셋 · 쉬는 시각이 지났으면 다음 값을 모른다 — 「가득 참」 · 「풀림」으로 짐작하지 않는다.
  const timePassed =
    (snapshot.resetsAt !== null && snapshot.resetsAt <= now) || (snapshot.pausedUntil !== null && snapshot.pausedUntil <= now);
  if (failures >= CREDIT_STALE_AFTER_FAILURES || (failures > 0 && timePassed)) {
    return { state: "unknown", remaining: null, limit, percent: 0, countdownTo: null, stale: true };
  }

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
  return { state, remaining, limit, percent, countdownTo, stale: false };
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
  /** 모름인데 갱신 실패로 낡아서인 경우 — 문구가 「기록 없음」과 다르다. */
  stale: boolean;
  headline: CreditHeadline;
  /** 0~1 막대. 쉬는 중 · 모름은 0. */
  fill: number;
  /** 넉넉 · 주의일 때 다시 가득 차기까지(모르면 null). */
  refillMs: number | null;
};

export function creditDisplay(view: Beds24CreditView, now: number | null): Beds24CreditDisplay {
  const leftMs = view.countdownTo !== null && now !== null ? Math.max(0, view.countdownTo - now) : null;
  const base = { state: view.state, limit: view.limit, stale: view.stale };
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
      gauge: { label: copy.name, value: d.stale ? copy.staleShort : copy.unknownShort, suffix: "" },
      aria: d.stale ? copy.ariaStale : copy.ariaUnknown,
      big: { value: "—", suffix: leftOf },
      sub: d.stale ? copy.staleBody : copy.unknownBody,
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

/* ───────────── 최근 호출 목록 — 쌓기 · 묶기 · 거르기 (2026-11-18) ───────────── */

export const NO_CREDIT_CALL_FILTER: Beds24CreditCallFilter = { actor: null, feature: null };

/** 목록 열쇠 — 기간 · 거르기가 바뀌면 목록을 새로 시작한다. */
export function creditCallListKey(range: Beds24CreditRange, filter: Beds24CreditCallFilter): string {
  return `${range}|${filter.actor ?? ""}|${filter.feature ?? ""}`;
}

export function isCreditCallFilterOn(filter: Beds24CreditCallFilter): boolean {
  return filter.actor !== null || filter.feature !== null;
}

/** 같은 줄을 다시 누르면 풀린다. 「누가」와 「어디에」는 따로 걸리고 둘 다 걸리면 둘 다 맞는 호출만. */
export function toggleCreditCallFilter(
  filter: Beds24CreditCallFilter,
  part: "actor" | "feature",
  value: string,
): Beds24CreditCallFilter {
  if (part === "actor") return { ...filter, actor: filter.actor === value ? null : value };
  const feature = value as Beds24CreditCallFilter["feature"];
  return { ...filter, feature: filter.feature === feature ? null : feature };
}

/** 「누가」 줄 중 누를 수 있는 줄 — Foldy 밖은 호출 기록이 없어 거를 수 없다. */
export function isCreditActorFilterable(actor: Pick<Beds24CreditActorUsage, "kind">): boolean {
  return actor.kind !== "outside";
}

/** 마이크로초 시각 — `called_at` 은 마이크로초까지 와서 ms(`at`)만으로는 같은 ms 줄 순서를 못 가린다. */
export function creditCallTimeUs(call: Pick<Beds24CreditCall, "at" | "calledAt">): number {
  const fraction = /\.(\d+)/.exec(call.calledAt)?.[1] ?? "";
  const extra = Number((fraction + "000000").slice(3, 6));
  return Math.floor(call.at) * 1000 + (Number.isFinite(extra) ? extra : 0);
}

function compareIdDesc(a: string, b: string): number {
  if (a.length !== b.length) return b.length - a.length;
  return a < b ? 1 : a > b ? -1 : 0;
}

/** DB 순서와 같은 (called_at desc, id desc). */
export function compareCreditCallsDesc(a: Beds24CreditCall, b: Beds24CreditCall): number {
  const time = creditCallTimeUs(b) - creditCallTimeUs(a);
  return time !== 0 ? time : compareIdDesc(a.id, b.id);
}

/** id 로 하나만(뒤에 온 값이 이긴다) · 새 것부터. */
export function mergeCreditCalls(current: readonly Beds24CreditCall[], incoming: readonly Beds24CreditCall[]): Beds24CreditCall[] {
  const byId = new Map<string, Beds24CreditCall>();
  for (const call of current) byId.set(call.id, call);
  for (const call of incoming) byId.set(call.id, call);
  return [...byId.values()].sort(compareCreditCallsDesc);
}

export type CreditCallList = {
  key: string;
  /** 목록을 새로 시작할 때마다 +1 — 그 전에 보낸 「더 보기」 · 첫 장 응답은 버린다. */
  generation: number;
  calls: Beds24CreditCall[];
  hasMore: boolean;
};

export function startCreditCallList(key: string, generation: number, page: Beds24CreditCallPage | null): CreditCallList {
  return { key, generation, calls: page ? [...page.calls].sort(compareCreditCallsDesc) : [], hasMore: page?.hasMore ?? false };
}

/**
 * 자동 갱신으로 온 첫 장(새 것 50개)을 합친다 — 새 호출은 위에, 「더 보기」로 받아 둔 아래 줄은 그대로.
 * 기간 시작보다 옛 줄은 걷어 낸다(5분 · 1시간은 시간이 지나며 밀린다).
 * 첫 장이 받아 둔 줄과 하나도 겹치지 않고 뒤에 더 있으면 그 사이가 비었을 수 있다 — 그때는 첫 장으로 다시 시작한다.
 * 다시 시작 · 비우기는 세대 +1 — 그 전에 보낸 「더 보기」가 새 첫 장 아래에 옛 줄을 붙이지 않게.
 * 이미 비어 있고 더 없음이면 같은 객체(세대를 올리면 진행 중인 첫 장 「다시 받기」 응답까지 버려진다).
 */
export function mergeCreditCallHead(list: CreditCallList, page: Beds24CreditCallPage): CreditCallList {
  if (page.calls.length === 0) {
    if (list.calls.length === 0 && !list.hasMore) return list;
    return { ...list, generation: list.generation + 1, calls: [], hasMore: false };
  }
  const kept = list.calls.filter((call) => call.at >= page.since);
  const head = [...page.calls].sort(compareCreditCallsDesc);
  const oldestHead = head[head.length - 1];
  const newestKept = kept[0];
  if (page.hasMore && newestKept && compareCreditCallsDesc(oldestHead, newestKept) < 0 && !kept.some((c) => head.some((h) => h.id === c.id))) {
    return { ...list, generation: list.generation + 1, calls: head, hasMore: true };
  }
  const reachesPast = kept.some((call) => compareCreditCallsDesc(call, oldestHead) > 0);
  return { ...list, calls: mergeCreditCalls(kept, head), hasMore: reachesPast ? list.hasMore : page.hasMore };
}

/**
 * 「더 보기」로 온 장을 아래에 잇는다. 보낸 커서가 지금 목록의 맨 끝 줄일 때만 — 그사이 목록이 바뀌었으면(다시 시작 ·
 * 옛 줄 걷어 냄) 그대로 돌려준다(같은 객체). 세대 판정과 겹치는 이중 방어.
 */
export function appendCreditCallPage(
  list: CreditCallList,
  page: Beds24CreditCallPage,
  sentCursor: Beds24CreditCallCursor | null,
): CreditCallList {
  const last = creditCallCursor(list);
  if (!sentCursor || !last || last.id !== sentCursor.id || last.calledAt !== sentCursor.calledAt) return list;
  const calls = mergeCreditCalls(list.calls, page.calls).filter((call) => call.at >= page.since);
  return { ...list, calls, hasMore: page.hasMore };
}

/** 마지막에 실패한 읽기. */
export type CreditCallFailure = "head" | "more" | null;

/**
 * 「다시 받기」가 다시 부를 쪽 — 「더 보기」가 실패했고 아직 아래가 남았으면 「더 보기」, 아니면 첫 장.
 * (첫 장 실패 뒤 상세 갱신이 목록만 채워 hasMore 가 꺼지면 「더 보기」는 아무것도 안 해 띠가 남았다.)
 */
export function creditCallRetryTarget(failed: CreditCallFailure, list: Pick<CreditCallList, "calls" | "hasMore">): "head" | "more" | null {
  if (!failed) return null;
  return failed === "more" && list.hasMore && list.calls.length > 0 ? "more" : "head";
}

/** 「더 보기」 커서 — 지금 가진 가장 옛 줄. */
export function creditCallCursor(list: Pick<CreditCallList, "calls">): Beds24CreditCallCursor | null {
  const last = list.calls[list.calls.length - 1];
  return last ? { calledAt: last.calledAt, id: last.id } : null;
}

/** 보낸 때의 목록(열쇠 · 세대)과 지금 목록이 같을 때만 응답을 쓴다 — 기간 · 거르기를 바꾼 뒤 늦게 온 응답은 버린다. */
export function isCurrentCreditCallResponse(
  sent: Pick<CreditCallList, "key" | "generation">,
  current: Pick<CreditCallList, "key" | "generation">,
): boolean {
  return sent.key === current.key && sent.generation === current.generation;
}

/** 묶는 간격 — 앞 호출과 이만큼 안에 난 같은 호출은 한 줄로. */
export const CREDIT_CALL_GROUP_GAP_MS = 60_000;

/** 실패한 호출(오류 응답 · 크레딧 헤더 없음)은 묶지 않는다 — 성공 줄에 섞이면 실패가 안 보인다. */
export function isFailedCreditCall(call: Pick<Beds24CreditCall, "cost" | "httpStatus">): boolean {
  return call.cost === null || (call.httpStatus ?? 0) >= 400;
}

/** 묶는 기준의 「누가」 — 사람은 사용자 id, 자동 작업은 작업 이름까지. */
export function creditCallActorKey(call: Pick<Beds24CreditCall, "actor">): string {
  const { actor } = call;
  if (actor.kind === "user") return actor.userId ? `user:${actor.userId}` : `user-name:${actor.name}`;
  return `auto:${actor.job ?? ""}`;
}

export type CreditCallGroup = {
  /**
   * 묶음 안 **가장 옛** 호출 id — React key · 스크롤 기준(`data-row`). 자동 갱신은 묶음을 위로 자라게 해서(10초마다 생길 수 있음)
   * 가장 새 id 를 쓰면 그때마다 다시 마운트돼 펼친 버튼의 포커스를 잃는다. 가장 옛 id 는 「더 보기」로 장 경계에서 묶음이
   * 아래로 이어질 때만 바뀐다(누른 사람의 포커스는 「더 보기」에 있다). 펼침 상태는 줄 id 로 따로 들고 있다.
   */
  id: string;
  /** 새 것부터. */
  calls: Beds24CreditCall[];
  /** 크레딧 합(실패 줄은 혼자라 null 이 섞이지 않는다). */
  cost: number | null;
  /** 가장 최근 호출의 남은 값. */
  remaining: number | null;
  at: number;
  firstAt: number;
};

/**
 * 연달아 난 같은 호출을 한 줄로 — 같은 「누가」(`creditCallActorKey`) · 같은 기능 · 바로 앞 줄과 60초 안 · 둘 다 성공.
 * 목록 전체(「더 보기」로 받은 줄 포함)로 매번 다시 계산해서 장 경계에 걸린 묶음도 이어진다.
 */
export function groupCreditCalls(calls: readonly Beds24CreditCall[]): CreditCallGroup[] {
  const groups: Beds24CreditCall[][] = [];
  for (const call of calls) {
    const group = groups[groups.length - 1];
    const prev = group?.[group.length - 1];
    if (
      group &&
      prev &&
      !isFailedCreditCall(prev) &&
      !isFailedCreditCall(call) &&
      creditCallActorKey(prev) === creditCallActorKey(call) &&
      prev.feature === call.feature &&
      Math.abs(prev.at - call.at) <= CREDIT_CALL_GROUP_GAP_MS
    ) {
      group.push(call);
    } else {
      groups.push([call]);
    }
  }
  return groups.map((items) => {
    const newest = items[0];
    const cost = items.every((item) => item.cost !== null) ? items.reduce((sum, item) => sum + (item.cost ?? 0), 0) : null;
    return { id: items[items.length - 1].id, calls: items, cost, remaining: newest.remaining, at: newest.at, firstAt: items[items.length - 1].at };
  });
}

/** 펼침 — 묶음의 줄 id 중 하나라도 펼친 목록에 있으면 펼친 것(묶음이 위 · 아래로 자라도 유지). */
export function isCreditCallGroupOpen(group: CreditCallGroup, openIds: ReadonlySet<string>): boolean {
  return group.calls.some((call) => openIds.has(call.id));
}

export function toggleCreditCallGroup(group: CreditCallGroup, openIds: ReadonlySet<string>): Set<string> {
  const next = new Set(openIds);
  if (isCreditCallGroupOpen(group, openIds)) for (const call of group.calls) next.delete(call.id);
  else for (const call of group.calls) next.add(call.id);
  return next;
}
