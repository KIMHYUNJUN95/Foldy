"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { boardReasonLabel } from "@/lib/board-report-reasons";
import { resolveBoardReport } from "../moderation-actions";
import type { PendingBoardReport } from "@/lib/board-moderation";
import type { Dictionary, Locale } from "@/lib/i18n";

export function BoardReportsClient({
  reports,
  copy,
  locale,
}: {
  reports: PendingBoardReport[];
  copy: Dictionary["board"];
  locale: Locale;
}) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingBoardReport | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dateFmt = new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Tokyo",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  async function resolve(report: PendingBoardReport, action: "remove" | "dismiss") {
    setPendingKey(report.key);
    try {
      const result = await resolveBoardReport({
        targetType: report.targetType,
        postId: report.postId,
        commentId: report.commentId,
        action,
      });
      setToast(
        "error" in result ? copy.errSaveFailed : action === "remove" ? copy.reportsRemoved : copy.reportsDismissed,
      );
      window.setTimeout(() => setToast(null), 1800);
      router.refresh();
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="pb-[120px]">
      <h1 className="px-[2px] text-[22px] font-black tracking-[-0.03em] text-foreground">{copy.reportsTitle}</h1>

      {reports.length === 0 ? (
        <p className="mt-10 text-center text-[13px] font-semibold text-muted-foreground">{copy.reportsEmpty}</p>
      ) : (
        <div className="mt-4 grid gap-3 fold:grid-cols-2 tablet:grid-cols-3">
          {reports.map((r) => (
            <article
              className="flex flex-col rounded-[18px] border border-border bg-surface p-4 shadow-[0_1px_2px_rgba(20,32,43,0.04)]"
              key={r.key}
            >
              <div className="flex items-center gap-2 text-[11.5px] font-bold">
                <span className="rounded-full bg-primary/[0.09] px-2 py-[2px] text-primary">
                  {r.targetType === "post" ? copy.reportsTargetPost : copy.reportsTargetComment}
                </span>
                <span className="truncate text-foreground">{r.authorName || copy.reportsAuthorUnknown}</span>
                <span className="ml-auto shrink-0 text-[#c5282e]">
                  {copy.reportsCount.replace("{count}", String(r.count))}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 whitespace-pre-line text-[13.5px] font-medium leading-[1.6] text-[#3a3746]">
                {r.preview}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.reasons.map((reason) => (
                  <span
                    className="rounded-full border border-border bg-background px-2 py-[2px] text-[11px] font-bold text-muted-foreground"
                    key={reason}
                  >
                    {boardReasonLabel(copy, reason)}
                  </span>
                ))}
              </div>
              {r.notes.slice(0, 2).map((note, i) => (
                <p className="mt-1.5 line-clamp-2 text-[12px] font-medium italic text-muted-foreground" key={i}>
                  “{note}”
                </p>
              ))}
              <p className="mt-2 text-[11px] font-semibold text-[#9a97a6]">{dateFmt.format(new Date(r.latestAt))}</p>
              <div className="mt-auto flex gap-2 pt-3">
                <Link
                  className="flex h-10 flex-1 items-center justify-center rounded-[11px] border border-border bg-background text-[12.5px] font-extrabold text-[#3a3746]"
                  href={`/mobile/board/${r.postId}`}
                >
                  {copy.reportsViewPost}
                </Link>
                <button
                  className="h-10 flex-1 rounded-[11px] border border-border bg-background text-[12.5px] font-extrabold text-primary disabled:opacity-50"
                  disabled={pendingKey === r.key}
                  onClick={() => resolve(r, "dismiss")}
                  type="button"
                >
                  {copy.reportsDismiss}
                </button>
                <button
                  className="h-10 flex-1 rounded-[11px] bg-[hsl(4_72%_52%)] text-[12.5px] font-extrabold text-white disabled:opacity-50"
                  disabled={pendingKey === r.key}
                  onClick={() => setConfirm(r)}
                  type="button"
                >
                  {copy.reportsRemove}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* 삭제 확인 — 게시판 삭제 확인과 같은 가운데 정렬 모달(의도된 BottomSheet 예외). */}
      {confirm && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-8" role="dialog" aria-modal="true">
          <div className="w-full max-w-[320px] rounded-[22px] bg-surface p-[22px] text-center shadow-[0_24px_60px_-20px_rgba(15,23,42,0.5)]">
            <p className="text-[15.5px] font-black tracking-[-0.01em] text-foreground">
              {confirm.targetType === "post" ? copy.reportsRemovePostTitle : copy.reportsRemoveCommentTitle}
            </p>
            <p className="mt-[7px] text-[12.5px] font-semibold leading-[1.5] text-muted-foreground">{copy.reportsRemoveBody}</p>
            <div className="mt-[18px] flex gap-[9px]">
              <button
                className="h-11 flex-1 rounded-[13px] border border-border bg-background text-[13.5px] font-extrabold text-[#3a3746]"
                onClick={() => setConfirm(null)}
                type="button"
              >
                {copy.actionCancel}
              </button>
              <button
                className="h-11 flex-1 rounded-[13px] bg-[hsl(4_72%_52%)] text-[13.5px] font-extrabold text-white"
                onClick={() => {
                  const target = confirm;
                  setConfirm(null);
                  void resolve(target, "remove");
                }}
                type="button"
              >
                {copy.deleteConfirmCta}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-[88px] z-[70] flex justify-center px-6">
          <div className="rounded-full bg-foreground/92 px-[18px] py-[9px] text-[12.5px] font-bold text-white shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
