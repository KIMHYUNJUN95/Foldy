"use client";

// 모바일 분실물 상세 — 현장 처리 블록 (상태 변경 + 처리 메모 + 증빙 사진).
// 2026-07-15 신설. 그동안 모바일 상세는 상태를 "보여주기만" 했다(읽기 전용 진행바). 수리·점검의
// 현장 처리(MaintenanceHandlingForm)와 동일한 구조·매커니즘이다.
//
// 반환완료(returned)는 "손님에게 전달을 마친" 되돌릴 수 없는 종결이라, 저장 전에 canonical
// BottomSheet로 한 번 더 확인한다(오조작 방지). 그 외 상태 변경은 확인 없이 바로 저장한다.
// part_time_staff는 렌더 자체를 안 하고, 서버 액션과 RLS가 최종 게이트다.
import { useRef, useState, type ReactNode } from "react";
import { Check, Lock } from "lucide-react";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import { removeRequestImages, uploadRequestImages } from "@/components/requests/request-image-upload";
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
  type LostReturnMethod,
} from "@/lib/lost-found-constants";
import { isValidLostItemTransition } from "@/lib/lost-found-handling";
import { haptic } from "@/lib/haptics";

type LostFoundHandlingFormProps = {
  canHandle: boolean;
  copy: Dictionary["lostFound"];
  imgCopy: Dictionary["requestImages"];
  handlerName: string;
  /** 이미 저장된 증빙 사진 장수 — 새로 올릴 수 있는 장수 = 5 - 이 값(서버가 이어 붙이고 상한을 다시 본다). */
  existingPhotoCount: number;
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
  existingPhotoCount,
  initialMemo,
  initialStatus,
  itemName,
  itemId,
  organizationId,
}: LostFoundHandlingFormProps) {
  const t = copy.handling;
  const c = copy.console;
  const [status, setStatus] = useState<LostItemStatus>(initialStatus);
  const [memo, setMemo] = useState(initialMemo);
  // 반환 방식 — 어드민 반환 창과 같은 [직접 수령 | 배송] · 기본 직접 수령, 배송이면 송장번호(선택) 칸(문서 09).
  const [returnMethod, setReturnMethod] = useState<LostReturnMethod>("pickup");
  const [trackingNo, setTrackingNo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 사진 올리기부터 저장이 끝날 때까지 한 덩어리로 잠근다 — 예전엔 올리는 동안 버튼이 살아 있어 두 번 저장됐다.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // 저장에 성공하면 고른 사진을 비운다(업로더를 새로 그림) — 예전엔 남아 있어 다음 저장 때 같은 사진이 또 올라갔다.
  const [uploaderKey, setUploaderKey] = useState(0);
  const uploaderRef = useRef<AnnouncementImageUploaderHandle | null>(null);
  const remainingPhotos = Math.max(0, LOST_FOUND_HANDLING_IMAGE_LIMIT - existingPhotoCount);

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
  const methodLabel = returnMethod === "delivery" ? c.mrDelivery : c.mrPickup;

  async function performSave() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    let handlingImageUrls: string[] = [];
    let uploadedPaths: string[] = [];
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
        uploadedPaths = uploaded.uploadedPaths;
      }

      const result: LostItemHandlingResult = await updateLostItemHandling({
        itemId,
        status,
        expectedStatus: initialStatus,
        memo,
        handlingImageUrls,
        ...(needsReturnConfirm
          ? { returnMethod, returnTrackingNo: returnMethod === "delivery" ? trackingNo : "" }
          : {}),
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
                : result.error === "return_method_required"
                  ? copy.errors.return_method_required
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
          {lostItemStatuses.map((value) => {
            // 지금 상태에서 갈 수 있는 상태만 누를 수 있다 — 서버와 같은 규칙(`isValidLostItemTransition`).
            const reachable = isValidLostItemTransition(initialStatus, value);
            return (
              <button
                aria-checked={status === value}
                role="radio"
                className={status === value ? "on" : undefined}
                disabled={!reachable}
                key={value}
                onClick={() => {
                  setStatus(value);
                  haptic("light");
                }}
                type="button"
              >
                {copy.statusLabels[value]}
              </button>
            );
          })}
        </div>
        {needsReturnConfirm ? (
          <>
            <p className="mdw-hint is-warn">{t.returnWarn}</p>
            <span className="mdw-k">{c.mrMethod}</span>
            <div className="mdw-seg lfd-method" role="radiogroup" aria-label={c.mrMethod}>
              {(["pickup", "delivery"] as const).map((m) => (
                <button
                  aria-checked={returnMethod === m}
                  role="radio"
                  className={returnMethod === m ? "on" : undefined}
                  key={m}
                  onClick={() => {
                    setReturnMethod(m);
                    haptic("light");
                  }}
                  type="button"
                >
                  {m === "pickup" ? c.mrPickup : c.mrDelivery}
                </button>
              ))}
            </div>
            {returnMethod === "delivery" ? (
              <div className="mdw-nf">
                <label className="mdw-nf__l" htmlFor="lfd-tracking">
                  {c.mrTracking}
                </label>
                <input
                  autoComplete="off"
                  className="mdw-nf__in"
                  id="lfd-tracking"
                  inputMode="text"
                  maxLength={100}
                  onChange={(e) => setTrackingNo(e.target.value)}
                  placeholder={c.mrTrackingPh}
                  type="text"
                  value={trackingNo}
                />
              </div>
            ) : null}
          </>
        ) : null}

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

        <button className={`mdw-save${saved ? " is-saved" : ""}`} disabled={busy} onClick={handleSaveClick} type="button">
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

      {confirmOpen ? (
        <ReturnConfirmSheet
          t={t}
          fromLabel={copy.statusLabels[initialStatus]}
          toLabel={copy.statusLabels.returned}
          itemName={itemName}
          handlerName={handlerName}
          memo={memo.trim()}
          methodLabel={methodLabel}
          methodRowLabel={c.mrMethod}
          trackingNo={returnMethod === "delivery" ? trackingNo.trim() : ""}
          pending={busy}
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
  methodLabel: string;
  methodRowLabel: string;
  trackingNo: string;
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
  methodLabel,
  methodRowLabel,
  trackingNo,
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
            <ConfirmRow k={methodRowLabel} v={trackingNo ? `${methodLabel} · ${trackingNo}` : methodLabel} />
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
