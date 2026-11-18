"use client";

/**
 * AI 답장 도우미 — 답장 칸 바로 위 한 줄 · 초안 표시 · 비슷한 과거 대화. docs/product/49-guest-message-ai-reply-assist.md §8-5
 *
 * - 대화를 열면 `getReplyAssist` 로 정해 둔 문구 추천 · 비슷한 대화를 읽는다(마지막 손님 메시지가 바뀌면 다시). 없음 · 실패는 줄을 숨긴다.
 * - 「초안 만들기」는 누를 때만(D3). 초안은 보는 직원 언어 — 손님에게는 기존 「손님 언어로 번역」 길로 나간다.
 * - 보라(`--gm-ai`)는 AI 가 만든 것에만. 「확인 필요」 · 자리 표시는 입력 칸 뒤 겹 그림(글은 그대로 고칠 수 있게).
 */

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  draftGuestReply,
  getReplyAssist,
  markAssistDiscarded,
  markAssistWrong,
} from "@/actions/guest-messages-assist";
import {
  getComposerInserts,
  type ComposerInserts,
} from "@/actions/guest-messages-compose";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useBuildingName } from "@/components/shared/building-names";
import { fill, type GmCopy } from "@/components/guest-messages/gm-format";
import {
  blockingSlots,
  capReopenDate,
  checksLeft,
  draftToDiscardOnLeave,
  resolveDraftResult,
  segmentDraft,
  type AssistDraft,
  type AssistState,
} from "@/components/guest-messages/ai-assist-model";
import {
  ASSIST_WRONG_REASONS,
  type AssistOverview,
  type AssistSimilar,
  type AssistWrongReason,
} from "@/lib/guest-messages/ai-assist-types";
import { insertLanguageFor } from "@/lib/guest-messages/guest-info-model";
import { haptic } from "@/lib/haptics";
import { tokyoDateOf } from "@/lib/tokyo-date";

type ReadyOverview = Extract<AssistOverview, { kind: "ready" }>;

export type { AssistDraft, AssistState };

export type ReplyAssist = ReturnType<typeof useReplyAssist>;

/**
 * 답장 칸 하나의 도우미 상태. 부르는 쪽(Composer)이 글을 갖고 있으므로 초안 글은 `onDraftText` 로 넘긴다.
 * `enabled` 가 꺼지면(답장 권한 없음 · 막힌 대화 · 내부 메모) 아무것도 읽지 않는다.
 */
export function useReplyAssist({
  conversationId,
  latestGuestMessageId,
  enabled,
  onDraftText,
  onSimilar,
}: {
  conversationId: string;
  latestGuestMessageId: string | null;
  enabled: boolean;
  onDraftText: (text: string) => void;
  onSimilar?: (similar: AssistSimilar[]) => void;
}) {
  const [overview, setOverview] = useState<ReadyOverview | null>(null);
  const [state, setState] = useState<AssistState>({ kind: "idle" });
  const [inserts, setInserts] = useState<ComposerInserts | null>(null);
  /** 초안 등장 흐림 → 선명 — 새 초안마다 한 번. */
  const [fadeKey, setFadeKey] = useState(0);
  /** 서버가 「답할 질문이 없다」(`invalid`)고 한 마지막 손님 메시지 — 그 메시지 동안은 초안 버튼을 조용히 숨긴다. */
  const [noQuestionFor, setNoQuestionFor] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const requestRef = useRef(0);
  const onSimilarRef = useRef(onSimilar);
  useEffect(() => {
    onSimilarRef.current = onSimilar;
  });

  // 마지막 손님 메시지가 바뀌면 추천을 다시 읽는다. 실패 · 없음은 줄을 숨길 뿐 메시지함은 그대로.
  useEffect(() => {
    if (!enabled || !latestGuestMessageId) return;
    let alive = true;
    void getReplyAssist(conversationId)
      .then(async (result) => {
        if (!alive) return;
        const ready = result.kind === "ready" ? result : null;
        setOverview(ready);
        onSimilarRef.current?.(ready?.similar ?? []);
        // 문구 칩을 누르면 바로 넣도록 넣을 글을 미리 읽어 둔다(기존 넣기 목록과 같은 글 · 같은 언어 규칙).
        if (ready && ready.suggestions.length > 0) {
          const loaded = await getComposerInserts(conversationId);
          if (alive && loaded.ok) setInserts(loaded.data);
        }
      })
      .catch(() => {
        if (alive) setOverview(null);
      });
    return () => {
      alive = false;
    };
  }, [conversationId, latestGuestMessageId, enabled]);

  // 대화가 바뀌거나 화면을 떠나면 PC 오른쪽 패널의 비슷한 대화도 비운다.
  useEffect(() => () => onSimilarRef.current?.([]), []);

  // 초안을 띄운 채 대화를 바꾸거나 화면을 닫으면 버림으로 남긴다(보낸 뒤 · 이미 버린 뒤는 상태가 idle 이라 없음). 실패해도 무시.
  const leaveDraftRef = useRef<string | null>(null);
  useEffect(() => {
    leaveDraftRef.current = draftToDiscardOnLeave(state);
  }, [state]);
  useEffect(
    () => () => {
      const id = leaveDraftRef.current;
      leaveDraftRef.current = null;
      if (id) void markAssistDiscarded(id).catch(() => undefined);
    },
    [conversationId],
  );

  const discardIfDraft = () => {
    if (state.kind === "draft")
      void markAssistDiscarded(state.draftId).catch(() => undefined);
  };

  const makeDraft = () => {
    // 앞 초안은 새 초안이 올 때까지 버리지 않는다 — 실패하면 되살려야 한다(칸에 앞 AI 글이 그대로 있으므로).
    const prev: AssistDraft | null = state.kind === "draft" ? state : null;
    const ticket = ++requestRef.current;
    setState({ kind: "loading" });
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof draftGuestReply>>;
      try {
        result = await draftGuestReply(conversationId);
      } catch {
        result = { ok: false, errorKey: "failed" };
      }
      if (ticket !== requestRef.current) return;
      const next = resolveDraftResult(prev, result);
      if (next.discardId)
        void markAssistDiscarded(next.discardId).catch(() => undefined);
      if (next.noQuestion) setNoQuestionFor(latestGuestMessageId);
      if (next.text !== null) {
        onDraftText(next.text);
        setFadeKey((n) => n + 1);
      }
      // 실패 안내를 보이므로 error(16 「햅틱 — 공용 규칙」). 한도 · 직접 확인 · 질문 없음은 오류가 아니다.
      if (
        !result.ok &&
        (result.errorKey === "failed" || result.errorKey === "unavailable")
      )
        haptic("error");
      setState(next.state);
    });
  };

  return {
    overview,
    state,
    inserts,
    fadeKey,
    makeDraft,
    canDraft: noQuestionFor === null || noQuestionFor !== latestGuestMessageId,
    /** 직원이 칸을 비웠거나 「초안 지우기」 — 버림 기록 후 처음 상태로. */
    discard: () => {
      discardIfDraft();
      setState({ kind: "idle" });
    },
    /** 보낸 뒤 — 서버가 보내기와 함께 그대로/고쳐 보냄을 기록했으므로 버림을 따로 남기지 않는다. */
    sent: () => {
      leaveDraftRef.current = null;
      setState({ kind: "idle" });
    },
    draftId: state.kind === "draft" ? state.draftId : null,
    setWrong: (wrong: AssistDraft["wrong"]) =>
      setState((current) =>
        current.kind === "draft" ? { ...current, wrong } : current,
      ),
    markWrong: (reason: AssistWrongReason) => {
      if (state.kind !== "draft") return;
      haptic("light");
      void markAssistWrong({ draftId: state.draftId, reason }).catch(
        () => undefined,
      );
      setState({ ...state, wrong: "noted" });
    },
  };
}

// ── 그림 ────────────────────────────────────────────────────────────────────

function PenGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function InfoGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5v.01" />
    </svg>
  );
}

/** 답장 칸 위 도우미 한 줄 — 처음(추천 칩) · 만드는 중 · 초안 상태 줄 · 직접 확인 · 한도 · 실패. */
export function AssistLine({
  assist,
  copy,
  locale,
  variant,
  text,
  guestLanguage,
  translateTarget,
  onInsert,
  onDraftRequest,
  onClear,
  notify,
}: {
  assist: ReplyAssist;
  copy: GmCopy;
  locale: string;
  variant: "pc" | "phone";
  text: string;
  guestLanguage: string | null;
  translateTarget: string | null;
  onInsert: (text: string) => void;
  /** 「초안 만들기」 · 「다시 만들기」 — 부르는 쪽이 쓰던 글을 덮어도 되는지 먼저 묻는다. */
  onDraftRequest: () => void;
  onClear: () => void;
  notify: (message: string) => void;
}) {
  const a = copy.assist;
  const [sheetOpen, setSheetOpen] = useState(false);
  const { overview, state } = assist;
  if (!overview) return null;
  const pc = variant === "pc";
  const similar = overview.similar;

  const pickSuggestion = (savedReplyId: string) => {
    const reply = assist.inserts?.replies.find(
      (item) => item.id === savedReplyId,
    );
    const lang = insertLanguageFor(guestLanguage, translateTarget, locale);
    const picked = reply?.byLang[lang] ?? null;
    if (!picked) {
      notify(copy.insertNoLang);
      return;
    }
    haptic("light");
    onInsert(picked.text);
    if (picked.missing.length > 0) notify(copy.insertMissingVars);
  };

  const capped = overview.capReached || state.kind === "cap";
  const draftButton = (disabled: boolean) =>
    pc ? (
      <button
        type="button"
        className="gm-btn ax-draftbtn"
        disabled={disabled}
        onClick={onDraftRequest}
      >
        <PenGlyph />
        {a.draft}
      </button>
    ) : (
      <button
        type="button"
        className="ax-chip-draft"
        disabled={disabled}
        onClick={onDraftRequest}
      >
        <PenGlyph />
        {a.draft}
      </button>
    );
  // PC: 칩만 가로로 밀리고 초안 버튼은 오른쪽에 고정 — 좁은 폭·긴 영어 제목에서 버튼이 잘리지 않게.
  const suggestionRow = (withDraft: boolean) => {
    if (overview.suggestions.length === 0 && !withDraft) return null;
    const chips = overview.suggestions.map((sug) => (
      <button
        key={sug.savedReplyId}
        type="button"
        className="ax-sug"
        onClick={() => pickSuggestion(sug.savedReplyId)}
      >
        {sug.title}
      </button>
    ));
    if (!pc) {
      return (
        <div className="ax-sugs" data-swipe-back="off">
          {withDraft ? draftButton(capped) : null}
          {chips}
        </div>
      );
    }
    return (
      <div className="ax-sugrow">
        {overview.suggestions.length > 0 ? (
          <div className="ax-sugs">
            <span className="ax-sugs__lead">{a.sugLead}</span>
            {chips}
          </div>
        ) : null}
        {withDraft ? (
          <span className="ax-sugs__end">{draftButton(capped)}</span>
        ) : null}
      </div>
    );
  };

  let body: ReactNode = null;
  if (state.kind === "loading") {
    body = (
      <div className="ax-line" role="status">
        <span className="ax-spark">
          <PenGlyph />
        </span>
        <span>{a.drafting}</span>
      </div>
    );
  } else if (state.kind === "draft") {
    body = (
      <DraftLine
        state={state}
        assist={assist}
        copy={copy}
        pc={pc}
        text={text}
        similarCount={similar.length}
        onSimilar={similar.length > 0 ? () => setSheetOpen(true) : null}
        onRedo={onDraftRequest}
        onClear={onClear}
      />
    );
  } else if (state.kind === "direct" || state.kind === "fail" || capped) {
    const [title, desc] =
      state.kind === "direct"
        ? [a.directTitle, a.directBody]
        : state.kind === "fail"
          ? [a.failTitle, a.failBody]
          : [a.capTitle, fill(a.capBody, { date: reopenLabel(locale) })];
    body = (
      <>
        <div className="ax-quiet" role="status">
          <InfoGlyph />
          <div className="ax-quiet__text">
            {title}
            <span>{desc}</span>
          </div>
          {state.kind === "fail" ? (
            <button
              type="button"
              className="ax-link ax-link--ink ax-quiet__act"
              onClick={assist.makeDraft}
            >
              {a.retry}
            </button>
          ) : null}
        </div>
        {suggestionRow(false)}
      </>
    );
  } else {
    body = suggestionRow(assist.canDraft);
  }

  return (
    <div className="ax-assist" aria-label={a.label} role="group">
      {body}
      {!pc && sheetOpen ? (
        <BottomSheet
          onClose={() => setSheetOpen(false)}
          ariaLabel={a.similarTitle}
          className="gm-root"
        >
          <div className="gm-sheet ax-simsheet">
            <h2 className="gm-sheet__title">{a.similarTitle}</h2>
            <p className="gm-hint ax-simsheet__hint">{a.similarHint}</p>
            <SimilarList similar={similar} locale={locale} />
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}

function DraftLine({
  state,
  assist,
  copy,
  pc,
  text,
  similarCount,
  onSimilar,
  onRedo,
  onClear,
}: {
  state: Extract<AssistState, { kind: "draft" }>;
  assist: ReplyAssist;
  copy: GmCopy;
  pc: boolean;
  text: string;
  similarCount: number;
  onSimilar: (() => void) | null;
  onRedo: () => void;
  onClear: () => void;
}) {
  const a = copy.assist;
  if (state.wrong === "asking") {
    return (
      <div className="ax-line ax-line--wrap">
        <span>{a.wrongAsk}</span>
        <span className="ax-line__end ax-line__end--reasons">
          {ASSIST_WRONG_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              className="ax-link ax-link--ink"
              onClick={() => assist.markWrong(reason)}
            >
              {a.wrongReason[reason]}
            </button>
          ))}
          <button
            type="button"
            className="ax-link"
            onClick={() => assist.setWrong("none")}
          >
            {a.wrongCancel}
          </button>
        </span>
      </div>
    );
  }

  const checks = checksLeft(text, state.checks);
  const slots = blockingSlots(text, state.placeholders);
  // 다시 만들기가 안 됐으면 앞 초안을 그대로 두고 이유만 앞에 보인다.
  const redoLead =
    state.redo === "fail"
      ? a.failTitle
      : state.redo === "cap"
        ? a.capTitle
        : state.redo === "direct"
          ? a.directTitle
          : null;
  const lead = redoLead
    ? redoLead
    : pc
      ? similarCount === 0
        ? a.lineNoSimilar
        : similarCount === 1
          ? a.lineBasedOne
          : fill(a.lineBased, { n: similarCount })
      : a.lineDraft;
  const marks: string[] = [];
  if (slots.length > 0) marks.push(fill(a.slotsShort, { n: slots.length }));
  if (checks > 0) marks.push(fill(a.checks, { n: checks }));
  if (state.needsHuman) marks.push(a.needsHuman);

  return (
    <div className="ax-line" role="status">
      <span className="ax-spark">
        <PenGlyph />
      </span>
      <span className={pc ? undefined : "ax-ell"}>
        <span>{lead}</span>
        {marks.map((mark) => (
          <span
            key={mark}
            title={
              mark === a.needsHuman && state.reason ? state.reason : undefined
            }
          >
            <span className="ax-sep" aria-hidden="true">
              {" · "}
            </span>
            <b>{mark}</b>
          </span>
        ))}
      </span>
      <span className="ax-line__end">
        {state.wrong === "noted" ? (
          <>
            {pc ? <span>{a.wrongNoted}</span> : null}
            <button
              type="button"
              className="ax-link ax-link--ink"
              onClick={onClear}
            >
              {a.clearDraft}
            </button>
            <button
              type="button"
              className="ax-link"
              onClick={() => assist.setWrong("kept")}
            >
              {a.keepDraft}
            </button>
          </>
        ) : (
          <>
            {!pc && onSimilar ? (
              <button
                type="button"
                className="ax-link"
                aria-haspopup="dialog"
                onClick={onSimilar}
              >
                {a.similar}
              </button>
            ) : null}
            {pc ? (
              <button type="button" className="ax-link" onClick={onRedo}>
                {a.redo}
              </button>
            ) : null}
            {state.wrong === "none" ? (
              <button
                type="button"
                className="ax-link"
                onClick={() => assist.setWrong("asking")}
              >
                {a.wrong}
              </button>
            ) : null}
          </>
        )}
      </span>
    </div>
  );
}

function reopenLabel(locale: string): string {
  const { year, month } = capReopenDate(
    tokyoDateOf(new Date().toISOString()) ?? "2000-01-01",
  );
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * 입력 칸 뒤 겹 그림 — 「확인 필요」 점선 밑줄 · 자리 표시 옅은 보라. 글자는 투명(입력 칸 글자가 위에 그대로 보인다),
 * 굵기 · 여백을 바꾸지 않아 줄이 어긋나지 않는다. 만드는 중엔 반짝임으로 칸을 덮는다.
 */
export function AssistFieldLayer({
  state,
  text,
  scrollTop,
}: {
  state: AssistState;
  text: string;
  scrollTop: number;
}) {
  if (state.kind === "loading") {
    return (
      <div className="ax-shimmer" aria-hidden="true">
        <i style={{ width: "92%" }} />
        <i style={{ width: "78%" }} />
        <i style={{ width: "54%" }} />
      </div>
    );
  }
  if (state.kind !== "draft") return null;
  const segments = segmentDraft(
    text,
    state.checks.map((check) => check.text),
    state.placeholders,
  );
  if (!segments.some((segment) => segment.kind !== "plain")) return null;
  return (
    <div className="ax-backdrop" aria-hidden="true">
      <div
        className="ax-backdrop__inner"
        style={{ transform: `translateY(${-scrollTop}px)` }}
      >
        {segments.map((segment, index) =>
          segment.kind === "plain" ? (
            <span key={index}>{segment.text}</span>
          ) : (
            <mark
              key={index}
              className={
                segment.kind === "check" ? "ax-tok ax-tok--check" : "ax-tok"
              }
            >
              {segment.text}
            </mark>
          ),
        )}
        {/* 끝 줄바꿈도 높이를 갖게 */}
        {"​"}
      </div>
    </div>
  );
}

function monthLabel(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export function SimilarList({
  similar,
  locale,
}: {
  similar: AssistSimilar[];
  locale: string;
}) {
  const buildingName = useBuildingName();
  return (
    <div className="ax-simlist">
      {similar.map((item, index) => {
        const meta = [
          item.propertyName ? buildingName(item.propertyName) : null,
          monthLabel(item.askedAt, locale),
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div key={`${item.conversationId}:${index}`} className="ax-sim">
            <div className="ax-sim__q">{item.question}</div>
            {item.reply ? <div className="ax-sim__a">{item.reply}</div> : null}
            {meta ? <div className="ax-sim__m">{meta}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

/** PC 오른쪽 패널 — 예약 정보 아래 「비슷한 과거 대화」(시안 그대로). */
export function AssistSimilarSection({
  similar,
  copy,
  locale,
}: {
  similar: AssistSimilar[];
  copy: GmCopy;
  locale: string;
}) {
  if (similar.length === 0) return null;
  return (
    <section className="ax-similar" aria-label={copy.assist.similarTitle}>
      <h3>{copy.assist.similarTitle}</h3>
      <p className="gm-hint">{copy.assist.similarHint}</p>
      <SimilarList similar={similar} locale={locale} />
    </section>
  );
}
