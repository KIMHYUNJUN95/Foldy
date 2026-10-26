"use client";

// 린넨 반품 등록 · 수정 폼 — 화이트 리디자인(2026-10-14, 시안 LinenNew-Phone · Linen-Fold · Linen-Tablet).
// 예전 「품목 고르기 + 수량」 줄을 하나씩 더하던 방식 대신 **이 건물의 활성 품목을 모두 펼쳐 ± 로 수량만** 정한다(사용자 승인).
// 같은 품목을 두 번 넣을 일이 없고(규칙 4), 0 인 품목은 저장하지 않는다. 서버에 보내는 모양(linesJson)은 그대로.
// 0 인 줄은 「−」를 숨긴다(hallmark 절제 점검). 숫자는 바뀔 때 살짝 굴러 바뀐다.
import Image from "next/image";
import { useMemo, useRef, useState, useTransition } from "react";
import { Minus, Plus, X } from "lucide-react";
import { createLinenReturnRecord } from "@/app/mobile/linen-return/new/actions";
import { updateLinenReturnRecord } from "@/app/mobile/linen-return/record/[id]/actions";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import { LINEN_JUST_SAVED_KEY } from "@/components/linen-return/linen-return-success";
import { uploadRequestImages } from "@/components/requests/request-image-upload";
import { haptic } from "@/lib/haptics";
import type { Dictionary } from "@/lib/i18n";
import type { LinenItemOption } from "@/lib/linen-returns";
import "@/components/requests/order-form.css";

type FormLine = { itemId: string; quantity: number };

type LinenReturnCreateFormProps = {
  building: string;
  buildingLabel: string;
  copy: Dictionary["linenReturn"];
  imgCopy: Dictionary["requestImages"];
  items: LinenItemOption[];
  organizationId: string;
  reporterName: string;
  serverError: string | null;
  /** 수정 모드에서 이 폼을 재사용하며, 기본은 생성 모드. */
  mode?: "create" | "edit";
  recordId?: string;
  initialLines?: (FormLine & { name?: string })[];
  initialNote?: string;
  /** 이미 저장된 사진 URL — 수정 모드에서 남기거나 지울 수 있다. */
  initialPhotos?: string[];
  submitLabel?: string;
};

/** CLAUDE.md §8 — 기능당 5장. 서버(create/update 액션)에서도 다시 막는다. */
const MAX_PHOTOS = 5;

export function LinenReturnCreateForm({
  building,
  copy,
  imgCopy,
  items,
  organizationId,
  serverError,
  mode = "create",
  recordId,
  initialLines,
  initialNote,
  initialPhotos,
}: LinenReturnCreateFormProps) {
  const isEdit = mode === "edit";
  const formRef = useRef<HTMLFormElement>(null);
  const uploaderRef = useRef<AnnouncementImageUploaderHandle>(null);

  // 수정 모드: 품목 목록에 없는(은퇴한) 품목이 기록에 있으면 그 줄도 함께 보여 준다.
  const rows = useMemo(() => {
    const known = new Set(items.map((it) => it.id));
    const extra = (initialLines ?? []).filter((l) => !known.has(l.itemId)).map((l) => ({ id: l.itemId, name: l.name ?? l.itemId }));
    return [...items.map((it) => ({ id: it.id, name: it.name })), ...extra];
  }, [items, initialLines]);

  const [qty, setQty] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const l of initialLines ?? []) init[l.itemId] = l.quantity;
    return init;
  });
  const [keptPhotos, setKeptPhotos] = useState<string[]>(() => (isEdit ? (initialPhotos ?? []) : []));
  const [error, setError] = useState<string | null>(serverError);
  const [isPending, startTransition] = useTransition();

  const lines: FormLine[] = rows.filter((r) => (qty[r.id] ?? 0) > 0).map((r) => ({ itemId: r.id, quantity: qty[r.id] }));
  const total = lines.reduce((sum, l) => sum + l.quantity, 0);

  function change(id: string, delta: number) {
    haptic("light");
    setError(null);
    setQty((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (lines.length === 0) {
      haptic("error");
      setError(copy.errorMinItems);
      return;
    }
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    formData.set("building", building);
    formData.set("linesJson", JSON.stringify(lines));

    if (isEdit) {
      formData.set("recordId", recordId ?? "");
      for (const url of keptPhotos) formData.append("imageUrls", url);
      try {
        const pending = uploaderRef.current?.getItems() ?? [];
        if (pending.length > 0) {
          const { imageUrls } = await uploadRequestImages({
            items: pending,
            organizationId,
            // 같은 기록의 사진은 같은 폴더에 모은다(스토리지 경로 규칙 유지).
            requestId: recordId ?? crypto.randomUUID(),
            requestType: "linen-returns",
          });
          for (const url of imageUrls) formData.append("imageUrls", url);
        }
      } catch {
        setError(copy.errors.save_failed);
        return;
      }
      startTransition(async () => {
        await updateLinenReturnRecord(formData);
      });
      return;
    }

    const requestId = crypto.randomUUID();
    formData.set("id", requestId);
    try {
      const photos = uploaderRef.current?.getItems() ?? [];
      const { imageUrls } = await uploadRequestImages({
        items: photos,
        organizationId,
        requestId,
        requestType: "linen-returns",
      });
      for (const url of imageUrls) formData.append("imageUrls", url);
    } catch {
      setError(copy.errors.save_failed);
      return;
    }
    // 완료 화면이 「이번에 보낸 장수 · 품목」을 보여 주도록 남겨 둔다(합쳐진 기록이면 기록 합계와 다르다).
    try {
      const name = (id: string) => rows.find((r) => r.id === id)?.name ?? "";
      window.sessionStorage.setItem(
        LINEN_JUST_SAVED_KEY,
        JSON.stringify({ total, lines: lines.map((l) => `${name(l.itemId)} ${l.quantity}`).join(" · ") }),
      );
    } catch {
      // 못 남기면 완료 화면이 기록 합계를 보여 준다.
    }
    startTransition(async () => {
      await createLinenReturnRecord(formData);
    });
  }

  return (
    <form className="lnw-form" onSubmit={handleSubmit} ref={formRef}>
      {rows.length === 0 ? <p className="lnw-empty">{copy.noItemsAvailable}</p> : null}
      <div className="lnw-steps">
        {rows.map((r) => {
          const q = qty[r.id] ?? 0;
          return (
            <div className={`lnw-step${q > 0 ? " has" : ""}`} key={r.id}>
              <span className="lnw-step__n">{r.name}</span>
              <button
                aria-label={copy.wMinus.replace("{item}", r.name)}
                className={`lnw-st${q === 0 ? " is-hidden" : ""}`}
                disabled={q === 0}
                onClick={() => change(r.id, -1)}
                type="button"
              >
                <Minus aria-hidden="true" />
              </button>
              <span className="lnw-step__q num" aria-live="polite" key={q}>
                {q}
              </span>
              <button aria-label={copy.wPlus.replace("{item}", r.name)} className="lnw-st is-plus" onClick={() => change(r.id, 1)} type="button">
                <Plus aria-hidden="true" />
              </button>
            </div>
          );
        })}
        <div className="lnw-step is-total">
          <b>{copy.wTotal}</b>
          <span className="num" key={total}>
            {total}
            <small>{copy.quantityUnit}</small>
          </span>
        </div>
      </div>

      <section className="ofw-sec">
        <label className="ofw-nf">
          <span className="ofw-nf__l">{copy.wMemoOpt}</span>
          <textarea className="ofw-nf__in ofw-ta" defaultValue={initialNote ?? ""} name="note" placeholder={copy.memoPlaceholder} rows={2} />
        </label>
        {keptPhotos.length > 0 ? (
          <div className="ofw-photos__row">
            {keptPhotos.map((url) => (
              <div className="ofw-photos__th" key={url}>
                <Image alt="" fill sizes="72px" src={url} />
                <button
                  aria-label={imgCopy.remove}
                  onClick={() => setKeptPhotos((prev) => prev.filter((u) => u !== url))}
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <AnnouncementImageUploader
          addImagesLabel={imgCopy.addPhotos}
          errorCountExceeded={imgCopy.errorCount}
          errorSizeExceeded={imgCopy.errorSize}
          errorTypeInvalid={imgCopy.errorType}
          imageAttachmentsLabel={copy.wPhotoOpt}
          imageLimitLabel={imgCopy.limit}
          imageRemoveLabel={imgCopy.remove}
          maxImages={MAX_PHOTOS - keptPhotos.length}
          ref={uploaderRef}
          variant="white"
        />
      </section>

      {error ? (
        <p className="ofw-err" role="alert">
          {error}
        </p>
      ) : null}

      <div className="lnw-submit">
        <button className="ofw-submit" disabled={isPending || total === 0} type="submit">
          {isPending ? <span className="ofw-spin" aria-hidden="true" /> : null}
          {(isEdit ? copy.wSaveN : copy.wSubmitN).replace("{n}", String(total))}
        </button>
        {!isEdit ? <span>{copy.wMergeNote}</span> : null}
      </div>
    </form>
  );
}
