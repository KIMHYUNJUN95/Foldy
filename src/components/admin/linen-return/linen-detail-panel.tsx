"use client";

// Admin 린넨 반품 콘솔 — 우측 상세 패널(읽기) + 기록 수정 창. 화이트 리디자인(2026-10-14, 시안 Linen-PC · LinenEdit-PC):
// 패널 = 건물 · 「요약 · n장」 · 「날짜 · 등록자」 + 삭제(빨간 휴지통) · 닫기 → 품목 줄 · 합계 → 사진 → 메모 · 등록 증빙 → [기록 수정].
// 수정 창 = 건물 · 이 건물에서 고를 수 있는 품목 전부를 ± 로(0 이면 저장하지 않음 — 중복 행이 생길 수 없다) · 메모 · 사진 → [취소][저장].
// 등록 일시/등록자는 현장 증빙값이라 수정 창 머리에 적어만 두고, 서버 액션도 이 두 컬럼을 payload 에 넣지 않는다.
// 사진은 기존 업로드 계약(compressImageFile → uploadRequestImages, 기능당 5장)을 그대로 쓴다.
// 참고: docs/product/19-linen-defect-workflow.md → "Record Management Contract".
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Minus, Plus, Trash2, X } from "lucide-react";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import { compressImageFile, type PreviewItem } from "@/components/announcements/announcement-image-uploader";
import { uploadRequestImages } from "@/components/requests/request-image-upload";
import type { AdminLinenBuildingOption, AdminLinenItemOption, AdminLinenRecordVM } from "@/lib/admin-linen-returns";
import { dayOf, itemsForBuilding, summaryOf, timeOf, tpl, weekdayLabel } from "./linen-console-data";
import type { LinenCopy } from "./linen-record-list";

/** CLAUDE.md §8 — 기능당 5장(프로젝트 업무 예외는 해당 없음). 서버에서도 다시 막는다. */
export const MAX_PHOTOS = 5;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/gif", "image/jpeg", "image/png", "image/webp"];

export type LinenEditPayload = {
  buildingName: string;
  lines: { itemId: string; quantity: number }[];
  note: string;
  photos: string[];
};

function whenOf(record: AdminLinenRecordVM, localeTag: string): string {
  const day = dayOf(record.registeredAt);
  return `${+day.slice(5, 7)}/${+day.slice(8, 10)} (${weekdayLabel(day, localeTag)}) ${timeOf(record.registeredAt)}`;
}

type PanelProps = {
  record: AdminLinenRecordVM;
  t: LinenCopy["console"];
  units: Pick<LinenCopy, "quantityUnit" | "kindsUnit" | "summaryMore">;
  localeTag: string;
  disabled?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function LinenDetailPanel({ record, t, units, localeTag, disabled, onClose, onEdit, onDelete }: PanelProps) {
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled });

  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside aria-label={t.pKicker} className="panel on lfp lnp" ref={panelRef} role="dialog" tabIndex={-1}>
        <div className="panel__h">
          <div className="panel__top">
            <span className="lfp__kick">
              <span>{record.buildingLabel}</span>
            </span>
            <span className="lfp__acts">
              {record.canManage ? (
                <button aria-label={t.delete} className="lfp__del" onClick={onDelete} title={t.delete} type="button">
                  <Trash2 aria-hidden="true" />
                </button>
              ) : null}
              <button aria-label={t.close} className="panel__x" onClick={onClose} type="button">
                <X />
              </button>
            </span>
          </div>
          <div className="lfp__title">
            {tpl(t.wTitleQty, { summary: summaryOf(record, units.summaryMore, units.kindsUnit), q: record.totalQuantity })}
          </div>
          <div className="lfp__sub num">
            {whenOf(record, localeTag)} · {record.registrantName}
          </div>
        </div>

        <div className="panel__body lfp__body">
          <div className="lnp-lines">
            {record.lines.map((line) => (
              <div className="lnp-line" key={line.itemId}>
                <span>{line.name}</span>
                <b className="num">
                  {line.quantity}
                  {t.wQtyUnit}
                </b>
              </div>
            ))}
            <div className="lnp-line is-total">
              <b>{t.wTotal}</b>
              <b className="num">
                {record.totalQuantity}
                {t.wQtyUnit}
              </b>
            </div>
          </div>

          {record.photos.length ? (
            <div className="lfp__gal">
              {record.photos.map((url) => (
                <a className="lfp__shot" href={url} key={url} rel="noreferrer" target="_blank">
                  <Image alt="" fill sizes="170px" src={url} />
                </a>
              ))}
            </div>
          ) : null}

          <dl className="lfp__dl">
            {record.note ? (
              <>
                <dt>{t.pMemo}</dt>
                <dd>{record.note}</dd>
              </>
            ) : null}
            <dt>{t.wEvidence}</dt>
            <dd className="lfp__muted">{t.wEvidenceV}</dd>
          </dl>
        </div>

        <div className="panel__foot lfp__foot">
          {record.canManage ? (
            <button className="btn lfp__soft lfp__restore" onClick={onEdit} type="button">
              {t.wEditRecord}
            </button>
          ) : (
            <span className="lfp__note">{t.readonlyNote}</span>
          )}
        </div>
      </aside>
    </>
  );
}

type EditProps = {
  record: AdminLinenRecordVM;
  t: LinenCopy["console"];
  errors: Record<string, string>;
  catalog: AdminLinenItemOption[];
  buildings: AdminLinenBuildingOption[];
  localeTag: string;
  organizationId: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: LinenEditPayload) => void;
};

export function LinenEditModal({ record, t, errors, catalog, buildings, localeTag, organizationId, saving, onCancel, onSave }: EditProps) {
  const [building, setBuilding] = useState(record.buildingName);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(record.lines.map((l) => [l.itemId, l.quantity])));
  const [note, setNote] = useState(record.note ?? "");
  const [photos, setPhotos] = useState<string[]>(() => [...record.photos]);
  const [pending, setPending] = useState<PreviewItem[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = saving || uploading;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  // 건물 선택지 — 룸 마스터의 건물 + 이 기록의 건물(마스터에서 빠졌을 수 있다).
  const buildingChoices: AdminLinenBuildingOption[] = [
    ...(buildings.some((o) => o.name === record.buildingName) ? [] : [{ name: record.buildingName, label: record.buildingLabel }]),
    ...buildings,
  ].filter((o) => Boolean(o.name));

  // 고를 수 있는 품목 = 전역 품목 + 고른 건물 전용 품목(서버 검증과 같은 규칙). 기록에 있던 은퇴 품목도 줄로 남긴다.
  const rows = useMemo(() => {
    const list = itemsForBuilding(catalog, building).map((it) => ({ id: it.id, name: it.name }));
    for (const line of record.lines) {
      if (!list.some((r) => r.id === line.itemId) && building === record.buildingName) list.push({ id: line.itemId, name: line.name });
    }
    return list;
  }, [catalog, building, record]);

  const lines = rows.filter((r) => (qty[r.id] ?? 0) > 0).map((r) => ({ itemId: r.id, quantity: qty[r.id] }));
  const total = lines.reduce((s, l) => s + l.quantity, 0);
  const photoCount = photos.length + pending.length;

  function change(id: string, delta: number) {
    setFormError(null);
    setQty((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }));
  }

  async function addPhotos(files: File[]) {
    if (files.length === 0 || busy) return;
    if (files.some((f) => !ALLOWED_TYPES.includes(f.type))) return setFormError(t.ePhotoType);
    if (files.some((f) => f.size > MAX_BYTES)) return setFormError(tpl(t.ePhotoSize, { max: Math.round(MAX_BYTES / (1024 * 1024)) }));
    if (photoCount + files.length > MAX_PHOTOS) return setFormError(tpl(t.ePhotoLimit, { max: MAX_PHOTOS }));
    setFormError(null);
    const items = await Promise.all(
      files.map(async (file) => {
        const compressed = await compressImageFile(file);
        return { id: `${Date.now()}-${Math.random()}`, file: compressed, previewUrl: URL.createObjectURL(compressed) };
      }),
    );
    setPending((prev) => [...prev, ...items]);
  }

  async function submit() {
    if (busy) return;
    if (lines.length === 0) return setFormError(t.wNeedItem);
    let nextPhotos = photos;
    if (pending.length > 0) {
      setUploading(true);
      try {
        const { imageUrls } = await uploadRequestImages({ items: pending, organizationId, requestId: record.id, requestType: "linen-returns" });
        nextPhotos = [...photos, ...imageUrls];
      } catch {
        setUploading(false);
        return setFormError(errors.save_failed);
      }
      setUploading(false);
    }
    setFormError(null);
    onSave({ buildingName: building, lines, note, photos: nextPhotos });
  }

  return (
    <>
      <div className="modal-scrim on" onClick={busy ? undefined : onCancel} />
      <div aria-labelledby="lnm-title" aria-modal="true" className="modal on lfm owm lnm" role="dialog">
        <div className="lfm__h">
          <h2 id="lnm-title">{t.wEditTitle}</h2>
          <span>{tpl(t.wEditSub, { when: whenOf(record, localeTag), who: record.registrantName })}</span>
        </div>

        <div className="lfm__nf lnm-bld">
          <span className="lfm__nl">{t.pBuilding}</span>
          <AdmDropdown
            ariaLabel={t.pBuilding}
            onChange={(v) => {
              setBuilding(v);
              setFormError(null);
            }}
            options={buildingChoices.map((o) => ({ value: o.name, label: o.label }))}
            value={building}
          />
        </div>

        <div className="lnm-steps">
          {rows.map((r) => {
            const q = qty[r.id] ?? 0;
            return (
              <div className={`lnm-step${q > 0 ? " has" : ""}`} key={r.id}>
                <span>{r.name}</span>
                <button
                  aria-label={t.wMinus.replace("{item}", r.name)}
                  className={`lnm-st${q === 0 ? " is-hidden" : ""}`}
                  disabled={q === 0}
                  onClick={() => change(r.id, -1)}
                  type="button"
                >
                  <Minus aria-hidden="true" />
                </button>
                <b className="num" key={q}>
                  {q}
                </b>
                <button aria-label={t.wPlus.replace("{item}", r.name)} className="lnm-st is-plus" onClick={() => change(r.id, 1)} type="button">
                  <Plus aria-hidden="true" />
                </button>
              </div>
            );
          })}
          <div className="lnm-step is-total">
            <b>{t.wTotal}</b>
            <b className="num" key={total}>
              {total}
              {t.wQtyUnit}
            </b>
          </div>
        </div>

        <label className="lfm__nf">
          <span className="lfm__nl">{t.wMemoOpt}</span>
          <textarea onChange={(e) => setNote(e.target.value)} placeholder={t.fMemoPlaceholder} rows={2} value={note} />
        </label>

        <div className="lnm-photos">
          {photos.map((url) => (
            <div className="lnm-ph" key={url}>
              <Image alt="" fill sizes="64px" src={url} />
              <button aria-label={t.fRemovePhoto} onClick={() => setPhotos((prev) => prev.filter((u) => u !== url))} type="button">
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
          {pending.map((p) => (
            <div className="lnm-ph" key={p.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" src={p.previewUrl} />
              <button
                aria-label={t.fRemovePhoto}
                onClick={() => {
                  URL.revokeObjectURL(p.previewUrl);
                  setPending((prev) => prev.filter((x) => x.id !== p.id));
                }}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
          {photoCount < MAX_PHOTOS ? (
            <button aria-label={t.fAddPhoto} className="lnm-add" onClick={() => fileRef.current?.click()} type="button">
              <Camera aria-hidden="true" />
            </button>
          ) : null}
          <input
            accept={ALLOWED_TYPES.join(",")}
            aria-hidden="true"
            className="sr-only"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void addPhotos(files);
            }}
            ref={fileRef}
            tabIndex={-1}
            type="file"
          />
        </div>

        {formError ? (
          <p className="lnm-err" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="lfm__foot">
          <button className="btn lfm__cancel" disabled={busy} onClick={onCancel} type="button">
            {t.cancel}
          </button>
          <button className="btn lfm__ok is-pri" disabled={busy} onClick={submit} type="button">
            {uploading ? t.uploading : t.save}
          </button>
        </div>
      </div>
    </>
  );
}
