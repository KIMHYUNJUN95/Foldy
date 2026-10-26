"use client";

/**
 * Frame 2 — Staff Suggestions compose (의견 작성).
 * Feedback Box.html 핸드오프의 `frameCompose()` 시각 이식:
 * 받는 사람(필수) · 참조(선택) · 제목 · 본문 · 분류 ·
 * 건물/객실 태그 · 사진 최대 5장.
 *
 * Step 2 (2026-06-16): 실제 생성 흐름에 연결. 시각 구조/`.sg` 클래스는 유지하고,
 * 필드는 이제 제어 입력이며, 구성원 피커는 데이터 기반(받는 사람 단일 / 참조
 * 다중), 건물·객실은 공용 `ContextPickerSheet` 를 재사용하고, 사진은 공용
 * `uploadRequestImages` + `compressImageFile` 을 재사용하며, 제출은 `createStaffSuggestion` 을 호출한다.
 * 참고: docs/product/22-staff-suggestions-workflow.md.
 */

import { useRef, useState, useTransition } from "react";
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
import "./suggestions.css";
import { Ic, SgIcon } from "./sg-icons";
import { SuggestionsUserPicker } from "./suggestions-user-picker";
import { useBuildingName } from "@/components/shared/building-names";

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

  const [error, setError] = useState<string | null>(
    serverError
      ? copy.errors[serverError as keyof typeof copy.errors] ?? copy.errors.save_failed
      : null,
  );
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const roleLabel = (role: string) => roleLabels[role] ?? role;

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (selected.length === 0) return;
    if (selected.some((f) => !ALLOWED_TYPES.includes(f.type))) return;
    if (selected.some((f) => f.size > MAX_BYTES)) return;
    if (existingImages.length + photos.length + selected.length > MAX_PHOTOS) {
      setError(copy.errors.too_many_photos);
      return;
    }
    setError(null);
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
    if (!recipient) {
      setError(copy.errors.missing_recipient);
      return;
    }
    if (!title.trim()) {
      setError(copy.errors.missing_title);
      return;
    }
    if (!body.trim()) {
      setError(copy.errors.missing_body);
      return;
    }
    setError(null);

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
          setError(copy.errors.upload_failed);
          return;
        }
      }

      if (isEdit) {
        fd.set("suggestionId", editId as string);
        await updateStaffSuggestion(fd);
      } else {
        await createStaffSuggestion(fd);
      }
    });
  }

  return (
    <div className="sg">
      <div className="scroll">
        <div className="ctxbar">
          <span className="ctxbar__name">{isEdit ? copy.editTitle : copy.composeTitle}</span>
          <button
            type="button"
            className="ctxbar__save"
            onClick={submit}
            disabled={isPending}
            style={isPending ? { opacity: 0.6 } : undefined}
          >
            {copy.send}
          </button>
        </div>

        {error ? (
          <p
            role="alert"
            style={{
              margin: "0 0 10px",
              padding: "10px 12px",
              borderRadius: "12px",
              background: "rgba(192,57,43,0.08)",
              color: "#c0392b",
              fontSize: "13px",
              fontWeight: 700,
            }}
          >
            {error}
          </p>
        ) : null}

        <div className="field">
          <div className="field__l">
            {copy.fieldRecipient} <span className="req">*</span>
          </div>
          {recipient ? (
            <div className="recip">
              <span className="recip__av">{recipient.name.slice(0, 1)}</span>
              <div className="recip__b">
                <div className="recip__n">{recipient.name}</div>
                <div className="recip__r">{roleLabel(recipient.role)}</div>
              </div>
              <button type="button" className="recip__chg" onClick={() => setPickerMode("recipient")}>
                {copy.change}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="recip"
              style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
              onClick={() => setPickerMode("recipient")}
            >
              <span className="recip__av">＋</span>
              <div className="recip__b">
                <div className="recip__n">{copy.recipientPickName}</div>
                <div className="recip__r">{copy.recipientPickSub}</div>
              </div>
            </button>
          )}
        </div>

        <div className="field">
          <div className="field__l">
            {copy.fieldReferences} <span className="opt">{copy.fieldReferencesHint}</span>
          </div>
          <div className="ref-chips">
            {references.map((r) => (
              <span className="ref-chip" key={r.id}>
                <span className="av av--p">{r.name.slice(0, 1)}</span>
                {r.name}
                <span
                  className="ic"
                  role="button"
                  onClick={() => setReferences((prev) => prev.filter((x) => x.id !== r.id))}
                >
                  {SgIcon.x}
                </span>
              </span>
            ))}
            <button type="button" className="ref-add" onClick={() => setPickerMode("references")}>
              <Ic>{SgIcon.plus}</Ic>{copy.add}
            </button>
          </div>
        </div>

        <div className="field">
          <div className="field__l">
            {copy.fieldTitle} <span className="req">*</span>
          </div>
          <input
            className="inp inp--title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={copy.placeholderTitle}
          />
        </div>

        <div className="field">
          <div className="field__l">
            {copy.fieldBody} <span className="req">*</span>
          </div>
          <textarea
            className="inp"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={copy.placeholderBody}
          />
        </div>

        <div className="field">
          <div className="field__l">
            {copy.fieldCategory} <span className="opt">{copy.fieldCategoryHint}</span>
          </div>
          <input
            className="inp inp--title"
            style={{ height: "44px", fontSize: "14px" }}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={copy.placeholderCategory}
          />
        </div>

        <div className="field">
          <div className="field__l">
            {copy.fieldTags} <span className="opt">{copy.fieldTagsHint}</span>
          </div>
          <div className="tags-row">
            <button type="button" className="tagbtn" onClick={() => { setCtxInitialProperty(undefined); setCtxOpen(true); }}>
              <Ic>{SgIcon.building}</Ic>{copy.tagBuilding}
              <span className="v">{ctx?.propertyName ? bName(ctx.propertyName) : copy.tagSelect}</span>
            </button>
            <button type="button" className="tagbtn" onClick={() => { setCtxInitialProperty(ctx?.propertyName ?? undefined); setCtxOpen(true); }}>
              <Ic>{SgIcon.door}</Ic>{copy.tagRoom}
              <span className="v">{ctx?.roomLabel ? (ctx.roomLabel === ctx.propertyName ? bName(ctx.roomLabel) : ctx.roomLabel) : copy.tagSelect}</span>
            </button>
            {ctx ? (
              <button
                type="button"
                className="ref-add"
                onClick={() => setCtx(null)}
              >
                <Ic>{SgIcon.x}</Ic>{copy.tagClear}
              </button>
            ) : null}
          </div>
        </div>

        <div className="field">
          <div className="field__l">
            {copy.fieldPhotos} <span className="opt">{copy.fieldPhotosHint}</span>
          </div>
          <div className="photos">
            {existingImages.map((url) => (
              <div
                className="photo-thumb"
                key={url}
                style={{
                  backgroundImage: `url(${url})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              >
                <span
                  className="x"
                  role="button"
                  onClick={() => setExistingImages((prev) => prev.filter((u) => u !== url))}
                >
                  {SgIcon.x}
                </span>
              </div>
            ))}
            {photos.map((p) => (
              <div
                className="photo-thumb"
                key={p.id}
                style={{
                  backgroundImage: `url(${p.previewUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              >
                <span className="x" role="button" onClick={() => removePhoto(p.id)}>
                  {SgIcon.x}
                </span>
              </div>
            ))}
            {existingImages.length + photos.length < MAX_PHOTOS ? (
              <button type="button" className="photo-add" onClick={() => fileRef.current?.click()}>
                <Ic>{SgIcon.image}</Ic>
                <span>{copy.add}</span>
              </button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/gif,image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            style={{ display: "none" }}
            onChange={onPickFiles}
          />
        </div>
        <div style={{ height: "10px" }} />
      </div>

      {/* 구성원 피커 — 받는 사람(단일) / 참조(다중) */}
      <SuggestionsUserPicker
        open={pickerMode === "recipient"}
        onClose={() => setPickerMode(null)}
        mode="single"
        users={users}
        roleLabel={roleLabel}
        groupLabel={copy.pickerGroup}
        title={copy.pickerRecipientTitle}
        sub={copy.pickerRecipientSub}
        searchPlaceholder={copy.pickerSearch}
        emptyLabel={copy.pickerEmpty}
        confirmSingle={copy.pickerConfirmSingle}
        confirmMulti={copy.pickerConfirmMulti}
        confirmEmpty={copy.pickerConfirm}
        initialSelectedIds={recipient ? [recipient.id] : []}
        onConfirm={(ids) => setRecipient(users.find((u) => u.id === ids[0]) ?? null)}
      />
      <SuggestionsUserPicker
        open={pickerMode === "references"}
        onClose={() => setPickerMode(null)}
        mode="multi"
        users={users}
        roleLabel={roleLabel}
        groupLabel={copy.pickerGroup}
        title={copy.pickerReferencesTitle}
        sub={copy.pickerReferencesSub}
        searchPlaceholder={copy.pickerSearch}
        emptyLabel={copy.pickerEmpty}
        confirmSingle={copy.pickerConfirmSingle}
        confirmMulti={copy.pickerConfirmMulti}
        confirmEmpty={copy.pickerConfirm}
        initialSelectedIds={references.map((r) => r.id)}
        excludeIds={recipient ? [recipient.id] : []}
        onConfirm={(ids) =>
          setReferences(users.filter((u) => ids.includes(u.id) && u.id !== recipient?.id))
        }
      />

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
