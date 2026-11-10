"use client";

// 외부 리뷰 상세 패널(PC)의 누르는 부분 — 번역 · 컴플레인으로 등록 (2026-11-10).
//
// 예전엔 둘 다 `<form action>` + redirect 라 (1) 실패해도 화면이 몰랐고(전환 실패는 그대로 상세, 번역 실패는 원문만)
// (2) 응답 전에 다시 누를 수 있었다. 이제 결과를 받아 실패면 그 자리에 문구 + 오류 햅틱, 도는 동안은 버튼을 잠근다.
// 성공하면 서버 렌더 주소로 바꾼다(번역 → `?tr=1`, 전환 → 연결된 컴플레인 상세). 이미 전환된 리뷰도 그 컴플레인으로 간다.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertReviewAction, translateReviewAction } from "@/app/admin/complaints/actions";
import { haptic } from "@/lib/haptics";
import { COMPLAINT_ID_SLOT } from "@/components/admin/complaints/complaint-id-slot";

export function ReviewTranslateButton({
  reviewId,
  translatedHref,
  label,
  pendingLabel,
  failedLabel,
}: {
  reviewId: string;
  translatedHref: string;
  label: string;
  pendingLabel: string;
  failedLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await translateReviewAction(reviewId);
      if ("error" in result) {
        setError(failedLabel);
        haptic("error");
        return;
      }
      router.replace(translatedHref, { scroll: false });
    });
  }

  return (
    <>
      <button type="button" className="cxw-link" disabled={pending} aria-busy={pending} onClick={run}>
        {pending ? pendingLabel : label}
      </button>
      {error ? (
        <p className="cxw-err" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function ReviewConvertButton({
  reviewId,
  complaintHrefTemplate,
  label,
  failedLabel,
}: {
  reviewId: string;
  /** `__CID__` 자리에 컴플레인 id 가 들어간다(콘솔이 쿼리 규약으로 만든 주소). */
  complaintHrefTemplate: string;
  label: string;
  failedLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await convertReviewAction(reviewId);
      if ("error" in result) {
        setError(failedLabel);
        haptic("error");
        return;
      }
      // 새로 만든 것만 성공 진동 — 이미 연결돼 있던 컴플레인으로 옮겨 가는 것은 저장이 아니다.
      haptic(result.alreadyLinked ? "light" : "success");
      router.replace(complaintHrefTemplate.replace(COMPLAINT_ID_SLOT, encodeURIComponent(result.complaintId)), { scroll: false });
    });
  }

  return (
    <>
      {error ? (
        <p className="cxw-err" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="cxw-btn is-pri" disabled={pending} aria-busy={pending} onClick={run}>
        {pending ? <span className="cxw-spin" aria-hidden="true" /> : null}
        {label}
      </button>
    </>
  );
}
