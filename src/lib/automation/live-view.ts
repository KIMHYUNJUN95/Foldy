/**
 * 자동화 관제실 실시간 — 언제 다시 읽나 · 어느 응답이 이기나 · 편집 중이면 무엇을 덮지 않나(2026-11-18).
 *
 * 도메인 계약: docs/product/36-automation-control.md 「실시간(2026-11-18)」.
 * 화면 쪽 훅(`use-automation-live.ts`)과 설정 칸(PC · 모바일)은 판정을 여기서만 가져다 쓴다.
 */
import { mergeFields } from "@/lib/automation/save-merge";

/**
 * 조용한 갱신 간격. 정시 발송은 1분 틱이 보내므로 그 4분의 1이면 「보냄」이 틱 뒤 15초 안에 보이고,
 * 한 번 읽기가 우리 DB 7번(실행 기록 300줄 포함)이라 열린 탭 하나가 1분에 4번이면 충분히 가볍다.
 */
export const AUTOMATION_POLL_MS = 15_000;
/** 탭 · 창으로 돌아왔을 때 이 안에 받은 적 있으면 건너뛴다. */
export const AUTOMATION_MIN_GAP_MS = 5_000;

export function liveRefreshDue(input: { visible: boolean; inFlight: boolean; lastFetchedAt: number; now: number; minGapMs: number }): boolean {
  if (!input.visible || input.inFlight) return false;
  return input.now - input.lastFetchedAt >= input.minGapMs;
}

/** 폴링으로 받은 값 — 어느 서버 그림(props)을 바탕으로 보낸 요청인지 같이 든다. */
export type LivePolled<P, D> = { basedOn: P; data: D };

export type LivePollVerdict = "stale" | "superseded" | "same" | "apply";

/**
 * 폴링 응답 판정.
 * - `stale`: 더 나중에 보낸 요청의 응답을 이미 반영했다(순서 뒤바뀜).
 * - `superseded`: 요청을 보낸 뒤 서버 그림이 새로 왔다(저장 뒤 revalidate · refresh) — 그쪽이 더 나중 값이다.
 * - `same`: 지금 보이는 값과 같다 — 순번만 올리고 다시 그리지 않는다.
 * - `apply`: 반영.
 */
export function judgeLivePoll<P extends object, D extends object>(input: {
  token: number;
  appliedToken: number;
  basedOn: P;
  currentProps: P;
  next: D;
  /** 지금 보이는 값 — 응답에 있는 칸만 비교한다(크레딧 등 응답에 없는 칸은 안 본다). */
  shown: P;
}): LivePollVerdict {
  if (input.token <= input.appliedToken) return "stale";
  if (input.basedOn !== input.currentProps) return "superseded";
  const shown = input.shown as Record<string, unknown>;
  const sameKeys = Object.fromEntries(Object.keys(input.next).map((key) => [key, shown[key]]));
  return JSON.stringify(input.next) === JSON.stringify(sameKeys) ? "same" : "apply";
}

/** 보일 값 — 폴링 값은 지금 서버 그림을 바탕으로 받은 것일 때만 덮는다. 아니면 서버 그림(더 나중 값)이 이긴다. */
export function pickLiveData<P extends object, D extends object>(props: P, polled: LivePolled<P, D> | null): P {
  if (!polled || polled.basedOn !== props) return props;
  return { ...props, ...polled.data };
}

/**
 * 설정 초안 — 서버 값이 바뀌어 들어올 때의 규칙. 「저장 전 / 뒤」는 내용이 아니라 **출처**(서버 버전 =
 * `automation_jobs.updated_at`)로 가른다 — 같은 내용이 저장 전에도 뒤에도 있을 수 있어서다(2026-11-19).
 * - `original` · `originalVersion`: 지금 화면의 서버 값(객체)과 그 버전. 같은 객체면 아무것도 하지 않는다.
 * - `base`: 초안이 맞춰 본 기준(직렬화) — 「바뀜」 · 칸 단위 합치기의 「손댐」은 이것과 비교한다. 저장 성공 뒤엔 저장한 값.
 * - `holding`: 저장을 보낸 뒤 결과를 기다리는 중 — 들어온 그림은 맞추지 않고 원본으로만 기억한다(보낸 값과 화면이 같게).
 * - `floor`: 마지막으로 성공한 내 저장의 버전. 이보다 옛 그림은 저장 전 값이라 버린다 — 그 앞의 다른 사람 변경은
 *   서버가 저장 때 합쳐(`mergeAutomationSave`) 저장 값(`settle` 의 `saved`)에 이미 들어 있다.
 */
export type DraftSync<T> = {
  draft: T;
  original: T;
  originalVersion: number | null;
  base: string;
  holding: boolean;
  floor: number | null;
};

/** 서버 시각 문자열 → 비교용 수. DB(`+00:00`)와 `toISOString()`(`Z`)이 같은 순간이면 같은 수. 없거나 못 읽으면 null. */
export function draftVersionOf(updatedAt: string | null | undefined): number | null {
  if (!updatedAt) return null;
  const value = Date.parse(updatedAt);
  return Number.isNaN(value) ? null : value;
}

export function draftSyncOf<T>(original: T, version: number | null): DraftSync<T> {
  return { base: JSON.stringify(original), draft: original, floor: null, holding: false, original, originalVersion: version };
}

/** 칸 단위 3방향 합치기 — 서버 저장과 같은 규칙 하나(`mergeFields`, `src/lib/automation/save-merge.ts`). */
export const mergeDraftFields = mergeFields;

/** 내 마지막 저장보다 옛 그림인가 — 버전을 모르는 그림도 저장 뒤엔 옛 것으로 본다. */
const beforeMySave = (floor: number | null, version: number | null) => floor !== null && (version === null || version < floor);

/**
 * 서버 값 하나를 초안에 맞춘다 — `reconcileDraft` · `settleDraft` · `releaseDraft` 가 함께 쓰는 유일한 판정.
 * 1. 저장 중이거나(`holding`) 내 저장보다 옛 그림이면 원본만 기억한다 — 저장한 값 · 새 편집을 되돌리지 않는다.
 * 2. 기준과 같은 내용이면 원본만 바꾼다.
 * 3. 아니면 **손댄 칸만** 초안으로 남기고 나머지는 새 서버 값(`mergeDraftFields`, 기준 = `base`). 손댄 칸을 서버도 바꿨으면
 *    초안 값이 남고 기준만 새 서버 값 — 「바뀐 곳」에 그대로 보이고, 저장하면 초안 값이 들어간다.
 */
function alignDraft<T>(state: DraftSync<T>, next: T, version: number | null): DraftSync<T> {
  if (state.holding || beforeMySave(state.floor, version)) return { ...state, original: next, originalVersion: version };
  const nextBase = JSON.stringify(next);
  if (nextBase === state.base) return { ...state, original: next, originalVersion: version };
  const draft = mergeDraftFields(state.draft, JSON.parse(state.base) as T, next);
  return { ...state, base: nextBase, draft: JSON.stringify(draft) === nextBase ? next : draft, original: next, originalVersion: version };
}

/** 새 서버 값(과 그 버전)이 들어왔을 때. 같은 객체면 같은 상태를 돌려준다(다시 그리기 없음). */
export function reconcileDraft<T>(state: DraftSync<T>, nextOriginal: T, version: number | null): DraftSync<T> {
  if (nextOriginal === state.original) return state;
  return alignDraft(state, nextOriginal, version);
}

/** 사용자가 고쳤다(저장 중에도 — 새 편집은 저장 성공 뒤 「바뀜」으로 남는다). */
export function editDraft<T>(state: DraftSync<T>, update: (current: T) => T): DraftSync<T> {
  return { ...state, draft: update(state.draft) };
}

/**
 * 저장을 보낼 때의 표 — 보낸 초안과 그때의 기준(둘 다 직렬화). 서버는 기준과 같은 칸을 「안 건드림」으로 보고
 * 저장 때 DB 값을 둔다(`mergeAutomationSave`) — 화면의 「바뀜」과 서버의 「바꾼 칸」이 같은 기준을 쓴다.
 */
export type DraftSubmit = { base: string; draft: string };

export function draftSubmitOf<T>(state: DraftSync<T>): DraftSubmit {
  return { base: state.base, draft: JSON.stringify(state.draft) };
}

/** 저장을 보냈다 — 결과가 올 때까지 들어오는 그림은 미뤄 둔다. */
export function holdDraft<T>(state: DraftSync<T>): DraftSync<T> {
  return state.holding ? state : { ...state, holding: true };
}

/**
 * 저장 성공 — `savedVersion` 은 서버가 이 저장으로 쓴 버전, `saved` 는 실제로 쓴 값(다른 사람이 바꾼 칸이 섞인 합친 값).
 * 기준을 저장한 값으로 옮기고(「바뀜」 · 저장 단추가 바로 꺼짐), 초안은 보낸 뒤 또 고친 칸만 남기고 나머지를 저장 값으로
 * 바꾼다. 바닥을 그 버전으로 올린 뒤 미뤄 둔 그림에 맞춘다 — 저장 전 그림이면 버리고, 저장 뒤 그림이 와 있으면 받는다.
 * `saved` 가 없으면 보낸 초안을 저장 값으로 본다.
 */
export function settleDraft<T>(state: DraftSync<T>, submit: DraftSubmit, savedVersion: number | null, saved?: T): DraftSync<T> {
  const floor = savedVersion === null ? state.floor : Math.max(state.floor ?? savedVersion, savedVersion);
  if (saved === undefined) return alignDraft({ ...state, base: submit.draft, floor, holding: false }, state.original, state.originalVersion);
  const base = JSON.stringify(saved);
  const merged = mergeDraftFields(state.draft, JSON.parse(submit.draft) as T, saved);
  const draft = JSON.stringify(merged) === base ? saved : merged;
  return alignDraft({ ...state, base, draft, floor, holding: false }, state.original, state.originalVersion);
}

/** 저장 실패 · 예외 — 미뤄 둔 그림을 평소 규칙으로 맞춘다(초안은 남김). 다음 폴링도 막지 않는다. */
export function releaseDraft<T>(state: DraftSync<T>): DraftSync<T> {
  if (!state.holding) return state;
  return alignDraft({ ...state, holding: false }, state.original, state.originalVersion);
}
