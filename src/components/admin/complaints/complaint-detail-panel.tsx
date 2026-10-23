import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";
import type { Complaint, ComplaintComment } from "@/lib/complaints";
import type { Dictionary } from "@/lib/i18n";
import { tokyoDateOf } from "@/lib/tokyo-date";
import { getCanonicalPropertyName, localizePropertyName, localizeRoomPlaceLabel } from "@/lib/room-label-normalization";
import { PLATFORMS } from "@/components/complaints/cx-platform";
import {
  ComplaintComposer,
  ComplaintDeleteButton,
  ComplaintStatusButton,
  type ComplaintActionLabels,
} from "@/components/admin/complaints/complaint-panel-actions";

// 수동 컴플레인 상세 패널 — 서버 컴포넌트. 화이트 리디자인(2026-10-14, 시안 FBManual-PC 오른쪽):
// 상태 · 플랫폼 → 제목 → 건물 · 객실 / 예약 / 평점 / 작성자 → 내용 → 사진 → 처리 기록(댓글) + 남기기 →
// 아래 「처리 완료로 바꾸기」. 위 휴지통은 확인 창을 거친다(hard delete, CLAUDE.md §9).
// 콘솔 계약대로 `?complaint=<id>` 쿼리로 열고 `.panel` 오버레이를 쓴다(새 라우트를 파지 않는다).
// 도메인 계약: docs/product/25-complaint-workflow.md

export type ComplaintPanelLabels = {
  building: string;
  room: string;
  reservation: string;
  guest: string;
  close: string;
};

type Props = {
  complaint: Complaint;
  comments: ComplaintComment[];
  copy: Dictionary["complaints"];
  buildingLabels: Record<string, string>;
  labels: ComplaintPanelLabels;
  closeHref: string;
  canComment: boolean;
  canChangeStatus: boolean;
  canDelete: boolean;
  linkedReviewHref: string | null;
};

function stamp(iso: string): string {
  const day = tokyoDateOf(iso);
  const time = new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
  return day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))} ${time}` : "—";
}

export function ComplaintDetailPanel({
  complaint,
  comments,
  copy,
  buildingLabels,
  labels,
  closeHref,
  canComment,
  canChangeStatus,
  canDelete,
}: Props) {
  const isOpen = complaint.status === "open";
  const platform =
    complaint.platform === "direct"
      ? copy.platformDirect
      : complaint.platform === "other"
        ? copy.platformOther
        : PLATFORMS[complaint.platform]?.name ?? complaint.platform;
  const building = complaint.propertyName
    ? localizePropertyName(getCanonicalPropertyName(complaint.propertyName), buildingLabels)
    : null;
  const place = building
    ? `${building}${complaint.roomLabel ? ` · ${localizeRoomPlaceLabel(complaint.roomLabel, buildingLabels)}` : ""}`
    : "—";
  const max = PLATFORMS[complaint.platform]?.maxRating ?? 5;

  const actionLabels: ComplaintActionLabels = {
    deleteAction: copy.deleteAction,
    deleteTitle: copy.wDeleteTitle,
    deleteSummary: `${complaint.title} · ${place} · ${stamp(complaint.createdAt)} ${complaint.authorName}`,
    deleteBody: copy.wDeleteBody.replace("{n}", String(comments.length)),
    deleteLinked: copy.wDeleteLinked,
    deleteWarn: copy.wDeleteWarn,
    keep: copy.wKeep,
    confirmDelete: copy.deleteConfirm,
    logPlaceholder: copy.wLogPlaceholder,
    send: copy.wSend,
    resolve: copy.wResolve,
    reopen: copy.wReopen,
    failed: copy.wActionFailed,
  };

  const rows: [string, React.ReactNode][] = [[copy.wFieldPlace, place]];
  if (complaint.guestName || complaint.platformRef) {
    rows.push([
      copy.wFieldReservation,
      <span key="r">
        {complaint.guestName ?? copy.noGuestName}
        {complaint.platformRef ? <span className="num">{` · ${complaint.platformRef}`}</span> : null}
      </span>,
    ]);
  }
  if (complaint.rating !== null) {
    rows.push([
      copy.metaRating,
      <span key="g" className="num">
        <b className="is-bad">{complaint.rating}</b>
        {` / ${max} · ${platform}`}
      </span>,
    ]);
  }
  rows.push([copy.authorLabel, <span key="a" className="num">{`${complaint.authorName || "—"} · ${stamp(complaint.createdAt)}`}</span>]);
  if (complaint.resolvedAt) rows.push([copy.resolvedAtLabel, <span key="d" className="num">{stamp(complaint.resolvedAt)}</span>]);

  return (
    <>
      <Link href={closeHref} className="panel-scrim" aria-label={labels.close} data-panel-close scroll={false} />
      <aside className="panel cxw-panel" role="dialog" aria-label={copy.viewManual}>
        <div className="cxw-ph">
          <div className="cxw-ph__main">
            <span className="cxw-ph__kick">
              <span className={`cxw-st${isOpen ? " is-open" : " is-done"}`}>
                <i aria-hidden="true" />
                {isOpen ? copy.statusOpen : copy.wDoneTab}
              </span>
              <span>{platform}</span>
            </span>
            <h2 className="cxw-ph__title is-lg">{complaint.title}</h2>
          </div>
          {canDelete ? <ComplaintDeleteButton complaintId={complaint.id} closeHref={closeHref} labels={actionLabels} /> : null}
          <Link href={closeHref} className="cxw-ph__x" aria-label={labels.close} data-panel-close scroll={false}>
            <X aria-hidden="true" />
          </Link>
        </div>

        <div className="panel__body cxw-pb">
          <dl className="cxw-dl">
            {rows.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <div className="cxw-sec">
            <div className="cxw-part">
              <small>{copy.wContent}</small>
              <p className={complaint.description ? "" : "cxw-dim"}>{complaint.description || copy.noDescription}</p>
            </div>
            {complaint.imageUrls.length > 0 ? (
              <div className="cxw-shots">
                {complaint.imageUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="cxw-shot" aria-label={copy.photosTitle}>
                    <Image src={url} alt="" width={72} height={72} />
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <div className="cxw-sec">
            <small className="cxw-k">{copy.wLogTitle.replace("{n}", String(comments.length))}</small>
            <ol className="cxw-log">
              {comments.map((comment) => (
                <li key={comment.id}>
                  <span className="cxw-log__by">
                    <b>{comment.authorName || "—"}</b>
                    <span className="num">{stamp(comment.createdAt)}</span>
                  </span>
                  <p>{comment.content}</p>
                  {comment.imageUrls.length > 0 ? (
                    <span className="cxw-shots">
                      {comment.imageUrls.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer" className="cxw-shot is-sm" aria-label={copy.photosTitle}>
                          <Image src={url} alt="" width={56} height={56} />
                        </a>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            {canComment ? <ComplaintComposer complaintId={complaint.id} labels={actionLabels} /> : null}
          </div>
        </div>

        {canChangeStatus ? (
          <div className="cxw-pf">
            <ComplaintStatusButton complaintId={complaint.id} open={isOpen} labels={actionLabels} />
          </div>
        ) : null}
      </aside>
    </>
  );
}
