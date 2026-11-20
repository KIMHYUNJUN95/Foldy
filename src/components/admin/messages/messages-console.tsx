"use client";

/**
 * PC 손님 메시지함 `/admin/messages` — 왼쪽 목록 · 가운데 대화 · 오른쪽 예약 정보(시안 R2Main). docs/product/47 §5-1
 * 필터는 주소(`?status=&building=&c=`) — 새로고침 · 링크로 같은 화면. 처음 목록은 서버가 주고, 대화는 서버 액션으로 읽는다.
 * 실시간(47 §5-9): 신호의 대화만 서버 액션으로 다시 읽어 그 자리에서 합친다 — 서버 렌더를 다시 받지 않는다.
 * 2단계 범위: 대화 탭만(자동 안내 · 정해 둔 문구 · 설정 탭은 그 단계에서 — 빈 탭을 그리지 않는다).
 */

import { haptic } from "@/lib/haptics";
import { setAutoRunPausedAction } from "@/app/admin/messages/auto-actions";
import { AutoRunsList } from "@/components/guest-messages/auto-runs-list";
import type { AutoRunView } from "@/lib/guest-messages/auto-model";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdmDropdown, type AdmOption } from "@/components/admin/shared/adm-dropdown";
import { AdminDatePicker } from "@/components/admin/shared/admin-date-picker";
import { AdminTimePicker } from "@/components/admin/shared/admin-time-picker";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { AdminUndoToast } from "@/components/admin/shared/admin-undo-toast";
import { useBuildingName } from "@/components/shared/building-names";
import {
  Composer,
  ConversationRowBody,
  InboxEmpty,
  InboxError,
  ReservationRows,
  ThreadMessages,
  ThreadMetaLine,
  errorText,
  useNow,
  usePlaceLabel,
} from "@/components/guest-messages/gm-parts";
import {
  bookingStateLabel,
  channelFilterLabel,
  fill,
  formatWhen,
  viewLangOptions,
  type GmCopy,
} from "@/components/guest-messages/gm-format";
import { useThread } from "@/components/guest-messages/use-thread";
import { useInboxLive } from "@/components/guest-messages/use-inbox-live";
import { useInboxSearch } from "@/components/guest-messages/use-inbox-search";
import { InboxSearchBox, InboxSearchState, searchRows } from "@/components/guest-messages/inbox-search-view";
import { NewMessagesPill, useThreadFollow } from "@/components/guest-messages/thread-follow";
import { useLiveChanges } from "@/components/shared/live-refresh";
import { guestInboxLiveSources, guestThreadLiveSources } from "@/lib/live-sources";
import { idsOfKind, liveKeysOf, pruneLocalLeaving, touchesThread } from "@/lib/guest-messages/live-merge";
import { StallNoticeLine } from "@/components/guest-messages/stall-notice";
import { BuildingGuestInfoPanel } from "@/components/admin/messages/building-guest-info-panel";
import type { StallNotice } from "@/lib/guest-messages/channel-overview-server";
import { guestWrites } from "@/components/guest-messages/guest-writes";
import type { Dictionary } from "@/lib/i18n";
import {
  INBOX_CHANNEL_FILTERS,
  isStaffViewLang,
  parseChannelFilter,
  type InboxChannelFilter,
  type InboxListData,
  type StaffViewLang,
  type InboxStatusFilter,
  type InboxThread,
  type SnoozeInput,
} from "@/lib/guest-messages/inbox-model";
import { tokyoDateOf } from "@/lib/tokyo-date";
import type { LinkTargetType } from "@/lib/guest-messages/task-link-model";
import { TaskCreateForm, TaskPanelSection, type TaskCategoryCopy } from "@/components/guest-messages/task-create";
import { AssistSimilarSection } from "@/components/guest-messages/ai-assist";
import type { AssistSimilar } from "@/lib/guest-messages/ai-assist-types";

type Shared = Dictionary["admin"]["shared"];

export function MessagesConsole({
  organizationId,
  copy,
  shared,
  locale,
  data,
  status,
  building,
  channel,
  selectedId,
  initialThread,
  canReply,
  canManage = false,
  stall = null,
  taskKinds = [],
  taskCategoryCopy,
  initialQuery = "",
}: {
  /** 실시간 구독 필터(조직) — 권한 · 조직 판정은 서버 액션이 다시 한다. */
  organizationId: string;
  copy: GmCopy;
  shared: Shared;
  locale: string;
  data: InboxListData | null;
  status: InboxStatusFilter;
  building: string | null;
  channel: InboxChannelFilter;
  selectedId: string | null;
  initialThread: InboxThread | null;
  canReply: boolean;
  /** `guest_messages.manage` — 「문구 관리」 링크 · 받는 통로 멈춤 줄. */
  canManage?: boolean;
  stall?: StallNotice | null;
  /** 이 사람이 메시지에서 만들 수 있는 업무(6단계 — 서버 `creatableKinds`). */
  taskKinds?: LinkTargetType[];
  taskCategoryCopy: TaskCategoryCopy;
  /** 주소 `q` — 필터를 바꿔 다시 그려도 검색이 이어진다. */
  initialQuery?: string;
}) {
  const router = useRouter();
  const now = useNow();
  const buildingName = useBuildingName();
  const inbox = useInboxLive(data, { status, building, channel });
  const list = inbox.list;
  const search = useInboxSearch({ status, building, channel }, initialQuery);
  const found = search.active ? searchRows(search) : null;
  const [selected, setSelected] = useState<string | null>(selectedId ?? data?.rows[0]?.id ?? null);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const { toast, showToast, dismiss } = useAdminToast();
  const [undo, setUndo] = useState<{ id: string; stamp: number } | null>(null);
  // 번역해서 볼 언어 — 비우면 원문(§9).
  const [viewLang, setViewLang] = useState<StaffViewLang | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  // 답장 칸 「건물 정보 고치기」 — 이 화면 안에서 손님용 칸 패널을 연다(§6-3).
  const [editBuilding, setEditBuilding] = useState<string | null>(null);
  // 건물 손님용 정보를 저장하면 올린다 — 답장 칸 넣기 목록이 새 값으로 다시 읽힌다.
  const [insertsRefreshKey, setInsertsRefreshKey] = useState(0);
  // AI 도우미의 비슷한 과거 대화(49 §8-5) — 답장 칸이 읽어 오고, 오른쪽 패널이 그린다. 대화 id 로 묶어 옛 대화 것이 남지 않게.
  const [assistSimilar, setAssistSimilar] = useState<{ id: string; list: AssistSimilar[] } | null>(null);
  // 먼저 접어 둔 줄은 서버 답이 올 때까지 접힌 채 — 다른 줄의 실시간 합치기로 펴지 않는다(16 「줄 접힘」: 실패할 때만 다시 편다).
  // 그 줄이 목록에서 빠지면 표시를 지운다(나중에 같은 대화가 다시 들어오면 펴진 채로 나타나게).
  const rowIds = list?.rows.map((row) => row.id).join("|") ?? "";
  const [seenRowIds, setSeenRowIds] = useState(rowIds);
  if (seenRowIds !== rowIds) {
    setSeenRowIds(rowIds);
    const pruned = pruneLocalLeaving(leaving, list?.rows ?? []);
    if (pruned !== leaving) setLeaving(pruned);
  }
  const controller = useThread(selected, initialThread);
  const thread = controller.thread;
  const follow = useThreadFollow(thread);
  const bookingNumber = thread?.conversation.id === selected ? (thread?.reservation.bookingNumber ?? null) : null;

  // 실시간(47 §5-9) — 목록 줄은 그 대화만, 열린 대화는 조용히 다시 읽어 합친다. 들어온 말에는 햅틱 없음.
  // 목록 채널은 고른 대화와 상관없이 그대로 — 대화를 바꿔도 목록 구독이 끊기지 않는다.
  const listSources = useMemo(() => guestInboxLiveSources(organizationId), [organizationId]);
  useLiveChanges(listSources, {
    toKeys: (change) => liveKeysOf(change).filter((key) => key.startsWith("c:")),
    // 검색 중이면 결과는 같은 검색어로 다시 찾아 갈아 끼운다(줄을 하나씩 고치면 필터 · 순서가 어긋난다). 신호마다 찾지 않고 5초에 한 번까지(`live`).
    onFlush: (keys) => {
      void inbox.applyIds(idsOfKind(keys, "c"));
      search.live();
    },
    onCatchUp: () => {
      void inbox.reload();
      search.live();
    },
  });
  // 열린 대화 구독 — 대화를 바꿔도 같은 조직 토픽 채널을 그대로 쓰고(필터는 신호가 올 때 지금 대화로 거른다, `liveSubscriptionKey`),
  // 소켓이 다시 붙으면 따라잡기(그 대화 다시 읽기).
  const threadSources = useMemo(
    () => (selected ? guestThreadLiveSources(organizationId, selected) : []),
    [organizationId, selected],
  );
  const refreshThread = controller.refresh;
  useLiveChanges(threadSources, {
    toKeys: (change) => (selected && touchesThread(liveKeysOf(change), selected, bookingNumber) ? ["thread"] : []),
    onFlush: () => refreshThread(),
    onCatchUp: () => refreshThread(),
  });
  // 업무 만들기(6단계) — 열면 오른쪽 패널이 만들기 칸이 되고 손님 말을 눌러 붙인다(시안 R2Task).
  const [taskKind, setTaskKind] = useState<LinkTargetType | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const openTask = (kind: LinkTargetType) => {
    setTaskKind(kind);
    if (picked.size === 0 && thread) {
      // 처음엔 마지막 손님 말 하나를 붙여 둔다 — 다른 말은 눌러서 더하거나 뺀다.
      const lastGuest = [...thread.messages].reverse().find((m) => m.direction === "guest");
      if (lastGuest) setPicked(new Set([lastGuest.id]));
    }
  };
  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hrefFor = useCallback(
    (next: { status?: InboxStatusFilter; building?: string | null; channel?: InboxChannelFilter; c?: string | null }) => {
      const params = new URLSearchParams();
      const s = next.status ?? status;
      const b = next.building === undefined ? building : next.building;
      const c = next.c === undefined ? selected : next.c;
      if (s !== "all") params.set("status", s);
      const ch = next.channel ?? channel;
      if (b) params.set("building", b);
      if (ch !== "all") params.set("channel", ch);
      if (c) params.set("c", c);
      if (search.query) params.set("q", search.query);
      const query = params.toString();
      return query ? `/admin/messages?${query}` : "/admin/messages";
    },
    [building, channel, search.query, selected, status],
  );

  const choose = (id: string) => {
    setSelected(id);
    setSnoozeOpen(false);
    setTaskKind(null);
    setPicked(new Set());
    window.history.replaceState(null, "", hrefFor({ c: id }));
  };

  const afterChange = () => {
    controller.refresh();
    if (selected) void inbox.applyIds([selected]);
    search.refresh();
  };
  const afterSend = () => {
    follow.follow();
    afterChange();
  };

  const statusOptions: AdmOption[] = [
    {
      value: "awaiting",
      label: list ? fill(copy.filterAwaitingCount, { n: list.awaitingCount }) : copy.filterAwaiting,
    },
    { value: "snoozed", label: copy.filterSnoozed },
    { value: "done", label: copy.filterDone },
    { value: "all", label: copy.filterAll },
  ];
  const buildingOptions: AdmOption[] = [
    { value: "", label: copy.buildingAll },
    ...(list?.buildings ?? []).map((name) => ({
      value: name,
      label: buildingName(name),
    })),
  ];

  const channelOptions: AdmOption[] = INBOX_CHANNEL_FILTERS.map((value) => ({
    value,
    label: channelFilterLabel(value, copy),
  }));

  const markDone = (done: boolean) => {
    const id = selected;
    if (!id) return;
    const willLeave = (status === "awaiting" && done) || (status === "done" && !done);
    if (willLeave) setLeaving((prev) => new Set(prev).add(id));
    controller.setDone(done, (result) => {
      if (result.ok) {
        if (done) setUndo({ id, stamp: Date.now() });
        else showToast(copy.reopenToast);
        void inbox.applyIds([id]);
        search.refresh();
      } else {
        setLeaving((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        showToast(errorText(result.errorKey, copy));
      }
    });
  };

  const applySnooze = (input: SnoozeInput) => {
    const id = selected;
    if (!id) return;
    if (status === "awaiting") setLeaving((prev) => new Set(prev).add(id));
    setSnoozeOpen(false);
    controller.snooze(input, (result) => {
      if (result.ok) {
        showToast(
          fill(copy.snoozedToast, {
            time: result.snoozeUntil ? formatWhen(result.snoozeUntil, locale, new Date()) : "",
          }),
        );
        void inbox.applyIds([id]);
        search.refresh();
      } else {
        setLeaving((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        showToast(errorText(result.errorKey, copy));
      }
    });
  };

  const state = controller.state ?? thread?.conversation.state ?? null;

  return (
    <div className="gm-root gm-console">
      <section className="gm-console__list" aria-label={copy.listLabel}>
        <InboxSearchBox search={search} copy={copy} />
        <div className="gm-filters">
          <AdmDropdown
            options={statusOptions}
            value={status}
            ariaLabel={copy.filterStatus}
            onChange={(value) => router.replace(hrefFor({ status: value as InboxStatusFilter, c: null }))}
          />
          <AdmDropdown
            options={buildingOptions}
            value={building ?? ""}
            ariaLabel={copy.filterBuilding}
            onChange={(value) => router.replace(hrefFor({ building: value || null, c: null }))}
          />
          <AdmDropdown
            options={channelOptions}
            value={channel}
            ariaLabel={copy.filterChannel}
            onChange={(value) => router.replace(hrefFor({ channel: parseChannelFilter(value), c: null }))}
          />
        </div>
        {canManage ? <StallNoticeLine notice={stall} copy={copy} locale={locale} notify={(message) => showToast(message)} /> : null}
        <div className="gm-scroll">
          {search.active ? (
            <>
              <InboxSearchState search={search} copy={copy} />
              {found && found.length > 0 ? (
                <div data-stale={search.loading ? "" : undefined}>
                  {found.map(({ row, match }) => (
                    <div className="row-collapse" key={row.id} data-leaving={leaving.has(row.id) ? "" : undefined}>
                      <div>
                        <button
                          type="button"
                          className="gm-row"
                          aria-current={row.id === selected ? "true" : undefined}
                          onClick={() => choose(row.id)}
                        >
                          <ConversationRowBody row={row} copy={copy} locale={locale} now={now} withDates match={match} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : !list ? (
            <InboxError copy={copy} onRetry={() => void inbox.reload()} />
          ) : list.rows.length === 0 ? (
            <InboxEmpty filter={status} copy={copy} />
          ) : (
            list.rows.map((row) => (
              <div
                className="row-collapse"
                key={row.id}
                data-leaving={leaving.has(row.id) || inbox.leaving.has(row.id) ? "" : undefined}
                data-entering={inbox.entered.has(row.id) ? "" : undefined}
              >
                <div>
                  <button
                    type="button"
                    className="gm-row"
                    aria-current={row.id === selected ? "true" : undefined}
                    onClick={() => choose(row.id)}
                  >
                    <ConversationRowBody row={row} copy={copy} locale={locale} now={now} withDates />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="gm-console__thread" aria-label={copy.threadLabel}>
        {!selected ? (
          <p className="gm-empty">{copy.pickConversation}</p>
        ) : !thread ? (
          controller.error ? (
            <InboxError copy={copy} onRetry={controller.refresh} />
          ) : (
            <p className="gm-empty" aria-busy="true">
              {copy.loading}
            </p>
          )
        ) : (
          <>
            <div className="gm-thead">
              <div className="gm-thead__who">
                <b className="gm-thead__name">{thread.conversation.guestName || copy.guestUnknown}</b>
                <ThreadMetaLine row={thread.conversation} copy={copy} locale={locale} now={now} />
              </div>
              <div className="gm-thead__actions">
                <AdmDropdown
                  options={viewLangOptions(copy, locale).map((option) => ({
                    value: option.value ?? "",
                    label: option.value ? option.label : viewLang ? copy.translateViewOff : copy.translateView,
                  }))}
                  value={viewLang ?? ""}
                  ariaLabel={copy.viewLangLabel}
                  onChange={(value) => setViewLang(isStaffViewLang(value) ? value : null)}
                />
                {canReply ? (
                  <>
                    {state === "snoozed" ? (
                      <button
                        type="button"
                        className="gm-btn"
                        disabled={controller.pending}
                        onClick={() => {
                          const id = selected;
                          controller.unsnooze((r) => {
                            if (!r.ok) showToast(errorText(r.errorKey, copy));
                            else if (id) void inbox.applyIds([id]);
                          });
                        }}
                      >
                        {copy.unsnooze}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="gm-btn"
                        aria-expanded={snoozeOpen}
                        aria-haspopup="dialog"
                        onClick={() => setSnoozeOpen((v) => !v)}
                      >
                        <ClockIcon />
                        {copy.snooze}
                      </button>
                    )}
                    {state === "done" ? (
                      <button type="button" className="gm-btn" disabled={controller.pending} onClick={() => markDone(false)}>
                        {copy.reopen}
                      </button>
                    ) : (
                      <button type="button" className="gm-btn" disabled={controller.pending} onClick={() => markDone(true)}>
                        <CheckIcon />
                        {copy.done}
                      </button>
                    )}
                    {snoozeOpen ? (
                      <SnoozePopover
                        copy={copy}
                        shared={shared}
                        locale={locale}
                        onPick={applySnooze}
                        onClose={() => setSnoozeOpen(false)}
                      />
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
            <div className="gm-tbody">
              <ThreadMessages
                thread={thread}
                copy={copy}
                locale={locale}
                canReply={canReply}
                translateAll={viewLang !== null}
                viewLang={viewLang}
                notify={(message) => showToast(message)}
                onChanged={afterChange}
                surface="admin"
                selectable={taskKind !== null}
                pickedIds={picked}
                onTogglePick={togglePick}
                endRef={follow.endRef}
              />
            </div>
            <div className="gm-tfoot">
              <NewMessagesPill count={follow.unseen} copy={copy} onJump={follow.jump} />
              <Composer
                key={thread.conversation.id}
                organizationId={organizationId}
                thread={thread}
                copy={copy}
                locale={locale}
                canReply={canReply}
                variant="pc"
                notify={(message) => showToast(message)}
                onSent={afterSend}
                canManageReplies={canManage}
                onEditBuilding={setEditBuilding}
                insertsRefreshKey={insertsRefreshKey}
                onAssistSimilar={(list) => setAssistSimilar({ id: thread.conversation.id, list })}
              />
            </div>
          </>
        )}
      </section>

      {thread && taskKind ? (
        <aside className="gm-console__panel gm-console__panel--task" aria-label={copy.taskMake}>
          <TaskCreateForm
            key={thread.conversation.id}
            thread={thread}
            kind={taskKind}
            kinds={taskKinds}
            onKindChange={setTaskKind}
            pickedIds={picked}
            copy={copy}
            locale={locale}
            categoryCopy={taskCategoryCopy}
            variant="pc"
            onClose={() => setTaskKind(null)}
            onBackgroundError={(message) => showToast(message)}
            onCreated={(result) => {
              showToast(result.linkFailed ? copy.taskLinkFailed : fill(copy.taskCreated, { kind: copy.taskKind[result.kind] }));
              setTaskKind(null);
              setPicked(new Set());
              controller.refresh();
            }}
          />
        </aside>
      ) : thread ? (
        <ReservationPanel
          key={thread.conversation.id}
          thread={thread}
          copy={copy}
          locale={locale}
          now={now}
          canPause={canManage || canReply}
          canManage={canManage}
          notify={(message) => showToast(message)}
          taskKinds={taskKinds}
          onPickTask={openTask}
          similar={assistSimilar?.id === thread.conversation.id ? assistSimilar.list : []}
        />
      ) : (
        <aside className="gm-console__panel" aria-label={copy.panelLabel} />
      )}

      {editBuilding ? (
        <BuildingGuestInfoPanel
          canonicalName={editBuilding}
          copy={copy}
          locale={locale}
          onClose={() => setEditBuilding(null)}
          notify={(message) => showToast(message)}
          onSaved={() => setInsertsRefreshKey((n) => n + 1)}
        />
      ) : null}
      {toast ? <AdminToast key={toast.id} message={toast.message} onDismiss={dismiss} /> : null}
      {undo ? (
        <AdminUndoToast
          stamp={undo.stamp}
          message={copy.doneToast}
          undoLabel={copy.undo}
          onExpire={() => setUndo(null)}
          onUndo={() => {
            const id = undo.id;
            setUndo(null);
            setLeaving((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            if (id === selected) {
              markDone(false);
              return;
            }
            // 다른 대화로 옮긴 뒤 되돌리기 — 그 대화만 다시 답장 기다림으로.
            void guestWrites.setDone(id, false).then((result) => {
              if (result.ok) void inbox.applyIds([id]);
              else showToast(errorText(result.errorKey, copy));
            });
          }}
        />
      ) : null}
    </div>
  );
}

function ReservationPanel({
  thread,
  copy,
  locale,
  now,
  canPause,
  canManage,
  notify,
  taskKinds,
  onPickTask,
  similar,
}: {
  thread: InboxThread;
  copy: GmCopy;
  locale: string;
  now: Date;
  canPause: boolean;
  canManage: boolean;
  notify: (message: string) => void;
  taskKinds: LinkTargetType[];
  onPickTask: (kind: LinkTargetType) => void;
  similar: AssistSimilar[];
}) {
  const placeLabel = usePlaceLabel();
  const row = thread.conversation;
  // 이 예약의 자동 안내(5단계) — 멈추기 · 다시 보내기는 바로 반영하고 실패하면 되돌린다.
  const [runs, setRuns] = useState(thread.autoRuns);
  const [seenRuns, setSeenRuns] = useState(thread.autoRuns);
  if (seenRuns !== thread.autoRuns) {
    setSeenRuns(thread.autoRuns);
    setRuns(thread.autoRuns);
  }
  const [busyRun, setBusyRun] = useState<string | null>(null);
  const pause = async (run: AutoRunView, paused: boolean) => {
    if (busyRun) return;
    setBusyRun(run.id);
    const before = runs;
    setRuns((current) => current.map((item) => (item.id === run.id ? { ...item, status: paused ? "paused" : "scheduled", skipReason: null, missingVariables: [], paused } : item)));
    const result = await setAutoRunPausedAction(run.id, paused);
    setBusyRun(null);
    if (result.ok) {
      haptic("light");
      notify(paused ? copy.autoPausedToast : copy.autoResumedToast);
    } else {
      haptic("error");
      setRuns(before);
      notify(result.errorKey === "locked" ? copy.autoPauseLocked : result.errorKey === "forbidden" ? copy.forbidden : copy.autoErrFailed);
    }
  };
  return (
    <aside className="gm-console__panel" aria-label={copy.panelLabel}>
      <div>
        <span className="gm-panel__kicker">{bookingStateLabel(row, copy, now, true)}</span>
        <h2 className="gm-panel__title">{placeLabel(row.propertyName, row.roomLabel) || copy.unknownValue}</h2>
      </div>
      <ReservationRows reservation={thread.reservation} copy={copy} locale={locale} surface="admin" />
      <AssistSimilarSection similar={similar} copy={copy} locale={locale} />
      <TaskPanelSection kinds={taskKinds} links={thread.links} copy={copy} locale={locale} onPick={onPickTask} />
      <AutoRunsList
        runs={runs}
        copy={copy}
        locale={locale}
        guestName={row.guestName}
        onPause={canPause ? (run, paused) => void pause(run, paused) : undefined}
        busyId={busyRun}
        manageHref={canManage ? "/admin/messages?tab=auto" : null}
      />
    </aside>
  );
}

function SnoozePopover({
  copy,
  shared,
  locale,
  onPick,
  onClose,
}: {
  copy: GmCopy;
  shared: Shared;
  locale: string;
  onPick: (input: SnoozeInput) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const today = tokyoDateOf(new Date().toISOString()) ?? "";
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("09:00");
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // 공용 날짜 · 시각 팝오버는 body 밖으로 뜰 수 있다 — 그 안 클릭은 닫지 않는다.
      if (ref.current && !ref.current.contains(target) && !target.closest(".calpop, .adp, .atp, [data-admin-popover]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  const localeTag = locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR";
  const custom = () => {
    const nowMs = Date.now();
    const start = Date.parse(`${date}T${time}:00+09:00`);
    if (!(start > nowMs) || start - nowMs > 30 * 86_400_000) {
      setInvalid(true);
      return;
    }
    onPick({ date, time });
  };
  return (
    <div className="gm-pop" role="dialog" aria-label={copy.snoozeTitle} ref={ref}>
      <b className="gm-pop__title">{copy.snoozeTitle}</b>
      <button type="button" className="gm-pop__item" onClick={() => onPick({ preset: "1h" })}>
        {copy.snooze1h}
      </button>
      <button type="button" className="gm-pop__item" onClick={() => onPick({ preset: "3h" })}>
        {copy.snooze3h}
      </button>
      <button type="button" className="gm-pop__item" onClick={() => onPick({ preset: "tomorrow9" })}>
        {copy.snoozeTomorrow}
      </button>
      <div className="gm-pop__custom">
        <span className="gm-hint">
          {copy.snoozeCustom} · {copy.snoozeTokyo}
        </span>
        <div className="gm-pop__pickers">
          <AdminDatePicker
            value={date}
            onChange={(value) => {
              setDate(value);
              setInvalid(false);
            }}
            min={today}
            localeTag={localeTag}
            ariaLabel={copy.snoozeDate}
            labels={{
              prevMonth: shared.datePrevMonth,
              nextMonth: shared.dateNextMonth,
              today: shared.dateToday,
            }}
          />
          <AdminTimePicker
            value={time}
            onChange={(value) => {
              setTime(value);
              setInvalid(false);
            }}
            ariaLabel={copy.snoozeTime}
          />
        </div>
        {invalid ? <span className="gm-hint gm-urgent">{copy.snoozeInvalid}</span> : null}
        <div className="gm-actions">
          <button type="button" className="gm-btn gm-btn--primary" onClick={custom}>
            {copy.snoozeApply}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}
