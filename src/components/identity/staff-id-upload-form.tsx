"use client";

/**
 * 관리자 대신 올리기(재류카드 R4, 2026-10-26, 시안 M8bU3z… Upload-PC · Upload-Phone · Upload-Fold · Upload-Tablet).
 * PC 「직원 서류」 오른쪽 패널과 모바일 `/mobile/users/documents/[userId]` 가 같이 쓴다.
 *
 * 종이 복사본(스캔 파일 · 사진)을 앞 · 뒤 칸에 올리고(마이넘버 카드는 앞면 하나), 칸은 원본을 보고 손으로 채운다 — 자동 읽기는
 * 없다(동의는 본인만 할 수 있다). 저장하면 바로 「확인함」(올린 사람 = 확인한 사람).
 * 사진은 서버가 만든 일회용 주소로 대상 사람 경로에 올린다(`prepareStaffIdUpload`). 긴 변 2000px JPEG 로 줄여서 올린다(카메라와 같은 규칙).
 *
 * 움직임: 올린 사진은 0.15초 동안 0.97 → 1 로 나타난다. 저장이 서버에서 확인되면 체크를 그리고 성공 햅틱.
 */

import "./staff-id-upload.css";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Camera, Check, Upload } from "lucide-react";
import { discardStaffIdUpload, prepareStaffIdUpload, saveStaffIdDocumentByAdmin } from "@/actions/staff-documents";
import { AdminDatePicker } from "@/components/admin/shared/admin-date-picker";
import { fileToCardJpeg } from "@/components/identity/id-card-camera";
import { extraActivityLabel, idFieldLabel, workRestrictionLabel } from "@/components/identity/id-card-flow";
import { haptic } from "@/lib/haptics";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  EMPTY_ID_FIELDS,
  EXTRA_ACTIVITIES,
  RESIDENCE_STATUSES,
  WORK_RESTRICTIONS,
  adminUploadFields,
  type IdDocumentField,
  type IdDocumentFields,
  type IdDocumentKind,
  type IdFieldErrorKey,
} from "@/lib/staff-documents/fields";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Side = "front" | "back";
type Photo = { path: string; url: string; fileName: string };

const BUCKET = "staff-documents";
const OTHER = "__other";
const PC_TYPES = /^image\/(jpeg|png)$/;

export type StaffIdUploadTarget = { userId: string; name: string; kind: IdDocumentKind };

export function StaffIdUploadForm({
  target,
  confirmerName,
  locale,
  variant,
  onCancel,
  onSaved,
}: {
  target: StaffIdUploadTarget;
  confirmerName: string;
  locale: Locale;
  /** pc = 대시보드 패널(끌어다 놓기 · 파일 고르기), mobile = 카메라로 찍기 · 파일 고르기. */
  variant: "pc" | "mobile";
  /** 없으면 취소 단추를 그리지 않는다(폰은 화면 스와이프가 뒤로). */
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const dict = getDictionary(locale);
  const copy = dict.idCard;
  const shared = dict.admin.shared;
  const kind = target.kind;
  const sides: Side[] = kind === "residence_card" ? ["front", "back"] : ["front"];
  const keys = adminUploadFields(kind);

  const documentId = useRef<string | null>(null);
  const docId = () => (documentId.current ??= crypto.randomUUID());
  const [photos, setPhotos] = useState<Partial<Record<Side, Photo>>>({});
  const [busy, setBusy] = useState<Side | null>(null);
  const [dragOver, setDragOver] = useState<Side | null>(null);
  const [fields, setFields] = useState<IdDocumentFields>(EMPTY_ID_FIELDS);
  const [statusOther, setStatusOther] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<IdDocumentField, IdFieldErrorKey>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputs = useRef<Partial<Record<Side, HTMLInputElement | null>>>({});
  // 사진을 올렸는데 저장하지 않고 폼이 사라지면(취소 · 다른 사람 · 화면 나가기) 서버에서 지운다 — 개인정보 사진을 남기지 않게.
  const pending = useRef<{ uploaded: boolean; saved: boolean }>({ uploaded: false, saved: false });
  useEffect(() => {
    const state = pending.current;
    const ids = { userId: target.userId, documentId };
    return () => {
      if (state.uploaded && !state.saved && ids.documentId.current) {
        void discardStaffIdUpload({ userId: ids.userId, documentId: ids.documentId.current }).catch(() => undefined);
      }
    };
  }, [target.userId]);
  const cameraInputs = useRef<Partial<Record<Side, HTMLInputElement | null>>>({});

  const title = (kind === "residence_card" ? copy.upTitleResidence : copy.upTitleMyNumber).replace("{name}", target.name || "—");
  const sideLabel = (side: Side) => (side === "front" ? copy.sideFront : copy.sideBack);

  async function takeFile(side: Side, file: File | undefined | null) {
    if (!file) return;
    if (variant === "pc" ? !PC_TYPES.test(file.type) : !file.type.startsWith("image/")) {
      haptic("error");
      setNotice(copy.upFileType);
      return;
    }
    setBusy(side);
    setNotice(null);
    try {
      const blob = await fileToCardJpeg(file);
      if (!blob) {
        haptic("error");
        setNotice(copy.upFileType);
        return;
      }
      const ticket = await prepareStaffIdUpload({ userId: target.userId, documentId: docId(), side });
      if (!ticket.ok) {
        haptic("error");
        setNotice(ticket.errorKey === "no_nationality" ? copy.upNoNationality : copy.uploadFailed);
        return;
      }
      pending.current.uploaded = true;
      const { error } = await getSupabaseBrowserClient()
        .storage.from(BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, blob, { contentType: "image/jpeg" });
      if (error) {
        haptic("error");
        setNotice(copy.uploadFailed);
        return;
      }
      haptic("light");
      setPhotos((current) => {
        const old = current[side];
        if (old) URL.revokeObjectURL(old.url);
        return { ...current, [side]: { path: ticket.path, url: URL.createObjectURL(blob), fileName: file.name } };
      });
    } catch {
      haptic("error");
      setNotice(copy.uploadFailed);
    } finally {
      setBusy(null);
    }
  }

  function update(key: IdDocumentField, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function save() {
    if (saving || saved) return;
    if (!photos.front) {
      haptic("error");
      setNotice(copy.upNeedFront);
      return;
    }
    if (kind === "residence_card" && !photos.back) {
      haptic("error");
      setNotice(copy.upNeedBack);
      return;
    }
    setSaving(true);
    setNotice(null);
    let result: Awaited<ReturnType<typeof saveStaffIdDocumentByAdmin>>;
    try {
      result = await saveStaffIdDocumentByAdmin({
        userId: target.userId,
        documentId: docId(),
        frontPath: photos.front.path,
        backPath: photos.back?.path ?? null,
        fields,
      });
    } catch {
      result = { ok: false, errorKey: "failed" };
    }
    if (!result.ok) {
      setSaving(false);
      haptic("error");
      if (result.errorKey === "invalid") {
        setErrors(result.fieldErrors ?? {});
        setNotice(copy.submitInvalid);
      } else if (result.errorKey === "photo_missing") {
        setNotice(photos.back || kind !== "residence_card" ? copy.upNeedFront : copy.upNeedBack);
      } else if (result.errorKey === "no_nationality") {
        setNotice(copy.upNoNationality);
      } else {
        setNotice(copy.adminFailed);
      }
      return;
    }
    pending.current.saved = true;
    haptic("success");
    setSaved(true);
    window.setTimeout(onSaved, 900);
  }

  function onDrop(side: Side, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(null);
    void takeFile(side, event.dataTransfer.files?.[0]);
  }

  const slot = (side: Side) => {
    const photo = photos[side];
    const loading = busy === side;
    return (
      <div className="siu__slot" key={side}>
        <span className="siu__lbl">{sideLabel(side)}</span>
        {photo ? (
          <>
            <div className="siu__card" key={photo.path}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 방금 올린 사진(blob URL) */}
              <img alt={sideLabel(side)} src={photo.url} />
            </div>
            {variant === "pc" ? (
              <div className="siu__file">
                <span>{photo.fileName}</span>
                <button type="button" onClick={() => fileInputs.current[side]?.click()} disabled={loading || saving}>
                  {copy.upReplace}
                </button>
              </div>
            ) : (
              <div className="siu__again">
                <button type="button" onClick={() => cameraInputs.current[side]?.click()} disabled={loading || saving}>
                  {copy.upRetake}
                </button>
                <button type="button" onClick={() => fileInputs.current[side]?.click()} disabled={loading || saving}>
                  {copy.upReplaceFile}
                </button>
              </div>
            )}
          </>
        ) : variant === "pc" ? (
          <>
            <div
              className="siu__drop"
              data-over={dragOver === side ? "" : undefined}
              data-busy={loading ? "" : undefined}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(side);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(event) => onDrop(side, event)}
            >
              <Upload aria-hidden="true" size={22} strokeWidth={1.8} />
              {loading ? <span role="status">{copy.upUploading}</span> : <span>{copy.upDrop}</span>}
              <button className="siu__pick" type="button" onClick={() => fileInputs.current[side]?.click()} disabled={loading || saving}>
                {copy.upPick}
              </button>
            </div>
            <div className="siu__file">
              <span>{copy.upTypes}</span>
            </div>
          </>
        ) : (
          <div className="siu__empty" data-busy={loading ? "" : undefined}>
            {loading ? (
              <span role="status">{copy.upUploading}</span>
            ) : (
              <>
                <button type="button" onClick={() => cameraInputs.current[side]?.click()} disabled={saving}>
                  <Camera aria-hidden="true" size={18} />
                  {copy.upCamera}
                </button>
                <button type="button" onClick={() => fileInputs.current[side]?.click()} disabled={saving}>
                  {copy.upPick}
                </button>
              </>
            )}
          </div>
        )}
        <input
          ref={(node) => {
            fileInputs.current[side] = node;
          }}
          accept={variant === "pc" ? "image/jpeg,image/png" : "image/*"}
          aria-hidden="true"
          className="siu__input"
          onChange={(event) => {
            void takeFile(side, event.target.files?.[0]);
            event.target.value = "";
          }}
          tabIndex={-1}
          type="file"
        />
        {variant === "mobile" ? (
          <input
            ref={(node) => {
              cameraInputs.current[side] = node;
            }}
            accept="image/*"
            aria-hidden="true"
            capture="environment"
            className="siu__input"
            onChange={(event) => {
              void takeFile(side, event.target.files?.[0]);
              event.target.value = "";
            }}
            tabIndex={-1}
            type="file"
          />
        ) : null}
      </div>
    );
  };

  const field = (key: IdDocumentField) => {
    const id = `siu-${key}`;
    const label = idFieldLabel(copy, kind, key);
    const err = errors[key];
    const errText = err === "card_number_invalid" ? copy.errCardNumber : err ? copy.errRequired : null;
    const describe = errText ? `${id}-err` : undefined;
    let control;
    if (key === "residenceStatus") {
      const known = (RESIDENCE_STATUSES as readonly string[]).includes(fields.residenceStatus);
      control = (
        <>
          <select
            aria-describedby={describe}
            aria-invalid={errText ? true : undefined}
            className="siu__in siu__in--select"
            data-empty={!fields.residenceStatus && !statusOther ? "" : undefined}
            id={id}
            lang="ja"
            onChange={(event) => {
              const value = event.target.value;
              if (value === OTHER) {
                setStatusOther(true);
                update(key, "");
              } else {
                setStatusOther(false);
                update(key, value);
              }
            }}
            value={statusOther || (fields.residenceStatus && !known) ? OTHER : fields.residenceStatus}
          >
            <option value="" disabled>
              {copy.choose}
            </option>
            {RESIDENCE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
            <option value={OTHER} lang={locale}>
              {copy.residenceOther}
            </option>
          </select>
          {statusOther || (fields.residenceStatus && !known) ? (
            <input
              aria-label={copy.residenceOtherPlaceholder}
              className="siu__in siu__in--other"
              lang="ja"
              maxLength={60}
              onChange={(event) => update(key, event.target.value)}
              placeholder={copy.residenceOtherPlaceholder}
              value={fields.residenceStatus}
            />
          ) : null}
        </>
      );
    } else if (key === "workRestriction" || key === "extraActivity") {
      const options = key === "workRestriction" ? WORK_RESTRICTIONS : EXTRA_ACTIVITIES;
      const labelOf = key === "workRestriction" ? workRestrictionLabel : extraActivityLabel;
      control = (
        <select
          aria-describedby={describe}
          aria-invalid={errText ? true : undefined}
          className="siu__in siu__in--select"
          data-empty={!fields[key] ? "" : undefined}
          id={id}
          onChange={(event) => update(key, event.target.value)}
          value={fields[key]}
        >
          <option value="" disabled>
            {copy.choose}
          </option>
          {options.map((option) => (
            <option key={option} value={option}>
              {labelOf(copy, option)}
            </option>
          ))}
        </select>
      );
    } else if (key === "expiresOn") {
      control =
        variant === "pc" ? (
          <div className="siu__date" data-empty={fields.expiresOn ? undefined : ""}>
            <AdminDatePicker
            ariaLabel={label}
            labels={{ prevMonth: shared.datePrevMonth, nextMonth: shared.dateNextMonth, today: shared.dateToday }}
            localeTag={locale}
            onChange={(value) => update(key, value)}
            placeholder={copy.choose}
            value={fields.expiresOn}
            />
          </div>
        ) : (
          <input
            aria-describedby={describe}
            aria-invalid={errText ? true : undefined}
            className="siu__in"
            id={id}
            onChange={(event) => update(key, event.target.value)}
            type="date"
            value={fields.expiresOn}
          />
        );
    } else {
      control = (
        <input
          aria-describedby={describe}
          aria-invalid={errText ? true : undefined}
          autoCapitalize="characters"
          autoComplete="off"
          className="siu__in"
          id={id}
          maxLength={16}
          onChange={(event) => update(key, event.target.value)}
          placeholder="AB12345678CD"
          spellCheck={false}
          value={fields[key]}
        />
      );
    }
    return (
      <div className={`siu__f siu__f--${key}`} data-error={errText ? "" : undefined} key={key}>
        <label className="siu__fl" htmlFor={key === "expiresOn" && variant === "pc" ? undefined : id}>
          {label}
        </label>
        {control}
        {errText ? (
          <span className="siu__err" id={`${id}-err`}>
            {errText}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <section className={`siu siu--${variant}`} aria-label={title} data-kind={kind}>
      <h2 className="siu__title">{title}</h2>
      <p className="siu__sub">{variant === "pc" ? copy.upSubPc : copy.upSubMobile}</p>
      <div className="siu__grid">
        <div className="siu__slots" data-count={sides.length}>
          {sides.map(slot)}
          {kind === "my_number_card" ? <p className="siu__hint">{copy.upMyNumberNote}</p> : null}
        </div>
        <div className="siu__side">
          <div className="siu__fields">{keys.map(field)}</div>
          <p className="siu__note">
            <Check aria-hidden="true" size={16} strokeWidth={2.2} />
            <span>{copy.upNote.replace("{name}", confirmerName)}</span>
          </p>
          {notice ? (
            <p className="siu__notice" role="alert">
              {notice}
            </p>
          ) : null}
          <div className="siu__btns">
            {onCancel ? (
              <button className="siu__btn siu__btn--sec" disabled={saving} onClick={onCancel} type="button">
                {copy.cancel}
              </button>
            ) : null}
            <button
              aria-live="polite"
              className="siu__btn siu__btn--pri"
              data-saved={saved ? "" : undefined}
              disabled={saving || busy !== null}
              onClick={() => void save()}
              type="button"
            >
              {saved ? (
                <>
                  <svg aria-hidden="true" className="siu__check" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 24 24" width="18">
                    <path d="M5 12.5l4.5 4.5L19 7" />
                  </svg>
                  {copy.upSaved}
                </>
              ) : saving ? (
                copy.upSaving
              ) : (
                copy.upSave
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
