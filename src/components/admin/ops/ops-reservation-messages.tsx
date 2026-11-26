"use client";

/**
 * 예약 패널 「손님 메시지」 칸 — PC 예약 패널과 모바일 예약 시트가 같이 쓴다(2026-11-26).
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 패널 — 손님 메시지」 · `docs/product/47-guest-messaging.md`
 * 시안: 캔버스 MM33d93w… v11
 *
 * - 패널이 열린 뒤에 따로 읽는다(`loadReservationMessages`) — 숙박 · 금액은 기다리지 않는다.
 * - 권한: `guest_messages.view` 가 없으면 칸 자체가 없다. 보기만 = 최근 2개 + 대화로 가기, 답장 = 입력 칸까지.
 * - 대화가 없으면 「첫 메시지 쓰기」 — 보내면 대화가 생긴다. 발송이 꺼져 있으면 「보내기 대기」(켜질 때 나간다).
 * - 실패: role=alert 「보내지 못했어요 · 다시 보내기」, 쓴 글은 그대로 두고 같은 키로 다시 보낸다(두 번 안 나간다).
 *   이미 큐에 들어갔다가 실패한 우리 메시지는 `retryGuestOutbox` 로 다시 보낸다.
 * - 햅틱: 서버가 받은 뒤 success, 실패 error.
 */

import { useEffect, useId, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { retryGuestOutbox } from "@/actions/guest-messages";
import {
  loadReservationMessages,
  sendReservationMessage,
  type LoadReservationMessagesResult,
} from "@/actions/reservation-messages";
import { haptic } from "@/lib/haptics";
import "./ops-reservation-messages.css";

export type ReservationMessagesCopy = {
  rmTitle: string;
  rmUnread: string;
  rmOpen: string;
  rmEmpty: string;
  rmGuest: string;
  rmHost: string;
  rmInputLabel: string;
  rmSend: string;
  rmFirst: string;
  rmQueue: string;
  /** 버튼 글자 — 폰 폭에서 en · ja 가 두 줄로 꺾이지 않게(2026-11-26). 긴 문구는 aria-label 로. */
  rmFirstShort: string;
  rmQueueShort: string;
  rmSendOffNotice: string;
  rmSending: string;
  rmSent: string;
  rmQueued: string;
  rmFailed: string;
  rmRetry: string;
  rmOutboxFailed: string;
  rmBlockedDirect: string;
  rmBlockedUnknown: string;
  rmLoadFailed: string;
};

type Loaded = Extract<LoadReservationMessagesResult, { ok: true }>;
type Phase = "idle" | "sending" | "sent" | "queued" | "failed";

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `rm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function stamp(iso: string, localeTag: string): string {
  try {
    return new Intl.DateTimeFormat(localeTag, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function OpsReservationMessages({
  copy,
  localeTag,
  reservationId,
  variant,
}: {
  copy: ReservationMessagesCopy;
  localeTag: string;
  reservationId: string;
  /** pc = 관리자 콘솔 패널(`/admin/messages?c=`), mobile = 모바일 시트(`/mobile/messages/<id>`). */
  variant: "pc" | "mobile";
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [text, setText] = useState("");
  // 같은 글을 다시 보내면 같은 키 — 서버가 첫 줄을 돌려줘 두 번 나가지 않는다. 글이 바뀌면 새 키.
  const [key, setKey] = useState(newKey);
  const [phase, setPhase] = useState<Phase>("idle");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const inputId = useId();
  const noteId = useId();
  const statusId = useId();

  useEffect(() => {
    let alive = true;
    loadReservationMessages(reservationId)
      .then((result) => {
        if (!alive) return;
        if (result.ok) {
          setData(result);
          setLoadFailed(false);
        } else if (result.errorKey === "forbidden" || result.errorKey === "not_found") {
          setHidden(true);
        } else {
          setLoadFailed(true);
        }
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [reservationId, reloadKey]);

  if (hidden) return null;

  const sectionClass = variant === "pc" ? "spw-sect rmsg" : "msw-sect rmsg is-mobile";
  const head = variant === "pc" ? "spw-sec" : "h";

  if (!data) {
    return loadFailed ? (
      <section className={sectionClass}>
        <span className={head}>{copy.rmTitle}</span>
        <p className="rmsg__note is-err">{copy.rmLoadFailed}</p>
      </section>
    ) : null;
  }

  const href = data.conversationId
    ? variant === "pc"
      ? `/admin/messages?c=${data.conversationId}`
      : `/mobile/messages/${data.conversationId}`
    : null;
  const canReply = data.access === "reply" && !data.blocked;
  const busy = phase === "sending";
  const sendLabel = !data.sendEnabled ? copy.rmQueue : data.conversationId ? copy.rmSend : copy.rmFirst;
  const sendShort = !data.sendEnabled ? copy.rmQueueShort : data.conversationId ? copy.rmSend : copy.rmFirstShort;
  const blockedText =
    data.blocked === "direct_booking" ? copy.rmBlockedDirect : data.blocked ? copy.rmBlockedUnknown : null;

  const send = () => {
    const body = text.trim();
    if (!body || busy) return;
    setPhase("sending");
    startTransition(async () => {
      try {
        const result = await sendReservationMessage({ reservationId, body, idempotencyKey: key });
        if (!result.ok) {
          haptic("error");
          setPhase("failed");
          return;
        }
        haptic("success");
        setPhase(result.sendEnabled ? "sent" : "queued");
        setText("");
        setKey(newKey());
        setReloadKey((value) => value + 1);
      } catch {
        haptic("error");
        setPhase("failed");
      }
    });
  };

  const retryOutbox = (outboxId: string) => {
    setRetrying(outboxId);
    startTransition(async () => {
      try {
        const result = await retryGuestOutbox(outboxId);
        if (result.ok) {
          haptic("success");
          setReloadKey((value) => value + 1);
        } else {
          haptic("error");
        }
      } catch {
        haptic("error");
      } finally {
        setRetrying(null);
      }
    });
  };

  return (
    <section aria-labelledby={`${statusId}-t`} className={sectionClass}>
      <span className={head} id={`${statusId}-t`}>
        <span>
          {copy.rmTitle}
          {data.unreadCount > 0 && (
            <b className="rmsg__unread">{copy.rmUnread.replace("{n}", String(data.unreadCount))}</b>
          )}
        </span>
        {href && (
          <Link className="rmsg__open" href={href}>
            {copy.rmOpen}
            <ChevronRight aria-hidden="true" size={14} strokeWidth={2} />
          </Link>
        )}
      </span>

      {data.messages.length === 0 ? (
        <p className="rmsg__note">{copy.rmEmpty}</p>
      ) : (
        <ol className="rmsg__list">
          {data.messages.map((message) => {
            const outbox = message.outbox;
            const failed = outbox?.status === "failed" || outbox?.status === "uncertain";
            return (
              <li className={`rmsg__item is-${message.direction}`} key={message.id}>
                <span className="rmsg__meta">
                  {message.direction === "guest" ? copy.rmGuest : copy.rmHost}
                  <time dateTime={message.sentAt}>{stamp(message.sentAt, localeTag)}</time>
                </span>
                <p className="rmsg__body">{message.bodyTranslated ?? message.body}</p>
                {failed && outbox && (
                  <span className="rmsg__fail">
                    {copy.rmOutboxFailed}
                    {outbox.retryable && data.access === "reply" && (
                      <button
                        className="rmsg__link"
                        disabled={retrying === outbox.id}
                        onClick={() => retryOutbox(outbox.id)}
                        type="button"
                      >
                        {copy.rmRetry}
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {blockedText && data.access === "reply" && <p className="rmsg__note">{blockedText}</p>}

      {canReply && (
        <div className="rmsg__form">
          <label className="sr-only" htmlFor={inputId}>
            {copy.rmInputLabel}
          </label>
          <textarea
            aria-describedby={!data.sendEnabled ? noteId : undefined}
            className="rmsg__input"
            disabled={busy}
            id={inputId}
            onChange={(event) => {
              setText(event.target.value);
              // 글이 바뀌면 다른 메시지 — 새 키. 실패한 뒤 그대로 다시 보내면 같은 키.
              if (phase === "failed" || phase === "sent" || phase === "queued") setPhase("idle");
              setKey((current) => (phase === "failed" ? newKey() : current));
            }}
            placeholder={copy.rmInputLabel}
            rows={variant === "pc" ? 2 : 3}
            value={text}
          />
          {!data.sendEnabled && (
            <p className="rmsg__note" id={noteId}>
              {copy.rmSendOffNotice}
            </p>
          )}
          <div className="rmsg__row">
            <span aria-live="polite" className="rmsg__status" role="status">
              {phase === "sending" ? copy.rmSending : phase === "sent" ? copy.rmSent : phase === "queued" ? copy.rmQueued : ""}
            </span>
            <button
              className={variant === "pc" ? "spw-btn is-primary rmsg__send" : "msw-btn rmsg__send"}
              disabled={busy || text.trim().length === 0}
              onClick={send}
              aria-label={variant === "pc" ? undefined : sendLabel}
              type="button"
            >
              {variant === "pc" ? sendLabel : sendShort}
            </button>
          </div>
          {phase === "failed" && (
            <p className="rmsg__alert" role="alert">
              {copy.rmFailed}
              <span aria-hidden="true"> · </span>
              <button className="rmsg__link" onClick={send} type="button">
                {copy.rmRetry}
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
