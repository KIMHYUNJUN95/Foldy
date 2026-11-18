import { tokyoDateOf, tokyoDayStart, ymdShift } from "@/lib/tokyo-date";
import {
  BEDS24_CREDIT_FEATURES,
  BEDS24_CREDIT_LIMIT,
  BEDS24_CREDIT_STOP_BELOW,
  BEDS24_CREDIT_WARN_BELOW,
  type Beds24CreditActorUsage,
  type Beds24CreditDetail,
  type Beds24CreditFeature,
  type Beds24CreditFeatureUsage,
  type Beds24CreditRange,
  type Beds24CreditSnapshot,
  type Beds24CreditWindowBar,
} from "@/lib/beds24/credit-usage-types";

/**
 * Beds24 크레딧 사용 기록 — 계산(순수 함수만). 서버 읽기는 `credit-usage-read.ts`.
 * 도메인 계약: docs/engineering/01-beds24-integration.md → 「크레딧 사용 기록」.
 *
 * - 한 창(5분)에서 쓴 양 = 한도 − 그 창에서 본 가장 낮은 남은 값. 창이 시작될 때는 항상 가득이라서다.
 * - Foldy 밖 = 그 양 − 우리가 기록한 비용(0 아래로는 안 간다). 다른 조직 · Beds24 화면 · 다른 앱 몫이다.
 * - 헤더가 없는 호출만 있는 창(남은 값 모름)은 우리 비용만 센다(밖은 0).
 * - 토큰(credential)이 늘어나면 창은 토큰마다 따로다 — 그래서 묶기 함수가 키를 받는다.
 */

const WINDOW_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BAR_COUNT = 12;

/** `beds24_credit_usage_windows` 한 줄(시각은 epoch ms). */
export type Beds24CreditWindowRow = {
  credentialKey: string;
  windowResetsAt: number | null;
  windowMinRemaining: number | null;
  windowPausedAt: number | null;
  actorKind: "user" | "auto";
  actorUserId: string | null;
  actorName: string | null;
  actorJob: string | null;
  feature: Beds24CreditFeature;
  calls: number;
  cost: number;
  rateLimited: number;
  firstAt: number;
  lastAt: number;
};

export type Beds24CreditWindow = {
  /** null = 헤더가 하나도 없어 창을 모르는 줄 묶음(줄마다 따로). */
  resetsAt: number | null;
  minRemaining: number | null;
  pausedAt: number | null;
  firstAt: number;
  rows: Beds24CreditWindowRow[];
  /** 우리가 기록한 비용 합. */
  ours: number;
  /** Foldy 밖. */
  outside: number;
  /** 이 창 합(밖 포함). */
  used: number;
};

const toMs = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};
const toInt = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const isFeature = (value: unknown): value is Beds24CreditFeature =>
  typeof value === "string" && (BEDS24_CREDIT_FEATURES as readonly string[]).includes(value);

/** RPC 응답(문자열 시각) → 계산용 줄. 모르는 기능 이름은 `other`. */
export function parseBeds24CreditWindowRows(raw: readonly Record<string, unknown>[] | null): Beds24CreditWindowRow[] {
  return (raw ?? []).map((row) => ({
    credentialKey: typeof row.credential_key === "string" ? row.credential_key : "main",
    windowResetsAt: toMs(row.window_resets_at),
    windowMinRemaining: typeof row.window_min_remaining === "number" ? row.window_min_remaining : null,
    windowPausedAt: toMs(row.window_paused_at),
    actorKind: row.actor_kind === "user" ? "user" : "auto",
    actorUserId: typeof row.actor_user_id === "string" ? row.actor_user_id : null,
    actorName: typeof row.actor_name === "string" ? row.actor_name : null,
    actorJob: typeof row.actor_job === "string" ? row.actor_job : null,
    feature: isFeature(row.feature) ? row.feature : "other",
    calls: toInt(row.calls),
    cost: toInt(row.cost),
    rateLimited: toInt(row.rate_limited),
    firstAt: toMs(row.first_at) ?? 0,
    lastAt: toMs(row.last_at) ?? 0,
  }));
}

/** 한 토큰의 줄들을 창으로 묶는다(옛 것부터). */
export function groupBeds24CreditWindows(
  rows: readonly Beds24CreditWindowRow[],
  credentialKey: string,
  limit: number = BEDS24_CREDIT_LIMIT,
): Beds24CreditWindow[] {
  const byWindow = new Map<number, Beds24CreditWindowRow[]>();
  const loose: Beds24CreditWindowRow[] = [];
  for (const row of rows) {
    if (row.credentialKey !== credentialKey) continue;
    if (row.windowResetsAt === null) loose.push(row);
    else byWindow.set(row.windowResetsAt, [...(byWindow.get(row.windowResetsAt) ?? []), row]);
  }
  const windows: Beds24CreditWindow[] = [];
  for (const [resetsAt, list] of byWindow) {
    const ours = list.reduce((sum, row) => sum + row.cost, 0);
    const minRemaining = list.reduce<number | null>(
      (min, row) => (row.windowMinRemaining === null ? min : min === null ? row.windowMinRemaining : Math.min(min, row.windowMinRemaining)),
      null,
    );
    const pausedAt = list.reduce<number | null>(
      (min, row) => (row.windowPausedAt === null ? min : min === null ? row.windowPausedAt : Math.min(min, row.windowPausedAt)),
      null,
    );
    const outside = minRemaining === null ? 0 : Math.max(0, limit - minRemaining - ours);
    windows.push({
      resetsAt,
      minRemaining,
      pausedAt,
      firstAt: Math.min(...list.map((row) => row.firstAt)),
      rows: list,
      ours,
      outside,
      used: ours + outside,
    });
  }
  // 헤더 없는 줄의 windowPausedAt 은 그런 줄 전체가 한 묶음이라(SQL 의 창 = null) 쓰지 않고, 그 줄의 429 만 본다.
  for (const row of loose) {
    windows.push({
      resetsAt: null,
      minRemaining: null,
      pausedAt: row.rateLimited > 0 ? row.firstAt : null,
      firstAt: row.firstAt,
      rows: [row],
      ours: row.cost,
      outside: 0,
      used: row.cost,
    });
  }
  return windows.sort((a, b) => (a.resetsAt ?? a.firstAt + WINDOW_MS) - (b.resetsAt ?? b.firstAt + WINDOW_MS));
}

/** `from` 뒤에 끝나는 창(헤더 없는 줄은 `from` 뒤에 부른 것). SQL 의 범위 규칙과 같다. */
export function windowsSince(windows: readonly Beds24CreditWindow[], fromMs: number): Beds24CreditWindow[] {
  return windows.filter((w) => (w.resetsAt !== null ? w.resetsAt > fromMs : w.firstAt >= fromMs));
}

/** 지금 창 — 아직 리셋되지 않은 창. 없으면 null(지금은 가득). */
export function currentBeds24CreditWindow(windows: readonly Beds24CreditWindow[], nowMs: number): Beds24CreditWindow | null {
  const open = windows.filter((w) => w.resetsAt !== null && w.resetsAt > nowMs);
  return open.length > 0 ? open[open.length - 1] : null;
}

function topFeatures(costs: Map<Beds24CreditFeature, number>): Beds24CreditFeature[] {
  return [...costs.entries()]
    .filter(([, credits]) => credits > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([feature]) => feature);
}

/** 누가 — 사람별 · 자동 한 줄 · Foldy 밖(있을 때만). 많이 쓴 순, 0 은 뺀다. */
export function summarizeBeds24CreditActors(windows: readonly Beds24CreditWindow[]): Beds24CreditActorUsage[] {
  const actors = new Map<string, { kind: "user" | "auto"; name: string; credits: number; features: Map<Beds24CreditFeature, number> }>();
  let outside = 0;
  for (const window of windows) {
    outside += window.outside;
    for (const row of window.rows) {
      const key = row.actorKind === "user" && row.actorUserId ? `user:${row.actorUserId}` : "auto";
      const entry = actors.get(key) ?? {
        kind: key === "auto" ? ("auto" as const) : ("user" as const),
        name: "",
        credits: 0,
        features: new Map<Beds24CreditFeature, number>(),
      };
      entry.credits += row.cost;
      if (entry.kind === "user" && !entry.name && row.actorName) entry.name = row.actorName;
      entry.features.set(row.feature, (entry.features.get(row.feature) ?? 0) + row.cost);
      actors.set(key, entry);
    }
  }
  const list: Beds24CreditActorUsage[] = [...actors.entries()]
    .filter(([, entry]) => entry.credits > 0)
    .map(([key, entry]) => ({
      key,
      kind: entry.kind,
      name: entry.name,
      topFeatures: topFeatures(entry.features),
      credits: entry.credits,
    }));
  if (outside > 0) list.push({ key: "outside", kind: "outside", name: "", topFeatures: [], credits: outside });
  return list.sort((a, b) => b.credits - a.credits);
}

/** 어디에 — 우리 기록만(밖은 어디에 썼는지 모른다). 많이 쓴 순, 0 은 뺀다. */
export function summarizeBeds24CreditFeatures(windows: readonly Beds24CreditWindow[]): Beds24CreditFeatureUsage[] {
  const costs = new Map<Beds24CreditFeature, number>();
  for (const window of windows) {
    for (const row of window.rows) costs.set(row.feature, (costs.get(row.feature) ?? 0) + row.cost);
  }
  return [...costs.entries()]
    .filter(([, credits]) => credits > 0)
    .map(([feature, credits]) => ({ feature, credits }))
    .sort((a, b) => b.credits - a.credits);
}

export function sumBeds24CreditUsed(windows: readonly Beds24CreditWindow[]): number {
  return windows.reduce((sum, w) => sum + w.used, 0);
}

function levelOf(window: Beds24CreditWindow, limit: number): "ok" | "warn" | "stop" {
  if (window.pausedAt !== null || window.rows.some((row) => row.rateLimited > 0)) return "stop";
  const remaining = window.minRemaining ?? limit - window.used;
  if (remaining < BEDS24_CREDIT_STOP_BELOW) return "stop";
  if (remaining < BEDS24_CREDIT_WARN_BELOW) return "warn";
  return "ok";
}

/**
 * 최근 1시간, 5분 칸 12개(옛 것부터, 마지막 칸 = 지금). Beds24 창은 시계에 맞지 않아 칸의 기준을 **지금 창의 시작**
 * (리셋 − 5분)으로 잡고 5분씩 거슬러 간다 — 지금 창이 늘 마지막 칸이다. 지금 창이 없으면 시계 5분 칸.
 * 창은 **시작한 칸**에 넣는다. 이웃 창의 시작은 5분 넘게 떨어져 있어 한 칸에 창은 많아야 하나다.
 * 헤더 없는 줄(창 밖)이 같은 칸에 들 수 있어 칸 값은 한도에서 자른다.
 */
export function buildBeds24CreditBars(
  windows: readonly Beds24CreditWindow[],
  nowMs: number,
  limit: number = BEDS24_CREDIT_LIMIT,
): Beds24CreditWindowBar[] {
  const current = currentBeds24CreditWindow(windows, nowMs);
  const lastStart =
    current?.resetsAt != null ? current.resetsAt - WINDOW_MS : Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
  const firstStart = lastStart - (BAR_COUNT - 1) * WINDOW_MS;
  const bars: Beds24CreditWindowBar[] = Array.from({ length: BAR_COUNT }, (_, i) => ({
    startsAt: firstStart + i * WINDOW_MS,
    used: 0,
    level: "ok",
  }));
  const rank = { ok: 0, warn: 1, stop: 2 } as const;
  for (const window of windows) {
    const startedAt = window.resetsAt !== null ? window.resetsAt - WINDOW_MS : window.firstAt;
    const index = Math.floor((startedAt - firstStart) / WINDOW_MS);
    if (index < 0 || startedAt > nowMs) continue;
    const bar = bars[Math.min(BAR_COUNT - 1, index)];
    bar.used = Math.min(limit, bar.used + window.used);
    const level = window.resetsAt !== null || window.pausedAt !== null ? levelOf(window, limit) : "ok";
    if (rank[level] > rank[bar.level]) bar.level = level;
  }
  return bars;
}

/** 쉰 때 — 429 를 받았거나 10 아래로 내려간 창. 쉰 길이 ≈ 그때부터 리셋까지. */
export function summarizeBeds24CreditPauses(windows: readonly Beds24CreditWindow[]): {
  count: number;
  lastAt: number | null;
  lastSeconds: number | null;
} {
  const paused = windows.filter((w) => w.pausedAt !== null);
  if (paused.length === 0) return { count: 0, lastAt: null, lastSeconds: null };
  const last = paused.reduce((a, b) => ((b.pausedAt ?? 0) > (a.pausedAt ?? 0) ? b : a));
  return {
    count: paused.length,
    lastAt: last.pausedAt,
    // 헤더 없는 429 는 리셋 시각을 몰라 길이도 모른다.
    lastSeconds: last.resetsAt === null ? null : Math.max(0, Math.round((last.resetsAt - (last.pausedAt ?? 0)) / 1000)),
  };
}

/** `account_credit` 줄(만료 여부와 상관없이 원본) — 서버가 읽어 넘긴다. */
export type Beds24AccountCreditRaw = {
  expiresAt: number | null;
  remaining: number | null;
  resetsAt: number | null;
  limit: number | null;
  recordedAt: number | null;
};

/**
 * 게이지 값. 리셋 시각이 지났으면 가득(한도)으로 본다 — 그 뒤로 아무도 안 불렀다는 뜻이다.
 * 쿨다운이 걸려 있으면 남은 값과 상관없이 「쉬는 중」.
 */
export function buildBeds24CreditSnapshot(
  raw: Beds24AccountCreditRaw | null,
  cooldownUntil: number | null,
  nowMs: number,
): Beds24CreditSnapshot {
  const limit = raw?.limit ?? BEDS24_CREDIT_LIMIT;
  const pausedUntil = cooldownUntil !== null && cooldownUntil > nowMs ? cooldownUntil : null;
  const resetsAtRaw = raw ? (raw.resetsAt ?? raw.expiresAt) : null;
  let remaining: number | null = null;
  let resetsAt: number | null = null;
  if (raw && resetsAtRaw !== null && resetsAtRaw <= nowMs) {
    remaining = limit;
  } else if (raw && raw.remaining !== null) {
    remaining = raw.remaining;
    resetsAt = resetsAtRaw;
  }
  const state: Beds24CreditSnapshot["state"] =
    pausedUntil !== null
      ? "stop"
      : remaining === null
        ? "unknown"
        : remaining < BEDS24_CREDIT_STOP_BELOW
          ? "stop"
          : remaining < BEDS24_CREDIT_WARN_BELOW
            ? "warn"
            : "ok";
  return { state, remaining, limit, resetsAt, pausedUntil, recordedAt: raw?.recordedAt ?? null };
}

/**
 * 지금 창 기록이 없는데 계정 값(`account_credit`)이 아직 유효하면, 그 사이 누군가(다른 조직 · Foldy 밖)가 쓴 것이라
 * `한도 − 남은 값` 을 「Foldy 밖」으로 둔 창 하나를 더한다. 요약 · 상세 지금 막대 · 「5분」 범위가 이것 하나를 같이 쓴다.
 */
function withAccountCurrentWindow(
  windows: readonly Beds24CreditWindow[],
  snapshot: Beds24CreditSnapshot,
  nowMs: number,
): Beds24CreditWindow[] {
  if (currentBeds24CreditWindow(windows, nowMs)) return [...windows];
  if (snapshot.remaining === null || snapshot.resetsAt === null || snapshot.resetsAt <= nowMs) return [...windows];
  const outside = Math.max(0, snapshot.limit - snapshot.remaining);
  const account: Beds24CreditWindow = {
    resetsAt: snapshot.resetsAt,
    minRemaining: snapshot.remaining,
    pausedAt: null,
    firstAt: snapshot.resetsAt - WINDOW_MS,
    rows: [],
    ours: 0,
    outside,
    used: outside,
  };
  return [...windows, account].sort((a, b) => (a.resetsAt ?? a.firstAt + WINDOW_MS) - (b.resetsAt ?? b.firstAt + WINDOW_MS));
}

/** 요약(게이지 팝오버)의 지금 창 — 상세 「5분」 범위와 같은 창들. */
export function summarizeBeds24CreditCurrent(
  windows: readonly Beds24CreditWindow[],
  snapshot: Beds24CreditSnapshot,
  nowMs: number,
): { windowUsed: number; actors: Beds24CreditActorUsage[] } {
  const inNow = beds24CreditWindowsInRange(withAccountCurrentWindow(windows, snapshot, nowMs), "5m", nowMs);
  return { windowUsed: sumBeds24CreditUsed(inNow), actors: summarizeBeds24CreditActors(inNow) };
}

/** 상세의 계산 부분. 지금 막대 · 「5분」은 계정 값까지, 지난 막대 · 1시간 · 오늘 · 7일은 기록만. */
export function buildBeds24CreditDetailView(
  windows: readonly Beds24CreditWindow[],
  snapshot: Beds24CreditSnapshot,
  range: Beds24CreditRange,
  nowMs: number,
): Pick<Beds24CreditDetail, "total" | "bars" | "actors" | "features" | "pausesToday"> {
  const withNow = withAccountCurrentWindow(windows, snapshot, nowMs);
  const inRange = beds24CreditWindowsInRange(range === "5m" ? withNow : windows, range, nowMs);
  return {
    total: sumBeds24CreditUsed(inRange),
    bars: buildBeds24CreditBars(withNow, nowMs),
    actors: summarizeBeds24CreditActors(inRange),
    features: summarizeBeds24CreditFeatures(inRange),
    pausesToday: summarizeBeds24CreditPauses(windowsSince(windows, tokyoTodayStartMs(nowMs))),
  };
}

/** 도쿄 오늘 0시(epoch ms). */
export function tokyoTodayStartMs(nowMs: number): number {
  const today = tokyoDateOf(new Date(nowMs).toISOString()) as string;
  return Date.parse(tokyoDayStart(today));
}

/** 기간 시작(epoch ms). 「오늘」 · 「7일」은 도쿄 날짜 경계(7일 = 오늘 포함 7일). */
export function beds24CreditRangeStart(range: Beds24CreditRange, nowMs: number): number {
  if (range === "5m") return nowMs - WINDOW_MS;
  if (range === "1h") return nowMs - HOUR_MS;
  const today = tokyoDateOf(new Date(nowMs).toISOString()) as string;
  return Date.parse(tokyoDayStart(range === "today" ? today : ymdShift(today, -6)));
}

/** 기간에 든 창. 「5분」은 지금 창 하나(+ 헤더 없는 최근 5분 줄). */
export function beds24CreditWindowsInRange(
  windows: readonly Beds24CreditWindow[],
  range: Beds24CreditRange,
  nowMs: number,
): Beds24CreditWindow[] {
  if (range === "5m") {
    const current = currentBeds24CreditWindow(windows, nowMs);
    return windows.filter((w) => w === current || (w.resetsAt === null && w.firstAt >= nowMs - WINDOW_MS));
  }
  return windowsSince(windows, beds24CreditRangeStart(range, nowMs));
}

/** 상세를 한 번에 읽을 시작점 — 기간 · 최근 1시간(막대) · 오늘(쉰 때) 중 가장 이른 것. */
export function beds24CreditDetailFetchStart(range: Beds24CreditRange, nowMs: number): number {
  const barsStart = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS - BAR_COUNT * WINDOW_MS;
  return Math.min(beds24CreditRangeStart(range, nowMs), barsStart, tokyoTodayStartMs(nowMs));
}
