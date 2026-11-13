"use client";

/**
 * 손님 메시지함 공용 조각 — PC 콘솔 · 모바일 3폭이 같이 쓴다. docs/product/47-guest-messaging.md §5
 * 목록 줄 · 대화(말풍선 · 번역 · 발송 상태) · 답장 칸(내부 메모 · 번역해서 보내기 미리 보기) · 예약 정보 줄.
 * 시각 규칙(사용자): 세로 구분선 · 카드 테두리 없음, 구분선 0.5px #E4E3E9, 고른 줄 옅은 보라 배경, 급함 #c4364b, 주 버튼 #7A52E6.
 */

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  addGuestInternalNote,
  cancelGuestOutbox,
  editGuestOutbox,
  previewReplyTranslation,
  retryGuestOutbox,
  sendGuestReply,
  translateGuestMessage,
  type GuestMessageErrorKey,
} from "@/actions/guest-messages";
import {
  useBuildingName,
  useRoomPlaceLabel,
} from "@/components/shared/building-names";
import {
  MAX_NOTE_CHARS,
  MAX_REPLY_CHARS,
  defaultReplyTarget,
  outboxErrorKey,
  replyTranslationTargets,
  type StaffViewLang,
  type InboxConversationRow,
  type InboxMessage,
  type InboxReservationSummary,
  type InboxThread,
} from "@/lib/guest-messages/inbox-model";
import { haptic } from "@/lib/haptics";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { tokyoDateOf } from "@/lib/tokyo-date";
import {
  CHANNEL_DOT,
  bookingStateLabel,
  channelName,
  durationLabel,
  fill,
  formatDay,
  formatShortRange,
  formatStayParts,
  formatTime,
  initialOf,
  languageName,
  lastLineText,
  newIdempotencyKey,
  outboxErrorText,
  waitBadge,
  type GmCopy,
} from "@/components/guest-messages/gm-format";
import { InsertTools } from "@/components/guest-messages/composer-inserts";
import { MessageBodyView } from "@/components/guest-messages/message-body-view";
import { messagePlainText, messageTextForTranslation } from "@/lib/guest-messages/message-body";
import { TaskLinkLine } from "@/components/guest-messages/task-create";
import { insertLanguageFor } from "@/lib/guest-messages/guest-info-model";
import type { LinkSurface, ThreadLinkView } from "@/lib/guest-messages/task-link-model";
import "@/components/guest-messages/guest-messages.css";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/components/shell/use-body-scroll-lock";

export type GmNotify = (message: string, tone?: "ok" | "error") => void;

export function errorText(key: GuestMessageErrorKey, copy: GmCopy): string {
  switch (key) {
    case "forbidden":
      return copy.forbidden;
    case "too_long":
      return fill(copy.tooLong, { n: MAX_REPLY_CHARS });
    case "stale":
      return copy.stale;
    case "direct_booking":
      return copy.errDirectBooking;
    case "unknown_channel":
      return copy.errUnknownChannel;
    case "not_found":
      return copy.notFound;
    case "translation_budget":
      return copy.translateBudget;
    case "translation_unavailable":
      return copy.translateFailed;
    default:
      return copy.actionFailed;
  }
}

/** 「건물 · 방」 — 방 라벨에 건물 이름이 이미 있으면 그대로 바꿔 그리고, 없으면 붙인다. */
export function usePlaceLabel() {
  const building = useBuildingName();
  const place = useRoomPlaceLabel();
  return useCallback(
    (propertyName: string | null, roomLabel: string | null): string => {
      const room = roomLabel?.trim() ?? "";
      const prop = propertyName?.trim() ?? "";
      if (room && prop && room.startsWith(prop)) {
        const rest = room.slice(prop.length).trim();
        return rest && rest !== prop
          ? `${building(prop)} · ${rest}`
          : building(prop);
      }
      if (room && prop)
        return room === prop
          ? building(prop)
          : `${building(prop)} · ${place(room)}`;
      if (room) return place(room);
      return prop ? building(prop) : "";
    },
    [building, place],
  );
}

/** 1분마다 다시 그리는 「지금」 — 기다린 시간이 화면에서 늘어나게. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ── 목록 줄 ───────────────────────────────────────────────────────────────────

export function ConversationRowBody({
  row,
  copy,
  locale,
  now,
  withTarget,
  withDates,
}: {
  row: InboxConversationRow;
  copy: GmCopy;
  locale: string;
  now: Date;
  withTarget: boolean;
  withDates: boolean;
}) {
  const placeLabel = usePlaceLabel();
  const badge = waitBadge(row, copy, locale, now, withTarget);
  const unread = row.state === "awaiting";
  const meta = [
    placeLabel(row.propertyName, row.roomLabel),
    bookingStateLabel(row, copy, now),
    withDates ? formatShortRange(row.checkInDate, row.checkOutDate) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const alert =
    row.outboxAlert === "failed"
      ? copy.outboxFailedShort
      : row.outboxAlert === "uncertain"
        ? copy.outboxUncertainShort
        : row.outboxAlert === "queued"
          ? copy.outboxQueuedShort
          : null;
  return (
    <>
      <span className="gm-ava" aria-hidden="true">
        {initialOf(row.guestName, copy.guestUnknown)}
      </span>
      <span className="gm-row__main">
        <span className="gm-row__top">
          <b className="gm-row__name" data-unread={unread ? "" : undefined}>
            {row.guestName || copy.guestUnknown}
          </b>
          <span className="gm-row__wait" data-tone={badge.tone}>
            {badge.text}
          </span>
        </span>
        <span className="gm-row__line" data-unread={unread ? "" : undefined}>
          {lastLineText(row, copy) || " "}
        </span>
        <span className="gm-row__meta">
          {alert ? (
            <span
              className="gm-row__alert"
              data-tone={row.outboxAlert === "queued" ? "muted" : "urgent"}
            >
              {alert}
            </span>
          ) : null}
          {/* 어느 채널인지 점만으로는 모른다 — 점 + 채널 이름(회색 글자, 칩 · 테두리 없음). */}
          <span className="gm-row__channel">
            <span
              className="gm-dot"
              aria-hidden="true"
              style={{ background: CHANNEL_DOT[row.channel ?? "none"] }}
            />
            {channelName(row.channel, copy)}
          </span>
          <span className="gm-row__metatext">{meta}</span>
        </span>
      </span>
    </>
  );
}

// ── 대화 머리 한 줄(채널 · 상태 · 언어 · 기다린 시간) ─────────────────────────

export function ThreadMetaLine({
  row,
  copy,
  locale,
  now,
}: {
  row: InboxConversationRow;
  copy: GmCopy;
  locale: string;
  now: Date;
}) {
  const parts = [
    channelName(row.channel, copy),
    bookingStateLabel(row, copy, now),
    languageName(row.guestLanguage, locale),
  ].filter(Boolean);
  let wait: ReactNode = null;
  if (row.state === "awaiting" && row.waiting.waitingMinutes > 0) {
    const w = durationLabel(row.waiting.waitingMinutes, copy);
    const t = durationLabel(row.waiting.targetMinutes, copy);
    wait = row.waiting.overdue ? (
      <span className="gm-urgent">
        {fill(copy.waitedOver, { wait: w, target: t })}
      </span>
    ) : (
      <span>{fill(copy.waitedFor, { wait: w })}</span>
    );
  }
  return (
    <span className="gm-metaline">
      <span
        className="gm-dot"
        aria-hidden="true"
        style={{ background: CHANNEL_DOT[row.channel ?? "none"] }}
      />
      {/* 항목 사이 「·」 는 CSS 가 그린다 — 줄이 바뀌어도 줄 앞 · 끝에 「·」 가 남지 않게(guest-messages.css `.gm-sep-list`). */}
      <span className="gm-sep-list">
        {parts.map((part) => (
          <span key={part as string}>{part}</span>
        ))}
        {wait}
      </span>
    </span>
  );
}

// ── 대화 ─────────────────────────────────────────────────────────────────────

type TranslationState =
  | { status: "loading" }
  | { status: "ok"; text: string }
  | { status: "error"; budget: boolean };

export function ThreadMessages({
  thread,
  copy,
  locale,
  canReply,
  translateAll,
  viewLang,
  notify,
  onChanged,
  surface = "mobile",
  selectable = false,
  pickedIds,
  onTogglePick,
}: {
  thread: InboxThread;
  copy: GmCopy;
  locale: string;
  canReply: boolean;
  /** 머리 「번역해서 보기」 — 켜면 손님 말을 모두 번역해 보인다. */
  translateAll: boolean;
  /** 번역해서 볼 언어(한국어 · 일본어 · 영어). 비우면 보는 사람 언어. 손님 말 옆 「번역」도 이 언어로 한다. */
  viewLang?: StaffViewLang | null;
  notify: GmNotify;
  onChanged: () => void;
  /** 업무 링크 줄의 「열기」 주소 — PC 콘솔은 admin, 모바일은 mobile(6단계). */
  surface?: LinkSurface;
  /** 업무에 붙일 손님 말 고르기(6단계) — 켜면 손님 말이 눌러 고르는 단추가 된다. */
  selectable?: boolean;
  pickedIds?: ReadonlySet<string>;
  onTogglePick?: (id: string) => void;
}) {
  const now = useNow();
  const [translations, setTranslations] = useState<
    Record<string, TranslationState>
  >({});
  const [showOriginal, setShowOriginal] = useState<Record<string, boolean>>({});
  const requested = useRef(new Set<string>());
  const lang: string = viewLang ?? locale;
  /** 번역은 (언어, 메시지) 마다 따로 — 언어를 바꾸면 그 언어 번역을 새로 받는다. */
  const tkey = (id: string) => `${lang}:${id}`;

  // 서버가 이미 캐시한 같은 언어 번역은 바로 쓴다(서버는 보는 사람 언어 것만 싣는다).
  const cached = useMemo(() => {
    const out: Record<string, string> = {};
    if (lang !== locale) return out;
    for (const m of thread.messages) {
      if (
        m.direction === "guest" &&
        m.bodyTranslated &&
        m.translatedLang === locale
      )
        out[m.id] = m.bodyTranslated;
    }
    return out;
  }, [thread.messages, locale, lang]);

  // 실패한 줄은 `requested` 에 남긴다 — 자동(「번역해서 보기」)으로는 다시 부르지 않고, 손님 말 옆 「번역」을 눌러야 다시 한다.
  const translate = useCallback(
    async (id: string, manual = false): Promise<boolean> => {
      const key = `${lang}:${id}`;
      if (requested.current.has(key) && !manual) return true;
      requested.current.add(key);
      setTranslations((prev) => ({ ...prev, [key]: { status: "loading" } }));
      const result = await translateGuestMessage(id, lang);
      setTranslations((prev) => ({
        ...prev,
        [key]: result.ok
          ? { status: "ok", text: result.text }
          : {
              status: "error",
              budget: result.errorKey === "translation_budget",
            },
      }));
      return result.ok;
    },
    [lang],
  );

  useEffect(() => {
    if (!translateAll) return;
    let cancelled = false;
    (async () => {
      // 한 번에 하나씩 — 한도를 한꺼번에 잡지 않게. 한도 소진 · 오류가 나면 거기서 멈춘다(남은 줄을 줄줄이 부르지 않음).
      for (const m of thread.messages) {
        if (cancelled) return;
        if (
          m.direction !== "guest" ||
          cached[m.id] ||
          !messageTextForTranslation(m.body) ||
          requested.current.has(`${lang}:${m.id}`)
        )
          continue;
        const ok = await translate(m.id);
        if (!ok) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [translateAll, thread.messages, cached, translate, lang]);

  // 말 · 업무 링크 줄을 시각 순으로 한 줄에(링크는 만든 시각 자리, 6단계).
  const groups = useMemo(() => {
    type Entry = { key: string; at: string; message?: InboxMessage; link?: ThreadLinkView };
    const entries: Entry[] = thread.messages.map((m) => ({ key: m.id, at: m.sentAt, message: m }));
    for (const link of thread.links ?? []) {
      const index = entries.findIndex((e) => e.at > link.createdAt);
      const entry = { key: `link:${link.id}`, at: link.createdAt, link };
      if (index < 0) entries.push(entry);
      else entries.splice(index, 0, entry);
    }
    const out: Array<{ day: string; items: Entry[] }> = [];
    for (const e of entries) {
      const day = tokyoDateOf(e.at) ?? "";
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [thread.messages, thread.links]);

  const endRef = useRef<HTMLDivElement | null>(null);
  const lastId = thread.messages[thread.messages.length - 1]?.id;
  useEffect(() => {
    // scrollIntoView(end) 는 마지막 말을 스크롤 칸 맨 아래 — 붙어 있는 답장 칸 · 탭바 밑 — 로 보낸다.
    // 감싼 스크롤 칸(PC 대화 칸 · 모바일 셸 본문)을 끝까지 내려 답장 칸 위에 마지막 말이 보이게 한다.
    let el = endRef.current?.parentElement ?? null;
    while (el) {
      const overflowY = getComputedStyle(el).overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight
      ) {
        el.scrollTop = el.scrollHeight;
        return;
      }
      el = el.parentElement;
    }
  }, [lastId, thread.conversation.id]);

  if (thread.messages.length === 0) {
    return <p className="gm-thread__empty">{copy.noMessages}</p>;
  }

  const channel = channelName(thread.conversation.channel, copy);

  return (
    <div className="gm-thread">
      {groups.map((group) => (
        <div className="gm-day" key={group.day}>
          <span className="gm-day__label">
            {group.day ? formatDay(group.day, locale, now, copy) : null}
          </span>
          {group.items.map((entry) => {
            if (entry.link) {
              return <TaskLinkLine key={entry.key} link={entry.link} copy={copy} locale={locale} surface={surface} />;
            }
            const m = entry.message as InboxMessage;
            if (m.direction === "system") {
              return (
                <p className="gm-system" key={m.id}>
                  {m.body}
                </p>
              );
            }
            if (m.direction === "internal") {
              return (
                <div className="gm-msg gm-msg--note" key={m.id}>
                  <div className="gm-bubble gm-bubble--note">
                    <MessageBodyView body={m.body} images={m.images} copy={copy} />
                  </div>
                  <span className="gm-msg__foot">
                    <LockGlyph />
                    {copy.internalNote}
                    {m.authorName ? ` · ${m.authorName}` : ""} ·{" "}
                    {formatTime(m.sentAt, locale)}
                  </span>
                </div>
              );
            }
            if (m.direction === "guest") {
              const state = translations[tkey(m.id)];
              const translated =
                cached[m.id] ?? (state?.status === "ok" ? state.text : null);
              const wantsTranslation =
                translateAll ||
                Boolean(translated) ||
                state?.status === "loading";
              const showingTranslation =
                Boolean(translated) && wantsTranslation && !showOriginal[m.id];
              const picked = Boolean(pickedIds?.has(m.id));
              // 본문은 조각(글 · 링크 · 사진)으로 그린다 — HTML 을 그대로 보이지 않게(47 §5-8).
              const shownText = showingTranslation ? translated : null;
              const ariaText =
                messagePlainText(shownText ?? m.body).text ||
                (m.images.length > 0 ? copy.photoLabel : copy.attachmentOnly);
              const bubbleBody = (interactive: boolean) => (
                <MessageBodyView
                  body={m.body}
                  textOverride={shownText}
                  images={m.images}
                  copy={copy}
                  interactive={interactive}
                  emptyText={copy.attachmentOnly}
                />
              );
              return (
                <div
                  className="gm-msg gm-msg--guest"
                  key={m.id}
                  data-picked={picked ? "" : undefined}
                >
                  {selectable && onTogglePick ? (
                    // 업무에 붙일 말 고르기 — 고른 말은 옅은 보라 바탕(테두리 · 왼쪽 막대 대신, 시각 규칙).
                    <button
                      type="button"
                      className="gm-bubble gm-bubble--guest gm-bubble--pick"
                      aria-pressed={picked}
                      aria-label={`${copy.taskSelectAria}: ${ariaText}`}
                      onClick={() => {
                        haptic("light");
                        onTogglePick(m.id);
                      }}
                    >
                      {bubbleBody(false)}
                    </button>
                  ) : (
                    <div className="gm-bubble gm-bubble--guest">{bubbleBody(true)}</div>
                  )}
                  <span className="gm-msg__foot">
                    {picked ? (
                      <b className="gm-msg__picked">{copy.taskSelectedTag} ·</b>
                    ) : null}
                    {formatTime(m.sentAt, locale)}
                    {m.attachmentCount > 0
                      ? ` · ${fill(copy.attachments, { n: m.attachmentCount })}`
                      : ""}
                    {state?.status === "loading" ? (
                      <> · {copy.translating}</>
                    ) : null}
                    {state?.status === "error" ? (
                      <>
                        {" "}
                        ·{" "}
                        {state.budget
                          ? copy.translateBudget
                          : copy.translateFailed}
                      </>
                    ) : null}
                    {translated ? (
                      <>
                        {" · "}
                        {showingTranslation ? `${copy.translatedTag} · ` : null}
                        <button
                          type="button"
                          className="gm-link"
                          onClick={() =>
                            setShowOriginal((prev) => ({
                              ...prev,
                              [m.id]: showingTranslation,
                            }))
                          }
                        >
                          {showingTranslation
                            ? copy.viewOriginal
                            : copy.viewTranslation}
                        </button>
                      </>
                    ) : state?.status !== "loading" && messageTextForTranslation(m.body) ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="gm-link"
                          onClick={() => {
                            setShowOriginal((prev) => ({
                              ...prev,
                              [m.id]: false,
                            }));
                            void translate(m.id, true);
                          }}
                        >
                          {copy.translateOne}
                        </button>
                      </>
                    ) : null}
                  </span>
                </div>
              );
            }
            return (
              <HostMessage
                key={m.id}
                message={m}
                copy={copy}
                locale={locale}
                channel={channel}
                canReply={canReply}
                sendEnabled={thread.sendEnabled}
                notify={notify}
                onChanged={onChanged}
              />
            );
          })}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function LockGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg
      width="12"
      height="12"
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

function AlertGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  );
}

function HostMessage({
  message,
  copy,
  locale,
  channel,
  canReply,
  sendEnabled,
  notify,
  onChanged,
}: {
  message: InboxMessage;
  copy: GmCopy;
  locale: string;
  channel: string;
  canReply: boolean;
  sendEnabled: boolean;
  notify: GmNotify;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [showWritten, setShowWritten] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [pending, startTransition] = useTransition();
  const outbox = message.outbox;
  const status = outbox?.status ?? "sent";

  const run = (
    work: () => Promise<{ ok: boolean; errorKey?: GuestMessageErrorKey }>,
    okText: string,
  ) => {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        haptic("success");
        notify(okText);
        setEditing(false);
        onChanged();
      } else {
        haptic("error");
        notify(errorText(result.errorKey ?? "failed", copy), "error");
      }
    });
  };

  const foot = (() => {
    if (status === "sent")
      return (
        <>
          {formatTime(message.sentAt, locale)} · {copy.sentLabel}
          {message.bodyLang && message.bodyTranslated
            ? ` · ${languageName(message.bodyLang, locale) ?? message.bodyLang}`
            : ""}
        </>
      );
    if (status === "sending") return <>{copy.sendingLabel}</>;
    if (status === "queued") {
      return (
        <span className="gm-status">
          <ClockGlyph />
          {copy.queuedLabel} ·{" "}
          {sendEnabled ? copy.queuedHint : copy.queuedHintDisabled}
        </span>
      );
    }
    if (status === "uncertain") {
      return (
        <span className="gm-urgent gm-status">
          <AlertGlyph />
          {fill(copy.uncertainLabel, { channel })}
        </span>
      );
    }
    if (status === "cancelled") return <>{copy.cancelledLabel}</>;
    return (
      <span className="gm-urgent gm-status">
        <AlertGlyph />
        {copy.failedLabel} ·{" "}
        {outboxErrorText(outboxErrorKey(outbox?.errorCode), copy, channel)}
      </span>
    );
  })();

  return (
    <div className="gm-msg gm-msg--host" data-status={status}>
      {editing ? (
        <div className="gm-edit">
          <textarea
            className="gm-input"
            aria-label={copy.edit}
            value={draft}
            maxLength={MAX_REPLY_CHARS}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
          />
          <div className="gm-actions">
            <button
              type="button"
              className="gm-btn"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              {copy.editCancel}
            </button>
            <button
              type="button"
              className="gm-btn gm-btn--primary"
              disabled={pending || !draft.trim()}
              onClick={() =>
                run(() => editGuestOutbox(outbox!.id, draft), copy.editedToast)
              }
            >
              {copy.editSave}
            </button>
          </div>
        </div>
      ) : (
        <div className="gm-bubble gm-bubble--host">
          {showWritten && message.bodyTranslated ? (
            message.bodyTranslated
          ) : (
            <MessageBodyView body={message.body} images={message.images} copy={copy} emptyText={copy.attachmentOnly} />
          )}
        </div>
      )}
      {/* 항목 사이 「·」 는 CSS(`.gm-sep-list`) — 줄이 바뀌어도 줄 앞에 「·」 가 남지 않게. */}
      <span className="gm-msg__foot gm-sep-list gm-sep-list--end">
        <span>{foot}</span>
        {message.outbox?.kind === "auto" ? <span>{copy.autoMessageLabel}</span> : message.authorName ? <span>{message.authorName}</span> : null}
        {message.bodyTranslated && !editing ? (
          <span>
            <button
              type="button"
              className="gm-link"
              onClick={() => setShowWritten((v) => !v)}
            >
              {showWritten ? copy.viewTranslation : copy.previewYourText}
            </button>
          </span>
        ) : null}
      </span>
      {canReply &&
      outbox &&
      !outbox.locked &&
      !editing &&
      (status === "queued" || status === "failed" || status === "uncertain") ? (
        <div className="gm-msg__tools">
          {status === "queued" ? (
            <span className="gm-hint">{copy.queuedEditHint}</span>
          ) : null}
          {status === "failed" &&
          outboxErrorKey(outbox.errorCode) === "rejected" ? (
            <span className="gm-hint">{copy.errCancelledHint}</span>
          ) : null}
          <span className="gm-msg__buttons">
            {status === "queued" ? (
              <button
                type="button"
                className="gm-btn gm-btn--sm"
                disabled={pending}
                onClick={() => setEditing(true)}
              >
                {copy.edit}
              </button>
            ) : null}
            {outbox.retryable ? (
              <button
                type="button"
                className="gm-btn gm-btn--sm"
                disabled={pending}
                onClick={() =>
                  status === "uncertain"
                    ? setConfirmRetry(true)
                    : run(() => retryGuestOutbox(outbox.id), copy.retryToast)
                }
              >
                {copy.retry}
              </button>
            ) : null}
            {status === "queued" || status === "failed" ? (
              <button
                type="button"
                className="gm-btn gm-btn--sm"
                disabled={pending}
                onClick={() => {
                  haptic("light");
                  run(() => cancelGuestOutbox(outbox.id), copy.cancelledToast);
                }}
              >
                {copy.cancelSend}
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      {confirmRetry && outbox ? (
        <GmConfirm
          title={copy.retryUncertainTitle}
          body={copy.retryUncertainBody}
          confirmLabel={copy.retryUncertainConfirm}
          cancelLabel={copy.confirmCancel}
          onCancel={() => setConfirmRetry(false)}
          onConfirm={() => {
            setConfirmRetry(false);
            run(
              () => retryGuestOutbox(outbox.id, { confirmUncertain: true }),
              copy.retryToast,
            );
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * 가운데 확인 창(되돌릴 수 없는 일 — CLAUDE.md 의 확인 모달 예외). Esc · 바깥 누르기로 닫힌다.
 * `<body>` 로 띄우고(스크롤 칸 · 목록 줄 접힘 안에 갇히지 않게) 뒤 화면 스크롤을 잠근다. `.gm-root` 를 붙여 색 변수를 받는다.
 */
export function GmConfirm({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // 다른 곳이 이미 처리한 Esc(예: 패널이 이 확인 창을 연 바로 그 Esc — 같은 키가 window 까지 올라온다)는 무시.
      if (event.key === "Escape" && !event.defaultPrevented) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  useBodyScrollLock(true);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="gm-root gm-confirm" role="presentation" onClick={onCancel}>
      <div
        className="gm-confirm__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <b id={titleId} className="gm-confirm__title">
          {title}
        </b>
        <p className="gm-confirm__body">{body}</p>
        <div className="gm-actions">
          <button type="button" className="gm-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="gm-btn gm-btn--primary"
            ref={confirmRef}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── 답장 칸 ───────────────────────────────────────────────────────────────────

type Preview =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "ready"; text: string; language: string }
  | { kind: "failed"; budget: boolean };

export function Composer({
  thread,
  copy,
  locale,
  canReply,
  variant,
  notify,
  onSent,
  canManageReplies = false,
  onEditBuilding,
  insertsRefreshKey = 0,
}: {
  thread: InboxThread;
  copy: GmCopy;
  locale: string;
  canReply: boolean;
  variant: "pc" | "phone";
  notify: GmNotify;
  onSent: () => void;
  /** 「문구 관리」 링크(PC, `guest_messages.manage`). */
  canManageReplies?: boolean;
  /** PC 만 — 「건물 정보 고치기」 패널 열기. */
  onEditBuilding?: (canonicalName: string) => void;
  /** 바뀌면 넣기 목록을 다시 읽는다(건물 정보 저장 뒤). */
  insertsRefreshKey?: number;
}) {
  const row = thread.conversation;
  // 답장이 막힌 대화(직접 예약 등)도 처음엔 「답장」 자리 — 막힘 안내(이메일 복사 · 내부 메모 쓰기)가 먼저 보인다(시안 States).
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview>({ kind: "none" });
  const [translatedDraft, setTranslatedDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const keyRef = useRef<string>(newIdempotencyKey());
  /** 지금 키로 보낸(보내려던) 글. */
  const keyBodyRef = useRef<string | null>(null);
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const channel = channelName(row.channel, copy);
  // 번역해서 보낼 언어(§9) — 처음엔 손님 언어(번역할 수 있을 때), 직원이 영어 · 일본어 · 한국어로 바꾸거나 끌 수 있다.
  const targets = replyTranslationTargets(locale, row.guestLanguage);
  const guestTarget = defaultReplyTarget(locale, row.guestLanguage);
  const [target, setTarget] = useState<string | null>(guestTarget);
  const targetName = target ? languageName(target, locale) : null;

  // 「해결됐어요」 초안(6단계, 시안 R2PhoneThread) — 이어진 업무가 끝났고 그 뒤 답장이 없으면 빈 답장 칸에 띄운다. **보내지 않는다** —
  // 보내기는 언제나 직원이 누른다. 넣는 언어는 넣기 목록과 같은 규칙(번역해서 보낼 때는 직원 언어, `insertLanguageFor`).
  const draft = canReply && !row.replyBlock ? thread.resolvedDraft : null;
  const draftTextFor = (to: string | null) =>
    draft ? draft.texts[insertLanguageFor(row.guestLanguage, to, locale)] : "";
  const [draftText, setDraftText] = useState<string | null>(null);
  const [seenDraft, setSeenDraft] = useState<string | null>(null);
  if (draft && seenDraft !== draft.linkId) {
    setSeenDraft(draft.linkId);
    if (!text.trim()) {
      const next = draftTextFor(target);
      setText(next);
      setDraftText(next);
    }
  }
  const draftActive = Boolean(draft && draftText !== null && text.trim() && mode === "reply");

  // 대화가 바뀌면 칸을 비운다 — 부르는 쪽이 `key={대화 id}` 로 새로 그린다(효과 안 setState 대신).

  if (!canReply) {
    return <p className="gm-composer__readonly">{copy.readOnly}</p>;
  }

  const limit = mode === "note" ? MAX_NOTE_CHARS : MAX_REPLY_CHARS;
  const tooLong = Array.from(text).length > limit;
  // 서버와 같은 기준(코드포인트) — 번역문이 원문보다 길어질 수 있다.
  const draftTooLong =
    Array.from(translatedDraft.trim()).length > MAX_REPLY_CHARS;

  const finishSend = (
    body: string,
    original: string | null,
    bodyLang: string | null = null,
  ) => {
    if (Array.from(body).length > MAX_REPLY_CHARS) {
      haptic("error");
      notify(fill(copy.tooLong, { n: MAX_REPLY_CHARS }), "error");
      return;
    }
    // 같은 글을 두 번 누르면 같은 키(서버가 한 줄만), 글이 바뀌었으면 새 키 — 고친 글이 옛 키로 묻히지 않게.
    if (keyBodyRef.current !== null && keyBodyRef.current !== body)
      keyRef.current = newIdempotencyKey();
    keyBodyRef.current = body;
    startTransition(async () => {
      const result = await sendGuestReply({
        conversationId: row.id,
        body,
        idempotencyKey: keyRef.current,
        original,
        bodyLang: original ? bodyLang : null,
      });
      if (result.ok) {
        // 성공 햅틱은 서버가 큐에 넣었다고 확인한 뒤에만(16 「햅틱 — 공용 규칙」).
        haptic("success");
        notify(
          result.sendEnabled ? copy.queuedToast : copy.queuedDisabledToast,
        );
        setText("");
        setDraftText(null);
        setPreview({ kind: "none" });
        keyRef.current = newIdempotencyKey();
        keyBodyRef.current = null;
        onSent();
      } else {
        haptic("error");
        notify(errorText(result.errorKey, copy), "error");
      }
    });
  };

  const submit = () => {
    const body = text.trim();
    if (!body || tooLong || pending) return;
    if (mode === "note") {
      startTransition(async () => {
        const result = await addGuestInternalNote({
          conversationId: row.id,
          body,
        });
        if (result.ok) {
          haptic("success");
          notify(copy.noteSaved);
          setText("");
          onSent();
        } else {
          haptic("error");
          notify(errorText(result.errorKey, copy), "error");
        }
      });
      return;
    }
    if (target) {
      setPreview({ kind: "loading" });
      startTransition(async () => {
        const result = await previewReplyTranslation({
          conversationId: row.id,
          text: body,
          targetLang: target,
        });
        if (result.ok) {
          setTranslatedDraft(result.text);
          setPreview({
            kind: "ready",
            text: result.text,
            language: result.language,
          });
        } else {
          // 실패 안내를 보이므로 error(16 「햅틱 — 공용 규칙」).
          haptic("error");
          setPreview({
            kind: "failed",
            budget: result.errorKey === "translation_budget",
          });
        }
      });
      return;
    }
    finishSend(body, null);
  };

  // 「정해 둔 문구」 · 「건물 정보」 넣기 — 커서 자리에 넣고(고른 글이 있으면 바꿈) 커서를 넣은 글 뒤로(§6-3).
  const insertAtCursor = (insert: string) => {
    const el = inputRef.current;
    const start = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const gap = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${gap}${insert}${after}`;
    const caret = before.length + gap.length + insert.length;
    setText(next);
    setPreview({ kind: "none" });
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };
  const insertTools =
    mode === "reply" ? (
      <InsertTools
        conversationId={row.id}
        guestLanguage={row.guestLanguage}
        translateTarget={target}
        locale={locale}
        copy={copy}
        variant={variant}
        canManageReplies={canManageReplies}
        onInsert={insertAtCursor}
        onEditBuilding={onEditBuilding}
        notify={(message) => notify(message)}
        refreshKey={insertsRefreshKey}
      />
    ) : null;

  const blocked = mode === "reply" ? row.replyBlock : null;
  const label =
    mode === "note"
      ? copy.noteLabel
      : draftActive && draft
        ? fill(copy.resolvedDraftLabel, { kind: copy.taskKind[draft.targetType] })
        : targetName
        ? fill(copy.replyLabelTranslate, { lang: targetName })
        : copy.replyLabel;
  const hint =
    mode === "note"
      ? copy.noteHint
      : draftActive
        ? `${copy.resolvedNote} · ${targetName ? fill(copy.channelHintTranslated, { lang: targetName, channel }) : fill(copy.channelHint, { channel })}`
        : targetName
        ? fill(copy.channelHintTranslated, { lang: targetName, channel })
        : fill(copy.channelHint, { channel });
  // 번역 언어 고르기 — 칩 대신 드롭다운 하나(시각 규칙). 폰은 짧은 이름, PC 는 손님 언어에 「손님 언어」 꼬리표.
  const onTargetChange = (value: string) => {
    const next = value || null;
    // 이미 고른 항목을 다시 눌러도 미리 보기 · 햅틱을 건드리지 않는다.
    if (next === target) return;
    haptic("light");
    setTarget(next);
    setPreview({ kind: "none" });
    // 손대지 않은 초안은 넣는 언어가 바뀌면 그 언어 글로 바꾼다(번역해서 보낼 때 두 번 번역되지 않게).
    if (draft && draftText !== null && text === draftText) {
      const swapped = draftTextFor(next);
      setText(swapped);
      setDraftText(swapped);
    }
  };
  const targetLabel = (code: string) => {
    const name = languageName(code, locale) ?? code;
    return code === guestTarget && variant === "pc"
      ? fill(copy.translateToggleGuest, { lang: name })
      : fill(copy.translateToggle, { lang: name });
  };
  // PC 는 공용 관리자 드롭다운(시스템 팝업이 콘솔과 안 맞음), 폰은 OS 선택기를 그대로 쓴다. 작성기가 화면 아래라 위로 연다.
  const targetSelect =
    mode === "reply" && targets.length > 0 ? (
      variant === "pc" ? (
        <AdmDropdown
          size="sm"
          placement="up"
          ariaLabel={copy.translateTargetLabel}
          value={target ?? ""}
          onChange={onTargetChange}
          options={[
            { value: "", label: copy.translateNone },
            ...targets.map((code) => ({ value: code, label: targetLabel(code) })),
          ]}
        />
      ) : (
        <select
          className="gm-select gm-select--target"
          aria-label={copy.translateTargetLabel}
          value={target ?? ""}
          onChange={(event) => onTargetChange(event.target.value)}
        >
          <option value="">{copy.translateNone}</option>
          {targets.map((code) => (
            <option key={code} value={code}>
              {targetLabel(code)}
            </option>
          ))}
        </select>
      )
    ) : null;

  return (
    <div className={`gm-composer gm-composer--${variant}`} data-mode={mode}>
      {blocked ? (
        <BlockedNotice
          block={blocked}
          copy={copy}
          email={thread.reservation.guestEmail}
          notify={notify}
          onWriteNote={() => setMode("note")}
        />
      ) : null}

      {preview.kind === "ready" || preview.kind === "failed" ? (
        <div className="gm-preview" role="group" aria-label={copy.previewTitle}>
          {preview.kind === "ready" ? (
            <>
              <b className="gm-preview__title">
                {copy.previewTitle} ·{" "}
                {languageName(preview.language, locale) ?? preview.language}
              </b>
              <span className="gm-hint">{copy.previewHint}</span>
              <textarea
                className="gm-input"
                aria-label={copy.previewTitle}
                value={translatedDraft}
                onChange={(event) => setTranslatedDraft(event.target.value)}
                rows={variant === "pc" ? 3 : 4}
              />
              {draftTooLong ? (
                <span className="gm-hint gm-urgent">
                  {fill(copy.tooLong, { n: MAX_REPLY_CHARS })}
                </span>
              ) : null}
              <span className="gm-hint">
                {copy.previewYourText}: {text.trim()}
              </span>
              <div className="gm-actions">
                <button
                  type="button"
                  className="gm-btn"
                  disabled={pending}
                  onClick={() => setPreview({ kind: "none" })}
                >
                  {copy.backToEdit}
                </button>
                <button
                  type="button"
                  className="gm-btn"
                  disabled={pending}
                  onClick={() => finishSend(text.trim(), null)}
                >
                  {copy.sendOriginalInstead}
                </button>
                <button
                  type="button"
                  className="gm-btn gm-btn--primary"
                  disabled={pending || !translatedDraft.trim() || draftTooLong}
                  onClick={() =>
                    finishSend(
                      translatedDraft.trim(),
                      text.trim(),
                      preview.kind === "ready" ? preview.language : null,
                    )
                  }
                >
                  {pending ? copy.sending : copy.sendTranslated}
                </button>
              </div>
            </>
          ) : (
            <>
              <b className="gm-preview__title">
                {preview.budget
                  ? copy.translateBudgetAsk
                  : copy.translateFailedAsk}
              </b>
              <div className="gm-actions">
                <button
                  type="button"
                  className="gm-btn"
                  disabled={pending}
                  onClick={() => setPreview({ kind: "none" })}
                >
                  {copy.backToEdit}
                </button>
                <button
                  type="button"
                  className="gm-btn gm-btn--primary"
                  disabled={pending}
                  onClick={() => finishSend(text.trim(), null)}
                >
                  {pending ? copy.sending : copy.sendOriginalInstead}
                </button>
              </div>
            </>
          )}
        </div>
      ) : blocked ? null : (
        // 막힌 대화는 위 안내(이메일 복사 · 내부 메모 쓰기)만 — 쓸 수 없는 답장 칸을 같이 그리지 않는다.
        <>
          {variant === "phone" ? (
            <div className="gm-tools" data-swipe-back="off">
              {insertTools}
              {!row.replyBlock || mode === "note" ? (
                <button
                  type="button"
                  className="gm-chipbtn"
                  aria-pressed={mode === "note"}
                  onClick={() => {
                    haptic("light");
                    setMode((m) => (m === "note" ? "reply" : "note"));
                  }}
                >
                  <LockGlyph />
                  {copy.noteToggleShort}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="gm-composer__row">
            <label className="gm-field" htmlFor={inputId} data-mode={mode} data-draft={draftActive ? "" : undefined}>
              <span className="gm-field__label">{label}</span>
              <textarea
                ref={inputRef}
                id={inputId}
                className="gm-field__input"
                value={text}
                placeholder={
                  mode === "note" ? copy.notePlaceholder : copy.replyPlaceholder
                }
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={variant === "pc" ? 3 : 2}
                disabled={mode === "reply" && Boolean(row.replyBlock)}
              />
            </label>
            {variant === "phone" ? (
              <button
                type="button"
                className="gm-send-round"
                aria-label={
                  mode === "note"
                    ? copy.saveNote
                    : fill(copy.sendTo, { channel })
                }
                disabled={
                  pending ||
                  !text.trim() ||
                  tooLong ||
                  (mode === "reply" && Boolean(row.replyBlock))
                }
                onClick={submit}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            ) : null}
          </div>
          {tooLong ? (
            <span className="gm-hint gm-urgent">
              {fill(copy.tooLong, { n: limit })}
            </span>
          ) : null}
          {variant === "pc" ? (
            <div className="gm-composer__bar">
              {insertTools}
              {!row.replyBlock || mode === "note" ? (
                <button
                  type="button"
                  className="gm-btn"
                  aria-pressed={mode === "note"}
                  onClick={() =>
                    setMode((m) => (m === "note" ? "reply" : "note"))
                  }
                >
                  {mode === "note" ? copy.replyLabel : copy.noteToggle}
                </button>
              ) : null}
              {targetSelect}
              <span className="gm-hint gm-composer__hint">{hint}</span>
              <button
                type="button"
                className="gm-btn gm-btn--primary gm-btn--lg"
                disabled={
                  pending ||
                  !text.trim() ||
                  tooLong ||
                  (mode === "reply" && Boolean(row.replyBlock))
                }
                onClick={submit}
              >
                {pending || preview.kind === "loading"
                  ? copy.sending
                  : mode === "note"
                    ? copy.saveNote
                    : copy.send}
              </button>
            </div>
          ) : (
            // 폰 · 폴드 · 태블릿: 번역 언어는 도구 줄이 아니라 입력 칸 아래 자기 줄에(가로로 넘기지 않게) — 안내 글과 같은 줄, 좁으면 안내가 아래로.
            <div className="gm-composer__langline">
              {targetSelect}
              <span className="gm-hint gm-composer__hint">
                {preview.kind === "loading" ? copy.translating : hint}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BlockedNotice({
  block,
  copy,
  email,
  notify,
  onWriteNote,
}: {
  block: "direct_booking" | "unknown_channel";
  copy: GmCopy;
  email: string | null;
  notify: GmNotify;
  onWriteNote: () => void;
}) {
  return (
    <div className="gm-blocked" role="note">
      <span className="gm-blocked__text">
        <AlertGlyph />
        {block === "direct_booking" ? copy.directBlocked : copy.unknownBlocked}
      </span>
      <span className="gm-blocked__row">
        {block === "direct_booking" ? (
          <span className="gm-blocked__email">{email ?? copy.noEmail}</span>
        ) : null}
        {block === "direct_booking" && email ? (
          <button
            type="button"
            className="gm-btn gm-btn--sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(email);
                haptic("light");
                notify(copy.emailCopied);
              } catch {
                notify(copy.actionFailed, "error");
              }
            }}
          >
            {copy.copyEmail}
          </button>
        ) : null}
        <button
          type="button"
          className="gm-btn gm-btn--sm"
          onClick={onWriteNote}
        >
          {copy.writeNote}
        </button>
      </span>
    </div>
  );
}

// ── 예약 정보 줄 ──────────────────────────────────────────────────────────────

export function calendarHref(
  reservation: InboxReservationSummary,
  surface: "admin" | "mobile",
): string | null {
  if (surface === "mobile") {
    return reservation.reservationId
      ? `/mobile/calendar?reservationId=${encodeURIComponent(reservation.reservationId)}`
      : null;
  }
  if (!reservation.checkInDate) return null;
  const params = new URLSearchParams({
    month: reservation.checkInDate.slice(0, 7),
  });
  if (reservation.propertyName)
    params.set("property", reservation.propertyName);
  return `/admin/calendar?${params.toString()}`;
}

export function ReservationRows({
  reservation,
  copy,
  locale,
  surface,
}: {
  reservation: InboxReservationSummary;
  copy: GmCopy;
  locale: string;
  surface: "admin" | "mobile";
}) {
  const range = formatStayParts(
    reservation.checkInDate,
    reservation.checkOutDate,
    locale,
  );
  const nights =
    reservation.nights === null
      ? null
      : reservation.nights === 1
        ? copy.nightOne
        : fill(copy.nights, { n: reservation.nights });
  const guests =
    reservation.adults !== null
      ? [
          fill(copy.adults, { n: reservation.adults }),
          reservation.children
            ? fill(copy.children, { n: reservation.children })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : reservation.totalGuests !== null
        ? fill(copy.guestsTotal, { n: reservation.totalGuests })
        : null;
  const lang = languageName(reservation.guestLanguage, locale);
  const href = calendarHref(reservation, surface);
  return (
    <dl className="gm-resv">
      <div className="gm-resv__row">
        <dt>{copy.dates}</dt>
        <dd>
          {range ? (
            <>
              {/* 날짜 하나 · 「N박」은 끊기지 않게 묶는다 — 줄은 두 날짜 사이에서만 바뀐다. */}
              <span className="gm-nw">{range.from} –</span>{" "}
              <span className="gm-nw">{range.to}</span>
              {nights ? (
                <span className="gm-resv__sub gm-nw">{nights}</span>
              ) : null}
            </>
          ) : (
            copy.unknownValue
          )}
        </dd>
      </div>
      <div className="gm-resv__row">
        <dt>{copy.guests}</dt>
        <dd>{guests ?? copy.unknownValue}</dd>
      </div>
      <div className="gm-resv__row">
        <dt>{copy.channel}</dt>
        <dd>
          {[channelName(reservation.channel, copy), lang]
            .filter(Boolean)
            .join(" · ")}
        </dd>
      </div>
      <div className="gm-resv__row">
        <dt>{copy.bookingNumber}</dt>
        <dd className="gm-resv__num">
          <span>
            {reservation.channelReference ?? reservation.bookingNumber}
            {reservation.channelReference ? (
              <span className="gm-resv__sub">
                {fill(copy.beds24Number, { n: reservation.bookingNumber })}
              </span>
            ) : null}
          </span>
          {href ? (
            <Link className="gm-link" href={href}>
              {copy.openCalendar}
            </Link>
          ) : null}
        </dd>
      </div>
    </dl>
  );
}

// ── 빈 · 오류 상태 ────────────────────────────────────────────────────────────

export function InboxEmpty({ filter, copy }: { filter: string; copy: GmCopy }) {
  const awaiting = filter === "awaiting";
  return (
    <div className="gm-empty">
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#7A52E6"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        {awaiting ? <path d="m9 12 2 2 4-4" /> : null}
      </svg>
      <b>{awaiting ? copy.emptyAwaitingTitle : copy.emptyOtherTitle}</b>
      <span>{awaiting ? copy.emptyAwaitingBody : copy.emptyOtherBody}</span>
    </div>
  );
}

export function InboxError({
  copy,
  onRetry,
}: {
  copy: GmCopy;
  onRetry?: () => void;
}) {
  return (
    <div className="gm-empty" role="alert">
      <b>{copy.loadFailed}</b>
      <span>{copy.loadFailedBody}</span>
      {onRetry ? (
        <button type="button" className="gm-btn" onClick={onRetry}>
          {copy.retryLoad}
        </button>
      ) : null}
    </div>
  );
}
