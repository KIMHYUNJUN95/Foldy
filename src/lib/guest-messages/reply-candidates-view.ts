/**
 * 과거 답장 후보 화면 — 화면 상태 · 버튼 · 거르기 · 건물 묶기(순수 함수, PC · 모바일 공용). docs/product/49-guest-message-ai-reply-assist.md §9-7
 *
 * 서버 판정은 `src/actions/guest-message-candidates.ts` 가 다시 한다 — 여기서 숨긴 버튼은 보기만 정리하는 것.
 */

import type { CandidateOverview, CandidateRunView, CandidateView } from "@/lib/guest-messages/reply-candidates-server";
import type { Localized } from "@/lib/guest-messages/guest-info-model";

export type CandidateKind = CandidateView["kind"];

/** 목록 거르기 — 남은 것 · 추가함(건물은 넣음) · 뺌. */
export const CANDIDATE_FILTERS = ["pending", "added", "dismissed"] as const;
export type CandidateFilter = (typeof CANDIDATE_FILTERS)[number];

export type CandidateLoad =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; overview: CandidateOverview; kinds: readonly CandidateKind[]; canRun: boolean };

export type CandidateScreen =
  /** 처음 읽는 중 */
  | "loading"
  /** 읽기 실패 — 「다시 시도」 */
  | "error"
  /** 이 종류를 볼 권한이 없음 */
  | "forbidden"
  /** 키가 없어 쓸 수 없음 — 이미 있는 후보도 없을 때만 */
  | "unavailable"
  /** 후보가 아직 하나도 없음(남은 것 · 끝낸 것 모두 0) */
  | "empty"
  /** 남은 것은 다 봤음(끝낸 것은 있음) — 「남은 것」 거르기일 때만 */
  | "done"
  /** 고른 거르기에 해당하는 것이 없음(추가함 · 뺌) */
  | "filter-empty"
  | "list";

/** 화면 상태 하나로 — 어떤 칸을 그릴지 한 곳에서 정한다. */
export function candidateScreen(load: CandidateLoad, kind: CandidateKind, filter: CandidateFilter): CandidateScreen {
  if (load.kind === "loading") return "loading";
  if (load.kind === "error") return "error";
  if (!load.kinds.includes(kind)) return "forbidden";
  const counts = candidateCounts(load.overview, kind);
  const total = counts.pending + counts.added + counts.dismissed;
  if (total === 0) return load.overview.available ? "empty" : "unavailable";
  if (counts[filter] > 0) return "list";
  return filter === "pending" ? "done" : "filter-empty";
}

export type CandidateCounts = Record<CandidateFilter, number>;

export function candidateCounts(overview: CandidateOverview, kind: CandidateKind): CandidateCounts {
  const counts: CandidateCounts = { pending: 0, added: 0, dismissed: 0 };
  for (const item of overview.pending) if (item.kind === kind) counts.pending += 1;
  for (const item of overview.decided) if (item.kind === kind) counts[item.status === "added" ? "added" : "dismissed"] += 1;
  return counts;
}

/** 고른 거르기의 후보 — 남은 것은 많이 물어본 순(서버 순서 그대로), 끝낸 것은 최근 결정 순. */
export function candidatesFor(overview: CandidateOverview, kind: CandidateKind, filter: CandidateFilter): CandidateView[] {
  if (filter === "pending") return overview.pending.filter((item) => item.kind === kind);
  return overview.decided.filter((item) => item.kind === kind && item.status === filter);
}

export type CandidateButtons = {
  /** 문구: 그대로 추가 / 고친 내용으로 추가 · 건물: 넣기 */
  add: boolean;
  /** 문구: 고치기 · 건물: 고쳐서 넣기 */
  edit: boolean;
  /** 빼기 · 아니요 */
  dismiss: boolean;
  /** 뺀 것을 남은 것으로(「뺌」 거르기에서) */
  restore: boolean;
};

const NONE: CandidateButtons = { add: false, edit: false, dismiss: false, restore: false };

/**
 * 후보 하나에 보일 버튼 — 그 종류 권한이 있을 때만. 남은 것: 추가 · 고치기 · 빼기 / 뺌: 되돌리기 / 추가함: 없음
 * (추가한 문구는 정해 둔 문구에서 고치고, 넣은 칸은 건물 정보에서 고친다).
 */
export function candidateButtons(candidate: Pick<CandidateView, "kind" | "status">, kinds: readonly CandidateKind[]): CandidateButtons {
  if (!kinds.includes(candidate.kind)) return NONE;
  if (candidate.status === "pending") return { add: true, edit: true, dismiss: true, restore: false };
  if (candidate.status === "dismissed") return { ...NONE, restore: true };
  return NONE;
}

/** 이만큼 넘게 「찾는 중」이면 멈춘 것으로 본다 — DB 시작 함수(202611180005)가 다음 시작 때 닫는 기준과 같다. */
export const RUN_STALE_MS = 15 * 60 * 1000;

/**
 * 읽을 때 낡은 실행 바로잡기 — 15분 넘게 `running` 이면 `failed · stale` 로 보여 준다(DB 는 다음 시작 때 닫는다).
 * 화면이 「찾는 중」에 영영 묶이지 않고 「다시 찾기」를 다시 누를 수 있다.
 */
export function settleStaleRun(run: CandidateRunView, nowMs: number): CandidateRunView {
  if (run.status !== "running") return run;
  const started = Date.parse(run.startedAt);
  if (!Number.isFinite(started) || nowMs - started <= RUN_STALE_MS) return run;
  return { ...run, status: "failed", errorKey: "stale" };
}

/** 지난 실행이 남긴 한 줄 — 실패 · 한도 · 멈춤만(끝났거나 도는 중이면 없음). */
export function runNote(run: CandidateRunView | null): "failed" | "cap" | "stale" | null {
  if (!run || run.status !== "failed") return null;
  if (run.errorKey === "cap" || run.errorKey === "stale") return run.errorKey;
  // 키 없음(unavailable)은 화면 전체가 「쓸 수 없음」으로 따로 말한다.
  return run.errorKey === "unavailable" ? null : "failed";
}

/** 도는 중 → 끝남 · 실패로 바뀌었는가(목록을 다시 읽고 토스트를 낼 때). */
export function runFinished(before: Pick<CandidateRunView, "status"> | null | undefined, after: CandidateRunView | null | undefined): "done" | "failed" | null {
  if (before?.status !== "running" || !after || after.status === "running") return null;
  return after.status;
}

/** 「다시 찾기」 — 서버가 준 `canRun`(정해 둔 문구 관리) + 키가 있을 때만. 돌고 있으면 버튼 대신 「찾는 중」. */
export function runButton(load: CandidateLoad): "hidden" | "running" | "ready" {
  if (load.kind !== "ready" || !load.canRun || !load.overview.available) return "hidden";
  return load.overview.lastRun?.status === "running" ? "running" : "ready";
}

/** 입구 줄 — 볼 수 있는 남은 후보 수(종류별). 둘 다 0 이면 입구를 숨긴다. */
export function entryCounts(overview: CandidateOverview, kinds: readonly CandidateKind[]) {
  const replies = kinds.includes("saved_reply") ? candidateCounts(overview, "saved_reply").pending : 0;
  const info = kinds.includes("guest_info") ? candidateCounts(overview, "guest_info").pending : 0;
  return { replies, info, total: replies + info };
}

// ── 건물 칸 ──────────────────────────────────────────────────────────────────

export type BuildingGroup = {
  /** 한국어 정식 이름(그릴 때 `useBuildingName`). */
  propertyName: string;
  fields: CandidateView[];
  /** 값이 둘 이상인 칸 수 */
  conflicts: number;
};

/** 건물 칸 후보를 건물마다 — 건물 순서는 처음 나온 순(서버가 많이 물어본 순으로 준다), 칸 순서도 그대로. */
export function groupByBuilding(candidates: readonly CandidateView[]): BuildingGroup[] {
  const groups = new Map<string, BuildingGroup>();
  for (const item of candidates) {
    if (item.kind !== "guest_info" || !item.propertyName) continue;
    let group = groups.get(item.propertyName);
    if (!group) {
      group = { propertyName: item.propertyName, fields: [], conflicts: 0 };
      groups.set(item.propertyName, group);
    }
    group.fields.push(item);
    if (item.options.length > 1) group.conflicts += 1;
  }
  return [...groups.values()];
}

/** 값이 길면(한 줄에 안 들어감) 「고쳐서 넣기」를 앞에 권한다. */
export const LONG_VALUE_CHARS = 40;
export function isLongValue(value: Localized, lang: keyof Localized): boolean {
  return Array.from(value[lang] ?? "").length > LONG_VALUE_CHARS;
}

// ── 문구 고치기 ──────────────────────────────────────────────────────────────

export type PhraseDraft = { title: string; bodies: Localized };

export function draftOf(candidate: CandidateView, locale: string): PhraseDraft {
  const lang = (["ko", "ja", "en"] as const).includes(locale as keyof Localized) ? (locale as keyof Localized) : "en";
  return { title: candidate.title[lang] || candidate.title.ko || candidate.title.en || candidate.title.ja, bodies: { ...candidate.bodies } };
}

/** 고친 칸 — 이름 · 언어별 본문 중 처음 글과 다른 것. */
export function editedParts(candidate: CandidateView, draft: PhraseDraft, locale: string) {
  const start = draftOf(candidate, locale);
  return {
    title: start.title !== draft.title,
    langs: (["ko", "ja", "en"] as const).filter((lang) => start.bodies[lang] !== draft.bodies[lang]),
  };
}

export function isEdited(candidate: CandidateView, draft: PhraseDraft, locale: string): boolean {
  const parts = editedParts(candidate, draft, locale);
  return parts.title || parts.langs.length > 0;
}

/** 결정 뒤 다음에 고를 후보 — 같은 자리(없으면 앞). 목록이 비면 null. */
export function nextAfter(ids: readonly string[], removedId: string): string | null {
  const index = ids.indexOf(removedId);
  const rest = ids.filter((id) => id !== removedId);
  if (rest.length === 0) return null;
  if (index < 0) return rest[0];
  return rest[Math.min(index, rest.length - 1)];
}

// ── 근거 글 ──────────────────────────────────────────────────────────────────

/** 서버가 가린 자리(`[…]`)를 나눠 — 화면은 그 자리를 ••••로 그린다. */
export function splitMasked(text: string): Array<{ masked: boolean; text: string }> {
  const parts: Array<{ masked: boolean; text: string }> = [];
  for (const piece of text.split(/(\[…\])/)) {
    if (!piece) continue;
    parts.push(piece === "[…]" ? { masked: true, text: "••••" } : { masked: false, text: piece });
  }
  return parts;
}

// ── 결정 뒤 화면 목록 고치기 ─────────────────────────────────────────────────

/**
 * 서버가 돌려준 후보 하나로 목록을 고친다 — 두 목록에서 같은 id 를 빼고, 남은 것이면 많이 물어본 순 자리에,
 * 끝낸 것이면 끝낸 것 맨 앞에 넣는다(최근 결정 순). 다시 읽지 않아도 화면이 서버와 같아진다.
 */
export function applyResult(overview: CandidateOverview, candidate: CandidateView): CandidateOverview {
  const pending = overview.pending.filter((item) => item.id !== candidate.id);
  const decided = overview.decided.filter((item) => item.id !== candidate.id);
  if (candidate.status === "pending") {
    const at = pending.findIndex((item) => item.askCount < candidate.askCount);
    pending.splice(at < 0 ? pending.length : at, 0, candidate);
  } else {
    decided.unshift(candidate);
  }
  return { ...overview, pending, decided };
}

// ── 결정 줄 · 모두 넣기(화면 훅이 쓰는 순수 조각 — 테스트로 묶는다) ─────────────

/**
 * 결정 줄 — 같은 후보에 대한 결정이 돌고 있으면 두 번째는 받지 않고(빠른 두 번 누름 → 두 번 추가 막기),
 * 보내는 것은 한 줄로 세운다(되돌리기가 아직 끝나지 않은 넣기보다 먼저 닿지 않게). 실패해도 줄은 이어진다.
 */
export function createDecisionQueue<R>(fallback: R) {
  const locks = new Set<string>();
  let tail: Promise<unknown> = Promise.resolve();
  return {
    /** 잠글 수 있으면 잠그고 true — 하나라도 이미 잠겨 있으면 false(아무것도 잠그지 않음). */
    lock(ids: readonly string[]): boolean {
      if (ids.some((id) => locks.has(id))) return false;
      for (const id of ids) locks.add(id);
      return true;
    },
    unlock(ids: readonly string[]) {
      for (const id of ids) locks.delete(id);
    },
    busy(): boolean {
      return locks.size > 0;
    },
    enqueue(call: () => Promise<R>): Promise<R> {
      const job = tail.then(() => call()).catch(() => fallback);
      tail = job;
      return job;
    },
  };
}

/** 서버가 확인했을 때만(true) 다음 일 — 다음 후보로 넘기기 · 고친 글 비우기. 실패면 그대로 둔다. */
export function whenConfirmed(act: Promise<boolean> | boolean | void, onOk: () => void): Promise<void> {
  return Promise.resolve(act).then((ok) => {
    if (ok === true) onOk();
  });
}

/**
 * 자리 표지 — 사용자가 고른 후보를 바꿀 때(목록 누름 · 뒤로 · 다른 후보) 한 칸씩 올린다. 결정을 누를 때 값을 잡아 두고,
 * 서버가 확인했을 때 값이 그대로일 때만 다음 후보로 옮긴다 — 기다리는 사이 다른 곳으로 갔으면 목록만 고치고 자리는 그대로.
 */
export function createNavStamp() {
  let value = 0;
  return {
    bump() {
      value += 1;
    },
    take(): number {
      return value;
    },
    still(at: number): boolean {
      return at === value;
    },
  };
}

/** `whenConfirmed` + 자리 표지 — 확인됐고 그 사이 자리를 옮기지 않았을 때만 `onOk`. */
export function whenConfirmedHere(
  act: Promise<boolean> | boolean | void,
  nav: { still(at: number): boolean },
  at: number,
  onOk: () => void,
): Promise<void> {
  return whenConfirmed(act, () => {
    if (nav.still(at)) onOk();
  });
}

/** 모두 넣기 — 「고쳐서 넣기를 권해요」 칸(긴 글)은 빼고 넘긴다. */
export function splitPutAll<T>(fields: readonly T[], valueOf: (field: T) => Localized, lang: keyof Localized) {
  const items: Array<{ candidate: T; value: Localized }> = [];
  let skippedLong = 0;
  for (const field of fields) {
    const value = valueOf(field);
    if (isLongValue(value, lang)) skippedLong += 1;
    else items.push({ candidate: field, value });
  }
  return { items, skippedLong };
}

/**
 * 모두 넣기 결과를 토스트 하나로 — 성공 토스트가 실패를 덮지 않게 합친다.
 * 이미 채워진 칸(conflict)은 실패가 아니라 「건너뜀」 — 「다시 시도」 문구는 진짜 실패에만 쓴다.
 * 모두 이미 채워져 있으면 한 칸 막힘과 같은 문구(한 칸이면 그 문구 그대로 · 여러 칸이면 수를 넣은 문구).
 */
export function putAllOutcome(put: number, failed: number, skippedLong: number, conflicts = 0) {
  const key =
    put > 0
      ? failed > 0
        ? ("candToastPutAllPartial" as const)
        : ("candToastPutAll" as const)
      : failed === 0 && conflicts > 0
        ? conflicts === 1
          ? ("candErrConflict" as const)
          : ("candToastPutAllConflicts" as const)
        : ("candErrFailed" as const);
  const haptic =
    put === 0 && failed > 0 ? ("error" as const) : put === 0 || failed > 0 || conflicts > 0 ? ("warning" as const) : ("success" as const);
  // 이미 채워진 칸 꼬리 — 본문이 이미 그 말을 할 때(모두 이미 채워짐)는 붙이지 않는다.
  const conflictLeft = conflicts > 0 && (put > 0 || failed > 0);
  return { key, haptic, conflictLeft, longLeft: skippedLong > 0, undo: put > 0 };
}
