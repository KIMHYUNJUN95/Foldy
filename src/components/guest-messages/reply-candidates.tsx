"use client";

/**
 * 과거 답장에서 찾은 후보 — 살펴보기 화면(PC `/admin/messages?tab=replies&cand=phrase|info` · 모바일 `/mobile/messages/candidates`).
 * docs/product/49-guest-message-ai-reply-assist.md §9-6 · 시안 pa3(2026-11-19).
 *
 * - 승인 전엔 아무것도 저장하지 않는다 — 「그대로 추가 / 넣기」를 눌러야 서버가 저장한다.
 * - 권한 · 조직 판정은 서버 액션(`src/actions/guest-message-candidates.ts`)이 다시 한다. 여기서 숨긴 버튼은 보기 정리일 뿐.
 * - 건물 이름은 데이터 — `useBuildingName()` 으로 그린다. 서버로 보내는 값 · 목록 키는 한국어 정식 이름 그대로.
 * - 근거 글은 서버가 번호 · 비밀번호를 `[…]` 로 가려서 준다 — 화면은 ••••로 그린다. 와이파이 칸은 후보로 오지 않는다.
 * - 햅틱: 저장 확인 뒤 success · 빼기 light · 실패 error. 빠지는 줄은 `.row-collapse`(16 「줄 접힘」).
 */

import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Info, Lock, PenLine } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  addReplyCandidate,
  applyGuestInfoReplyCandidate,
  dismissReplyCandidate,
  getReplyCandidates,
  restoreReplyCandidate,
  runReplyCandidates,
  undoAddReplyCandidate,
  undoGuestInfoReplyCandidate,
  type CandidateActionResult,
} from "@/actions/guest-message-candidates";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { AdminUndoToast } from "@/components/admin/shared/admin-undo-toast";
import { fill, type GmCopy } from "@/components/guest-messages/gm-format";
import { useBuildingName } from "@/components/shared/building-names";
import { TaskToast } from "@/components/tasks/task-toast";
import { haptic } from "@/lib/haptics";
import { GUEST_LANGS, type GuestLang, type Localized } from "@/lib/guest-messages/guest-info-model";
import type { CandidateView } from "@/lib/guest-messages/reply-candidates-server";
import {
  applyResult,
  candidateButtons,
  candidateCounts,
  candidateScreen,
  candidatesFor,
  draftOf,
  editedParts,
  groupByBuilding,
  isEdited,
  isLongValue,
  createDecisionQueue,
  createNavStamp,
  nextAfter,
  putAllOutcome,
  runButton,
  runFinished,
  runNote,
  splitMasked,
  splitPutAll,
  whenConfirmedHere,
  type BuildingGroup,
  type CandidateFilter,
  type CandidateKind,
  type CandidateLoad,
  type PhraseDraft,
} from "@/lib/guest-messages/reply-candidates-view";
import "./guest-messages.css";

const LANG_KEY: Record<GuestLang, "langAutonymKo" | "langAutonymJa" | "langAutonymEn"> = {
  ko: "langAutonymKo",
  ja: "langAutonymJa",
  en: "langAutonymEn",
};

const FIELD_KEY: Record<NonNullable<CandidateView["field"]>, keyof GmCopy> = {
  checkIn: "fieldCheckIn",
  checkOut: "fieldCheckOut",
  luggage: "fieldLuggage",
  parking: "fieldParking",
  trash: "fieldTrash",
  directions: "fieldDirections",
};

const EVIDENCE_LIMIT = 3;
const NO_KINDS: readonly CandidateKind[] = [];
const VAR_RE = /(\{[a-z_]+\})/;

function langOf(locale: string): GuestLang {
  return (GUEST_LANGS as readonly string[]).includes(locale) ? (locale as GuestLang) : "en";
}

function pick(value: Localized, lang: GuestLang): string {
  return value[lang] || value.ko || value.en || value.ja;
}

function fieldLabel(copy: GmCopy, field: CandidateView["field"]): string {
  return field ? (copy[FIELD_KEY[field]] as string) : "";
}

function shortDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).format(date);
}

function actionError(copy: GmCopy, key: Exclude<CandidateActionResult, { ok: true }>["errorKey"]): string {
  switch (key) {
    case "forbidden":
      return copy.forbidden;
    case "conflict":
      return copy.candErrConflict;
    case "changed":
      return copy.candErrChanged;
    case "too_long":
      return copy.candErrTooLong;
    case "limit":
      return copy.candErrLimit;
    case "not_found":
      return copy.candErrNotFound;
    case "invalid":
      return copy.candErrInvalid;
    default:
      return copy.candErrFailed;
  }
}

function runError(copy: GmCopy, key: "forbidden" | "unavailable" | "busy" | "cap" | "failed"): string {
  if (key === "forbidden") return copy.forbidden;
  if (key === "busy") return copy.candRunErrBusy;
  if (key === "cap") return copy.candRunErrCap;
  if (key === "unavailable") return copy.candRunErrUnavailable;
  return copy.candRunErrFailed;
}

function runNoteText(copy: GmCopy, note: "failed" | "cap" | "stale" | null): string | null {
  if (note === "cap") return copy.candRunNoteCap;
  if (note === "stale") return copy.candRunNoteStale;
  if (note === "failed") return copy.candRunNoteFailed;
  return null;
}

/** 「다시 찾기」가 끝나면 — 끝남은 알림, 실패는 이유 한 줄. */
function useRunEnd(copy: GmCopy, notifyRef: { current: Notify | null }) {
  return useCallback(
    (outcome: "done" | "failed", load: ReadyLoad) => {
      const notify = notifyRef.current;
      if (!notify) return;
      if (outcome === "done") {
        notify(copy.candRunDone);
        return;
      }
      haptic("error");
      notify(runNoteText(copy, runNote(load.overview.lastRun)) ?? copy.candRunNoteFailed);
    },
    [copy, notifyRef],
  );
}

const FOLD_QUERY = "(min-width: 600px)";
function subscribeFold(listener: () => void) {
  const query = window.matchMedia(FOLD_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
/** 폴드 이상(≥ 600px) — 목록 | 상세 둘로 나눈다. 서버 렌더에서는 아니다. */
function useIsWide(): boolean {
  return useSyncExternalStore(subscribeFold, () => window.matchMedia(FOLD_QUERY).matches, () => false);
}

// ── 읽기 · 결정 ─────────────────────────────────────────────────────────────

type Notify = (message: string, undo?: () => void) => void;

const RUN_POLL_MS = 5000;

type ReadyLoad = Extract<CandidateLoad, { kind: "ready" }>;

function toLoad(result: Awaited<ReturnType<typeof getReplyCandidates>>): CandidateLoad {
  if (!result.ok) {
    return result.errorKey === "forbidden"
      ? { kind: "ready", overview: { available: false, lastRun: null, pending: [], decided: [] }, kinds: [], canRun: false }
      : { kind: "error" };
  }
  return { kind: "ready", overview: { available: result.available, lastRun: result.lastRun, pending: result.pending, decided: result.decided }, kinds: result.kinds, canRun: result.canRun };
}

/**
 * 후보 읽기. 「다시 찾기」가 도는 동안(`running`)은 5초마다 조용히 다시 읽는다 — 화면이 가려지면 쉬고,
 * 다시 보이면 바로 한 번 읽는다. 끝남 · 실패로 바뀌면 `onRunEnd` 를 부른다(토스트). 15분 넘은 실행은 서버가 「멈춤」으로 준다.
 */
function useCandidates(onRunEnd?: (outcome: "done" | "failed", load: ReadyLoad) => void) {
  const [load, setLoad] = useState<CandidateLoad>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const onRunEndRef = useRef(onRunEnd);
  useEffect(() => {
    onRunEndRef.current = onRunEnd;
  });
  useEffect(() => {
    let live = true;
    getReplyCandidates()
      .then((result) => live && setLoad(toLoad(result)))
      .catch(() => live && setLoad({ kind: "error" }));
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const runningRun = load.kind === "ready" && load.overview.lastRun?.status === "running" ? load.overview.lastRun : null;
  const runningStamp = runningRun?.startedAt ?? null;
  useEffect(() => {
    if (!runningStamp) return;
    let live = true;
    let inFlight = false;
    const tick = () => {
      if (!live || inFlight || document.hidden) return;
      inFlight = true;
      getReplyCandidates()
        .then((result) => {
          if (!live || !result.ok) return;
          const next = toLoad(result);
          if (next.kind !== "ready") return;
          setLoad(next);
          const outcome = runFinished({ status: "running" }, next.overview.lastRun);
          if (outcome) onRunEndRef.current?.(outcome, next);
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    const timer = window.setInterval(tick, RUN_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [runningStamp]);

  const reload = useCallback((quiet = false) => {
    if (!quiet) setLoad({ kind: "loading" });
    setReloadKey((key) => key + 1);
  }, []);
  const apply = useCallback((candidate: CandidateView) => {
    setLoad((prev) => (prev.kind === "ready" ? { ...prev, overview: applyResult(prev.overview, candidate) } : prev));
  }, []);
  const markRunning = useCallback(() => {
    setLoad((prev) =>
      prev.kind === "ready"
        ? {
            ...prev,
            overview: {
              ...prev.overview,
              lastRun: { status: "running", startedAt: new Date().toISOString(), finishedAt: null, sourceCount: prev.overview.lastRun?.sourceCount ?? 0, sourceSince: null, errorKey: null, skipNotes: [] },
            },
          }
        : prev,
    );
  }, []);
  return { load, reload, apply, markRunning };
}

/**
 * 결정 하나를 서버에 — 빠지는 줄은 먼저 접고(실패하면 다시 편다), 결과로 목록을 고친다.
 * 같은 후보에 대한 결정이 아직 돌고 있으면 두 번째 누름은 버린다(빠른 두 번 누름 → 두 번 추가 막기, ref 잠금).
 * 되돌리기는 `chain` 으로 앞선 결정이 끝난 뒤에 돈다(넣기가 끝나기 전에 되돌리기가 먼저 닿지 않게).
 */
function useDecide(copy: GmCopy, apply: (c: CandidateView) => void, reload: (quiet?: boolean) => void, notify: Notify) {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [lane] = useState(() => createDecisionQueue<CandidateActionResult>({ ok: false, errorKey: "failed" }));
  const queue = lane.enqueue;
  const setLeave = useCallback((ids: string[], on: boolean) => {
    setLeaving((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const run = useCallback(
    async (ids: string[], call: () => Promise<CandidateActionResult>, options: { silent?: boolean; collapse?: boolean } = {}): Promise<CandidateView | null> => {
      if (!lane.lock(ids)) return null;
      setBusy(true);
      if (options.collapse !== false) setLeave(ids, true);
      const job = queue(call);
      try {
        const result = await job;
        if (!result.ok) {
          setLeave(ids, false);
          if (!options.silent) {
            haptic("error");
            notify(actionError(copy, result.errorKey));
          }
          if (result.errorKey === "not_found") reload(true);
          return null;
        }
        apply(result.candidate);
        setLeave(ids, false);
        return result.candidate;
      } finally {
        lane.unlock(ids);
        setBusy(lane.busy());
      }
    },
    [apply, copy, lane, notify, queue, reload, setLeave],
  );
  return { leaving, busy, run, queue };
}

// ── 토스트(PC: 공용 되돌리기 토스트 · 모바일: 공용 TaskToast) ───────────────

function useCandToast(surface: "admin" | "mobile", undoLabel: string) {
  const admin = useAdminToast();
  const [undo, setUndo] = useState<{ stamp: number; message: string; onUndo: () => void } | null>(null);
  const [mobile, setMobile] = useState<{ id: number; message: string; action?: { label: string; onAction: () => void } } | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  const { showToast, dismiss: dismissAdmin } = admin;
  const notify: Notify = useCallback(
    (message, onUndo) => {
      if (surface === "admin") {
        if (onUndo) {
          dismissAdmin();
          setUndo({ stamp: Date.now(), message, onUndo });
        } else {
          // 오류 · 알림 토스트는 지난 결정의 되돌리기 토스트를 지우지 않는다 — 둘은 따로 뜬다.
          showToast(message);
        }
        return;
      }
      if (timer.current) window.clearTimeout(timer.current);
      const id = Date.now();
      setMobile({
        id,
        message,
        action: onUndo
          ? {
              label: undoLabel,
              onAction: () => {
                setMobile(null);
                onUndo();
              },
            }
          : undefined,
      });
      timer.current = window.setTimeout(() => setMobile((t) => (t?.id === id ? null : t)), onUndo ? 5000 : 2600);
    },
    [dismissAdmin, showToast, surface, undoLabel],
  );
  const node =
    surface === "admin" ? (
      <>
        {undo ? (
          <AdminUndoToast
            stamp={undo.stamp}
            message={undo.message}
            undoLabel={undoLabel}
            onUndo={() => {
              const action = undo.onUndo;
              setUndo(null);
              action();
            }}
            onExpire={() => setUndo(null)}
          />
        ) : null}
        {admin.toast ? <AdminToast message={admin.toast.message} onDismiss={admin.dismiss} /> : null}
      </>
    ) : mobile ? (
      <TaskToast key={mobile.id} message={mobile.message} action={mobile.action} onDismiss={() => setMobile(null)} />
    ) : null;
  return { notify, node };
}

// ── 조각 ─────────────────────────────────────────────────────────────────────

function VarText({ text }: { text: string }) {
  return (
    <>
      {text.split(VAR_RE).map((part, index) =>
        VAR_RE.test(part) ? (
          <span key={index} className="gm-cand-var">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Masked({ text }: { text: string }) {
  return (
    <>
      {splitMasked(text).map((part, index) =>
        part.masked ? (
          <span key={index} className="gm-cand-mask">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

function AiLine({ text, position }: { text: string; position?: string }) {
  return (
    <div className="gm-cand-ai">
      <PenLine size={14} strokeWidth={2} aria-hidden="true" />
      <span>{text}</span>
      {position ? <span className="gm-cand-ai__pos">{position}</span> : null}
    </div>
  );
}

function Filters<T extends string>({
  label,
  items,
  value,
  onChange,
  trailing,
}: {
  label: string;
  items: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="gm-cand-filters" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="gm-cand-filter"
          aria-pressed={value === item.id}
          onClick={() => {
            if (value === item.id) return;
            haptic("light");
            onChange(item.id);
          }}
        >
          {item.label}
          {item.count !== undefined ? <b>{item.count}</b> : null}
        </button>
      ))}
      {trailing}
    </div>
  );
}

function StateBox({ tone, icon, title, body, children }: { tone?: "err"; icon: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="gm-cand-state" role={tone === "err" ? "alert" : "status"}>
      <span className="gm-cand-state__icon" data-tone={tone}>
        {icon}
      </span>
      <b>{title}</b>
      {body ? <p>{body}</p> : null}
      {children ? <div className="gm-cand-state__actions">{children}</div> : null}
    </div>
  );
}

function LoadingBox({ copy }: { copy: GmCopy }) {
  return (
    <div className="gm-cand-state" role="status" aria-live="polite">
      <span className="gm-cand-spin" aria-hidden="true" />
      <p>{copy.candLoading}</p>
    </div>
  );
}

function RunButton({ load, copy, onRun, running }: { load: CandidateLoad; copy: GmCopy; onRun: () => void; running: boolean }) {
  const state = runButton(load);
  if (state === "hidden") return null;
  const busy = state === "running" || running;
  return (
    <button type="button" className="gm-btn gm-btn--sm gm-btn--ghost" disabled={busy} onClick={onRun}>
      {busy ? copy.candRunning : copy.candRun}
    </button>
  );
}

/** 폰 아래 고정 버튼 줄 — 실제 높이를 `--gm-mbar-h` 로 알려 몸통 아래 여백 · 토스트 자리를 맞춘다(글자 크기 · 줄바꿈 따라). */
function MobileBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty("--gm-mbar-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--gm-mbar-h");
    };
  }, []);
  return (
    <div ref={ref} className="gm-cand-mbar">
      {children}
    </div>
  );
}

// ── 문구 후보 상세 ───────────────────────────────────────────────────────────

/** 결정은 서버가 확인하면 true — 부르는 쪽은 그때만 다음 후보로 넘기고 고친 글을 비운다. */
type PhraseActions = {
  onAdd: (candidate: CandidateView, draft: PhraseDraft | null) => Promise<boolean> | void;
  onSkip: (candidate: CandidateView) => Promise<boolean> | void;
  onRestore: (candidate: CandidateView) => Promise<boolean> | void;
};

function PhraseDetail({
  candidate,
  copy,
  locale,
  kinds,
  position,
  busy,
  similarTitle,
  similarHref,
  draft,
  setDraft,
  actions,
  foot,
}: {
  candidate: CandidateView;
  copy: GmCopy;
  locale: string;
  kinds: readonly CandidateKind[];
  position?: string;
  busy: boolean;
  similarTitle: string | null;
  similarHref: string | null;
  draft: PhraseDraft | null;
  setDraft: (draft: PhraseDraft | null) => void;
  actions: PhraseActions;
  /** 버튼 줄 꼴 — PC 편집기 아래 붙음 · 폰 화면 아래 고정 · 폴드 칸 안 */
  foot: "pc" | "bar" | "inline";
}) {
  const buildingName = useBuildingName();
  const uiLang = langOf(locale);
  const [lang, setLang] = useState<GuestLang>(() => (candidate.bodies[uiLang] ? uiLang : (GUEST_LANGS.find((l) => candidate.bodies[l]) ?? uiLang)));
  const buttons = candidateButtons(candidate, kinds);
  const editing = draft !== null;
  const edited = draft ? editedParts(candidate, draft, locale) : { title: false, langs: [] as GuestLang[] };
  const changed = draft ? isEdited(candidate, draft, locale) : false;
  const title = draft ? draft.title : draftOf(candidate, locale).title;
  const body = draft ? draft.bodies[lang] : candidate.bodies[lang];
  const question = pick(candidate.question, uiLang);
  const note = pick(candidate.note, uiLang);
  const langName = copy[LANG_KEY[lang]];

  const buttonRow = (
    <>
      {buttons.dismiss ? (
        <button type="button" className="gm-btn gm-btn--ghost" disabled={busy} onClick={() => actions.onSkip(candidate)}>
          {copy.candSkip}
        </button>
      ) : null}
      {buttons.edit ? (
        editing ? (
          <button type="button" className="gm-btn" disabled={busy || !changed} onClick={() => setDraft(draftOf(candidate, locale))}>
            {copy.candReset}
          </button>
        ) : (
          <button
            type="button"
            className="gm-btn"
            disabled={busy}
            onClick={() => {
              haptic("light");
              setDraft(draftOf(candidate, locale));
            }}
          >
            {copy.candEdit}
          </button>
        )
      ) : null}
      {buttons.add ? (
        <button type="button" className="gm-btn gm-btn--primary" disabled={busy} onClick={() => actions.onAdd(candidate, changed ? draft : null)}>
          {changed ? copy.candAddEdited : copy.candAdd}
        </button>
      ) : null}
      {buttons.restore ? (
        <button type="button" className="gm-btn gm-btn--primary" disabled={busy} onClick={() => actions.onRestore(candidate)}>
          {copy.candRestore}
        </button>
      ) : null}
    </>
  );
  const hasButtons = buttons.add || buttons.dismiss || buttons.restore;

  return (
    <>
      <AiLine text={`${copy.candFrom} · ${fill(copy.candAsked, { n: candidate.askCount })}`} position={position} />
      {editing ? (
        <label className="gm-cand-notch" data-draft={edited.title ? "" : undefined}>
          <span className="gm-cand-notch__label">{copy.candName}</span>
          <input
            className="gm-cand-notch__input"
            value={draft.title}
            maxLength={80}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
      ) : (
        <h2>{title}</h2>
      )}
      <div className="gm-cand-bodyhead">
        <span>{fill(edited.langs.includes(lang) ? copy.candBodyEdited : copy.candBody, { lang: langName })}</span>
        <div className="gm-cand-langseg" role="radiogroup" aria-label={copy.candLangLabel}>
          {GUEST_LANGS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={lang === l}
              onClick={() => {
                if (lang !== l) haptic("light");
                setLang(l);
              }}
            >
              {copy[LANG_KEY[l]]}
            </button>
          ))}
        </div>
      </div>
      {editing ? (
        <label className="gm-cand-notch" data-draft={edited.langs.includes(lang) ? "" : undefined}>
          <span className="gm-cand-notch__label">{fill(copy.candBody, { lang: langName })}</span>
          <textarea
            className="gm-cand-notch__input"
            value={body}
            maxLength={2000}
            rows={7}
            onChange={(event) => setDraft({ ...draft, bodies: { ...draft.bodies, [lang]: event.target.value } })}
          />
        </label>
      ) : (
        <div className="gm-cand-notch">
          <div className="gm-cand-notch__input" data-empty={body ? undefined : ""}>
            {body ? <VarText text={body} /> : copy.candBodyEmpty}
          </div>
        </div>
      )}
      {note ? (
        <p className="gm-cand-note">
          <Info size={13} aria-hidden="true" />
          <span>{note}</span>
        </p>
      ) : null}
      {similarTitle ? (
        <div className="gm-cand-notice">
          <Copy size={14} aria-hidden="true" />
          <div>
            {fill(copy.candSimilar, { title: similarTitle })}{" "}
            {similarHref ? (
              <Link className="gm-cand-link" href={similarHref}>
                {copy.candOpen}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
      {candidate.evidence.length > 0 ? (
        <section className="gm-cand-ev" aria-label={copy.candEvidence}>
          <p className="gm-cand-ev__title">
            {copy.candEvidence}
            <span>{fill(copy.candEvidenceSub, { n: Math.min(EVIDENCE_LIMIT, candidate.evidence.length) })}</span>
          </p>
          {question ? <span className="gm-cand-sim__q">{question}</span> : null}
          {candidate.evidence.slice(0, EVIDENCE_LIMIT).map((item, index) => (
            <div key={`${item.at}-${index}`} className="gm-cand-sim">
              <span className="gm-cand-sim__a">
                <Masked text={item.text} />
              </span>
              <span className="gm-cand-sim__m">{[item.property ? buildingName(item.property) : null, shortDate(item.at, locale)].filter(Boolean).join(" · ")}</span>
            </div>
          ))}
        </section>
      ) : null}
      {hasButtons ? (
        foot === "bar" ? (
          <MobileBar>{buttonRow}</MobileBar>
        ) : (
          <div className={foot === "pc" ? "gm-cand-foot" : "gm-cand-inlinefoot"}>{buttonRow}</div>
        )
      ) : null}
    </>
  );
}

// ── 건물 정보 상세 ───────────────────────────────────────────────────────────

type BuildingActions = {
  onPut: (candidate: CandidateView, value: Localized) => Promise<boolean> | void;
  onSkip: (candidate: CandidateView) => Promise<boolean> | void;
  onRestore: (candidate: CandidateView) => Promise<boolean> | void;
  /** 긴 칸(`isLongValue`)은 부르는 쪽이 빼고 넘긴다 — `skippedLong` 은 뺀 수(토스트에 적는다). */
  onPutAll: (items: Array<{ candidate: CandidateView; value: Localized }>, skippedLong: number) => Promise<void> | void;
};

function FieldRow({
  candidate,
  copy,
  locale,
  kinds,
  busy,
  choice,
  setChoice,
  actions,
}: {
  candidate: CandidateView;
  copy: GmCopy;
  locale: string;
  kinds: readonly CandidateKind[];
  busy: boolean;
  choice: number;
  setChoice: (index: number) => void;
  actions: BuildingActions;
}) {
  const lang = langOf(locale);
  const [edit, setEdit] = useState<Localized | null>(null);
  const buttons = candidateButtons(candidate, kinds);
  const options = candidate.options;
  const conflict = options.length > 1;
  const chosen = options[Math.min(choice, options.length - 1)];
  const long = chosen ? isLongValue(chosen.value, lang) : false;
  const label = fieldLabel(copy, candidate.field);
  const state = candidate.status === "added" ? copy.candStatePut : candidate.status === "dismissed" ? copy.candStateDismissed : null;

  return (
    <div className="gm-cand-field" data-hl={conflict && candidate.status === "pending" ? "" : undefined}>
      <div className="gm-cand-field__top">
        <b>{label}</b>
        {state ? (
          <span className="gm-cand-field__tag">{state}</span>
        ) : conflict ? (
          <span className="gm-cand-field__tag">{copy.candConflict}</span>
        ) : null}
      </div>
      {conflict && candidate.status === "pending" ? (
        <div className="gm-cand-opts" role="radiogroup" aria-label={label}>
          {options.map((option, index) => (
            <button
              key={index}
              type="button"
              role="radio"
              className="gm-cand-opt"
              aria-checked={choice === index}
              onClick={() => {
                if (choice !== index) haptic("light");
                setChoice(index);
              }}
            >
              <span className="gm-cand-opt__dot" aria-hidden="true" />
              <span className="gm-cand-opt__v">{pick(option.value, lang)}</span>
              <span className="gm-cand-opt__s">
                {fill(index === 0 ? copy.candSourceLatest : copy.candSourceOlder, { n: option.count, date: shortDate(option.lastAt, locale) })}
              </span>
            </button>
          ))}
        </div>
      ) : chosen ? (
        <>
          <span className="gm-cand-field__val">{pick(chosen.value, lang)}</span>
          <span className="gm-cand-field__src">{fill(copy.candSource, { n: chosen.count, date: shortDate(chosen.lastAt, locale) })}</span>
        </>
      ) : null}
      {long && buttons.add && !edit ? <span className="gm-cand-field__src">{copy.candLongHint}</span> : null}
      {edit ? (
        <div className="gm-cand-field__edit">
          {GUEST_LANGS.map((l) => (
            <label key={l} className="gm-cand-notch" data-draft={chosen && edit[l] !== chosen.value[l] ? "" : undefined}>
              <span className="gm-cand-notch__label">{copy[LANG_KEY[l]]}</span>
              <textarea className="gm-cand-notch__input" rows={2} maxLength={1000} value={edit[l]} onChange={(event) => setEdit({ ...edit, [l]: event.target.value })} />
            </label>
          ))}
          <div className="gm-cand-field__act">
            <button type="button" className="gm-btn gm-btn--sm gm-btn--ghost" disabled={busy} onClick={() => setEdit(null)}>
              {copy.candCancel}
            </button>
            <button
              type="button"
              className="gm-btn gm-btn--sm gm-btn--primary"
              disabled={busy || GUEST_LANGS.every((l) => !edit[l].trim())}
              onClick={() => actions.onPut(candidate, edit)}
            >
              {copy.candPutEdited}
            </button>
          </div>
        </div>
      ) : buttons.add || buttons.restore ? (
        <div className="gm-cand-field__act">
          {buttons.add && chosen ? (
            <>
              <button
                type="button"
                className={long ? "gm-btn gm-btn--sm" : "gm-btn gm-btn--sm gm-btn--primary"}
                disabled={busy}
                onClick={() => actions.onPut(candidate, chosen.value)}
              >
                {copy.candPut}
              </button>
              <button
                type="button"
                className={long ? "gm-btn gm-btn--sm gm-btn--primary" : "gm-btn gm-btn--sm"}
                disabled={busy}
                onClick={() => {
                  haptic("light");
                  setEdit({ ...chosen.value });
                }}
              >
                {copy.candFixPut}
              </button>
            </>
          ) : null}
          {buttons.dismiss ? (
            <button type="button" className="gm-btn gm-btn--sm gm-btn--ghost" disabled={busy} onClick={() => actions.onSkip(candidate)}>
              {copy.candNo}
            </button>
          ) : null}
          {buttons.restore ? (
            <button type="button" className="gm-btn gm-btn--sm" disabled={busy} onClick={() => actions.onRestore(candidate)}>
              {copy.candRestore}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BuildingDetail({
  group,
  copy,
  locale,
  kinds,
  busy,
  leaving,
  position,
  actions,
}: {
  group: BuildingGroup;
  copy: GmCopy;
  locale: string;
  kinds: readonly CandidateKind[];
  busy: boolean;
  leaving: ReadonlySet<string>;
  position?: string;
  actions: BuildingActions;
}) {
  const buildingName = useBuildingName();
  const [choices, setChoices] = useState<Record<string, number>>({});
  const lang = langOf(locale);
  const pending = group.fields.filter((field) => field.status === "pending" && candidateButtons(field, kinds).add && field.options.length > 0);
  // 「고쳐서 넣기를 권해요」 칸(긴 글)은 모두 넣기에서 뺀다 — 하나씩 고쳐서 넣는다.
  const { items: putAllItems, skippedLong } = splitPutAll(pending, (field) => field.options[Math.min(choices[field.id] ?? 0, field.options.length - 1)].value, lang);
  return (
    <>
      <AiLine text={fill(copy.candInfoFrom, { n: group.fields.length })} position={position} />
      <div className="gm-cand-bhead">
        <h2>{buildingName(group.propertyName)}</h2>
        {pending.length > 1 && putAllItems.length > 0 ? (
          <button
            type="button"
            className="gm-btn gm-btn--sm gm-btn--primary"
            disabled={busy}
            onClick={() => void actions.onPutAll(putAllItems, skippedLong)}
          >
            {copy.candPutAll}
          </button>
        ) : null}
      </div>
      {pending.length > 1 && putAllItems.length > 0 && skippedLong > 0 ? <p className="gm-cand-off">{fill(copy.candPutAllSkipLong, { k: skippedLong })}</p> : null}
      <div className="gm-cand-fields">
        {group.fields.map((field) => (
          <div key={field.id} className="row-collapse" data-leaving={leaving.has(field.id) ? "" : undefined}>
            <div>
              <FieldRow
                candidate={field}
                copy={copy}
                locale={locale}
                kinds={kinds}
                busy={busy}
                choice={choices[field.id] ?? 0}
                setChoice={(index) => setChoices((prev) => ({ ...prev, [field.id]: index }))}
                actions={actions}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="gm-cand-off">
        <Lock size={13} aria-hidden="true" />
        <span>{copy.candWifiOff}</span>
      </p>
    </>
  );
}

// ── 결정 묶음(두 화면 공용) ─────────────────────────────────────────────────

type ActionHooks = {
  /** 되돌리기가 서버에서 끝났을 때 — 방금 돌아온 후보를 다시 고른다. */
  onUndone?: (candidate: CandidateView) => void;
};

function useActions(copy: GmCopy, locale: string, notify: Notify, data: ReturnType<typeof useCandidates>, hooks: ActionHooks = {}) {
  const { apply, reload } = data;
  const decide = useDecide(copy, apply, reload, notify);
  const { run, queue } = decide;
  const lang = langOf(locale);
  const titleOf = (candidate: CandidateView) => pick(candidate.title, lang);
  const { onUndone } = hooks;

  // 되돌리기도 결정과 같은 줄에 선다 — 아직 끝나지 않은 넣기 뒤에 닿는다.
  const undoWith = async (call: () => Promise<CandidateActionResult>, reselect: boolean) => {
    const result = await queue(call);
    if (!result.ok) {
      haptic("error");
      notify(actionError(copy, result.errorKey));
      if (result.errorKey === "not_found") reload(true);
      return false;
    }
    apply(result.candidate);
    if (reselect) onUndone?.(result.candidate);
    return true;
  };
  const undoToast = (call: () => Promise<CandidateActionResult>) => () => {
    void undoWith(call, true).then((ok) => ok && notify(copy.candToastUndone));
  };

  const phrase = {
    onAdd: async (candidate: CandidateView, draft: PhraseDraft | null) => {
      const input = draft ?? draftOf(candidate, locale);
      const done = await run([candidate.id], () => addReplyCandidate(candidate.id, { title: input.title, bodies: input.bodies }));
      if (!done) return false;
      haptic("success");
      notify(fill(copy.candToastAdded, { title: input.title }), undoToast(() => undoAddReplyCandidate(candidate.id)));
      return true;
    },
    onSkip: async (candidate: CandidateView) => {
      haptic("light");
      const done = await run([candidate.id], () => dismissReplyCandidate(candidate.id, "saved_reply"));
      if (!done) return false;
      notify(fill(copy.candToastSkipped, { title: titleOf(candidate) }), undoToast(() => restoreReplyCandidate(candidate.id, "saved_reply")));
      return true;
    },
    onRestore: async (candidate: CandidateView) => {
      haptic("light");
      const done = await run([candidate.id], () => restoreReplyCandidate(candidate.id, candidate.kind));
      if (!done) return false;
      notify(copy.candToastRestored);
      return true;
    },
  } satisfies PhraseActions;

  const building = {
    onPut: async (candidate: CandidateView, value: Localized) => {
      const done = await run([candidate.id], () => applyGuestInfoReplyCandidate(candidate.id, value));
      if (!done) return false;
      haptic("success");
      notify(fill(copy.candToastPut, { field: fieldLabel(copy, candidate.field) }), undoToast(() => undoGuestInfoReplyCandidate(candidate.id)));
      return true;
    },
    onSkip: async (candidate: CandidateView) => {
      haptic("light");
      const done = await run([candidate.id], () => dismissReplyCandidate(candidate.id, "guest_info"));
      if (!done) return false;
      notify(fill(copy.candToastFieldSkipped, { field: fieldLabel(copy, candidate.field) }), undoToast(() => restoreReplyCandidate(candidate.id, "guest_info")));
      return true;
    },
    onRestore: phrase.onRestore,
    onPutAll: async (items: Array<{ candidate: CandidateView; value: Localized }>, skippedLong: number) => {
      // 칸마다 차례로 — 서버가 매번 건물 정보를 다시 읽어 저장한다(동시에 쏘면 서로 덮는다).
      // 한 칸이 실패해도 나머지는 이어서 넣고, 결과는 토스트 하나로 합쳐 말한다(성공 토스트가 오류를 덮지 않게).
      // 이미 채워진 칸(conflict)은 실패로 세지 않는다 — 「건너뜀」으로 따로 말한다.
      const put: string[] = [];
      let failed = 0;
      let conflicts = 0;
      for (const item of items) {
        let conflict = false;
        const done = await run(
          [item.candidate.id],
          async () => {
            const result = await applyGuestInfoReplyCandidate(item.candidate.id, item.value);
            conflict = !result.ok && result.errorKey === "conflict";
            return result;
          },
          { silent: true },
        );
        if (done) put.push(item.candidate.id);
        else if (conflict) conflicts += 1;
        else failed += 1;
      }
      const outcome = putAllOutcome(put.length, failed, skippedLong, conflicts);
      const message = [
        fill(copy[outcome.key], { n: put.length, m: failed, c: conflicts }),
        outcome.conflictLeft ? fill(copy.candToastConflictLeft, { c: conflicts }) : null,
        outcome.longLeft ? fill(copy.candToastLongLeft, { k: skippedLong }) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      haptic(outcome.haptic);
      if (!outcome.undo) {
        notify(message);
        return;
      }
      notify(message, () => {
        void (async () => {
          let ok = true;
          for (const id of put) ok = (await undoWith(() => undoGuestInfoReplyCandidate(id), false)) && ok;
          if (ok) notify(copy.candToastUndone);
        })();
      });
    },
  } satisfies BuildingActions;

  return { phrase, building, busy: decide.busy, leaving: decide.leaving };
}

function useRun(copy: GmCopy, notify: Notify, markRunning: () => void) {
  const [running, setRunning] = useState(false);
  const start = useCallback(() => {
    setRunning(true);
    haptic("light");
    void runReplyCandidates()
      .catch(() => ({ ok: false as const, errorKey: "failed" as const }))
      .then((result) => {
        setRunning(false);
        if (!result.ok) {
          haptic("error");
          notify(runError(copy, result.errorKey));
          return;
        }
        markRunning();
        notify(copy.candRunStarted);
      });
  }, [copy, markRunning, notify]);
  return { running, start };
}

// ── PC ───────────────────────────────────────────────────────────────────────

/** PC 「정해 둔 문구」 탭 위 입구 띠 — 후보가 있을 때만(서버가 센 수). */
export function ReplyCandidatesEntryBand({ copy, replies, info }: { copy: GmCopy; replies: number; info: number }) {
  if (replies + info === 0) return null;
  const phraseFirst = replies > 0;
  return (
    <div className="gm-root">
      <div className="gm-cand-entry">
        <span className="gm-cand-entry__icon" aria-hidden="true">
          <PenLine size={16} strokeWidth={2} />
        </span>
        <span className="gm-cand-entry__txt">
          <b className="gm-cand-num">{phraseFirst ? fill(copy.candEntryTitle, { n: replies }) : fill(copy.candEntryInfoTitle, { n: info })}</b>
          <span>{copy.candEntrySub}</span>
        </span>
        <span className="gm-cand-entry__go">
          {phraseFirst && info > 0 ? (
            <Link className="gm-cand-entry__link" href="/admin/messages?tab=replies&cand=info">
              {fill(copy.candEntryInfoLink, { n: info })}
            </Link>
          ) : null}
          <Link className="gm-btn gm-btn--sm gm-btn--primary" href={`/admin/messages?tab=replies&cand=${phraseFirst ? "phrase" : "info"}`}>
            {copy.candEntryReview}
          </Link>
        </span>
      </div>
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/** PC 살펴보기 — 왼쪽 후보 목록 · 오른쪽 상세(편집기). `view` 로 문구 / 건물 정보. */
export function AdminReplyCandidates({
  copy,
  locale,
  view,
  similarTitles,
}: {
  copy: GmCopy;
  locale: string;
  view: "phrase" | "info";
  /** 비슷한 정해 둔 문구 id → 이름(서버가 정해 둔 문구에서 만든다). */
  similarTitles: Record<string, string>;
}) {
  const kind: CandidateKind = view === "phrase" ? "saved_reply" : "guest_info";
  const notifyRef = useRef<Notify | null>(null);
  const data = useCandidates(useRunEnd(copy, notifyRef));
  const { load, reload } = data;
  const toast = useCandToast("admin", copy.undo);
  const { notify } = toast;
  useEffect(() => {
    notifyRef.current = notify;
  });
  const [filter, setFilterState] = useState<CandidateFilter>("pending");
  const [selected, setSelectedState] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; value: PhraseDraft } | null>(null);
  // 사용자가 고른 자리를 바꿀 때마다 한 칸 — 결정을 기다리는 사이 다른 후보를 골랐으면 확인 뒤에도 옮기지 않는다.
  const [nav] = useState(createNavStamp);
  const setSelected = (id: string | null) => {
    nav.bump();
    setSelectedState(id);
  };
  const setFilter = (next: CandidateFilter) => {
    nav.bump();
    setFilterState(next);
  };
  const acts = useActions(copy, locale, notify, data, {
    // 되돌리면 방금 돌아온 후보를 다시 고른다(대기 목록으로 돌아와 있다).
    onUndone: (candidate) => {
      if (candidate.kind !== kind) return;
      setFilter("pending");
      setSelected(candidate.kind === "guest_info" ? candidate.propertyName : candidate.id);
    },
  });
  const runner = useRun(copy, notify, data.markRunning);
  const buildingName = useBuildingName();
  const lang = langOf(locale);

  const screen = candidateScreen(load, kind, filter);
  const overview = load.kind === "ready" ? load.overview : null;
  const kinds = load.kind === "ready" ? load.kinds : NO_KINDS;
  const items = useMemo(() => (overview ? candidatesFor(overview, kind, filter) : []), [overview, kind, filter]);
  const groups = useMemo(() => (view === "info" ? groupByBuilding(items) : []), [items, view]);
  const ids = view === "phrase" ? items.map((item) => item.id) : groups.map((group) => group.propertyName);
  const current = selected && ids.includes(selected) ? selected : (ids[0] ?? null);
  const counts = overview ? candidateCounts(overview, kind) : { pending: 0, added: 0, dismissed: 0 };
  const otherPending = overview ? candidateCounts(overview, kind === "saved_reply" ? "guest_info" : "saved_reply").pending : 0;
  const otherAllowed = kinds.includes(kind === "saved_reply" ? "guest_info" : "saved_reply");

  const phraseCurrent = view === "phrase" ? (items.find((item) => item.id === current) ?? null) : null;
  const groupCurrent = view === "info" ? (groups.find((group) => group.propertyName === current) ?? null) : null;
  const currentDraft = phraseCurrent && draft?.id === phraseCurrent.id ? draft.value : null;

  // 결정 뒤 같은 자리의 다음 후보로 — 다음은 누를 때 잡아 두고, 서버가 확인한 뒤에만 옮긴다.
  // 실패하면 같은 후보 · 고친 글이 그대로 남는다. 기다리는 사이 다른 후보를 골랐으면 목록만 고치고 고른 자리는 그대로.
  const advanceAfter = (removed: string, act: Promise<boolean> | void) => {
    const next = nextAfter(ids, removed);
    void whenConfirmedHere(act, nav, nav.take(), () => {
      setSelectedState(next);
      setDraft((prev) => (prev?.id === removed ? null : prev));
    });
  };
  const phraseActions: PhraseActions = {
    onAdd: (candidate, value) => advanceAfter(candidate.id, acts.phrase.onAdd(candidate, value)),
    onSkip: (candidate) => advanceAfter(candidate.id, acts.phrase.onSkip(candidate)),
    onRestore: (candidate) => advanceAfter(candidate.id, acts.phrase.onRestore(candidate)),
  };

  // 키: A 추가 · S 빼기 · ↓/↑ 다음 · 앞(글 쓰는 중엔 안 받음). 키로 하는 일엔 움직임을 넣지 않는다.
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const onKeyDown = (event: KeyboardEvent) => {
    if (view !== "phrase" || screen !== "list" || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    const index = current ? ids.indexOf(current) : -1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (ids.length === 0) return;
      event.preventDefault();
      const next = event.key === "ArrowDown" ? Math.min(ids.length - 1, index + 1) : Math.max(0, index - 1);
      setSelected(ids[next]);
      return;
    }
    if (!phraseCurrent || acts.busy) return;
    const buttons = candidateButtons(phraseCurrent, kinds);
    if ((event.key === "a" || event.key === "A") && buttons.add) {
      event.preventDefault();
      phraseActions.onAdd(phraseCurrent, currentDraft && isEdited(phraseCurrent, currentDraft, locale) ? currentDraft : null);
    } else if ((event.key === "s" || event.key === "S") && buttons.dismiss) {
      event.preventDefault();
      phraseActions.onSkip(phraseCurrent);
    }
  };
  useEffect(() => {
    keyRef.current = onKeyDown;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sourceCount = overview?.lastRun?.sourceCount ?? 0;
  const note = runButton(load) !== "hidden" ? runNoteText(copy, runNote(overview?.lastRun ?? null)) : null;
  // 건물 칸만 고치는 사람(관리 권한 없음)은 「정해 둔 문구」 탭이 없다 — 대화로 돌아간다.
  const backHref = kinds.includes("saved_reply") ? "/admin/messages?tab=replies" : "/admin/messages";
  const backLabel = kinds.includes("saved_reply") || load.kind !== "ready" ? copy.tabSavedReplies : copy.tabConversations;
  const intro =
    view === "phrase" ? (sourceCount > 0 ? fill(copy.candIntroPhrase, { n: sourceCount.toLocaleString(locale) }) : copy.candIntroPhraseNoCount) : copy.candIntroInfo;
  const filterItems: Array<{ id: CandidateFilter; label: string; count: number }> = [
    { id: "pending", label: copy.candFilterPending, count: counts.pending },
    { id: "added", label: view === "phrase" ? copy.candFilterAdded : copy.candFilterPut, count: counts.added },
    { id: "dismissed", label: copy.candFilterDismissed, count: counts.dismissed },
  ];

  let main: ReactNode;
  if (screen === "loading") {
    main = (
      <>
        <LoadingBox copy={copy} />
      </>
    );
  } else if (screen === "error") {
    main = (
      <StateBox tone="err" icon={<AlertTriangle size={22} />} title={copy.candErrTitle} body={copy.candErrBody}>
        <button type="button" className="gm-btn gm-btn--primary" onClick={() => reload()}>
          {copy.candRetry}
        </button>
      </StateBox>
    );
  } else if (screen === "forbidden") {
    main = <StateBox tone="err" icon={<Lock size={22} />} title={copy.forbidden} />;
  } else if (screen === "unavailable") {
    main = <StateBox icon={<Info size={22} />} title={copy.candUnavailableTitle} body={copy.candUnavailableBody} />;
  } else if (screen === "empty") {
    main = (
      <StateBox icon={<PenLine size={22} />} title={copy.candEmptyTitle} body={runButton(load) === "ready" ? copy.candEmptyRunBody : copy.candEmptyBody}>
        {runButton(load) !== "hidden" ? (
          <button type="button" className="gm-btn gm-btn--primary" disabled={runner.running || runButton(load) === "running"} onClick={runner.start}>
            {runner.running || runButton(load) === "running" ? copy.candRunning : copy.candRun}
          </button>
        ) : null}
      </StateBox>
    );
  } else if (screen === "done") {
    const total = counts.added + counts.dismissed;
    main = (
      <StateBox
        icon={<Check size={24} />}
        title={view === "phrase" ? copy.candDoneTitle : copy.candInfoDoneTitle}
        body={fill(view === "phrase" ? copy.candDoneBody : copy.candInfoDoneBody, { total, added: counts.added, dismissed: counts.dismissed })}
      >
        {view === "phrase" ? (
          <Link className="gm-btn gm-btn--primary" href="/admin/messages?tab=replies">
            {copy.candDoneSaved}
          </Link>
        ) : null}
        {otherAllowed && otherPending > 0 ? (
          <Link className="gm-btn" href={`/admin/messages?tab=replies&cand=${view === "phrase" ? "info" : "phrase"}`}>
            {fill(view === "phrase" ? copy.candDoneInfoLink : copy.candDonePhraseLink, { n: otherPending })}
          </Link>
        ) : null}
      </StateBox>
    );
  } else {
    main = null;
  }

  const showList = screen === "list" || screen === "filter-empty";

  return (
    <div className="gm-root gm-cand">
      <section className="gm-cand__list" aria-label={copy.candListLabel}>
        <Link className="gm-cand__back" href={backHref}>
          <ChevronLeft size={15} aria-hidden="true" />
          {backLabel}
        </Link>
        <div className="gm-cand__titlerow">
          <h1>{view === "phrase" ? copy.candTitlePhrase : copy.candTitleInfo}</h1>
          <RunButton load={load} copy={copy} onRun={runner.start} running={runner.running} />
        </div>
        <p className="gm-cand__intro">{intro}</p>
        {note ? <p className="gm-cand__note">{note}</p> : null}
        {showList || screen === "done" ? (
          <Filters label={copy.candFiltersLabel} items={filterItems} value={filter} onChange={setFilter} trailing={view === "phrase" && filter === "pending" ? <span className="gm-cand-sort">{copy.candSortAsked}</span> : null} />
        ) : null}
        {showList ? (
          screen === "filter-empty" ? (
            <p className="gm-cand-pick">{copy.candFilterEmpty}</p>
          ) : view === "phrase" ? (
            <div className="gm-cand-rows" role="listbox" aria-label={copy.candListLabel}>
              {items.map((item) => (
                <div key={item.id} className="row-collapse" data-leaving={acts.leaving.has(item.id) ? "" : undefined}>
                  <div>
                    <button
                      type="button"
                      role="option"
                      aria-selected={item.id === current}
                      className="gm-cand-row"
                      data-selected={item.id === current ? "" : undefined}
                      onClick={() => {
                        setSelected(item.id);
                      }}
                    >
                      <span className="gm-cand-row__main">
                        <b>{pick(item.title, lang)}</b>
                        <span>{pick(item.question, lang) || pick(item.bodies, lang)}</span>
                      </span>
                      {item.status === "pending" ? (
                        <span className="gm-cand-row__count">{fill(copy.candTimes, { n: item.askCount })}</span>
                      ) : (
                        <span className="gm-cand-row__state">{item.status === "added" ? copy.candStateAdded : copy.candStateDismissed}</span>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="gm-cand-rows" role="listbox" aria-label={copy.candListLabel}>
              {groups.map((group) => (
                <div key={group.propertyName} className="row-collapse">
                  <div>
                    <button
                      type="button"
                      role="option"
                      aria-selected={group.propertyName === current}
                      className="gm-cand-row"
                      data-selected={group.propertyName === current ? "" : undefined}
                      onClick={() => setSelected(group.propertyName)}
                    >
                      <span className="gm-cand-row__main">
                        <b>{buildingName(group.propertyName)}</b>
                        <span>
                          {group.conflicts > 0
                            ? fill(copy.candFieldsConflict, { n: group.fields.length, c: group.conflicts })
                            : fill(copy.candFieldsCount, { n: group.fields.length })}
                        </span>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          main
        )}
        {view === "phrase" && screen === "list" && filter === "pending" ? (
          <div className="gm-cand__kbd" aria-hidden="true">
            <span>
              <kbd>A</kbd>
              {copy.candKbdAdd}
            </span>
            <span>
              <kbd>S</kbd>
              {copy.candKbdSkip}
            </span>
            <span>
              <kbd>↓</kbd>
              {copy.candKbdNext}
            </span>
          </div>
        ) : null}
      </section>
      {showList ? (
        <aside className="gm-cand__editor" aria-live="polite">
          {phraseCurrent ? (
            <PhraseDetail
              key={phraseCurrent.id}
              candidate={phraseCurrent}
              copy={copy}
              locale={locale}
              kinds={kinds}
              position={fill(copy.candPosition, { i: ids.indexOf(phraseCurrent.id) + 1, n: ids.length })}
              busy={acts.busy}
              similarTitle={phraseCurrent.similarSavedReplyId ? (similarTitles[phraseCurrent.similarSavedReplyId] ?? null) : null}
              similarHref={phraseCurrent.similarSavedReplyId ? `/admin/messages?tab=replies&r=${phraseCurrent.similarSavedReplyId}` : null}
              draft={currentDraft}
              setDraft={(value) => setDraft(value ? { id: phraseCurrent.id, value } : null)}
              actions={phraseActions}
              foot="pc"
            />
          ) : groupCurrent ? (
            <BuildingDetail
              key={groupCurrent.propertyName}
              group={groupCurrent}
              copy={copy}
              locale={locale}
              kinds={kinds}
              busy={acts.busy}
              leaving={acts.leaving}
              position={fill(copy.candPosition, { i: ids.indexOf(groupCurrent.propertyName) + 1, n: ids.length })}
              actions={acts.building}
            />
          ) : (
            <p className="gm-cand-pick">{copy.candPickHint}</p>
          )}
        </aside>
      ) : null}
      {toast.node}
    </div>
  );
}

// ── 모바일 ───────────────────────────────────────────────────────────────────

/** 폰 대화 목록 위 한 줄 입구 — 후보가 있을 때만(서버가 센 수). */
export function MobileCandidatesEntry({ copy, replies, info }: { copy: GmCopy; replies: number; info: number }) {
  const total = replies + info;
  if (total === 0) return null;
  return (
    <Link className="gm-cand-entry" href="/mobile/messages/candidates">
      <span className="gm-cand-entry__icon" aria-hidden="true">
        <PenLine size={16} strokeWidth={2} />
      </span>
      <span className="gm-cand-entry__txt">
        <b className="gm-cand-num">{fill(copy.candEntryMobileTitle, { n: total })}</b>
        <span className="gm-cand-num">{fill(copy.candEntryMobileSub, { a: replies, b: info })}</span>
      </span>
      <span className="gm-cand-entry__go">
        <span className="gm-cand-entry__link">{copy.candEntryView}</span>
        <ChevronRight size={16} aria-hidden="true" color="var(--gm-muted)" />
      </span>
    </Link>
  );
}

type MobileFilter = "replies" | "info" | "done";
type MobileOpen = { type: "phrase"; id: string } | { type: "building"; name: string } | null;

function readOpen(): MobileOpen {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (id) return { type: "phrase", id };
  const building = params.get("b");
  if (building) return { type: "building", name: building };
  return null;
}

/** 모바일 살펴보기 — 폰: 목록 → 상세(주소 `?id=` · `?b=`, 뒤로는 화면 스와이프) · 폴드 이상: 목록 | 상세 둘로. */
export function MobileReplyCandidates({ copy, locale, similarTitles }: { copy: GmCopy; locale: string; similarTitles: Record<string, string> }) {
  const notifyRef = useRef<Notify | null>(null);
  const data = useCandidates(useRunEnd(copy, notifyRef));
  const { load, reload } = data;
  const toast = useCandToast("mobile", copy.undo);
  const { notify } = toast;
  useEffect(() => {
    notifyRef.current = notify;
  });
  const reopenRef = useRef<(candidate: CandidateView) => void>(() => {});
  const acts = useActions(copy, locale, notify, data, { onUndone: (candidate) => reopenRef.current(candidate) });
  const runner = useRun(copy, notify, data.markRunning);
  const buildingName = useBuildingName();
  const wide = useIsWide();
  const lang = langOf(locale);
  const kinds = load.kind === "ready" ? load.kinds : NO_KINDS;
  const overview = load.kind === "ready" ? load.overview : null;
  const [filter, setFilterState] = useState<MobileFilter | null>(null);
  const activeFilter: MobileFilter = filter ?? (kinds.includes("saved_reply") ? "replies" : "info");
  const [open, setOpenState] = useState<MobileOpen>(null);
  // 열린 자리가 바뀔 때마다 한 칸(목록 누름 · 뒤로 · 거르기) — 결정을 기다리는 사이 옮겼으면 확인 뒤에도 주소를 건드리지 않는다.
  const [nav] = useState(createNavStamp);
  const setFilter = (next: MobileFilter) => {
    nav.bump();
    setFilterState(next);
  };
  const [draft, setDraft] = useState<{ id: string; value: PhraseDraft } | null>(null);

  // 폰 상세는 주소에 남겨 뒤로(화면 스와이프)로 목록에 돌아온다.
  // 상세 주소(`?id=` · `?b=`)로 바로 들어왔으면 목록 한 칸을 밑에 깔아 둔다 — 뒤로가 /mobile 로 떨어지지 않고 목록으로.
  useEffect(() => {
    const sync = () => {
      nav.bump();
      setOpenState(readOpen());
    };
    const first = readOpen();
    const state = window.history.state as Record<string, unknown> | null;
    if (first && state?.gmCand !== "detail" && !window.matchMedia(FOLD_QUERY).matches) {
      const detailUrl = window.location.href;
      const listUrl = new URL(detailUrl);
      listUrl.searchParams.delete("id");
      listUrl.searchParams.delete("b");
      window.history.replaceState(state, "", listUrl);
      window.history.pushState({ ...(state ?? {}), gmCand: "detail" }, "", detailUrl);
    }
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [nav]);
  const setOpen = (next: MobileOpen, mode: "push" | "replace" = "push") => {
    nav.bump();
    setDraft(null);
    setOpenState(next);
    if (wide) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("id");
    url.searchParams.delete("b");
    if (next?.type === "phrase") url.searchParams.set("id", next.id);
    if (next?.type === "building") url.searchParams.set("b", next.name);
    const state = { ...((window.history.state as Record<string, unknown> | null) ?? {}), gmCand: next ? "detail" : "list" };
    if (mode === "push") window.history.pushState(state, "", url);
    else window.history.replaceState(state, "", url);
  };

  const phrases = useMemo(() => (overview ? candidatesFor(overview, "saved_reply", "pending") : []), [overview]);
  const groups = useMemo(() => (overview ? groupByBuilding(candidatesFor(overview, "guest_info", "pending")) : []), [overview]);
  const decided = useMemo(() => (overview ? overview.decided.filter((item) => kinds.includes(item.kind)) : []), [overview, kinds]);
  const phraseCounts = overview ? candidateCounts(overview, "saved_reply") : { pending: 0, added: 0, dismissed: 0 };
  const infoCounts = overview ? candidateCounts(overview, "guest_info") : { pending: 0, added: 0, dismissed: 0 };

  const findCandidate = (id: string) => phrases.find((item) => item.id === id) ?? decided.find((item) => item.id === id) ?? null;
  const findGroup = (name: string): BuildingGroup | null => groups.find((group) => group.propertyName === name) ?? null;

  // 폴드 이상: 고른 것이 없으면 지금 거르기의 첫 항목.
  const listIds: MobileOpen[] =
    activeFilter === "replies"
      ? phrases.map((item) => ({ type: "phrase", id: item.id }) as const)
      : activeFilter === "info"
        ? groups.map((group) => ({ type: "building", name: group.propertyName }) as const)
        : decided.filter((item) => item.kind === "saved_reply").map((item) => ({ type: "phrase", id: item.id }) as const);
  const openValid =
    open && (open.type === "phrase" ? findCandidate(open.id) !== null : findGroup(open.name) !== null) ? open : null;
  const shown: MobileOpen = wide ? (openValid ?? listIds[0] ?? null) : openValid;
  const keyOf = (item: MobileOpen) => (item ? (item.type === "phrase" ? `p:${item.id}` : `b:${item.name}`) : "");
  const shownKey = keyOf(shown);

  // 상세 → 목록. 밑에 목록 한 칸이 깔려 있으면(`gmCand: "detail"` — 목록에서 밀어 넣었거나 바로 들어와 깔아 둔 것)
  // 뒤로 돌아간다 — 바꿔 쓰면 [목록, 목록]이 남아 뒤로 한 번에 화면을 못 나간다. 아니면(폴드에서 바로 들어옴 등) 바꿔 쓴다.
  const closeDetail = () => {
    const state = window.history.state as Record<string, unknown> | null;
    if (!wide && state?.gmCand === "detail") {
      nav.bump();
      setDraft(null);
      setOpenState(null);
      window.history.back();
      return;
    }
    setOpen(null, "replace");
  };

  // 다음 후보는 누를 때 잡아 두고, 서버가 확인한 뒤에만 옮긴다 — 실패하면 같은 후보 · 고친 글 · 주소(`?id=`)가 그대로.
  // 기다리는 사이 뒤로 · 다른 후보로 옮겼으면 목록만 고치고 자리는 그대로(덮어쓰지 않는다).
  const advanceAfter = (removedKey: string, act: Promise<boolean> | void) => {
    const keys = listIds.map(keyOf);
    const nextKey = nextAfter(keys, removedKey);
    const next = nextKey ? (listIds[keys.indexOf(nextKey)] ?? null) : null;
    void whenConfirmedHere(act, nav, nav.take(), () => (next ? setOpen(next, "replace") : closeDetail()));
  };
  const phraseActions: PhraseActions = {
    onAdd: (candidate, value) => advanceAfter(`p:${candidate.id}`, acts.phrase.onAdd(candidate, value)),
    onSkip: (candidate) => advanceAfter(`p:${candidate.id}`, acts.phrase.onSkip(candidate)),
    onRestore: (candidate) => {
      void whenConfirmedHere(acts.phrase.onRestore(candidate), nav, nav.take(), () => {
        if (!wide) closeDetail();
      });
    },
  };
  useEffect(() => {
    // 되돌린 후보를 다시 연다(폰: 상세 주소로 · 폴드 이상: 오른쪽 칸). 거르기도 그 종류로.
    reopenRef.current = (candidate) => {
      setFilter(candidate.kind === "saved_reply" ? "replies" : "info");
      // 목록에 있으면 밀어 넣는다(밑에 목록이 깔려 뒤로 한 번에 목록) · 이미 상세면 바꿔 쓴다.
      const onDetail = (window.history.state as Record<string, unknown> | null)?.gmCand === "detail";
      const mode = onDetail ? "replace" : "push";
      if (candidate.kind === "saved_reply") setOpen({ type: "phrase", id: candidate.id }, mode);
      else if (candidate.propertyName) setOpen({ type: "building", name: candidate.propertyName }, mode);
    };
  });

  const screen = candidateScreen(load, activeFilter === "info" ? "guest_info" : "saved_reply", "pending");
  const sourceCount = overview?.lastRun?.sourceCount ?? 0;
  const runNoteLine = runButton(load) !== "hidden" ? runNoteText(copy, runNote(overview?.lastRun ?? null)) : null;

  const filterItems: Array<{ id: MobileFilter; label: string; count?: number }> = [];
  if (kinds.includes("saved_reply")) filterItems.push({ id: "replies", label: copy.candFilterReplies, count: phraseCounts.pending });
  if (kinds.includes("guest_info")) filterItems.push({ id: "info", label: copy.candFilterInfo, count: infoCounts.pending });
  filterItems.push({ id: "done", label: copy.candFilterDone, count: decided.length });

  // ── 상세 ──
  let detail: ReactNode = null;
  if (shown?.type === "phrase") {
    const candidate = findCandidate(shown.id);
    if (candidate) {
      const pool = candidate.status === "pending" ? phrases : decided;
      detail = (
        <PhraseDetail
          key={candidate.id}
          candidate={candidate}
          copy={copy}
          locale={locale}
          kinds={kinds}
          position={candidate.status === "pending" ? fill(copy.candPosition, { i: pool.indexOf(candidate) + 1, n: pool.length }) : undefined}
          busy={acts.busy}
          similarTitle={candidate.similarSavedReplyId ? (similarTitles[candidate.similarSavedReplyId] ?? null) : null}
          similarHref={null}
          draft={draft?.id === candidate.id ? draft.value : null}
          setDraft={(value) => setDraft(value ? { id: candidate.id, value } : null)}
          actions={phraseActions}
          foot={wide ? "inline" : "bar"}
        />
      );
    }
  } else if (shown?.type === "building") {
    const group = findGroup(shown.name);
    if (group) {
      detail = (
        <BuildingDetail
          key={group.propertyName}
          group={group}
          copy={copy}
          locale={locale}
          kinds={kinds}
          busy={acts.busy}
          leaving={acts.leaving}
          position={fill(copy.candPosition, { i: groups.indexOf(group) + 1, n: groups.length })}
          actions={acts.building}
        />
      );
    }
  }

  // ── 목록 ──
  let listBody: ReactNode;
  if (load.kind === "loading") {
    listBody = (
      <>
        <LoadingBox copy={copy} />
        <div className="gm-cand-skel" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </>
    );
  } else if (load.kind === "error") {
    listBody = (
      <StateBox tone="err" icon={<AlertTriangle size={22} />} title={copy.candErrTitle} body={copy.candErrBody}>
        <button type="button" className="gm-btn gm-btn--primary gm-btn--lg" onClick={() => reload()}>
          {copy.candRetry}
        </button>
      </StateBox>
    );
  } else if (kinds.length === 0) {
    listBody = <StateBox tone="err" icon={<Lock size={22} />} title={copy.forbidden} />;
  } else if (activeFilter === "done") {
    listBody =
      decided.length === 0 ? (
        <p className="gm-cand-pick">{copy.candFilterEmpty}</p>
      ) : (
        <div className="gm-cand-rows" role="list">
          {decided.map((item) => {
            const isPhrase = item.kind === "saved_reply";
            const title = isPhrase ? pick(item.title, lang) : `${item.propertyName ? buildingName(item.propertyName) : ""} · ${fieldLabel(copy, item.field)}`;
            const state = item.status === "added" ? (isPhrase ? copy.candStateAdded : copy.candStatePut) : copy.candStateDismissed;
            const selected = shownKey === `p:${item.id}`;
            const body = (
              <>
                <span className="gm-cand-row__main">
                  <b>{title}</b>
                  {isPhrase ? <span>{pick(item.bodies, lang)}</span> : <span>{item.options[0] ? pick(item.options[0].value, lang) : ""}</span>}
                </span>
                <span className="gm-cand-row__state">
                  {item.status === "added" ? <Check size={13} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 3 }} /> : null}
                  {state}
                </span>
              </>
            );
            return (
              <div key={item.id} className="row-collapse" role="listitem" data-leaving={acts.leaving.has(item.id) ? "" : undefined}>
                <div>
                  {isPhrase ? (
                    <button type="button" className="gm-cand-row" data-done={item.status === "added" ? "" : undefined} data-selected={selected ? "" : undefined} onClick={() => setOpen({ type: "phrase", id: item.id })}>
                      {body}
                    </button>
                  ) : (
                    <div className="gm-cand-row" style={{ cursor: "default" }}>
                      {body}
                      {item.status === "dismissed" && candidateButtons(item, kinds).restore ? (
                        <button type="button" className="gm-btn gm-btn--sm" disabled={acts.busy} onClick={() => acts.building.onRestore(item)}>
                          {copy.candRestore}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
  } else if (screen === "unavailable") {
    listBody = <StateBox icon={<Info size={22} />} title={copy.candUnavailableTitle} body={copy.candUnavailableBody} />;
  } else if (screen === "empty") {
    listBody = (
      <StateBox icon={<PenLine size={22} />} title={copy.candEmptyTitle} body={runButton(load) === "ready" ? copy.candEmptyRunBody : copy.candEmptyBody}>
        {runButton(load) !== "hidden" ? (
          <button type="button" className="gm-btn gm-btn--primary gm-btn--lg" disabled={runner.running || runButton(load) === "running"} onClick={runner.start}>
            {runner.running || runButton(load) === "running" ? copy.candRunning : copy.candRun}
          </button>
        ) : null}
      </StateBox>
    );
  } else if (screen === "done") {
    const counts = activeFilter === "replies" ? phraseCounts : infoCounts;
    const other = activeFilter === "replies" ? infoCounts.pending : phraseCounts.pending;
    const otherAllowed = kinds.includes(activeFilter === "replies" ? "guest_info" : "saved_reply");
    listBody = (
      <StateBox
        icon={<Check size={24} />}
        title={activeFilter === "replies" ? copy.candDoneTitle : copy.candInfoDoneTitle}
        body={fill(activeFilter === "replies" ? copy.candDoneBodyMobile : copy.candInfoDoneBody, { total: counts.added + counts.dismissed, added: counts.added, dismissed: counts.dismissed })}
      >
        {otherAllowed && other > 0 ? (
          <button type="button" className="gm-btn gm-btn--primary gm-btn--lg" onClick={() => setFilter(activeFilter === "replies" ? "info" : "replies")}>
            {activeFilter === "replies" ? fill(copy.candDoneInfoLink, { n: infoCounts.pending }) : fill(copy.candDonePhraseLink, { n: other })}
          </button>
        ) : null}
        <Link className="gm-btn gm-btn--lg" href="/mobile/messages">
          {copy.title}
        </Link>
      </StateBox>
    );
  } else if (activeFilter === "replies") {
    listBody = (
      <div className="gm-cand-rows" role="list">
        {phrases.map((item) => {
          const selected = shownKey === `p:${item.id}`;
          return (
            <div key={item.id} className="row-collapse" role="listitem" data-leaving={acts.leaving.has(item.id) ? "" : undefined}>
              <div>
                <button type="button" className="gm-cand-row" data-selected={wide && selected ? "" : undefined} aria-current={wide && selected ? "true" : undefined} onClick={() => setOpen({ type: "phrase", id: item.id })}>
                  <span className="gm-cand-row__main">
                    <b>{pick(item.title, lang)}</b>
                    <span>{pick(item.question, lang) || pick(item.bodies, lang)}</span>
                  </span>
                  <span className="gm-cand-row__count">{fill(copy.candTimes, { n: item.askCount })}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  } else {
    listBody = (
      <div className="gm-cand-rows" role="list">
        {groups.map((group) => {
          const selected = shownKey === `b:${group.propertyName}`;
          return (
            <div key={group.propertyName} className="row-collapse" role="listitem">
              <div>
                <button type="button" className="gm-cand-row" data-selected={wide && selected ? "" : undefined} aria-current={wide && selected ? "true" : undefined} onClick={() => setOpen({ type: "building", name: group.propertyName })}>
                  <span className="gm-cand-row__main">
                    <b>{buildingName(group.propertyName)}</b>
                    <span>
                      {group.conflicts > 0 ? fill(copy.candFieldsConflict, { n: group.fields.length, c: group.conflicts }) : fill(copy.candFieldsCount, { n: group.fields.length })}
                    </span>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const header = (
    <>
      <div className="gm-cand__titlerow">
        <h1>{copy.candTitleMobile}</h1>
        <RunButton load={load} copy={copy} onRun={runner.start} running={runner.running} />
      </div>
      <p className="gm-cand__intro">{sourceCount > 0 ? fill(copy.candIntroMobile, { n: sourceCount.toLocaleString(locale) }) : copy.candIntroMobileNoCount}</p>
      {runNoteLine ? <p className="gm-cand__note">{runNoteLine}</p> : null}
      {load.kind === "ready" && kinds.length > 0 ? (
        <Filters
          label={copy.candFiltersLabel}
          items={filterItems}
          value={activeFilter}
          onChange={(id) => {
            setFilter(id);
            if (wide) setOpenState(null);
          }}
        />
      ) : null}
    </>
  );

  // 폰 상세 화면
  if (!wide && shown && detail) {
    return (
      <div className="gm-root gm-cand-m" data-bar={shown.type === "phrase" ? "" : undefined}>
        {detail}
        {toast.node}
      </div>
    );
  }

  if (wide) {
    return (
      <div className="gm-root gm-cand-m">
        {header}
        <div className="gm-cand-split">
          <div>{listBody}</div>
          <div className="gm-cand-split__pane" aria-live="polite">
            {detail ?? (load.kind === "ready" && listIds.length > 0 ? <p className="gm-cand-pick">{copy.candPickHint}</p> : null)}
          </div>
        </div>
        {toast.node}
      </div>
    );
  }

  return (
    <div className="gm-root gm-cand-m">
      {header}
      {listBody}
      {toast.node}
    </div>
  );
}
