"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { BoardConfirm } from "@/components/board/board-confirm";
import { boardReasonLabel } from "@/lib/board-report-reasons";
import { haptic } from "@/lib/haptics";
import "@/components/board/board-white.css";
import { resolveBoardReport } from "@/actions/board-moderation";
import type { PendingBoardReport } from "@/lib/board-moderation";
import type { Dictionary } from "@/lib/i18n";
import { BoardToast } from "@/components/board/board-toast";
import { boardDateTime } from "@/components/board/board-time";

/**
 * 게시판 신고 처리(모바일, owner · office_admin) — 화이트 리디자인(2026-10-15, 시안 BoardReports-Phone).
 * 대상별 묶음 한 줄: 「신고 n건 · 글/댓글 · 작성자」 + 오른쪽 시각 · 제목(글) 또는 댓글 내용 · 「사유 n · 사유 n」 · 메모 인용 ·
 * 회색 「글 보기」 · 옅은 보라 「문제없음」 · 빨간 휴지통(가운데 확인 뒤 삭제). 폰 1열 · 폴드 2열 · 태블릿 3열.
 */
export function BoardReportsClient({
  reports,
  copy,
  hint,
  reasonN,
}: {
  reports: PendingBoardReport[];
  copy: Dictionary["board"];
  /** 「같은 글에 들어온 신고는 한 줄로 묶어요」(PC 신고 콘솔과 같은 문구). */
  hint: string;
  /** 「{reason} {n}」 */
  reasonN: string;
}) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingBoardReport | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 처리한 묶음은 서버를 기다리지 않고 바로 접는다(줄 접힘 공용 `.row-collapse`). 실패하면 다시 펴고 알린다(unslop 2026-11-20).
  // "pending" = 서버 처리 중 · "done" = 처리 끝. 새 목록(reports)이 오면 "done" 은 지운다 — 같은 대상에 새 신고가
  // 들어와 다시 목록에 올라온 줄이 접힌 채로 숨지 않게.
  const [leaving, setLeaving] = useState<ReadonlyMap<string, "pending" | "done">>(() => new Map());
  const [seenReports, setSeenReports] = useState(reports);
  if (seenReports !== reports) {
    setSeenReports(reports);
    setLeaving((prev) => {
      if (![...prev.values()].includes("done")) return prev;
      return new Map([...prev].filter(([, state]) => state === "pending"));
    });
  }

  const toastTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );
  function dismissToast() {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(null);
  }
  function showToast(text: string) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }

  async function resolve(report: PendingBoardReport, action: "remove" | "dismiss") {
    setPendingKey(report.key);
    setLeaving((prev) => new Map(prev).set(report.key, "pending"));
    let ok = false;
    try {
      const result = await resolveBoardReport({
        targetType: report.targetType,
        postId: report.postId,
        commentId: report.commentId,
        action,
      });
      ok = !("error" in result);
    } catch {
      ok = false;
    } finally {
      setPendingKey(null);
    }
    if (!ok) {
      setLeaving((prev) => {
        const next = new Map(prev);
        next.delete(report.key);
        return next;
      });
      haptic("error");
      showToast(copy.reportsFailed);
      return;
    }
    setLeaving((prev) => new Map(prev).set(report.key, "done"));
    haptic("success");
    showToast(action === "remove" ? copy.reportsRemoved : copy.reportsDismissed);
    router.refresh();
  }

  return (
    <div className="bdw bdw-rep">
      <header className="bdw-rep__head">
        <h1>{copy.reportsMobileTitle}</h1>
        <span>{hint}</span>
      </header>

      {reports.length === 0 ? (
        <div className="bdw-empty">
          <b>{copy.reportsEmpty}</b>
        </div>
      ) : (
        <div className="bdw-rep__list">
          {reports.map((r) => {
            const reasonCounts = r.reasonCounts?.length
              ? r.reasonCounts
              : r.reasons.map((reason) => ({ reason, count: 1 }));
            const headline = r.targetType === "post" ? r.postTitle || r.preview : r.preview;
            const busy = pendingKey === r.key;
            return (
              <div
                className="row-collapse"
                data-leaving={leaving.has(r.key) ? "" : undefined}
                inert={leaving.has(r.key) || undefined}
                key={r.key}
              >
              <article className="bdw-rep__g">
                <div className="bdw-rep__top">
                  <b className="num">{copy.reportsCount.replace("{count}", String(r.count))}</b>
                  <i aria-hidden="true">·</i>
                  <span>{r.targetType === "post" ? copy.reportsTargetPost : copy.reportsTargetComment}</span>
                  <i aria-hidden="true">·</i>
                  <span className="is-who">{r.authorName || copy.reportsAuthorUnknown}</span>
                  <time className="num" dateTime={r.latestAt}>
                    {boardDateTime(r.latestAt)}
                  </time>
                </div>
                <span className="bdw-rep__t">{headline}</span>
                <span className="bdw-rep__r">
                  {reasonCounts
                    .map((x) => reasonN.replace("{reason}", boardReasonLabel(copy, x.reason)).replace("{n}", String(x.count)))
                    .join(" · ")}
                </span>
                {r.notes.slice(0, 2).map((note, i) => (
                  <span className="bdw-rep__q" key={i}>
                    “{note}”
                  </span>
                ))}
                <div className="bdw-rep__btns">
                  <Link className="bdw-btn is-gray" href={`/mobile/board/${r.postId}`}>
                    {copy.reportsViewPost}
                  </Link>
                  <button className="bdw-btn is-soft" disabled={busy} onClick={() => resolve(r, "dismiss")} type="button">
                    {copy.reportsDismiss}
                  </button>
                  <button
                    aria-label={copy.reportsRemove}
                    className="bdw-btn is-trash"
                    disabled={busy}
                    onClick={() => setConfirm(r)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" strokeWidth={1.7} />
                  </button>
                </div>
              </article>
              </div>
            );
          })}
        </div>
      )}

      {/* 삭제 확인 — 가운데 확인 창(의도된 BottomSheet 예외). */}
      {confirm ? (
        <BoardConfirm
          body={copy.reportsRemoveBody}
          cancelLabel={copy.actionCancel}
          confirmLabel={copy.deleteConfirmCta}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const target = confirm;
            setConfirm(null);
            void resolve(target, "remove");
          }}
          title={confirm.targetType === "post" ? copy.reportsRemovePostTitle : copy.reportsRemoveCommentTitle}
        />
      ) : null}

      {toast ? <BoardToast onDismiss={dismissToast} text={toast} /> : null}
    </div>
  );
}
