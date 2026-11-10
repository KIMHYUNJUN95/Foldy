"use client";

// 린넨 반품 기록 상세 — 빨간 휴지통 하나 + 삭제 확인 시트. 화이트 리디자인(2026-10-14, 시안 LinenDetail-Phone):
// 예전 「…」 메뉴(수정 · 삭제)는 없앴다 — 수정은 화면 아래 「기록 수정」, 삭제는 위 줄 오른쪽 끝 휴지통.
// 확인 시트는 「그대로 두기 · 삭제」(같은 이름 버튼 두 개 금지, 닫기는 한 곳 — 끌어내리기 · 바깥 누르기도 그대로 두기).
import { useEffect, useRef, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteLinenReturnRecord } from "@/app/mobile/linen-return/record/[id]/actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import type { Dictionary } from "@/lib/i18n";

type LinenReturnDetailActionsProps = {
  building: string;
  copy: Dictionary["linenReturn"];
  recordId: string;
  /** 주소의 ?error= — 삭제 실패로 다시 그려졌는지 본다. */
  errorCode?: string;
};

export function LinenReturnDetailActions({ building, copy, errorCode, recordId }: LinenReturnDetailActionsProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const wasPendingRef = useRef(false);

  // 삭제가 실패하면 서버가 ?error=delete_failed 로 돌려보낸다 — 확인 시트가 오류를 가리지 않게 닫고 진동으로 알린다.
  // (성공이면 목록으로 이동해 이 컴포넌트가 사라지므로 여기까지 오지 않는다.)
  useEffect(() => {
    if (wasPendingRef.current && !isPending && errorCode === "delete_failed") {
      setConfirmOpen(false);
      haptic("error");
    }
    wasPendingRef.current = isPending;
  }, [isPending, errorCode]);

  function handleDelete() {
    const formData = new FormData();
    formData.set("recordId", recordId);
    // 지우기는 「성공」이 아니라 가벼운 조작 진동(haptics.ts 규칙).
    haptic("light");
    startTransition(async () => {
      try {
        await deleteLinenReturnRecord(formData);
      } catch (e) {
        unstable_rethrow(e);
        setConfirmOpen(false);
        haptic("error");
        router.replace(`/mobile/linen-return/record/${recordId}?building=${encodeURIComponent(building)}&error=delete_failed`);
      }
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
