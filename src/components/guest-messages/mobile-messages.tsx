"use client";

/**
 * 모바일 손님 메시지 — 목록(`/mobile/messages`) → 대화(`/mobile/messages/[id]`). 문서 47 §5-2 · §5-4.
 * 태블릿 가로는 공용 `SplitList`(목록 | 대화 칸, 칸 안은 같은 대화 화면을 「칸 모드」로)를 쓴다 — 상세 주소가 있는 화면 규칙(16).
 * 폴드는 폰처럼 목록 → 대화로 넘어간다(레일만 보임). 탭바는 대화 화면에서도 그대로(결정 Q1). 뒤로는 공용 화면 스와이프.
 */

import { haptic } from "@/lib/haptics";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { AutoRunsList } from "@/components/guest-messages/auto-runs-list";
import { useBuildingName } from "@/components/shared/building-names";
import { TaskToast } from "@/components/tasks/task-toast";
import { StallNoticeLine } from "@/components/guest-messages/stall-notice";
import type { StallNotice } from "@/lib/guest-messages/channel-overview-server";
import {
  Composer,
  ConversationRowBody,
  InboxEmpty,
  InboxError,
  ReservationRows,
  ThreadMessages,
  errorText,
  useNow,
  usePlaceLabel,
} from "@/components/guest-messages/gm-parts";
import {
  bookingStateLabel,
  channelFilterLabel,
  channelName,
  fill,
  formatWhen,
  viewLangOptions,
  type GmCopy,
} from "@/components/guest-messages/gm-format";
import { useThread } from "@/components/guest-messages/use-thread";
import {
  INBOX_CHANNEL_FILTERS,
  parseChannelFilter,
  type InboxChannelFilter,
  type InboxListData,
  type StaffViewLang,
  type InboxStatusFilter,
  type InboxThread,
  type SnoozeInput,
} from "@/lib/guest-messages/inbox-model";
import type { LinkTargetType } from "@/lib/guest-messages/task-link-model";
import {
  TaskCreateForm,
  type TaskFormDraft,
  TaskKindList,
  pickedMessages,
  pickedPreviewLine,
  type TaskCategoryCopy,
} from "@/components/guest-messages/task-create";

/** 칸(iframe) 안 대화 → 왼쪽 목록에 「이 줄이 빠진다 / 돌아온다」를 서버를 기다리기 전에 알린다. */
const ROW_MESSAGE = "gm-row";
type RowMessage = { type: typeof ROW_MESSAGE; id: string; leaving: boolean };

function isRowMessage(data: unknown): data is RowMessage {
  return Boolean(data && typeof data === "object" && (data as { type?: unknown }).type === ROW_MESSAGE);
}

function tellList(id: string, leaving: boolean) {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage({ type: ROW_MESSAGE, id, leaving } satisfies RowMessage, window.location.origin);
}

type ToastState = {
  id: number;
  message: string;
  action?: { label: string; onAction: () => void };
} | null;

function useMobileToast() {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((message: string, action?: { label: string; onAction: () => void }) => {
    if (timer.current) window.clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, message, action });
    timer.current = window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), action ? 5000 : 2600);
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return { toast, show, dismiss };
}

function listHref(status: InboxStatusFilter, building: string | null, channel: InboxChannelFilter) {
  const params = new URLSearchParams();
  if (status !== "awaiting") params.set("status", status);
  if (building) params.set("building", building);
  if (channel !== "all") params.set("channel", channel);
  const query = params.toString();
  return query ? `/mobile/messages?${query}` : "/mobile/messages";
}

// ── 목록 ──────────────────────────────────────────────────────────────────────

export function MobileInbox({
  copy,
  locale,
  data,
  status,
  building,
  channel,
  stall = null,
}: {
  copy: GmCopy;
  locale: string;
  data: InboxListData | null;
  status: InboxStatusFilter;
  building: string | null;
  channel: InboxChannelFilter;
  /** `guest_messages.manage` 일 때만 서버가 채운다 — 받는 통로 멈춤 줄. */
  stall?: StallNotice | null;
}) {
  const router = useRouter();
  const { toast, show: notify, dismiss } = useMobileToast();
  const now = useNow();
  const buildingName = useBuildingName();
  const [leaving, setLeaving] = useState<Set<string>>(new Set());

  // 칸 안 대화가 보낸 「빠짐 / 되돌림」 — 서버 응답 전에 줄을 접고, 실패하면 다시 편다(16 「줄 접힘」).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isRowMessage(event.data)) return;
      const { id, leaving: isLeaving } = event.data;
      setLeaving((prev) => {
        const next = new Set(prev);
        if (isLeaving) next.add(id);
        else next.delete(id);
        return next;
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // 새 목록이 오면 접어 둔 표시를 비운다 — 다시 나타난 대화(되돌리기 · 새 손님 말)가 접힌 채 남지 않게.
  const rowsKey = data?.rows.map((row) => `${row.id}:${row.state}`).join("|") ?? "";
  const [seenKey, setSeenKey] = useState(rowsKey);
  if (seenKey !== rowsKey) {
    setSeenKey(rowsKey);
    if (leaving.size > 0) setLeaving(new Set());
  }

  return (
    <div className="gm-root">
      <div className="gm-mlist-head">
        <h1>{copy.title}</h1>
        <StallNoticeLine notice={stall} copy={copy} locale={locale} notify={(message) => notify(message)} />
        <div className="gm-mselects">
          <select
            className="gm-select"
            aria-label={copy.filterStatus}
            value={status}
            onChange={(event) => router.replace(listHref(event.target.value as InboxStatusFilter, building, channel))}
          >
            <option value="awaiting">{data ? fill(copy.filterAwaitingCount, { n: data.awaitingCount }) : copy.filterAwaiting}</option>
            <option value="snoozed">{copy.filterSnoozed}</option>
            <option value="done">{copy.filterDone}</option>
            <option value="all">{copy.filterAll}</option>
          </select>
          <select
            className="gm-select"
            aria-label={copy.filterBuilding}
            value={building ?? ""}
            onChange={(event) => router.replace(listHref(status, event.target.value || null, channel))}
          >
            <option value="">{copy.buildingAll}</option>
            {(data?.buildings ?? []).map((name) => (
              <option key={name} value={name}>
                {buildingName(name)}
              </option>
            ))}
          </select>
          <select
            className="gm-select"
            aria-label={copy.filterChannel}
            value={channel}
            onChange={(event) => router.replace(listHref(status, building, parseChannelFilter(event.target.value)))}
          >
            {INBOX_CHANNEL_FILTERS.map((value) => (
              <option key={value} value={value}>
                {channelFilterLabel(value, copy)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!data ? (
        <InboxError copy={copy} onRetry={() => router.refresh()} />
      ) : data.rows.length === 0 ? (
        <InboxEmpty filter={status} copy={copy} />
      ) : (
        <div className="gm-mrows">
          {data.rows.map((row) => (
            <div className="row-collapse" key={row.id} data-leaving={leaving.has(row.id) ? "" : undefined}>
              <div>
                <Link className="gm-row" href={`/mobile/messages/${row.id}`}>
                  <ConversationRowBody row={row} copy={copy} locale={locale} now={now} withTarget={false} withDates={false} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
      {toast ? <TaskToast key={toast.id} message={toast.message} action={toast.action} onDismiss={dismiss} /> : null}
    </div>
  );
}

// ── 대화 화면(폰 · 폴드 · 태블릿 칸 안) ────────────────────────────────────────

export function MobileThreadScreen({
  conversationId,
  initial,
  copy,
  locale,
  canReply,
  canManage = false,
  taskKinds = [],
  taskCategoryCopy,
}: {
  conversationId: string;
  initial: InboxThread | null;
  copy: GmCopy;
  locale: string;
  canReply: boolean;
  canManage?: boolean;
  /** 이 사람이 메시지에서 만들 수 있는 업무(6단계 — 서버 `creatableKinds`). */
  taskKinds?: LinkTargetType[];
  taskCategoryCopy: TaskCategoryCopy;
}) {
  const router = useRouter();
  const now = useNow();
  const placeLabel = usePlaceLabel();
  const { toast, show: notify, dismiss } = useMobileToast();
  const controller = useThread(conversationId, initial);
  const thread = controller.thread;
  // 번역해서 볼 언어 — 비우면 원문.
  const [viewLang, setViewLang] = useState<StaffViewLang | null>(null);
  const [sheet, setSheet] = useState<"none" | "info" | "more" | "snooze" | "lang" | "task" | "taskForm">("none");
  // 업무 만들기(6단계, 시안 R2PhoneTask) — 종류 시트 → 만들기 시트. 「손님 말 고르기」를 누르면 시트를 닫고 대화에서 말을 고른다.
  const [taskKind, setTaskKind] = useState<LinkTargetType | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  // 만들기 칸에 쓰던 값 — 「손님 말 고르기」로 시트가 닫혔다 다시 열려도 잇는다(만들거나 시트를 닫으면 비운다).
  const taskDraftRef = useRef<TaskFormDraft | null>(null);
  const subId = useId();

  const afterChange = () => {
    controller.refresh();
    router.refresh();
  };

  const setDone = (done: boolean) => {
    tellList(conversationId, done);
    controller.setDone(done, (result) => {
      if (!result.ok) {
        tellList(conversationId, !done);
        notify(errorText(result.errorKey, copy));
        return;
      }
      router.refresh();
      if (done)
        notify(copy.doneToast, {
          label: copy.undo,
          onAction: () => setDone(false),
        });
      else notify(copy.reopenToast);
    });
  };

  const snooze = (input: SnoozeInput) => {
    setSheet("none");
    tellList(conversationId, true);
    controller.snooze(input, (result) => {
      if (!result.ok) {
        tellList(conversationId, false);
        notify(errorText(result.errorKey, copy));
        return;
      }
      router.refresh();
      notify(
        fill(copy.snoozedToast, {
          time: result.snoozeUntil ? formatWhen(result.snoozeUntil, locale, new Date()) : "",
        }),
      );
    });
  };

  if (!thread) {
    return controller.error ? (
      <InboxError copy={copy} onRetry={controller.refresh} />
    ) : (
      <p className="gm-empty" aria-busy="true">
        {copy.loading}
      </p>
    );
  }

  const row = thread.conversation;
  const state = controller.state ?? row.state;
  const openTaskSheet = () => {
    if (picked.size === 0) {
      // 처음엔 마지막 손님 말 하나를 붙여 둔다.
      const lastGuest = [...thread.messages].reverse().find((m) => m.direction === "guest");
      if (lastGuest) setPicked(new Set([lastGuest.id]));
    }
    setSheet("task");
  };
  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startSelecting = () => {
    setSheet("none");
    setSelecting(true);
  };
  const finishSelecting = () => {
    setSelecting(false);
    setSheet(taskKind ? "taskForm" : "task");
  };
  const pickedList = pickedMessages(thread, picked);
  const sub = [channelName(row.channel, copy), placeLabel(row.propertyName, row.roomLabel), bookingStateLabel(row, copy, now)]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="gm-root gm-mthread">
      <div className="gm-mthread__head">
        {/* 이름이 버튼의 이름이 된다 — 「예약 정보 보기」는 덧붙인 설명(aria-describedby)으로 읽는다. */}
        <button type="button" className="gm-mthread__who" onClick={() => setSheet("info")} aria-describedby={subId}>
          <h1>{row.guestName || copy.guestUnknown}</h1>
          <span className="gm-mthread__sub">{sub}</span>
          <span id={subId} className="gm-sr-only">
            {copy.bookingInfo}
          </span>
        </button>
        <button
          type="button"
          className="gm-iconbtn"
          aria-pressed={viewLang !== null}
          aria-haspopup="dialog"
          aria-label={copy.viewLangLabel}
          onClick={() => setSheet("lang")}
        >
          <TranslateGlyph />
        </button>
        {canReply ? (
          <button
            type="button"
            className="gm-iconbtn"
            aria-label={state === "done" ? copy.reopen : copy.done}
            aria-pressed={state === "done"}
            disabled={controller.pending}
            onClick={() => setDone(state !== "done")}
          >
            <CheckGlyph />
          </button>
        ) : null}
        <button type="button" className="gm-iconbtn" aria-label={copy.more} onClick={() => setSheet("more")}>
          <MoreGlyph />
        </button>
      </div>
      <div className="gm-mthread__body">
        <ThreadMessages
          thread={thread}
          copy={copy}
          locale={locale}
          canReply={canReply}
          translateAll={viewLang !== null}
          viewLang={viewLang}
          notify={(message) => notify(message)}
          onChanged={afterChange}
          surface="mobile"
          selectable={selecting}
          pickedIds={picked}
          onTogglePick={togglePick}
        />
      </div>
      <div className="gm-mfoot">
        {selecting ? (
          <div className="gm-tselect" role="group" aria-label={copy.taskPickMessages}>
            <span className="gm-hint">{picked.size > 0 ? fill(copy.taskPickedCount, { n: picked.size }) : copy.taskSelectHint}</span>
            <button
              type="button"
              className="gm-btn"
              onClick={() => {
                setSelecting(false);
                setTaskKind(null);
                taskDraftRef.current = null;
              }}
            >
              {copy.taskSelectCancel}
            </button>
            <button type="button" className="gm-btn gm-btn--primary" onClick={finishSelecting}>
              {copy.taskSelectDone}
            </button>
          </div>
        ) : null}
        {/* 고르는 동안에도 답장 칸은 그대로 둔다(쓰던 글이 사라지지 않게) — 숨기기만. */}
        <div hidden={selecting}>
          <Composer
            key={row.id}
            thread={thread}
            copy={copy}
            locale={locale}
            canReply={canReply}
            canManageReplies={canManage}
            variant="phone"
            notify={(message) => notify(message)}
            onSent={afterChange}
          />
        </div>
      </div>

      {sheet === "info" ? (
        <BottomSheet onClose={() => setSheet("none")} ariaLabel={copy.bookingInfo} className="gm-root">
          <div className="gm-sheet">
            <h2 className="gm-sheet__title">{placeLabel(row.propertyName, row.roomLabel) || copy.bookingInfo}</h2>
            <ReservationRows reservation={thread.reservation} copy={copy} locale={locale} surface="mobile" />
            {/* 자동 안내(5단계) — 읽기만. 규칙 · 멈추기는 PC 전용. */}
            <AutoRunsList runs={thread.autoRuns} copy={copy} locale={locale} guestName={thread.conversation.guestName} />
          </div>
        </BottomSheet>
      ) : null}
      {sheet === "lang" ? (
        <BottomSheet onClose={() => setSheet("none")} ariaLabel={copy.viewLangLabel} className="gm-root">
          <div className="gm-sheet" role="radiogroup" aria-label={copy.viewLangLabel}>
            <h2 className="gm-sheet__title">{copy.viewLangLabel}</h2>
            {viewLangOptions(copy, locale).map((option) => (
              <button
                key={option.value ?? "original"}
                type="button"
                role="radio"
                aria-checked={viewLang === option.value}
                className="gm-sheet__item"
                onClick={() => {
                  haptic("light");
                  setViewLang(option.value);
                  setSheet("none");
                }}
              >
                <span className="gm-sheet__label">{option.label}</span>
                {viewLang === option.value ? <CheckGlyph /> : null}
              </button>
            ))}
          </div>
        </BottomSheet>
      ) : null}
      {sheet === "more" ? (
        <BottomSheet onClose={() => setSheet("none")} ariaLabel={copy.moreTitle} className="gm-root">
          <div className="gm-sheet">
            <h2 className="gm-sheet__title">{copy.moreTitle}</h2>
            {canReply ? (
              state === "snoozed" ? (
                <button
                  type="button"
                  className="gm-sheet__item"
                  onClick={() => {
                    setSheet("none");
                    controller.unsnooze((r) => (r.ok ? router.refresh() : notify(errorText(r.errorKey, copy))));
                  }}
                >
                  {copy.unsnooze}
                </button>
              ) : (
                <button type="button" className="gm-sheet__item" onClick={() => setSheet("snooze")}>
                  {copy.snooze}
                </button>
              )
            ) : null}
            {taskKinds.length > 0 ? (
              <button type="button" className="gm-sheet__item" onClick={openTaskSheet}>
                {copy.taskMake}
              </button>
            ) : null}
            <button type="button" className="gm-sheet__item" onClick={() => setSheet("info")}>
              {copy.bookingInfo}
            </button>
          </div>
        </BottomSheet>
      ) : null}
      {sheet === "task" ? (
        <BottomSheet onClose={() => setSheet("none")} ariaLabel={copy.taskMake} className="gm-root">
          <TaskKindList
            kinds={taskKinds}
            copy={copy}
            pickedPreview={pickedPreviewLine(pickedList, copy)}
            prefilledLine={
              placeLabel(row.propertyName, row.roomLabel)
                ? fill(copy.taskPrefilled, { place: placeLabel(row.propertyName, row.roomLabel), guest: row.guestName || copy.guestUnknown })
                : null
            }
            onPick={(kind) => {
              haptic("light");
              setTaskKind(kind);
              setSheet("taskForm");
            }}
            onPickMessages={startSelecting}
          />
        </BottomSheet>
      ) : null}
      {sheet === "taskForm" && taskKind ? (
        <BottomSheet
          onClose={() => {
            // 직접 내린 것 — 쓰던 값을 버린다(고르기 모드로 닫히는 것은 이 길을 지나지 않는다).
            taskDraftRef.current = null;
            setSheet("none");
          }}
          ariaLabel={copy.taskMake}
          className="gm-root flex max-h-[88dvh] flex-col"
        >
          {/* 칸이 길어 시트 안에서 스크롤 — 태블릿 가운데 카드(86dvh)에서 「만들기」가 카드 밖으로 밀려나던 것(2026-11-13 화면 확인). */}
          <div className="gm-tform-scroll">
          <TaskCreateForm
            thread={thread}
            kind={taskKind}
            kinds={taskKinds}
            onKindChange={setTaskKind}
            pickedIds={picked}
            copy={copy}
            locale={locale}
            categoryCopy={taskCategoryCopy}
            variant="phone"
            onClose={() => setSheet("none")}
            onPickMessages={startSelecting}
            draftRef={taskDraftRef}
            onBackgroundError={(message) => notify(message)}
            onCreated={(result) => {
              taskDraftRef.current = null;
              setSheet("none");
              setTaskKind(null);
              setPicked(new Set());
              controller.refresh();
              notify(
                result.linkFailed ? copy.taskLinkFailed : fill(copy.taskCreated, { kind: copy.taskKind[result.kind] }),
                { label: copy.taskOpen, onAction: () => router.push(result.mobileHref) },
              );
            }}
          />
          </div>
        </BottomSheet>
      ) : null}
      {sheet === "snooze" ? (
        <BottomSheet onClose={() => setSheet("none")} ariaLabel={copy.snoozeTitle} className="gm-root">
          <div className="gm-sheet">
            <h2 className="gm-sheet__title">{copy.snoozeTitle}</h2>
            <button type="button" className="gm-sheet__item" onClick={() => snooze({ preset: "1h" })}>
              {copy.snooze1h}
            </button>
            <button type="button" className="gm-sheet__item" onClick={() => snooze({ preset: "3h" })}>
              {copy.snooze3h}
            </button>
            <button type="button" className="gm-sheet__item" onClick={() => snooze({ preset: "tomorrow9" })}>
              {copy.snoozeTomorrow}
            </button>
          </div>
        </BottomSheet>
      ) : null}

      {toast ? <TaskToast key={toast.id} message={toast.message} action={toast.action} onDismiss={dismiss} /> : null}
    </div>
  );
}

function TranslateGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5h9M8.5 3v2M6 5c.5 3 2.6 5.6 5 7M11 5c-.6 3.4-3 6.4-6.5 8" />
      <path d="m13 21 4-9 4 9M14.5 18h5" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.7 2.7L16 9.8" />
    </svg>
  );
}

function MoreGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </svg>
  );
}
