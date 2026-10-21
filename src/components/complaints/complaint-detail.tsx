"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Trash2, X, ZoomIn } from "lucide-react";
import "./feedback-mobile.css";
import { platformName, ratingMax } from "./cx-platform";
import { ComplaintDeleteSheet } from "./complaint-delete-sheet";
import { getDictionary } from "@/lib/i18n";
import { tokyoDateOf } from "@/lib/tokyo-date";
import { haptic } from "@/lib/haptics";
import { getCanonicalPropertyName, localizePropertyName } from "@/lib/room-label-normalization";
import type { Complaint, ComplaintComment } from "@/lib/complaints";
import {
  resolveComplaintAction,
  reopenComplaintAction,
  createComplaintCommentAction,
} from "@/app/mobile/complaints/actions";

/** «10/8 14:20» — 도쿄 기준. */
function stamp(iso: string): string {
  const day = tokyoDateOf(iso);
  const time = new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
  return day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))} ${time}` : "—";
}

function Lightbox({ src, caption, onClose, hint, closeLabel }: { src: string; caption: string; onClose: () => void; hint: string; closeLabel: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fbw-lightbox" role="dialog" aria-modal="true" aria-label={caption}>
      <button type="button" className="fbw-lightbox__x" onClick={onClose} aria-label={closeLabel}>
        <X aria-hidden="true" />
      </button>
      <div className="fbw-lightbox__stage" onClick={onClose}>
        {/* 라이트박스는 원본 해상도로 본다(결정 로그 2026-06-22) — next/image 축소본을 쓰지 않는다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={caption} />
      </div>
      <span className="fbw-lightbox__hint">
        <ZoomIn aria-hidden="true" />
        {hint}
      </span>
    </div>,
    document.body,
  );
}

/**
 * 수동 컴플레인 상세 — 모바일. 화이트 리디자인(2026-10-14, 시안 FBCx-Phone):
 * 상태 · 플랫폼 → 제목(오른쪽 휴지통) → 건물 · 객실 / 예약 / 평점 / 등록자 → 내용 · 사진 → 처리 기록 + 남기기 →
 * 「처리 완료로 바꾸기」(체크 그리기 + 진동) / 「미처리로 되돌리기」. 삭제는 확인 시트(hard delete).
 * PC 상세 패널과 같은 순서 · 같은 서버 액션. See docs/product/25-complaint-workflow.md → 「화이트 리디자인」.
 */
export function ComplaintDetail({
  complaint,
  comments,
  locale,
  currentUserId,
  canModerate,
  canChangeStatus,
  canComment,
}: {
  complaint: Complaint;
  comments: ComplaintComment[];
  locale: string;
  currentUserId: string;
  canModerate: boolean;
  canChangeStatus: boolean;
  canComment: boolean;
}) {
  const dict = getDictionary(locale);
  const t = dict.complaints;
  const buildingLabels = dict.cleaning.buildingLabels;
  const c = complaint;
  const router = useRouter();
  const [lightbox, setLightbox] = useState<{ src: string; caption: string } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [justResolved, setJustResolved] = useState(false);
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();

  // 해결 · 다시 열기는 누르자마자 반영(2026-10-21 네이티브 점검 — 즉시 반영). 실패하면 전환이 끝날 때 원래 상태로 돌아간다.
  const [status, setOptimisticStatus] = useOptimistic(c.status);
  const open = status === "open";
  const max = ratingMax(c.platform);
  const canDelete = canModerate || c.createdByUserId === currentUserId;
  const building = c.propertyName ? localizePropertyName(getCanonicalPropertyName(c.propertyName), buildingLabels) : null;
  const place = building ? `${building}${c.roomLabel ? ` · ${c.roomLabel}` : ""}` : "—";

  function handleStatus() {
    setError(false);
    const resolving = open;
    startTransition(async () => {
      setOptimisticStatus(resolving ? "resolved" : "open");
      if (resolving) {
        setJustResolved(true);
        haptic("success");
      }
      const res = resolving ? await resolveComplaintAction(c.id) : await reopenComplaintAction(c.id);
      if ("error" in res) {
        setError(true);
        setJustResolved(false);
        haptic("error");
        return;
      }
      router.refresh();
    });
  }

  function handleComment() {
    const text = commentText.trim();
    if (!text || isPending) return;
    setError(false);
    startTransition(async () => {
      const res = await createComplaintCommentAction(c.id, text, []);
      if ("error" in res) {
        setError(true);
        haptic("error");
        return;
      }
      setCommentText("");
      haptic("light");
      router.refresh();
    });
  }

  const rows: [string, React.ReactNode][] = [[t.wFieldPlace, place]];
  if (c.guestName || c.platformRef) {
    rows.push([
      t.wFieldReservation,
      <>
        {c.guestName ?? t.noGuestName}
        {c.platformRef ? <span className="num">{` · ${c.platformRef}`}</span> : null}
      </>,
    ]);
  }
  if (max > 0 && c.rating != null) {
    rows.push([
      t.metaRating,
      <span className="num" key="r">
        <b className="is-bad">{c.rating}</b>
        {` / ${max} · ${platformName(c.platform, dict)}`}
      </span>,
    ]);
  }
  rows.push([t.authorLabel, <span className="num" key="a">{`${c.authorName || "—"} · ${stamp(c.createdAt)}`}</span>]);
  if (c.resolvedAt) rows.push([t.resolvedAtLabel, <span className="num" key="d">{stamp(c.resolvedAt)}</span>]);

  return (
    <div className="fbw fbw-detail">
      <div className="fbw-dh">
        <div className="fbw-dh__main">
          <span className="fbw-kick">
            <span className={`fbw-st${open ? " is-open" : " is-done"}`}>
              <i aria-hidden="true" />
              {open ? t.statusOpen : t.wDoneTab}
            </span>
            <span>{platformName(c.platform, dict)}</span>
          </span>
          <h1 className="fbw-dh__title">{c.title}</h1>
        </div>
        {canDelete ? (
          <button type="button" className="fbw-del" aria-label={t.deleteAction} onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <dl className="fbw-dl">
        {rows.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <section className="fbw-sec">
        <small className="fbw-k">{t.wContent}</small>
        <p className={c.description ? "fbw-p" : "fbw-p is-dim"}>{c.description || t.noDescription}</p>
        {c.imageUrls.length > 0 ? (
          <div className="fbw-shots">
            {c.imageUrls.map((url, i) => {
              const caption = `${t.photosTitle} ${i + 1}`;
              return (
                <button key={url} type="button" className="fbw-shot" aria-label={caption} onClick={() => setLightbox({ src: url, caption })}>
                  <Image src={url} alt="" fill sizes="96px" />
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="fbw-sec">
        <small className="fbw-k">{t.wLogTitle.replace("{n}", String(comments.length))}</small>
        <ol className="fbw-log">
          {comments.map((cm) => (
            <li key={cm.id}>
              <span className="fbw-log__by">
                <b>{cm.authorName || "—"}</b>
                <span className="num">{stamp(cm.createdAt)}</span>
              </span>
              <p>{cm.content}</p>
              {cm.imageUrls.length > 0 ? (
                <span className="fbw-shots">
                  {cm.imageUrls.map((url, i) => (
                    <button key={url} type="button" className="fbw-shot is-sm" aria-label={`${t.photosTitle} ${i + 1}`} onClick={() => setLightbox({ src: url, caption: `${t.photosTitle} ${i + 1}` })}>
                      <Image src={url} alt="" fill sizes="56px" />
                    </button>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        {/* 댓글 권한이 없으면(파트타임) 입력칸 자체를 그리지 않는다 — 막힌 칸은 고장으로 읽힌다. */}
        {canComment ? (
          <div className="fbw-compose">
            <textarea
              rows={1}
              name="content"
              autoComplete="off"
              value={commentText}
              aria-label={t.wLogPlaceholder}
              placeholder={t.wLogPlaceholder}
              onChange={(e) => setCommentText(e.target.value)}
            />
            <button type="button" className="fbw-send" aria-label={t.wSend} onClick={handleComment} disabled={isPending || !commentText.trim()}>
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </section>

      {error ? (
        <p className="fbw-err" role="alert">
          {t.wActionFailed}
        </p>
      ) : null}

      {canChangeStatus ? (
        <button type="button" className={`fbw-btn ${open ? "is-pri" : "is-soft"} is-big${justResolved ? " is-done" : ""}`} onClick={handleStatus} disabled={isPending}>
          {open ? <Check className="fbw-check" aria-hidden="true" /> : null}
          {open ? t.wResolve : t.wReopen}
        </button>
      ) : null}

      {deleting ? (
        <ComplaintDeleteSheet
          complaintId={c.id}
          onClose={() => setDeleting(false)}
          labels={{
            title: t.wDeleteTitle,
            summary: `${c.title} · ${place}`,
            body: `${t.wDeleteBody.replace("{n}", String(comments.length))} ${t.wDeleteLinked}`,
            warn: t.wDeleteWarn,
            keep: t.wKeep,
            confirm: t.deleteConfirm,
            failed: dict.common.deleteFailed,
          }}
        />
      ) : null}

      {lightbox ? (
        <Lightbox src={lightbox.src} caption={lightbox.caption} hint={t.lightboxHint} closeLabel={t.lightboxClose} onClose={() => setLightbox(null)} />
      ) : null}
    </div>
  );
}
