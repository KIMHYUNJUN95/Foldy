"use client";

// 모바일 수리·점검 상세 — 현장 처리 블록 (상태 변경 + 처리 메모 + 완료 사진).
// 2026-07-14 신설. 문서상 "현장이 모바일에서 처리한다"가 그동안 구현되어 있지 않았다.
// part_time_staff는 렌더 자체를 하지 않고(읽기 전용 안내만), 서버 액션과 RLS가 최종 게이트다.
import { useRef, useState } from "react";
import { Check, Lock } from "lucide-react";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import { removeRequestImages, uploadRequestImages } from "@/components/requests/request-image-upload";
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
  /** 이미 저장된 완료 사진 장수 — 새로 올릴 수 있는 장수 = 5 - 이 값(서버가 이어 붙이고 상한을 다시 본다). */
  existingPhotoCount: number;
  imgCopy: Dictionary["requestImages"];
  initialMemo: string;
  initialStatus: MaintenanceStatus;
  organizationId: string;
  reportId: string;
};

export function MaintenanceHandlingForm({
  canHandle,
  copy,
  existingPhotoCount,
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
  // 사진 올리기부터 저장이 끝날 때까지 한 덩어리로 잠근다 — 예전엔 올리는 동안 버튼이 살아 있어 두 번 저장됐다.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // 저장에 성공하면 고른 사진을 비운다(업로더를 새로 그림) — 예전엔 남아 있어 다음 저장 때 같은 사진이 또 올라갔다.
  const [uploaderKey, setUploaderKey] = useState(0);
  const uploaderRef = useRef<AnnouncementImageUploaderHandle | null>(null);
  const remainingPhotos = Math.max(0, MAINTENANCE_RESOLUTION_IMAGE_LIMIT - existingPhotoCount);

  if (!canHandle) {
    return (
      <p className="mdw-readonly">
        <Lock aria-hidden="true" />
        {t.readOnly}
      </p>
    );
  }

  async function handleSave() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    let resolutionImageUrls: string[] = [];
    let uploadedPaths: string[] = [];
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
        uploadedPaths = uploaded.uploadedPaths;
      }

      const result: MaintenanceHandlingResult = await updateMaintenanceHandling({
        reportId,
        status,
        expectedStatus: initialStatus,
        memo,
        resolutionImageUrls,
      });
      if (result.ok) {
        setSaved(true);
        setUploaderKey((k) => k + 1);
        haptic("success");
        window.setTimeout(() => setSaved(false), 2200);
        return;
      }
      // 저장이 안 됐으면 방금 올린 사진을 지운다(저장소에 남는 사진이 없게).
      void removeRequestImages(uploadedPaths).catch(() => {});
      haptic("error");
      setError(
        result.error === "forbidden"
          ? copy.errors.forbidden
          : result.error === "not_found"
            ? copy.errors.not_found
            : result.error === "too_many_photos"
              ? imgCopy.errorCount
              : result.error === "conflict"
                ? copy.errors.status_conflict
                : copy.errors.status_update_failed,
      );
    } catch {
      // 예외(네트워크 끊김 등)는 서버가 이미 저장했을 수 있어 사진을 지우지 않는다 — 지우면 저장된 기록이 깨진 사진을 가리킨다.
      // 업로드 자체가 던진 경우엔 uploadedPaths 가 아직 비어 있다.
      haptic("error");
      setError(copy.errors.save_failed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
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
        {remainingPhotos > 0 ? (
          <AnnouncementImageUploader
            addImagesLabel={imgCopy.addPhotos}
            errorCountExceeded={imgCopy.errorCount}
            errorSizeExceeded={imgCopy.errorSize}
            errorTypeInvalid={imgCopy.errorType}
            imageAttachmentsLabel={imgCopy.attachments}
            imageLimitLabel={imgCopy.limit}
            imageRemoveLabel={imgCopy.remove}
            key={uploaderKey}
            maxImages={remainingPhotos}
            ref={uploaderRef}
          />
        ) : (
          <p className="mdw-hint">{imgCopy.errorCount}</p>
        )}
      </div>

      {error ? (
        <p className="mdw-hint is-err" role="alert">
          {error}
        </p>
      ) : null}

      <button className={`mdw-save${saved ? " is-saved" : ""}`} disabled={busy} onClick={handleSave} type="button">
        {saved ? (
          <>
            <Check aria-hidden="true" />
            {t.updated}
          </>
        ) : busy ? (
          t.submitting
        ) : (
          t.submit
        )}
      </button>
    </section>
  );
}
