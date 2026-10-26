"use client";

/**
 * 제안 상세 — 화이트 리디자인(2026-10-15, 시안 SuggDetail-Phone · Sugg-Tablet 오른쪽 칸). 보는 사람 역할별로 한 컴포넌트:
 *  - 위: 상태 글자 · 분류 · 건물 · 객실 / 제목 / 「보낸 → 받는 · 참조 · 날짜」 한 줄 / (작성자 · 접수 상태면) 수정 · 삭제
 *  - 보류 사유 · 완료 메모(있으면) · 본문 · 사진
 *  - 「댓글 N」 — 댓글과 상태 바뀜 기록을 시간순으로 같은 자리에(예전 댓글 시트 → 화면 안으로)
 *  - 받은 사람만 「상태 바꾸기」 4칸(보류 · 완료는 공용 BottomSheet 에서 사유 · 메모를 받는다), 나머지는 안내 한 줄
 *  - 맨 아래 댓글 입력(기존 SuggestionCommentComposer — 사진 5장까지)
 * 서버 액션 · 권한은 그대로다. 예전 화면의 하트(좋아요)는 저장되지 않는 화면 장식이라 뺐다.
 * See docs/product/22-staff-suggestions-workflow.md 「화이트 리디자인 — 모바일」.
 */

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import {
  deleteStaffSuggestion,
  updateStaffSuggestionStatus,
} from "@/app/mobile/suggestions/actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { StaffSuggestionStatus } from "@/lib/suggestions";
import {
  localizeSuggestionCategory,
  localizeSuggestionPropertyName,
} from "@/lib/suggestion-display";
import type { SuggestionDetail } from "@/lib/suggestions-queries";
import "./suggestions.css";
import "./suggestions-white.css";
import { SuggestionCommentComposer } from "./suggestion-comment-composer";
import { SuggestionCommentItem } from "./suggestion-comment-item";
import { haptic } from "@/lib/haptics";

type SgCopy = Dictionary["mobile"]["suggestions"];

const STATUSES: StaffSuggestionStatus[] = ["submitted", "reviewing", "on_hold", "completed"];

function tokyoStamp(iso: string, locale: Locale, withDate: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    ...(withDate ? { month: "numeric", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

export function SuggestionsDetail({
  data,
  locale,
  organizationId,
  viewerUserId,
  copy,
}: {
  data: SuggestionDetail;
  locale: Locale;
  organizationId: string;
  viewerUserId: string;
  copy: SgCopy;
}) {
  const w = copy.white;
  const [noteSheet, setNoteSheet] = useState<"hold" | "done" | null>(null);
  const [holdReason, setHoldReason] = useState(data.holdReason ?? "");
  const [completionNote, setCompletionNote] = useState(data.completionNote ?? "");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<StaffSuggestionStatus | null>(null);
  const [isStatusPending, startStatus] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // 작성자는 `submitted` 상태인 동안에만 본 건의를 수정/삭제할 수 있다.
  const canAuthorEdit = data.viewerRole === "author" && data.status === "submitted";
  // 상태 바꾸기 — 받는 사람 또는 플랫폼 개발자(서버 changeSuggestionStatus 와 같은 규칙).
  const isRecipient = data.viewerCanChangeStatus;

  function removeSuggestion() {
    startDelete(async () => {
      const fd = new FormData();
      fd.set("suggestionId", data.id);
      await deleteStaffSuggestion(fd);
    });
  }

  // 수신자 전용 상태 변경. 네 가지 상태 사이에서 되돌릴 수 있으며, on_hold/completed 는 메모를 동반한다.
  function changeStatus(
    target: StaffSuggestionStatus,
    opts?: { holdReason?: string; completionNote?: string },
    onDone?: () => void,
  ) {
    if (isStatusPending) return;
    setStatusError(null);
    setPendingTarget(target);
    startStatus(async () => {
      const fd = new FormData();
      fd.set("suggestionId", data.id);
      fd.set("status", target);
      if (opts?.holdReason) fd.set("holdReason", opts.holdReason);
      if (opts?.completionNote) fd.set("completionNote", opts.completionNote);
      const result = await updateStaffSuggestionStatus(fd);
      setPendingTarget(null);
      if (!result.ok) {
        haptic("error");
        setStatusError(copy.errors.save_failed);
        return;
      }
      haptic("success");
      onDone?.();
    });
  }

  function pickStatus(target: StaffSuggestionStatus) {
    if (target === "on_hold") {
      setHoldReason(data.holdReason ?? "");
      setStatusError(null);
      setNoteSheet("hold");
      return;
    }
    if (target === "completed") {
      setCompletionNote(data.completionNote ?? "");
      setStatusError(null);
      setNoteSheet("done");
      return;
    }
    if (target === data.status) return;
    changeStatus(target);
  }

  const categoryLabel = localizeSuggestionCategory(data.category, locale);
  const propertyLabel = localizeSuggestionPropertyName(data.propertyName, locale);
  const kicker = [categoryLabel, propertyLabel, data.roomLabel].filter(Boolean) as string[];
  const refs = data.references.map((r) => r.name || "—").join(", ");
  const meta = [
    `${data.author.name || "—"} → ${data.recipient.name || "—"}`,
    refs ? w.refLine.replace("{names}", refs) : null,
    hydrated ? tokyoStamp(data.createdAt, locale, true) : null,
  ].filter(Boolean);

  // 댓글 스레드 = 댓글 + 상태 변경 이벤트를 시간순으로 섞은 것 (이벤트는 로그로 렌더).
  const timeline = [
    ...data.comments.map((c) => ({ kind: "comment" as const, at: c.createdAt, comment: c })),
    ...data.events.map((e) => ({ kind: "event" as const, at: e.createdAt, event: e })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const shownStatus = pendingTarget && pendingTarget !== "on_hold" && pendingTarget !== "completed" ? pendingTarget : data.status;

  return (
    <div className="sg sgw sgw-d">
      <div className="sgw-dh">
        <div className="sgw-dh__k">
          <span className="sgw-st" data-s={data.status}>
            {copy.status[data.status]}
          </span>
          {kicker.map((k) => (
            <span key={k} style={{ display: "contents" }}>
              <span aria-hidden="true" className="sgw-dot">
                ·
              </span>
              <span>{k}</span>
            </span>
          ))}
        </div>
        <h1>{data.title}</h1>
        <span className="sgw-dh__m">{meta.join(" · ")}</span>
      </div>

      {canAuthorEdit ? (
        <div className="sgw-own">
          <Link href={`/mobile/suggestions/${data.id}/edit`}>{copy.edit}</Link>
          {confirmDelete ? (
            <>
              <span className="sgw-own__q">{copy.deletePrompt}</span>
              <button data-tone="red" disabled={isDeleting} onClick={removeSuggestion} type="button">
                {copy.delete}
              </button>
              <button onClick={() => setConfirmDelete(false)} type="button">
                {copy.cancel}
              </button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} type="button">
              {copy.delete}
            </button>
          )}
        </div>
      ) : null}

      {data.status === "on_hold" && data.holdReason ? (
        <div className="sgw-note">
          <b>{copy.holdBanner}</b>
          {data.holdReason}
        </div>
      ) : null}
      {data.status === "completed" && data.completionNote ? (
        <div className="sgw-note" data-tone="done">
          <b>{copy.completionBanner}</b>
          {data.completionNote}
        </div>
      ) : null}

      <p className="sgw-body">{data.body}</p>
      {data.imageUrls.length ? (
        <div className="sgw-photos">
          {data.imageUrls.map((url, i) => (
            <a
              aria-label={`${w.photosAlt} ${i + 1}`}
              href={url}
              key={url}
              rel="noreferrer"
              style={{ backgroundImage: `url(${url})` }}
              target="_blank"
            />
          ))}
        </div>
      ) : null}

      <section className="sgw-sec">
        <b>{w.comments.replace("{n}", String(data.comments.length))}</b>
        {timeline.length === 0 ? (
          <p className="sgw-nocmt">{copy.noComments}</p>
        ) : (
          timeline.map((item) =>
            item.kind === "comment" ? (
              <SuggestionCommentItem
                comment={item.comment}
                copy={copy}
                hydrated={hydrated}
                isOwn={item.comment.authorId === viewerUserId}
                key={`c-${item.comment.id}`}
                locale={locale}
              />
            ) : (
              <div className="sgw-log" key={`e-${item.event.id}`}>
                {copy.statusLog
                  .replace("{name}", item.event.actorName || "—")
                  .replace("{status}", copy.status[item.event.status])}
                {hydrated ? ` · ${tokyoStamp(item.event.createdAt, locale, false)}` : ""}
              </div>
            ),
          )
        )}
      </section>

      <section className="sgw-sec">
        {isRecipient ? (
          <>
            <span className="sgw-sec__t">{w.statusTitle}</span>
            <div aria-label={w.statusTitle} className="sgw-seg" role="group">
              {STATUSES.map((s) => (
                <button
                  aria-pressed={shownStatus === s}
                  disabled={isStatusPending}
                  key={s}
                  onClick={() => pickStatus(s)}
                  type="button"
                >
                  {copy.status[s]}
                </button>
              ))}
            </div>
            {statusError && !noteSheet ? (
              <p className="sgw-err" role="alert">
                {statusError}
              </p>
            ) : null}
          </>
        ) : (
          <span className="sgw-perm">{copy.statusBarNote}</span>
        )}
      </section>

      <SuggestionCommentComposer copy={copy} organizationId={organizationId} suggestionId={data.id} />

      {noteSheet ? (
        <BottomSheet
          ariaLabel={noteSheet === "hold" ? copy.holdSheetTitle : copy.doneSheetTitle}
          onClose={() => setNoteSheet(null)}
        >
          {({ close }) => {
            const isHold = noteSheet === "hold";
            const value = isHold ? holdReason : completionNote;
            return (
              <div className="sgw-rs">
                <div className="sgw-rs__h">
                  <b>{isHold ? copy.holdSheetTitle : copy.doneSheetTitle}</b>
                  <span>{isHold ? copy.holdSheetSub : copy.doneSheetSub}</span>
                </div>
                <textarea
                  aria-label={isHold ? copy.holdField : copy.doneField}
                  onChange={(e) => (isHold ? setHoldReason(e.target.value) : setCompletionNote(e.target.value))}
                  placeholder={isHold ? copy.holdPlaceholder : copy.donePlaceholder}
                  rows={4}
                  value={value}
                />
                {statusError ? <p role="alert">{statusError}</p> : null}
                <button
                  className="sgw-rs__go"
                  data-tone={isHold ? undefined : "done"}
                  disabled={!value.trim() || isStatusPending}
                  onClick={() =>
                    changeStatus(
                      isHold ? "on_hold" : "completed",
                      isHold ? { holdReason: value.trim() } : { completionNote: value.trim() },
                      close,
                    )
                  }
                  type="button"
                >
                  {isHold ? copy.holdConfirm : copy.doneConfirm}
                </button>
                <button className="sgw-rs__no" onClick={close} type="button">
                  {copy.cancel}
                </button>
              </div>
            );
          }}
        </BottomSheet>
      ) : null}
    </div>
  );
}
