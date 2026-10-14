"use client";

// 수동 컴플레인 삭제 확인 — 공용 `BottomSheet`. 화이트 리디자인(2026-10-14, PC 삭제 창과 같은 문장):
// 제목 · 요약 → 「처리 기록 N개와 사진이 함께 지워져요. 연결된 리뷰는 남고…」 → 되돌릴 수 없음 → [그대로 두기][삭제].
// 컴플레인 본체는 MVP hard delete 라 확인을 거친다(CLAUDE.md §9). 지우면 목록으로 돌아간다.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { deleteComplaintAction } from "@/app/mobile/complaints/actions";
import { haptic } from "@/lib/haptics";

export type DeleteSheetLabels = {
  title: string;
  summary: string;
  body: string;
  warn: string;
  keep: string;
  confirm: string;
  failed: string;
};

export function ComplaintDeleteSheet({
  complaintId,
  labels,
  onClose,
}: {
  complaintId: string;
  labels: DeleteSheetLabels;
  onClose: () => void;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete(close: () => void) {
    setFailed(false);
    startTransition(async () => {
      const result = await deleteComplaintAction(complaintId);
      if ("error" in result) {
        setFailed(true);
        haptic("error");
        return;
      }
      haptic("success");
      close();
      router.replace("/mobile/complaints?view=manual");
    });
  }

  return (
    <BottomSheet ariaLabel={labels.title} onClose={onClose}>
      {({ close }) => (
        <div className="fbw fbw-sheet">
          <div className="fbw-sheet__h">
            <h3>{labels.title}</h3>
            <span>{labels.summary}</span>
          </div>
          <p className="fbw-sheet__p">{labels.body}</p>
          <p className="fbw-sheet__p is-warn">{labels.warn}</p>
          {failed ? (
            <p className="fbw-err" role="alert">
              {labels.failed}
            </p>
          ) : null}
          <div className="fbw-sheet__btns">
            <button type="button" className="fbw-btn is-gray" onClick={close} disabled={isPending}>
              {labels.keep}
            </button>
            <button type="button" className="fbw-btn is-danger" onClick={() => handleDelete(close)} disabled={isPending}>
              {labels.confirm}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
