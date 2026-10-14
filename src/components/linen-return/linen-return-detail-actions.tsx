"use client";

// 린넨 반품 기록 상세 — 빨간 휴지통 하나 + 삭제 확인 시트. 화이트 리디자인(2026-10-14, 시안 LinenDetail-Phone):
// 예전 「…」 메뉴(수정 · 삭제)는 없앴다 — 수정은 화면 아래 「기록 수정」, 삭제는 위 줄 오른쪽 끝 휴지통.
// 확인 시트는 「그대로 두기 · 삭제」(같은 이름 버튼 두 개 금지, 닫기는 한 곳 — 끌어내리기 · 바깥 누르기도 그대로 두기).
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteLinenReturnRecord } from "@/app/mobile/linen-return/record/[id]/actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type { Dictionary } from "@/lib/i18n";

type LinenReturnDetailActionsProps = {
  building: string;
  copy: Dictionary["linenReturn"];
  recordId: string;
};

export function LinenReturnDetailActions({ copy, recordId }: LinenReturnDetailActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    const formData = new FormData();
    formData.set("recordId", recordId);
    startTransition(async () => {
      await deleteLinenReturnRecord(formData);
    });
  }

  return (
    <>
      <button aria-label={copy.wDeleteAria} className="lnw-trash" onClick={() => setConfirmOpen(true)} type="button">
        <Trash2 aria-hidden="true" />
      </button>
      {confirmOpen ? (
        <BottomSheet ariaLabel={copy.deleteConfirmTitle} onClose={() => (isPending ? undefined : setConfirmOpen(false))}>
          {({ close }) => (
            <div className="lnw-sheet">
              <div className="lnw-sheet__h">
                <h3>{copy.deleteConfirmTitle}</h3>
                <span>{copy.deleteConfirmBody}</span>
              </div>
              <div className="lnw-sheet__btns">
                <button className="ofw-btn is-gray" disabled={isPending} onClick={close} type="button">
                  {copy.wKeepIt}
                </button>
                <button className="ofw-btn is-danger" disabled={isPending} onClick={handleDelete} type="button">
                  {copy.deleteConfirmConfirm}
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}
