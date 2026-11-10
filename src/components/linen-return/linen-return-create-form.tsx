"use client";

// 린넨 반품 등록 · 수정 폼 — 화이트 리디자인(2026-10-14, 시안 LinenNew-Phone · Linen-Fold · Linen-Tablet).
// 예전 「품목 고르기 + 수량」 줄을 하나씩 더하던 방식 대신 **이 건물의 활성 품목을 모두 펼쳐 ± 로 수량만** 정한다(사용자 승인).
// 같은 품목을 두 번 넣을 일이 없고(규칙 4), 0 인 품목은 저장하지 않는다. 서버에 보내는 모양(linesJson)은 그대로.
// 0 인 줄은 「−」를 숨긴다(hallmark 절제 점검). 숫자는 바뀔 때 살짝 굴러 바뀐다.
import Image from "next/image";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import {
  decideSubmissionId,
  errorCodeForMessage,
  freshLinenDraft,
  linenDraftKey,
  linenFingerprint,
  serializeLinenDraft,
} from "@/lib/linen-mobile-form";
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
  /** 수정 모드: 불러온 시점의 기록 수정 시각 — 서버가 다른 사람이 먼저 고쳤는지 본다. */
  updatedAt?: string;
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
  updatedAt,
}: LinenReturnCreateFormProps) {
  const isEdit = mode === "edit";
  const formRef = useRef<HTMLFormElement>(null);
  const uploaderRef = useRef<AnnouncementImageUploaderHandle>(null);
  const draftKey = linenDraftKey(mode, building, recordId);

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
  const [note, setNote] = useState(initialNote ?? "");
  const [keptPhotos, setKeptPhotos] = useState<string[]>(() => (isEdit ? (initialPhotos ?? []) : []));
  const [error, setError] = useState<string | null>(serverError);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  // 더블탭 · 업로드 중 재탭 방지 — state 는 다음 렌더에야 반영되므로 ref 로 즉시 잠근다.
  const lockRef = useRef(false);
  const attemptRef = useRef(0);
  const hapticAttemptRef = useRef(-1);
  const wasPendingRef = useRef(false);
  // 이번 시도에서 우리가 직접 잡은 오류(서버가 돌려준 오류가 아님) — 주소에 남은 예전 ?error= 가 덮지 않게.
  const caughtRef = useRef(false);

  const lines: FormLine[] = rows.filter((r) => (qty[r.id] ?? 0) > 0).map((r) => ({ itemId: r.id, quantity: qty[r.id] }));
  const total = lines.reduce((sum, l) => sum + l.quantity, 0);
  const busy = submitting || isPending;

  function unlock() {
    lockRef.current = false;
    setSubmitting(false);
  }

  // 한 번의 제출 시도에 오류 진동은 한 번만(서버 오류가 두 경로로 알려질 수 있다).
  function reportServerError(message: string) {
    setError(message);
    if (hapticAttemptRef.current !== attemptRef.current) {
      hapticAttemptRef.current = attemptRef.current;
      haptic("error");
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect -- 서버 오류 뒤 입력 복원 · 잠금 해제는 sessionStorage / 서버 응답과의 동기화다 */
  // 서버가 ?error= 로 돌려보낸 뒤(또는 처음 열 때): 입력을 되살리고, 오류 없이 새로 열었으면 지난 임시 저장을 지운다.
  useEffect(() => {
    try {
      if (serverError) {
        const code = errorCodeForMessage(serverError, copy.errors);
        const draft = freshLinenDraft(window.sessionStorage.getItem(draftKey), Date.now());
        // 옛 수정 시각으로 다시 보내면 또 stale 이라 지운다(서버가 최신 값으로 다시 그린다). 사진은 되살리지 않는다.
        if (code === "stale") window.sessionStorage.removeItem(draftKey);
        else if (draft) {
          setQty(draft.qty);
          setNote(draft.note);
        }
      } else if (!freshLinenDraft(window.sessionStorage.getItem(draftKey), Date.now())) {
        // 오류 없이 처음 열었다 — 새 폼은 비운 채 두고, 유효한 {id, 지문} 은 남겨 같은 내용이면 같은 id 를 쓰게 한다.
        // 성공(완료 화면)이나 stale 일 때 지운다.
        window.sessionStorage.removeItem(draftKey);
      }
    } catch {
      // 임시 저장을 못 읽어도 입력만 비어 있을 뿐이다.
    }
    if (serverError) {
      lockRef.current = false;
      setSubmitting(false);
      reportServerError(serverError);
    }
  }, [serverError, draftKey, copy.errors]);

  // 서버 응답이 끝나면 잠금을 푼다(같은 오류가 연달아 와도 풀리도록 서버 오류 문구 변화에 기대지 않는다).
  useEffect(() => {
    if (wasPendingRef.current && !isPending) {
      lockRef.current = false;
      setSubmitting(false);
      if (serverError && !caughtRef.current) reportServerError(serverError);
    }
    wasPendingRef.current = isPending;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 서버 응답이 끝나는 순간(isPending 하강)에만 돈다
  }, [isPending]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function change(id: string, delta: number) {
    haptic("light");
    setError(null);
    setQty((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lockRef.current) return;
    setError(null);
    if (lines.length === 0) {
      // 입력 검증으로 막힌 경우 — 진동 없음(haptics.ts 규칙).
      setError(copy.errorMinItems);
      return;
    }
    const form = formRef.current;
    if (!form) return;
    lockRef.current = true;
    attemptRef.current += 1;
    caughtRef.current = false;
    setSubmitting(true);

    const formData = new FormData(form);
    formData.set("building", building);
    formData.set("linesJson", JSON.stringify(lines));
    formData.set("note", note);
    for (const url of keptPhotos) formData.append("imageUrls", url);

    let uploaded: string[] = [];
    const pending = uploaderRef.current?.getItems() ?? [];
    // 제출 id — 내용 지문이 지난 제출과 같으면 같은 id(재시도), 다르면 새 id.
    const fp = linenFingerprint({
      building,
      lines,
      note,
      keptPhotos,
      files: pending.map((it) => ({ name: it.file.name, size: it.file.size })),
    });
    let stored: ReturnType<typeof freshLinenDraft> = null;
    try {
      stored = freshLinenDraft(window.sessionStorage.getItem(draftKey), Date.now());
    } catch {
      // 못 읽으면 새 id.
    }
    const submissionId = decideSubmissionId(stored, fp, () => crypto.randomUUID());
    try {
      if (pending.length > 0) {
        const { imageUrls } = await uploadRequestImages({
          items: pending,
          organizationId,
          // 같은 기록의 사진은 같은 폴더에 모은다(스토리지 경로 규칙 유지). 새 기록은 제출 id 폴더.
          requestId: isEdit ? (recordId ?? submissionId) : submissionId,
          requestType: "linen-returns",
        });
        uploaded = imageUrls;
      }
    } catch {
      unlock();
      haptic("error");
      setError(copy.errors.save_failed);
      return;
    }
    for (const url of uploaded) formData.append("imageUrls", url);

    // 서버 오류로 돌아와도 수량 · 메모 · 제출 id 가 남도록 임시 저장(사진은 보관하지 않는다).
    try {
      window.sessionStorage.setItem(draftKey, serializeLinenDraft({ id: submissionId, fp, qty, note, savedAt: Date.now() }));
    } catch {
      // 못 남겨도 저장 자체에는 영향 없다.
    }

    if (isEdit) {
      formData.set("recordId", recordId ?? "");
    } else {
      formData.set("id", submissionId);
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
    }
    startTransition(async () => {
      try {
        if (isEdit) await updateLinenReturnRecord(formData);
        else await createLinenReturnRecord(formData);
      } catch (e) {
        // 서버가 redirect 로 응답하는 정상 경로는 건드리지 않는다.
        unstable_rethrow(e);
        caughtRef.current = true;
        unlock();
        haptic("error");
        setError(copy.errors.save_failed);
      }
    });
  }

  return (
    <form className="lnw-form" onSubmit={handleSubmit} ref={formRef}>
      {updatedAt ? <input name="updatedAt" type="hidden" value={updatedAt} /> : null}
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
          <textarea
            className="ofw-nf__in ofw-ta"
            name="note"
            onChange={(e) => {
              setError(null);
              setNote(e.target.value);
            }}
            placeholder={copy.memoPlaceholder} rows={2}
            value={note}
          />
        </label>
        {keptPhotos.length > 0 ? (
          <div className="ofw-photos__row">
            {keptPhotos.map((url) => (
              <div className="ofw-photos__th" key={url}>
                <Image alt="" fill sizes="72px" src={url} />
                <button
                  aria-label={imgCopy.remove}
                  onClick={() => {
                    setError(null);
                    setKeptPhotos((prev) => prev.filter((u) => u !== url));
                  }}
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
        <button className="ofw-submit" disabled={busy || total === 0} type="submit">
          {busy ? <span className="ofw-spin" aria-hidden="true" /> : null}
          {(isEdit ? copy.wSaveN : copy.wSubmitN).replace("{n}", String(total))}
        </button>
        {!isEdit ? <span>{copy.wMergeNote}</span> : null}
      </div>
    </form>
  );
}
