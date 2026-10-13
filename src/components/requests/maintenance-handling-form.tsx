"use client";

// 모바일 수리·점검 상세 — 현장 처리 블록 (상태 변경 + 처리 메모 + 완료 사진).
// 2026-07-14 신설. 문서상 "현장이 모바일에서 처리한다"가 그동안 구현되어 있지 않았다.
// part_time_staff는 렌더 자체를 하지 않고(읽기 전용 안내만), 서버 액션과 RLS가 최종 게이트다.
import { useRef, useState, useTransition } from "react";
import { Check, Lock } from "lucide-react";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import { uploadRequestImages } from "@/components/requests/request-image-upload";
import {
  updateMaintenanceHandling,
  type MaintenanceHandlingResult,
} from "@/app/mobile/requests/maintenance/actions";
import type { Dictionary } from "@/lib/i18n";
import {
  maintenanceStatuses,
  MAINTENANCE_RESOLUTION_IMAGE_LIMIT,
  type MaintenanceStatus,
} from "@/lib/maintenance-constants";
import { haptic } from "@/lib/haptics";

type MaintenanceHandlingFormProps = {
  canHandle: boolean;
  copy: Dictionary["maintenance"];
  imgCopy: Dictionary["requestImages"];
  initialMemo: string;
  initialStatus: MaintenanceStatus;
  organizationId: string;
  reportId: string;
};

export function MaintenanceHandlingForm({
  canHandle,
  copy,
  imgCopy,
  initialMemo,
  initialStatus,
  organizationId,
  reportId,
}: MaintenanceHandlingFormProps) {
  const t = copy.handling;
  const [status, setStatus] = useState<MaintenanceStatus>(initialStatus);
  const [memo, setMemo] = useState(initialMemo);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const uploaderRef = useRef<AnnouncementImageUploaderHandle | null>(null);

  if (!canHandle) {
    return (
      <p className="mdw-readonly">
        <Lock aria-hidden="true" />
        {t.readOnly}
      </p>
    );
  }

  async function handleSave() {
    setError(null);
    setSaved(false);
    let resolutionImageUrls: string[] = [];
    try {
      const items = uploaderRef.current?.getItems() ?? [];
      if (items.length > 0) {
        const uploaded = await uploadRequestImages({
          items,
          organizationId,
          requestId: reportId,
          requestType: "maintenance-resolutions",
        });
        resolutionImageUrls = uploaded.imageUrls;
      }
    } catch {
      setError(copy.errors.save_failed);
      return;
    }

    startTransition(async () => {
      const result: MaintenanceHandlingResult = await updateMaintenanceHandling({
        reportId,
        status,
        memo,
        resolutionImageUrls,
      });
      if (result.ok) {
        setSaved(true);
        haptic("success");
        window.setTimeout(() => setSaved(false), 2200);
        return;
      }
      setError(
        result.error === "forbidden"
          ? copy.errors.forbidden
          : result.error === "not_found"
            ? copy.errors.not_found
            : copy.errors.status_update_failed,
      );
    });
  }

  // 화이트 리디자인(2026-10-13, 시안 ReqDetail-Phone): 상자 없는 「현장 처리」 — 4칸 상태 토글 · 테두리 이름표 메모 · 사진 · 저장(저장되면 체크 + 진동).
  return (
    <section className="mdw-handle">
      <div className="mdw-handle__h">
        <b>{t.title}</b>
        <span>{t.hint}</span>
      </div>

      <div className="mdw-seg" role="radiogroup" aria-label={t.statusLabel}>
        {maintenanceStatuses.map((value) => (
          <button
            aria-checked={status === value}
            role="radio"
            className={status === value ? "on" : undefined}
            key={value}
            onClick={() => setStatus(value)}
            type="button"
          >
            {copy.statusLabels[value]}
          </button>
        ))}
      </div>
      {status === "cancelled" ? <p className="mdw-hint is-warn">{t.cancelHint}</p> : null}
      {(status === "open" || status === "in_progress") && (initialStatus === "closed" || initialStatus === "cancelled") ? (
        <p className="mdw-hint">{t.reopenHint}</p>
      ) : null}

      <div className="mdw-nf">
        <label className="mdw-nf__l" htmlFor="mdw-memo">
          {t.memoLabel}
        </label>
        <textarea id="mdw-memo" className="mdw-nf__in" onChange={(e) => setMemo(e.target.value)} placeholder={t.memoPlaceholder} rows={3} value={memo} />
      </div>

      <div className="mdw-photos">
        <span className="mdw-k">
          {t.photosLabel} <em>{t.photosHint}</em>
        </span>
        <AnnouncementImageUploader
          addImagesLabel={imgCopy.addPhotos}
          errorCountExceeded={imgCopy.errorCount}
          errorSizeExceeded={imgCopy.errorSize}
          errorTypeInvalid={imgCopy.errorType}
          imageAttachmentsLabel={imgCopy.attachments}
          imageLimitLabel={imgCopy.limit}
          imageRemoveLabel={imgCopy.remove}
          maxImages={MAINTENANCE_RESOLUTION_IMAGE_LIMIT}
          ref={uploaderRef}
        />
      </div>

      {error ? (
        <p className="mdw-hint is-err" role="alert">
          {error}
        </p>
      ) : null}

      <button className={`mdw-save${saved ? " is-saved" : ""}`} disabled={isPending} onClick={handleSave} type="button">
        {saved ? (
          <>
            <Check aria-hidden="true" />
            {t.updated}
          </>
        ) : isPending ? (
          t.submitting
        ) : (
          t.submit
        )}
      </button>
    </section>
  );
}
