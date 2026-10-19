"use client";

// 게시판 신고 콘솔 — 화이트 리디자인(2026-10-15, 시안 「R · 게시판 신고 · PC」).
// 한 줄 요약(「처리할 신고 N」) + 표(대상 · 내용+사유 요약 · 작성자 · 신고 수 · 최근 신고) + 오른쪽 상세 패널
// (원문 · 사진 · 태그 · 사유별 수 · 메모 · 「문제없음으로 닫기」, 삭제는 위 휴지통 → 확인 창).
// 흰 바탕 · 상자 · 세로선 없음 · 선택은 옅은 보라 바탕만. docs/product/23-board-workflow.md §12-C
import "./board-reports-white.css";
import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import { resolveBoardReport } from "@/app/mobile/board/moderation-actions";
import { boardReasonLabel } from "@/lib/board-report-reasons";
import { haptic } from "@/lib/haptics";
import type { PendingBoardReport } from "@/lib/board-moderation";
import type { Dictionary } from "@/lib/i18n";

type Copy = Dictionary["board"];
type W = Dictionary["boardReportsWhite"];

const TOKYO_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 도쿄 기준 「10/8 21:14」. */
function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(TOKYO_PARTS.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function rowTitle(r: PendingBoardReport): string {
  return (r.preview || r.body).replace(/\s+/g, " ").trim();
}

function reasonSummary(r: PendingBoardReport, copy: Copy, w: W): string {
  return r.reasonCounts
    .map((x) => w.reasonN.replace("{reason}", boardReasonLabel(copy, x.reason)).replace("{n}", String(x.count)))
    .join(" · ");
}

export function BoardReportsConsole({ reports, copy, w }: { reports: PendingBoardReport[]; copy: Copy; w: W }) {
  const { toast, showToast, dismiss } = useAdminToast();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = reports.find((r) => r.key === selectedKey) ?? null;

  return (
    <div className="brw">
      <p className="brw-top">
        <b>
          {w.count} <span className={`num${reports.length > 0 ? " is-red" : ""}`}>{reports.length}</span>
        </b>
        <span>{w.hint}</span>
      </p>

      {reports.length === 0 ? (
        <div className="brw-empty">
          <b>{w.empty}</b>
          <span>{w.emptyHint}</span>
        </div>
      ) : (
        <>
          <div className="brw-th" aria-hidden="true">
            <span>{w.colTarget}</span>
            <span>{w.colContent}</span>
            <span>{w.colAuthor}</span>
            <span className="r">{w.colCount}</span>
            <span className="r">{w.colLatest}</span>
          </div>
          <div className="brw-rows">
            {reports.map((r) => (
              <button
                key={r.key}
                type="button"
                className={`brw-tr${selectedKey === r.key ? " on" : ""}`}
                aria-current={selectedKey === r.key ? "true" : undefined}
                onClick={() => setSelectedKey(r.key)}
              >
                <span className="brw-c is-soft">{r.targetType === "post" ? w.kindPost : w.kindComment}</span>
                <span className="brw-ttl">
                  <b>{rowTitle(r)}</b>
                  <span>{reasonSummary(r, copy, w)}</span>
                </span>
                <span className="brw-c">{r.authorName || w.unknownAuthor}</span>
                <span className="brw-n num">{r.count}</span>
                <span className="brw-c is-soft r num">{stamp(r.latestAt)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {selected ? (
        <ReportPanel
          key={selected.key}
          report={selected}
          copy={copy}
          w={w}
          onClose={() => setSelectedKey(null)}
          onDone={(message, ok) => {
            haptic(ok ? "success" : "error");
            showToast(message);
            if (ok) {
              setSelectedKey(null);
            }
          }}
        />
      ) : null}
      {toast ? <AdminToast key={toast.id} message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}

function ReportPanel({
  report,
  copy,
  w,
  onClose,
  onDone,
}: {
  report: PendingBoardReport;
  copy: Copy;
  w: W;
  onClose: () => void;
  onDone: (message: string, ok: boolean) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: confirm || photo !== null || pending });
  const isPost = report.targetType === "post";

  async function resolve(action: "remove" | "dismiss") {
    if (pending) return;
    setPending(true);
    try {
      const result = await resolveBoardReport({
        targetType: report.targetType,
        postId: report.postId,
        commentId: report.commentId,
        action,
      });
      if ("error" in result) {
        onDone(w.failed, false);
        return;
      }
      setConfirm(false);
      onDone(action === "remove" ? w.removed : w.dismissed, true);
    } catch {
      onDone(w.failed, false);
    } finally {
      setPending(false);
    }
  }

  const meta = [
    report.authorName || w.unknownAuthor,
    w.written.replace("{at}", stamp(report.targetCreatedAt)),
    report.reactionCount !== null ? w.reactions.replace("{n}", String(report.reactionCount)) : null,
    report.commentCount !== null ? w.comments.replace("{n}", String(report.commentCount)) : null,
  ].filter(Boolean);

  return (
    <>
      <div className="panel-scrim on" onClick={pending ? undefined : onClose} />
      <aside ref={panelRef} className="panel on brw-panel" role="dialog" aria-label={w.panelLabel} tabIndex={-1}>
        <div className="brw-hd">
          <div className="brw-hd__main">
            <span className="brw-hd__k">
              <b className="is-red num">{w.panelCount.replace("{n}", String(report.count))}</b>
              <span>{isPost ? w.kindPost : w.kindComment}</span>
            </span>
            <span className="brw-hd__m">{meta.join(" · ")}</span>
          </div>
          <button
            type="button"
            className="brw-ic is-danger"
            aria-label={isPost ? w.deletePost : w.deleteComment}
            onClick={() => setConfirm(true)}
            disabled={pending}
          >
            <Trash2 aria-hidden="true" />
          </button>
          <button type="button" className="brw-ic brw-hd__x" aria-label={w.close} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="brw-pb">
          <section className="brw-sec">
            <span className="brw-k">{w.original}</span>
            {isPost && report.postTitle ? <h2 className="brw-title">{report.postTitle}</h2> : null}
            {!isPost && report.postTitle ? (
              <span className="brw-on">{w.commentOn.replace("{title}", report.postTitle)}</span>
            ) : null}
            {report.body ? <p className="brw-body">{report.body}</p> : null}
            {report.imageUrls.length > 0 ? (
              <div className="brw-shots">
                {report.imageUrls.map((url, index) => (
                  <button
                    key={url}
                    type="button"
                    className="brw-shot"
                    onClick={() => setPhoto(url)}
                    aria-label={w.photoOpen.replace("{n}", String(index + 1))}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- 게시판 사진 버킷은 next/image 허용 목록 밖 */}
                    <img alt="" src={url} loading="lazy" />
                  </button>
                ))}
              </div>
            ) : null}
            {report.tags.length > 0 ? <p className="brw-tags">{report.tags.map((t) => `#${t}`).join(" ")}</p> : null}
          </section>

          <section className="brw-sec is-rule">
            <span className="brw-k">{w.reasonsTitle}</span>
            <ul className="brw-reasons">
              {report.reasonCounts.map((x) => (
                <li key={x.reason}>
                  <span>{boardReasonLabel(copy, x.reason)}</span>
                  <b className="num">{x.count}</b>
                </li>
              ))}
            </ul>
          </section>

          {report.noteItems.length > 0 ? (
            <section className="brw-sec">
              <span className="brw-k">{w.notesTitle}</span>
              <ul className="brw-notes">
                {report.noteItems.map((n, i) => (
                  <li key={i}>
                    <q>{n.note}</q>
                    <span className="num"> · {stamp(n.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="brw-pf">
          <button type="button" className="brw-btn is-gray" disabled={pending} aria-busy={pending} onClick={() => void resolve("dismiss")}>
            {w.dismiss}
          </button>
          <p className="brw-soft">{w.dismissHint}</p>
        </div>
      </aside>

      {confirm ? (
        <ConfirmModal
          w={w}
          isPost={isPost}
          pending={pending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void resolve("remove")}
        />
      ) : null}

      {photo ? (
        <div className="brw-viewer" role="dialog" aria-label={w.original} onClick={() => setPhoto(null)}>
          <button type="button" className="brw-viewer__x" aria-label={w.close} onClick={() => setPhoto(null)}>
            <X aria-hidden="true" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- 원본 비율 그대로 크게 보기 */}
          <img alt="" src={photo} onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
      <EscapeKey open={photo !== null} onClose={() => setPhoto(null)} />
    </>
  );
}

/** 열린 동안 Esc 를 먼저 가로채서 닫는다(뒤의 패널은 그대로). */
function EscapeKey({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  return null;
}

function ConfirmModal({
  w,
  isPost,
  pending,
  onCancel,
  onConfirm,
}: {
  w: W;
  isPost: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <EscapeKey open={!pending} onClose={onCancel} />
      <div className="modal-scrim on brw-scrim" onClick={pending ? undefined : onCancel} />
      <div className="modal on brw-modal" role="alertdialog" aria-modal="true" aria-labelledby="brw-confirm-t" aria-describedby="brw-confirm-b">
        <h2 id="brw-confirm-t">{isPost ? w.confirmPostTitle : w.confirmCommentTitle}</h2>
        <p id="brw-confirm-b">{w.confirmBody}</p>
        <div className="brw-modal__f">
          {/* 첫 초점은 「그대로 두기」 — Enter 한 번에 되돌릴 수 없는 삭제가 일어나지 않게. */}
          <button type="button" className="brw-btn is-gray" disabled={pending} onClick={onCancel} autoFocus>
            {w.keep}
          </button>
          <button type="button" className="brw-btn is-danger" disabled={pending} aria-busy={pending} onClick={onConfirm}>
            {w.delete}
          </button>
        </div>
      </div>
    </>
  );
}
