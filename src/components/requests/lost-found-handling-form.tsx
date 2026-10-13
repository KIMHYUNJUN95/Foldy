"use client";

// 모바일 분실물 상세 — 현장 처리 블록 (상태 변경 + 처리 메모 + 증빙 사진).
// 2026-07-15 신설. 그동안 모바일 상세는 상태를 "보여주기만" 했다(읽기 전용 진행바). 수리·점검의
// 현장 처리(MaintenanceHandlingForm)와 동일한 구조·매커니즘이다.
//
// 반환완료(returned)는 "손님에게 전달을 마친" 되돌릴 수 없는 종결이라, 저장 전에 canonical
// BottomSheet로 한 번 더 확인한다(오조작 방지). 그 외 상태 변경은 확인 없이 바로 저장한다.
// part_time_staff는 렌더 자체를 안 하고, 서버 액션과 RLS가 최종 게이트다.
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock } from "lucide-react";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import { uploadRequestImages } from "@/components/requests/request-image-upload";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import {
  updateLostItemHandling,
  type LostItemHandlingResult,
} from "@/app/mobile/requests/lost-found/actions";
import type { Dictionary } from "@/lib/i18n";
import {
  lostItemStatuses,
  LOST_FOUND_HANDLING_IMAGE_LIMIT,
  type LostItemStatus,
} from "@/lib/lost-found-constants";
import { haptic } from "@/lib/haptics";

type LostFoundHandlingFormProps = {
  canHandle: boolean;
  copy: Dictionary["lostFound"];
  imgCopy: Dictionary["requestImages"];
  handlerName: string;
  initialMemo: string;
  initialStatus: LostItemStatus;
  itemName: string;
  itemId: string;
  organizationId: string;
};

export function LostFoundHandlingForm({
  canHandle,
  copy,
  imgCopy,
  handlerName,
  initialMemo,
  initialStatus,
  itemName,
  itemId,
  organizationId,
}: LostFoundHandlingFormProps) {
  const t = copy.handling;
  const router = useRouter();
  const [status, setStatus] = useState<LostItemStatus>(initialStatus);
  const [memo, setMemo] = useState(initialMemo);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const uploaderRef = useRef<AnnouncementImageUploaderHandle | null>(null);

  if (!canHandle) {
    return (
      <p className="mdw-readonly">
        <Lock aria-hidden="true" />
        {t.readOnlySub}
      </p>
    );
  }

  // 반환완료로 새로 넘어가는 경우만 종결 확인 시트를 띄운다. 그 외에는 바로 저장.
  const needsReturnConfirm = status === "returned" && initialStatus !== "returned";

  async function performSave() {
    setError(null);
    setSaved(false);
    let handlingImageUrls: string[] = [];
    try {
      const items = uploaderRef.current?.getItems() ?? [];
      if (items.length > 0) {
        const uploaded = await uploadRequestImages({
          items,
          organizationId,
          requestId: itemId,
          requestType: "lost-found-handling",
        });
        handlingImageUrls = uploaded.imageUrls;
      }
    } catch {
      setError(copy.errors.save_failed);
      return;
    }

    startTransition(async () => {
      const result: LostItemHandlingResult = await updateLostItemHandling({
        itemId,
        status,
        memo,
        handlingImageUrls,
      });
      if (result.ok) {
        setSaved(true);
        haptic("success");
        window.setTimeout(() => setSaved(false), 2200);
        router.refresh();
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

  function handleSaveClick() {
    if (needsReturnConfirm) {
      setConfirmOpen(true);
      return;
    }
    void performSave();
  }

  // 화이트 리디자인(2026-10-14, 시안 LFDetail-Phone): 상자 없는 「현장 처리」 — 5칸 상태 토글 · 이름표 메모 · 증빙 사진 · 저장(체크 + 진동).
  return (
    <>
      <section className="mdw-handle">
        <div className="mdw-handle__h">
          <b>{t.title}</b>
          <span>{t.hint}</span>
        </div>

        <div className="mdw-seg lfd-seg" role="radiogroup" aria-label={t.statusLabel}>
          {lostItemStatuses.map((value) => (
            <button
              aria-checked={status === value}
              role="radio"
              className={status === value ? "on" : undefined}
              key={value}
              onClick={() => {
                setStatus(value);
                haptic("light");
              }}
              type="button"
            >
              {copy.statusLabels[value]}
            </button>
          ))}
        </div>
        {needsReturnConfirm ? <p className="mdw-hint is-warn">{t.returnWarn}</p> : null}

        <div className="mdw-nf">
          <label className="mdw-nf__l" htmlFor="lfd-memo">
            {t.memoLabel}
          </label>
          <textarea id="lfd-memo" className="mdw-nf__in" onChange={(e) => setMemo(e.target.value)} placeholder={t.memoPlaceholder} rows={3} value={memo} />
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
            maxImages={LOST_FOUND_HANDLING_IMAGE_LIMIT}
            ref={uploaderRef}
          />
        </div>

        {error ? (
          <p className="mdw-hint is-err" role="alert">
            {error}
          </p>
        ) : null}

        <button className={`mdw-save${saved ? " is-saved" : ""}`} disabled={isPending} onClick={handleSaveClick} type="button">
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

      {confirmOpen ? (
        <ReturnConfirmSheet
          t={t}
          fromLabel={copy.statusLabels[initialStatus]}
          toLabel={copy.statusLabels.returned}
          itemName={itemName}
          handlerName={handlerName}
          memo={memo.trim()}
          pending={isPending}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => void performSave()}
        />
      ) : null}
    </>
  );
}

type ReturnConfirmSheetProps = {
  t: Dictionary["lostFound"]["handling"];
  fromLabel: string;
  toLabel: string;
  itemName: string;
  handlerName: string;
  memo: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

function ReturnConfirmSheet({
  t,
  fromLabel,
  toLabel,
  itemName,
  handlerName,
  memo,
  pending,
  onClose,
  onConfirm,
}: ReturnConfirmSheetProps) {
  return (
    <BottomSheet ariaLabel={t.confirmTitle} onClose={onClose}>
      {({ close }) => (
        <div className="lfd-sheet">
          <span className="lfd-sheet__ic">
            <Check aria-hidden="true" />
          </span>
          <h3>{t.confirmTitle}</h3>
          <p>{t.confirmDesc}</p>
          <dl>
            <ConfirmRow k={t.confirmItem} v={itemName} />
            <ConfirmRow
              k={t.confirmChange}
              v={
                <>
                  {fromLabel} → <b>{toLabel}</b>
                </>
              }
            />
            <ConfirmRow k={t.handledBy} v={handlerName || "-"} />
            {memo ? <ConfirmRow k={t.memoLabel} v={memo} /> : null}
          </dl>
          <button
            className="mdw-save"
            disabled={pending}
            onClick={() => {
              onConfirm();
              close();
            }}
            type="button"
          >
            {t.confirmSave}
          </button>
          <button className="lfd-sheet__back" onClick={close} type="button">
            {t.confirmBack}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

function ConfirmRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
