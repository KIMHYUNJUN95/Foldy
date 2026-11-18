/**
 * AI 답장 도우미 — 화면 쪽 순수 계산(테스트 대상). docs/product/49-guest-message-ai-reply-assist.md §8-5
 */

import { ASSIST_PLACEHOLDER_LABELS } from "@/lib/guest-messages/ai-assist-model";
import type { AssistCheck, AssistDraftResult } from "@/lib/guest-messages/ai-assist-types";

export type AssistDraft = {
  draftId: string;
  checks: AssistCheck[];
  needsHuman: boolean;
  reason: string | null;
  placeholders: string[];
  /** 「틀렸어요」 흐름 — 이유 고르는 중 · 기록함 · 기록 뒤 그대로 둠. */
  wrong: "none" | "asking" | "noted" | "kept";
  /** 「다시 만들기」가 안 됐을 때 — 앞 초안을 그대로 두고 줄에 이유만 보인다. */
  redo?: "fail" | "cap" | "direct";
};

export type AssistState =
  | { kind: "idle" }
  | { kind: "loading" }
  | ({ kind: "draft" } & AssistDraft)
  | { kind: "direct"; reason: string | null }
  | { kind: "cap" }
  | { kind: "fail" };

/** 세 언어 자리 표시 전부 — 초안 상태와 상관없이 글에 남아 있으면 보내기를 막는다(서버와 같은 목록). */
export const ALL_ASSIST_PLACEHOLDERS: readonly string[] = Array.from(
  new Set(Object.values(ASSIST_PLACEHOLDER_LABELS).flatMap((labels) => Object.values(labels))),
);

/** 지금 글에 남아 보내기를 막는 자리 표시 — 초안이 준 것 + 세 언어 전부. */
export function blockingSlots(text: string, draftPlaceholders: readonly string[] = []): string[] {
  return placeholdersLeft(text, Array.from(new Set([...draftPlaceholders, ...ALL_ASSIST_PLACEHOLDERS])));
}

export type RedoOutcome = {
  state: AssistState;
  /** 칸에 새로 넣을 초안 글(없으면 칸을 건드리지 않는다). */
  text: string | null;
  /** 서버에 버림으로 남길 앞 초안 id. */
  discardId: string | null;
  /** 이 메시지에는 답할 질문이 없다 — 초안 버튼만 숨긴다. */
  noQuestion: boolean;
};

/**
 * 초안 요청 결과 → 다음 상태. 앞 초안(`prev`)이 있으면 실패 · 한도 · 직접 확인 · 질문 없음에서도 **앞 초안 상태를 되살린다**
 * — 칸에는 앞 AI 글이 그대로 있으므로 자리 표시 막기 · 밑줄 · 초안 id 를 잃으면 안 된다(직원이 고친 글도 지우지 않는다).
 */
export function resolveDraftResult(prev: AssistDraft | null, result: AssistDraftResult): RedoOutcome {
  if (result.ok && result.kind === "draft") {
    return {
      state: {
        kind: "draft",
        draftId: result.draftId,
        checks: result.checks,
        needsHuman: result.needsHuman,
        reason: result.reason,
        placeholders: result.placeholders,
        wrong: "none",
      },
      text: result.text,
      discardId: prev && prev.draftId !== result.draftId ? prev.draftId : null,
      noQuestion: false,
    };
  }
  const noQuestion = !result.ok && result.errorKey === "invalid";
  if (prev) {
    const redo = result.ok ? "direct" : result.errorKey === "cap" ? "cap" : noQuestion ? undefined : "fail";
    return { state: { kind: "draft", ...prev, wrong: "none", redo }, text: null, discardId: null, noQuestion };
  }
  if (result.ok) return { state: { kind: "direct", reason: result.reason }, text: null, discardId: null, noQuestion };
  if (result.errorKey === "cap") return { state: { kind: "cap" }, text: null, discardId: null, noQuestion };
  if (noQuestion) return { state: { kind: "idle" }, text: null, discardId: null, noQuestion };
  return {
    state: result.errorKey === "failed" || result.errorKey === "unavailable" ? { kind: "fail" } : { kind: "idle" },
    text: null,
    discardId: null,
    noQuestion,
  };
}

export type DraftSegment = { text: string; kind: "plain" | "check" | "slot" };

/**
 * 초안 글을 그릴 조각으로 — 「확인 필요」 문구(정확한 부분 문자열, 각각 처음 한 곳)와 남은 자리 표시(모든 곳)를 표시한다.
 * 직원이 고쳐서 문구가 사라지면 그 표시도 같이 사라진다. 겹치면 먼저 시작하는 쪽(같으면 자리 표시)이 이긴다.
 */
export function segmentDraft(text: string, checks: readonly string[], placeholders: readonly string[]): DraftSegment[] {
  const marks: Array<{ start: number; end: number; kind: "check" | "slot" }> = [];
  for (const slot of placeholders) {
    if (!slot) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(slot, from);
      if (at < 0) break;
      marks.push({ start: at, end: at + slot.length, kind: "slot" });
      from = at + slot.length;
    }
  }
  for (const check of checks) {
    const needle = check.trim();
    if (!needle) continue;
    const at = text.indexOf(needle);
    if (at >= 0) marks.push({ start: at, end: at + needle.length, kind: "check" });
  }
  marks.sort((a, b) => a.start - b.start || (a.kind === b.kind ? 0 : a.kind === "slot" ? -1 : 1));

  const out: DraftSegment[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue;
    if (mark.start > cursor) out.push({ text: text.slice(cursor, mark.start), kind: "plain" });
    out.push({ text: text.slice(mark.start, mark.end), kind: mark.kind });
    cursor = mark.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), kind: "plain" });
  return out;
}

/** 아직 글 안에 남은 자리 표시 — 하나라도 있으면 보내기를 막는다. */
export function placeholdersLeft(text: string, placeholders: readonly string[]): string[] {
  return placeholders.filter((slot) => slot && text.includes(slot));
}

/** 아직 글 안에 남은 「확인 필요」 수. */
export function checksLeft(text: string, checks: ReadonlyArray<{ text: string }>): number {
  return checks.filter((check) => check.text.trim() && text.includes(check.text.trim())).length;
}

/** 한도가 다시 열리는 날(다음 달 1일, 도쿄 달 기준) — `YYYY-MM-DD` 오늘 키에서. */
export function capReopenDate(todayKey: string): { year: number; month: number } {
  const [y, m] = todayKey.split("-").map(Number);
  return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
}

/** 화면을 떠날 때(대화 바꿈 · 닫힘) 버림으로 남길 초안 — 아직 보내지 않은 초안만. 보낸 뒤 · 이미 버린 뒤는 상태가 idle 이라 없다. */
export function draftToDiscardOnLeave(state: AssistState): string | null {
  return state.kind === "draft" ? state.draftId : null;
}

/** 보내기 실패를 어떻게 보일지 — 자리 표시로 막힌 건 번역 확인 창을 닫고 답장 칸 아래 빨간 줄로. */
export function sendFailureView(errorKey: string): { closePreview: boolean; inline: boolean } {
  return errorKey === "assist_placeholder" ? { closePreview: true, inline: true } : { closePreview: false, inline: false };
}

/**
 * AI 초안이 든 칸 높이 — 글에 맞춰 늘리되 `maxLines` 까지, **언제나 줄 단위로 끝나게**(마지막 줄이 반쯤 잘리지 않게).
 * `contentHeight` 는 높이를 비운 뒤 잰 scrollHeight 에서 위아래 안쪽 여백을 뺀 값.
 */
export function fitFieldHeight(input: {
  contentHeight: number;
  lineHeight: number;
  chrome: number;
  minLines: number;
  maxLines: number;
}): number {
  const { contentHeight, lineHeight, chrome, minLines, maxLines } = input;
  if (!(lineHeight > 0)) return 0;
  // 반올림 오차(소수 px)로 한 줄이 더 잡히지 않게 조금 빼고 올림.
  const lines = Math.ceil(Math.max(0, contentHeight - 0.5) / lineHeight);
  const fitted = Math.min(Math.max(lines, minLines), maxLines);
  return Math.round(fitted * lineHeight + chrome);
}
