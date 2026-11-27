"use client";

/**
 * 의견 쓰기 · 수정 — 받는 사람(필수) · 참조(선택) · 제목 · 본문 · 분류 · 건물/객실 태그 · 사진 최대 5장.
 * 목록 · 상세와 같은 화이트 `.sgw` 칸 · 라벨 · 버튼(suggestions-white.css `.sgw-c`).
 * 오류는 해당 칸 아래(빨간 테두리 · aria-describedby), 칸에 묶이지 않는 오류만 보내기 버튼 아래 한 줄.
 * 건물 · 객실은 공용 `ContextPickerSheet`, 사진은 공용 `uploadRequestImages` + `compressImageFile`,
 * 제출은 `createStaffSuggestion` / `updateStaffSuggestion`.
 * 참고: docs/product/22-staff-suggestions-workflow.md 「화이트 리디자인 — 모바일」.
 */

import { useRef, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  createStaffSuggestion,
  updateStaffSuggestion,
} from "@/app/mobile/suggestions/actions";
import {
  compressImageFile,
  type PreviewItem,
} from "@/components/announcements/announcement-image-uploader";
import { ContextPickerSheet } from "@/components/tasks/context-picker-sheet";
import type { LinkedContext } from "@/components/tasks/context-link-section";
import { uploadRequestImages } from "@/components/requests/request-image-upload";
import type { Dictionary } from "@/lib/i18n";
import type { ShareableUser } from "@/lib/tasks";
import { useBuildingName } from "@/components/shared/building-names";
import "./suggestions-white.css";
import { SgIcon } from "./sg-icons";
import { SuggestionsUserPicker } from "./suggestions-user-picker";
import {
  firstInvalidField,
  nextServerErrorSync,
  splitServerError,
  type ServerErrorSync,
  validateCompose,
  type ComposeErrorKey,
  type ComposeField,
  type ComposeFieldErrors,
} from "./suggestion-compose-errors";
import { dropFromReferences, pickRecipient, pickReferences } from "./suggestion-compose-pick";
import { requestImageSrc } from "@/lib/request-image-src";

const MAX_PHOTOS = 5;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/gif", "image/jpeg", "image/png", "image/webp"];

type SuggestionContext = {
  propertyId: string | null;
  propertyName: string | null;
  roomId: string | null;
  roomLabel: string | null;
};

export type SuggestionComposeInitial = {
  recipient: ShareableUser | null;
  references: ShareableUser[];
  title: string;
  body: string;
  category: string;
  ctx: SuggestionContext | null;
  imageUrls: string[];
};

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="sgw-c__ic">
      {children}
    </span>
  );
}

export function SuggestionsCompose({
  organizationId,
  users,
  roleLabels,
  buildingLabels,
  pickerCopy,
  copy,
  serverError,
  editId,
  initial,
}: {
  organizationId: string;
  users: ShareableUser[];
  roleLabels: Record<string, string>;
  buildingLabels: Record<string, string>;
  pickerCopy: Dictionary["tasks"];
  copy: Dictionary["mobile"]["suggestions"];
  serverError?: string | null;
  editId?: string;
  initial?: SuggestionComposeInitial;
}) {
  const bName = useBuildingName();
  const isEdit = Boolean(editId);
  const [pickerMode, setPickerMode] = useState<"recipient" | "references" | null>(null);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [ctxInitialProperty, setCtxInitialProperty] = useState<string | undefined>(undefined);

  const [recipient, setRecipient] = useState<ShareableUser | null>(initial?.recipient ?? null);
  const [references, setReferences] = useState<ShareableUser[]>(initial?.references ?? []);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [ctx, setCtx] = useState<SuggestionContext | null>(initial?.ctx ?? null);
  const [photos, setPhotos] = useState<PreviewItem[]>([]);
  // 수정 모드는 이미 올라간 이미지(URL)와 새로 고른 File 을 따로 두며, 둘 다 5장 한도에 포함된다.
  const [existingImages, setExistingImages] = useState<string[]>(initial?.imageUrls ?? []);

  const [fieldErrors, setFieldErrors] = useState<ComposeFieldErrors>(
    () => splitServerError(serverError).fields,
  );
  const [formError, setFormError] = useState<ComposeErrorKey | null>(
    () => splitServerError(serverError).form,
  );
  const [isPending, startTransition] = useTransition();
  // 서버까지 간 시도 번호 — 같은 `?error=` 가 두 번 와도 시도가 끝날 때마다 다시 보이게(nextServerErrorSync).
  const [sentAttempt, setSentAttempt] = useState(0);
  const [errorSync, setErrorSync] = useState<ServerErrorSync>({
    seen: serverError ?? null,
    appliedAttempt: 0,
  });
  // 스크린리더 안내는 보내기 · 실패 순간에 정한 문장만 — 입력하는 동안 남은 오류를 다시 읽지 않게.
  const [announcement, setAnnouncement] = useState<{ text: string; n: number }>(() => {
    const first = splitServerError(serverError);
    const key = first.form ?? Object.values(first.fields)[0];
    return { text: key ? (copy.errors[key] ?? copy.errors.save_failed) : "", n: 0 };
  });
  const syncNext = nextServerErrorSync(errorSync, { serverError, pending: isPending, sentAttempt });
  if (syncNext) {
    setErrorSync(syncNext);
    const next = splitServerError(serverError);
    setFieldErrors(next.fields);
    setFormError(next.form);
    const key = next.form ?? next.fields[firstInvalidField(next.fields) ?? "recipient"];
    if (key) setAnnouncement((a) => ({ text: copy.errors[key] ?? copy.errors.save_failed, n: a.n + 1 }));
  }

  const fileRef = useRef<HTMLInputElement>(null);
  const recipientRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const photosRef = useRef<HTMLDivElement>(null);

  const roleLabel = (role: string) => roleLabels[role] ?? role;
  const msg = (key: ComposeErrorKey) => copy.errors[key] ?? copy.errors.save_failed;
  const announce = (key: ComposeErrorKey) =>
    setAnnouncement((a) => ({ text: msg(key), n: a.n + 1 }));
  const errId = (field: ComposeField) => `sgw-c-err-${field}`;
  const clearField = (field: ComposeField) =>
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  function focusField(field: ComposeField) {
    const target =
      field === "recipient"
        ? recipientRef.current
        : field === "title"
          ? titleRef.current
          : field === "body"
            ? bodyRef.current
            : photosRef.current;
    target?.focus();
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (selected.length === 0) return;
    if (selected.some((f) => !ALLOWED_TYPES.includes(f.type))) return;
    if (selected.some((f) => f.size > MAX_BYTES)) return;
    if (existingImages.length + photos.length + selected.length > MAX_PHOTOS) {
      setFieldErrors((prev) => ({ ...prev, photos: "too_many_photos" }));
      return;
    }
    clearField("photos");
    const items = await Promise.all(
      selected.map(async (file) => {
        const compressed = await compressImageFile(file);
        return {
          id: `${Date.now()}-${Math.random()}`,
          file: compressed,
          previewUrl: URL.createObjectURL(compressed),
        } satisfies PreviewItem;
      }),
    );
    setPhotos((prev) => [...prev, ...items]);
  }

  function removePhoto(id: string) {
    clearField("photos");
    setPhotos((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  function applyContext(linked: LinkedContext) {
    if (!linked.propertyId && !linked.roomId) {
      setCtx(null);
      return;
    }
    setCtx({
      propertyId: linked.propertyId,
      propertyName: linked.propertyName,
      roomId: linked.roomId,
      roomLabel: linked.roomLabel,
    });
  }

  function submit() {
    if (isPending) return;
    const errors = validateCompose({ hasRecipient: Boolean(recipient), title, body });
    const first = firstInvalidField(errors);
    setFieldErrors(errors);
    setFormError(null);
    if (first || !recipient) {
      if (first) {
        focusField(first);
        announce(errors[first] as ComposeErrorKey);
      }
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.set("title", title.trim());
      fd.set("body", body.trim());
      fd.set("category", category.trim());
      fd.set("recipientId", recipient.id);
      fd.set("referencesJson", JSON.stringify(references.map((r) => r.id)));
      fd.set("propertyId", ctx?.propertyId ?? "");
      fd.set("propertyName", ctx?.propertyName ?? "");
      fd.set("roomId", ctx?.roomId ?? "");
      fd.set("roomLabel", ctx?.roomLabel ?? "");

      // 수정 모드: 지우지 않은 기존 이미지를 먼저 유지한다.
      if (isEdit) for (const url of existingImages) fd.append("imageUrls", url);

      const newSlots = MAX_PHOTOS - (isEdit ? existingImages.length : 0);
      if (photos.length > 0 && newSlots > 0) {
        try {
          const { imageUrls } = await uploadRequestImages({
            items: photos.slice(0, newSlots),
            organizationId,
            requestId: crypto.randomUUID(),
            requestType: "suggestion-images",
          });
          for (const url of imageUrls) fd.append("imageUrls", url);
        } catch {
          setFormError("upload_failed");
          announce("upload_failed");
          return;
        }
      }

      setSentAttempt((n) => n + 1);
      if (isEdit) {
        fd.set("suggestionId", editId as string);
        await updateStaffSuggestion(fd);
      } else {
        await createStaffSuggestion(fd);
      }
    });
  }

  const fieldError = (field: ComposeField) => {
    const key = fieldErrors[field];
    return key ? (
      <p className="sgw-c__err" id={errId(field)}>
        {msg(key)}
      </p>
    ) : null;
  };
  const invalidProps = (field: ComposeField) =>
    fieldErrors[field]
      ? { "aria-invalid": true as const, "aria-describedby": errId(field) }
      : {};
  const idleLabel = isEdit ? copy.save : copy.send;
  const pendingLabel = isEdit ? copy.saving : copy.sending;

  return (
    <div className="sgw sgw-c">
      <div className="sgw-c__bar">
        <h1>{isEdit ? copy.editTitle : copy.composeTitle}</h1>
        <button className="sgw-c__send" data-press="off" disabled={isPending} onClick={submit} type="button">
          {isPending ? pendingLabel : idleLabel}
        </button>
      </div>
      {formError ? <p className="sgw-c__err sgw-c__err--form">{msg(formError)}</p> : null}
      <p aria-live="polite" className="sr-only">
        {/* 같은 문장이 다시 와도 읽히게 매번 새 노드로. */}
        <span key={announcement.n}>{announcement.text}</span>
      </p>

      <div className="sgw-c__f">
        <div className="sgw-c__l">
          {copy.fieldRecipient} <span className="req">*</span>
        </div>
        {recipient ? (
          <div className="sgw-c__rc" data-invalid={fieldErrors.recipient ? "" : undefined}>
            <span aria-hidden="true" className="sgw-c__av">
              {recipient.name.slice(0, 1)}
            </span>
            <div className="sgw-c__rb">
              <div className="sgw-c__rn">{recipient.name}</div>
              <div className="sgw-c__rr">{roleLabel(recipient.role)}</div>
            </div>
            <button
              className="sgw-c__chg"
              onClick={() => setPickerMode("recipient")}
              ref={recipientRef}
              type="button"
              {...invalidProps("recipient")}
            >
              {copy.change}
            </button>
          </div>
        ) : (
          <button
            className="sgw-c__rc"
            data-invalid={fieldErrors.recipient ? "" : undefined}
            onClick={() => setPickerMode("recipient")}
            ref={recipientRef}
            type="button"
            {...invalidProps("recipient")}
          >
            <span aria-hidden="true" className="sgw-c__av">
              <Plus size={18} strokeWidth={1.5} />
            </span>
            <div className="sgw-c__rb">
              <div className="sgw-c__rn">{copy.recipientPickName}</div>
              <div className="sgw-c__rr">{copy.recipientPickSub}</div>
            </div>
          </button>
        )}
        {fieldError("recipient")}
      </div>

      <div className="sgw-c__f">
        <div className="sgw-c__l">
          {copy.fieldReferences} <span className="opt">{copy.fieldReferencesHint}</span>
        </div>
        <div className="sgw-c__chips">
          {references.map((r) => (
            <span className="sgw-c__chip" key={r.id}>
              <span aria-hidden="true" className="sgw-c__cav">
                {r.name.slice(0, 1)}
              </span>
              {r.name}
              <button
                aria-label={copy.removeReference.replace("{name}", r.name)}
                className="sgw-c__x"
                onClick={() => setReferences((prev) => prev.filter((x) => x.id !== r.id))}
                type="button"
              >
                <Glyph>{SgIcon.x}</Glyph>
              </button>
            </span>
          ))}
          <button className="sgw-c__pill" onClick={() => setPickerMode("references")} type="button">
            <Glyph>{SgIcon.plus}</Glyph>
            {copy.add}
          </button>
        </div>
      </div>

      <div className="sgw-c__f">
        <label className="sgw-c__l" htmlFor="sgw-c-title">
          {copy.fieldTitle} <span className="req">*</span>
        </label>
        <input
          className="sgw-c__in"
          id="sgw-c-title"
          onChange={(e) => {
            setTitle(e.target.value);
            clearField("title");
          }}
          placeholder={copy.placeholderTitle}
          ref={titleRef}
          value={title}
          {...invalidProps("title")}
        />
        {fieldError("title")}
      </div>

      <div className="sgw-c__f">
        <label className="sgw-c__l" htmlFor="sgw-c-body">
          {copy.fieldBody} <span className="req">*</span>
        </label>
        <textarea
          className="sgw-c__in sgw-c__in--area"
          id="sgw-c-body"
          onChange={(e) => {
            setBody(e.target.value);
            clearField("body");
          }}
          placeholder={copy.placeholderBody}
          ref={bodyRef}
          rows={4}
          value={body}
          {...invalidProps("body")}
        />
        {fieldError("body")}
      </div>

      <div className="sgw-c__f">
        <label className="sgw-c__l" htmlFor="sgw-c-category">
          {copy.fieldCategory} <span className="opt">{copy.fieldCategoryHint}</span>
        </label>
        <input
          className="sgw-c__in"
          id="sgw-c-category"
          onChange={(e) => setCategory(e.target.value)}
          placeholder={copy.placeholderCategory}
          value={category}
        />
      </div>

      <div className="sgw-c__f">
        <div className="sgw-c__l">
          {copy.fieldTags} <span className="opt">{copy.fieldTagsHint}</span>
        </div>
        <div className="sgw-c__tags">
          <button
            className="sgw-c__tag"
            onClick={() => {
              setCtxInitialProperty(undefined);
              setCtxOpen(true);
            }}
            type="button"
          >
            <Glyph>{SgIcon.building}</Glyph>
            {copy.tagBuilding}
            <span className="v">{ctx?.propertyName ? bName(ctx.propertyName) : copy.tagSelect}</span>
          </button>
          <button
            className="sgw-c__tag"
            onClick={() => {
              setCtxInitialProperty(ctx?.propertyName ?? undefined);
              setCtxOpen(true);
            }}
            type="button"
          >
            <Glyph>{SgIcon.door}</Glyph>
            {copy.tagRoom}
            <span className="v">
              {ctx?.roomLabel
                ? ctx.roomLabel === ctx.propertyName
                  ? bName(ctx.roomLabel)
                  : ctx.roomLabel
                : copy.tagSelect}
            </span>
          </button>
          {ctx ? (
            <button className="sgw-c__pill sgw-c__pill--tall" onClick={() => setCtx(null)} type="button">
              <Glyph>{SgIcon.x}</Glyph>
              {copy.tagClear}
            </button>
          ) : null}
        </div>
      </div>

      <div className="sgw-c__f">
        <div className="sgw-c__l">
          {copy.fieldPhotos} <span className="opt">{copy.fieldPhotosHint}</span>
        </div>
        <div
          aria-describedby={fieldErrors.photos ? errId("photos") : undefined}
          aria-label={copy.fieldPhotos}
          className="sgw-c__photos"
          ref={photosRef}
          role="group"
          tabIndex={-1}
        >
          {existingImages.map((url) => (
            <div className="sgw-c__thumb" key={url} style={{ backgroundImage: `url(${requestImageSrc(url)})` }}>
              <button
                aria-label={copy.removePhoto}
                className="sgw-c__thumbx"
                onClick={() => {
                  clearField("photos");
                  setExistingImages((prev) => prev.filter((u) => u !== url));
                }}
                type="button"
              >
                <Glyph>{SgIcon.x}</Glyph>
              </button>
            </div>
          ))}
          {photos.map((p) => (
            <div className="sgw-c__thumb" key={p.id} style={{ backgroundImage: `url(${p.previewUrl})` }}>
              <button
                aria-label={copy.removePhoto}
                className="sgw-c__thumbx"
                onClick={() => removePhoto(p.id)}
                type="button"
              >
                <Glyph>{SgIcon.x}</Glyph>
              </button>
            </div>
          ))}
          {existingImages.length + photos.length < MAX_PHOTOS ? (
            <button className="sgw-c__padd" onClick={() => fileRef.current?.click()} type="button">
              <Glyph>{SgIcon.image}</Glyph>
              <span>{copy.add}</span>
            </button>
          ) : null}
        </div>
        {fieldError("photos")}
        <input
          accept="image/gif,image/jpeg,image/png,image/webp"
          aria-hidden="true"
          hidden
          multiple
          onChange={onPickFiles}
          ref={fileRef}
          tabIndex={-1}
          type="file"
        />
      </div>

      {/* 구성원 피커 — 받는 사람(단일) / 참조(다중). 공용 BottomSheet 라 열 때마다 새로 올린다. */}
      {pickerMode === "recipient" ? (
        <SuggestionsUserPicker
          confirmEmpty={copy.pickerConfirm}
          confirmMulti={copy.pickerConfirmMulti}
          confirmSingle={copy.pickerConfirmSingle}
          emptyLabel={copy.pickerEmpty}
          groupLabel={copy.pickerGroup}
          initialSelectedIds={recipient ? [recipient.id] : []}
          mode="single"
          onClose={() => setPickerMode(null)}
          onConfirm={(ids) => {
            const next = pickRecipient(recipient, ids, users);
            setRecipient(next);
            if (next) {
              clearField("recipient");
              setReferences((prev) => dropFromReferences(prev, next.id));
            }
          }}
          roleLabel={roleLabel}
          searchPlaceholder={copy.pickerSearch}
          sub={copy.pickerRecipientSub}
          title={copy.pickerRecipientTitle}
          users={users}
        />
      ) : null}
      {pickerMode === "references" ? (
        <SuggestionsUserPicker
          confirmEmpty={copy.pickerConfirm}
          confirmMulti={copy.pickerConfirmMulti}
          confirmSingle={copy.pickerConfirmSingle}
          emptyLabel={copy.pickerEmpty}
          excludeIds={recipient ? [recipient.id] : []}
          groupLabel={copy.pickerGroup}
          initialSelectedIds={references.map((r) => r.id)}
          mode="multi"
          onClose={() => setPickerMode(null)}
          onConfirm={(ids) => setReferences((prev) => pickReferences(prev, ids, users, recipient?.id))}
          roleLabel={roleLabel}
          searchPlaceholder={copy.pickerSearch}
          sub={copy.pickerReferencesSub}
          title={copy.pickerReferencesTitle}
          users={users}
        />
      ) : null}

      {/* 건물 · 객실 태그 피커 — 공용 컨텍스트 피커를 재사용 (숙소/객실만). */}
      {ctxOpen ? (
        <ContextPickerSheet
          buildingLabels={buildingLabels}
          copy={pickerCopy}
          initialPropertyName={ctxInitialProperty}
          onClose={() => setCtxOpen(false)}
          onSelect={applyContext}
        />
      ) : null}
    </div>
  );
}
