"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { BugStatusBadge } from "@/components/bugs/bug-status-badge";
import { BugStatusSheet } from "@/components/bugs/bug-status-sheet";
import {
  bugStatusLabel,
  type BugCopy,
  type BugReport,
  type BugStatus,
} from "@/components/bugs/bug-types";
import { deleteBugReportAction, setBugReportStatus } from "../actions";

// ISO → "MM.dd HH:mm" 형태로 클라이언트에서 포맷
function formatReportedAt(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}.${dd} ${hh}:${min}`;
}

type Props = {
  copy: BugCopy;
  bug: BugReport;
  viewerIsAuthor: boolean;
  isReviewer: boolean;
};

export function BugDetailClient({ copy, bug, viewerIsAuthor, isReviewer }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [showStatusSheet, setShowStatusSheet] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 삭제 조건: 작성자 본인 + status === "submitted"
  const canDelete = viewerIsAuthor && bug.status === "submitted";

  function onDeleteClick() {
    setShowDeleteConfirm(true);
  }

  function onConfirmDelete() {
    setShowDeleteConfirm(false);
    startTransition(async () => {
      const result = await deleteBugReportAction(bug.id);
      if ("error" in result) {
        window.alert(copy.detailDeleteError);
        return;
      }
      router.replace("/mobile/bugs");
    });
  }

  function onStatusSelect(status: BugStatus) {
    setShowStatusSheet(false);
    startTransition(async () => {
      await setBugReportStatus(bug.id, status);
      router.refresh();
    });
  }

  return (
    // 바텀탭을 띄우는 화면이라 셸의 하단 여백은 `pb-[124px]` 다. `-mb-8` 로는 92px 이 남아
    // 콘텐츠 아래로 빈 공간이 스크롤된다(2026-08-07 수정). 목록 화면과 같은 이유.
    <div className="-mx-5 -mb-[124px] -mt-[84px] flex h-[100dvh] flex-col bg-background">
      {/* MobileShell chrome 84px 영역 확보 */}
      <div className="h-[84px] shrink-0" aria-hidden="true" />

      <div className="flex-1 overflow-y-auto">
        <div className="px-[18px] py-[20px]">
          {/* 신고 ID — uuid 앞 8자리 기반 fallback code */}
          <div className="font-mono text-[12px] font-bold text-primary">
            {`BR-${bug.id.replace(/-/g, "").slice(0, 4).toUpperCase()}`}
          </div>

          {/* 제목 */}
          <h2 className="mb-4 mt-2 text-[19px] font-extrabold leading-[1.3] tracking-[-0.02em]">
            {bug.title}
          </h2>

          {/* 키-값 표 */}
          <div className="border-y border-border">
            <KvRow label={copy.detailKvStatus}>
              {isReviewer ? (
                // 리뷰어: 상태 칩 자체를 탭하면 상태 변경 시트 오픈
                <button
                  type="button"
                  onClick={() => setShowStatusSheet(true)}
                  aria-label={copy.statusChangeSheetTitle}
                >
                  <BugStatusBadge
                    status={bug.status}
                    size="md"
                    label={bugStatusLabel(copy, bug.status)}
                  />
                </button>
              ) : (
                <BugStatusBadge
                  status={bug.status}
                  size="md"
                  label={bugStatusLabel(copy, bug.status)}
                />
              )}
            </KvRow>
            <KvRow label={copy.detailKvReportedAt}>
              <span className="font-mono text-[13.5px] font-semibold text-foreground">
                {formatReportedAt(bug.createdAt)}
              </span>
            </KvRow>
            <KvRow label={copy.detailKvReporter} isLast>
              <span className="text-[13.5px] font-semibold text-foreground">
                {bug.reporterName}
                {bug.reporterRole ? ` · ${bug.reporterRole}` : ""}
              </span>
            </KvRow>
          </div>

          {/* 설명 */}
          <div className="mb-2 mt-[18px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
            {copy.detailSectionDescription}
          </div>
          <p className="text-[14px] font-medium leading-[1.74] text-[hsl(222_18%_26%)]">
            {bug.description}
          </p>

          {/* 스크린샷 — imageUrls가 있을 때만 표시 */}
          {bug.imageUrls.length > 0 && (
            <>
              <div className="mb-2 mt-[18px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                {copy.detailSectionScreenshots}
              </div>
              <div className="mt-[10px] grid grid-cols-2 gap-2">
                {bug.imageUrls.map((url, idx) => (
                  <div
                    key={url}
                    className="relative h-[116px] overflow-hidden rounded-[10px] border border-[hsl(40_18%_85%)]"
                  >
                    <Image
                      src={url}
                      alt={`${copy.screenshotAlt} ${idx + 1}`}
                      fill
                      sizes="50vw"
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 수정 버튼: 1차 deferred — 표시하지 않음 */}
          {/* 삭제 버튼: 작성자 본인 + submitted 상태일 때만 */}
          {canDelete && (
            <div className="mt-[20px] flex items-center gap-[14px]">
              <button
                type="button"
                onClick={onDeleteClick}
                className="ml-auto inline-flex items-center gap-[6px] text-[13px] font-extrabold text-[hsl(222_9%_46%)]"
              >
                <Trash2 className="size-[15px]" aria-hidden="true" />
                {copy.detailActionDelete}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 리뷰어 상태 변경 BottomSheet */}
      {showStatusSheet && (
        <BugStatusSheet
          copy={copy}
          currentStatus={bug.status}
          onSelect={onStatusSelect}
          onClose={() => setShowStatusSheet(false)}
        />
      )}

      {/* 삭제 확인 모달 (center-aligned — board 패턴과 동일한 의도된 예외) */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-8">
          <div className="w-full max-w-[320px] rounded-[22px] bg-surface p-[22px] text-center shadow-[0_24px_60px_-20px_rgba(15,23,42,0.5)]">
            <p className="text-[15.5px] font-black tracking-[-0.01em] text-foreground">
              {copy.detailDeleteConfirmTitle}
            </p>
            <p className="mt-[7px] text-[12.5px] font-semibold leading-[1.5] text-muted-foreground">
              {copy.detailDeleteConfirmBody}
            </p>
            <div className="mt-[18px] flex gap-[9px]">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="h-11 flex-1 rounded-[13px] border border-border bg-background text-[13.5px] font-extrabold text-[#3a3746]"
              >
                {copy.detailDeleteConfirmCancel}
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                className="h-11 flex-1 rounded-[13px] bg-[hsl(4_72%_52%)] text-[13.5px] font-extrabold text-white"
              >
                {copy.detailDeleteConfirmCta}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KvRow({
  label,
  children,
  isLast,
}: {
  label: string;
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div
      className={`flex items-center py-[11px] ${isLast ? "" : "border-b border-border/60"}`}
    >
      <span className="w-[84px] shrink-0 text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-muted-foreground">
        {label}
      </span>
      <span className="flex-1">{children}</span>
    </div>
  );
}
