"use client";

/**
 * 버그 신고 상세 — 화이트 리디자인(2026-10-15, 목록 · 폼 시안과 같은 말투).
 * 위: `BR-xxxx` · 상태 색 글자 / 제목 / 「신고자 · 날짜 시간」 → 설명 → 화면 사진 → (검토자) 「상태 바꾸기」 4칸 → (작성자 · 접수 상태) 삭제.
 * 예전 키-값 표와 상태 바꾸기 시트는 제안함 상세와 같은 4칸 버튼으로 바꿨다. 삭제 확인은 가운데 작은 창(의도된 예외) 그대로.
 * See docs/product/25-bug-report-workflow.md 「화이트 리디자인 — 모바일」.
 */

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  bugStatusLabel,
  type BugCopy,
  type BugReport,
  type BugStatus,
} from "@/components/bugs/bug-types";
import { deleteBugReportAction, setBugReportStatus } from "../actions";
import { formatBugCode } from "../bugs-list-client";
import "@/components/bugs/bugs-white.css";
import { haptic } from "@/lib/haptics";

const STATUSES: BugStatus[] = ["submitted", "reviewing", "fixed", "closed"];

// 10/14 11:20 — 도쿄 시각.
function formatReportedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  })
    .format(new Date(iso))
    .replace(",", "");
}

type Props = {
  copy: BugCopy;
  bug: BugReport;
  viewerIsAuthor: boolean;
  isReviewer: boolean;
  /** 플랫폼 개발자 — 남의 제보 · 접수 뒤 제보도 지울 수 있다(2026-10-23, 서버 deleteBugReport 와 같은 규칙). */
  isDeveloper?: boolean;
};

export function BugDetailClient({ copy, bug, viewerIsAuthor, isReviewer, isDeveloper = false }: Props) {
  const w = copy.white;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingStatus, setPendingStatus] = useState<BugStatus | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 삭제 조건: 작성자 본인 + status === "submitted" (플랫폼 개발자는 언제나)
  const canDelete = isDeveloper || (viewerIsAuthor && bug.status === "submitted");
  const shownStatus = pendingStatus ?? bug.status;

  function onConfirmDelete() {
    setShowDeleteConfirm(false);
    startTransition(async () => {
      const result = await deleteBugReportAction(bug.id);
      if ("error" in result) {
        haptic("error");
        window.alert(copy.detailDeleteError);
        return;
      }
      haptic("success");
      router.replace("/mobile/bugs");
    });
  }

  function onStatusSelect(status: BugStatus) {
    if (status === bug.status || isPending) return;
    setPendingStatus(status);
    haptic("light");
    startTransition(async () => {
      await setBugReportStatus(bug.id, status);
      router.refresh();
      setPendingStatus(null);
    });
  }

  const reporter = [bug.reporterName, bug.reporterRole].filter(Boolean).join(" · ");

  return (
    <div className="bgw">
      <div className="bgw-dh">
        <div className="bgw-dh__k">
          <span className="bgw-id">{formatBugCode(bug.id)}</span>
          <span aria-hidden="true">·</span>
          <span className="bgw-st" data-s={bug.status}>
            {bugStatusLabel(copy, bug.status)}
          </span>
        </div>
        <h1>{bug.title}</h1>
        <span className="bgw-dh__m">
          {reporter ? `${w.reportedBy.replace("{name}", reporter)} · ` : ""}
          {formatReportedAt(bug.createdAt)}
        </span>
      </div>

      <p className="bgw-body">{bug.description}</p>

      {bug.imageUrls.length > 0 ? (
        <div className="bgw-shots">
          {bug.imageUrls.map((url, idx) => (
            <a href={url} key={url} rel="noreferrer" target="_blank">
              <Image alt={`${copy.screenshotAlt} ${idx + 1}`} className="object-cover" fill sizes="50vw" src={url} />
            </a>
          ))}
        </div>
      ) : null}

      {isReviewer ? (
        <section className="bgw-sec">
          <span className="bgw-sec__t">{w.changeStatus}</span>
          <div aria-label={w.changeStatus} className="bgw-seg" role="group">
            {STATUSES.map((s) => (
              <button
                aria-pressed={shownStatus === s}
                disabled={isPending}
                key={s}
                onClick={() => onStatusSelect(s)}
                type="button"
              >
                {bugStatusLabel(copy, s)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {canDelete ? (
        <button className="bgw-del" onClick={() => setShowDeleteConfirm(true)} type="button">
          {copy.detailActionDelete}
        </button>
      ) : null}

      {isReviewer ? null : <p className="bgw-note">{w.note}</p>}

      {/* 삭제 확인 모달 (center-aligned — board 패턴과 동일한 의도된 예외) */}
      {showDeleteConfirm ? (
        <div className="bgw-cf" onClick={() => setShowDeleteConfirm(false)} role="dialog" aria-modal="true">
          <div className="bgw-cf__c" onClick={(e) => e.stopPropagation()}>
            <b>{copy.detailDeleteConfirmTitle}</b>
            <p>{copy.detailDeleteConfirmBody}</p>
            <div className="bgw-cf__a">
              <button className="bgw-cf__no" onClick={() => setShowDeleteConfirm(false)} type="button">
                {copy.detailDeleteConfirmCancel}
              </button>
              <button className="bgw-cf__go" onClick={onConfirmDelete} type="button">
                {copy.detailDeleteConfirmCta}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
