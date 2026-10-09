"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Image as ImageIcon } from "lucide-react";
import { BoardFileCard, BoardFileAddButton } from "@/components/board/board-file-card";
import { BoardPinToggle } from "@/components/board/board-pin-toggle";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import {
  BOARD_MAX_FILES,
  BOARD_MAX_IMAGES,
  uploadBoardImage,
  uploadBoardAttachment,
  validateBoardFileList,
} from "@/lib/board";
import { updateBoardPost } from "../actions";
import type { FileAttachment } from "@/components/board/board-types";
import type { Dictionary } from "@/lib/i18n";

/**
 * 글 수정 폼 (Page 4).
 *
 * 작성 폼(`board-compose-client.tsx`)과 화면 구조를 의도적으로 맞춘다 — 같은 글을 다루는 두
 * 화면이 다르게 생기면 사용자가 «다른 기능»으로 읽는다. 다른 점은 두 가지뿐이다.
 *
 * 1. **이미 올라간 사진·첨부가 섞여 있다.** 기존 항목은 URL 이고 새 항목은 아직 업로드 전 `File`
 *    이다. 그래서 목록을 «기존/신규» 두 종류로 들고, 저장 시 신규만 업로드해 **남긴 기존 + 새로
 *    올린 것**을 최종 목록으로 보낸다. 지운 것은 목록에서 빠지므로 저장하면 사라진다.
 * 2. **고정 토글은 권한이 있을 때만 보인다.** 작성 경로가 owner/전무/office_admin 에게만 고정을
 *    허용하므로 수정도 같아야 한다(서버도 다시 검사한다).
 *
 * 스토리지 정리는 하지 않는다 — 사진을 지워도 버킷의 원본 파일은 남는다. 글 삭제도 같은 방식이라
 * 여기서만 다르게 하면 규약이 갈린다. 정리는 별도 작업으로 다뤄야 한다.
 */
type ExistingImage = { kind: "existing"; id: string; url: string };
type NewImage = { kind: "new"; id: string; file: File; preview: string };
type ImageItem = ExistingImage | NewImage;

type ExistingFile = { kind: "existing"; id: string; attachment: FileAttachment };
type NewFile = { kind: "new"; id: string; file: File };
type FileItem = ExistingFile | NewFile;

export function BoardEditClient({
  copy,
  orgId,
  postId,
  initial,
  canPin,
}: {
  copy: Dictionary["board"];
  orgId: string;
  postId: string;
  initial: {
    title: string | null;
    content: string;
    tags: string[];
    imageUrls: string[];
    fileAttachments: FileAttachment[];
    isPinned: boolean;
  };
  canPin: boolean;
}) {
  const router = useRouter();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(initial.title ?? "");
  const [content, setContent] = useState(initial.content);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [tagInput, setTagInput] = useState("");
  const [isPinned, setIsPinned] = useState(initial.isPinned);
  const [images, setImages] = useState<ImageItem[]>(() =>
    initial.imageUrls.map((url) => ({ kind: "existing", id: url, url })),
  );
  const [files, setFiles] = useState<FileItem[]>(() =>
    initial.fileAttachments.map((attachment, index) => ({
      kind: "existing",
      id: `${attachment.url}#${index}`,
      attachment,
    })),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = content.trim().length > 0 && !isSubmitting;

  // 미리보기 blob URL 은 신규 항목에만 있다. 화면을 떠날 때 회수한다.
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(
    () => () => {
      imagesRef.current.forEach((i) => {
        if (i.kind === "new") URL.revokeObjectURL(i.preview);
      });
    },
    [],
  );

  function removeImage(id: string) {
    setImages((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item?.kind === "new") URL.revokeObjectURL(item.preview);
      return prev.filter((i) => i.id !== id);
    });
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function addTag() {
    const t = tagInput.trim().replace(/^#+/, "");
    if (t && !tags.includes(t) && tags.length < 10) {
      setTags((prev) => [...prev, t]);
    }
    setTagInput("");
  }

  function removeTag(t: string) {
    setTags((prev) => prev.filter((x) => x !== t));
  }

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!selected.length) return;

    const remaining = BOARD_MAX_IMAGES - images.length;
    const toAdd = selected.slice(0, remaining);

    const newItems: NewImage[] = [];
    for (const file of toAdd) {
      if (!file.type.startsWith("image/")) continue;
      const compressed = await compressImageFile(file);
      const preview = URL.createObjectURL(compressed);
      newItems.push({ kind: "new", id: crypto.randomUUID(), file: compressed, preview });
    }
    setImages((prev) => [...prev, ...newItems]);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!selected.length) return;

    const remaining = BOARD_MAX_FILES - files.length;
    const toAdd = selected.slice(0, remaining);

    const validationError = validateBoardFileList(toAdd);
    if (validationError) {
      const msgMap: Record<string, keyof typeof copy> = {
        too_many_files: "errTooManyFiles",
        invalid_file_type: "errInvalidFileType",
        file_too_large: "errFileTooLarge",
      };
      const key = msgMap[validationError] ?? "errSaveFailed";
      setError(copy[key] as string);
      return;
    }

    setFiles((prev) => [
      ...prev,
      ...toAdd.map((file) => ({ kind: "new" as const, id: crypto.randomUUID(), file })),
    ]);
  }

  async function handleSubmit() {
    if (!canSave) return;
    setError(null);
    setIsSubmitting(true);

    // 남긴 기존 항목의 순서를 유지한 채, 신규만 업로드해 같은 자리에 채운다.
    const imageUrls: string[] = [];
    try {
      for (const img of images) {
        if (img.kind === "existing") imageUrls.push(img.url);
        else imageUrls.push(await uploadBoardImage({ file: img.file, organizationId: orgId, postId }));
      }
    } catch {
      setError(copy.errImageUploadFailed);
      setIsSubmitting(false);
      return;
    }

    const fileAttachments: FileAttachment[] = [];
    try {
      for (const f of files) {
        if (f.kind === "existing") fileAttachments.push(f.attachment);
        else
          fileAttachments.push(
            await uploadBoardAttachment({ file: f.file, organizationId: orgId, postId }),
          );
      }
    } catch {
      setError(copy.errFileUploadFailed);
      setIsSubmitting(false);
      return;
    }

    const result = await updateBoardPost(postId, {
      title: title.trim() || null,
      content: content.trim(),
      tags,
      imageUrls,
      fileAttachments,
      // 권한이 없으면 아예 보내지 않는다 — 서버가 «바뀌지 않은 값»도 거절하지 않도록.
      ...(canPin ? { isPinned } : {}),
    });

    if ("error" in result) {
      setError(copy.errSaveFailed);
      setIsSubmitting(false);
      return;
    }

    // 상세로 되돌린다. `replace` 라 뒤로가기가 수정 화면으로 되돌아오지 않는다.
    router.replace(`/mobile/board/${postId}`);
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* 헤더 */}
      <div className="flex h-[54px] shrink-0 items-center justify-between border-b border-border/60 pl-2 pr-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex size-10 items-center justify-center rounded-full text-[#3a3746]"
          aria-label={copy.close}
        >
          <X className="size-[22px]" aria-hidden="true" />
        </button>
        <span className="text-[16px] font-black tracking-[-0.02em]">{copy.editTitle}</span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSave}
          className="h-9 rounded-full bg-primary px-[18px] text-[13.5px] font-extrabold text-white shadow-[0_10px_18px_-10px_rgb(122_82_230/0.55)] disabled:cursor-not-allowed disabled:bg-[#f4f4f7] disabled:text-[#9a97a6] disabled:shadow-none"
        >
          {copy.submitEdit}
        </button>
      </div>

      {/* 에러 배너 */}
      {error && (
        <div className="shrink-0 border-b border-[hsl(6_70%_85%)] bg-[hsl(6_70%_97%)] px-[18px] py-[10px] text-[12.5px] font-semibold text-[#c5282e]">
          {error}
        </div>
      )}

      {/* 폼 바디 */}
      <div className="flex flex-1 flex-col overflow-y-auto px-[18px] py-[14px] pb-[16px]">
        <input
          type="text"
          placeholder={copy.titlePlaceholder}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border-0 border-b border-border bg-transparent pb-[11px] pt-1 text-[16px] font-extrabold tracking-[-0.01em] text-foreground outline-none placeholder:font-bold placeholder:text-[#9a97a6]"
        />

        <textarea
          placeholder={copy.contentPlaceholder}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          className="min-h-[96px] resize-none bg-transparent py-[14px] text-[13.5px] font-medium leading-[1.7] text-[#3a3746] outline-none placeholder:text-[#9a97a6]"
        />

        <div className="text-right text-[11px] font-bold text-[#9a97a6]">
          <span className="font-mono text-muted-foreground">{content.length}</span> / 1000
        </div>

        {/* 사진 */}
        <div className="mb-[9px] mt-[20px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          {copy.photoSection}
        </div>
        <div className="flex flex-wrap gap-[9px]">
          {images.map((img) => (
            <div key={img.id} className="relative size-[70px] overflow-hidden rounded-[10px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.kind === "existing" ? img.url : img.preview}
                alt=""
                className="size-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(img.id)}
                className="absolute -right-[6px] -top-[6px] inline-flex size-[21px] items-center justify-center rounded-full border-2 border-surface bg-foreground text-white"
                aria-label={copy.deletePhoto}
              >
                <X className="size-[11px]" aria-hidden="true" />
              </button>
            </div>
          ))}
          {images.length < BOARD_MAX_IMAGES ? (
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="inline-flex size-[70px] flex-col items-center justify-center gap-[3px] rounded-[10px] border-[1.5px] border-dashed border-border text-[10.5px] font-bold text-muted-foreground"
            >
              <ImageIcon className="size-[18px]" aria-hidden="true" />
              {copy.addPhoto}
            </button>
          ) : (
            <div className="inline-flex size-[70px] flex-col items-center justify-center gap-[3px] rounded-[10px] border border-border/60 bg-[#f4f4f7] text-[10.5px] font-bold text-[#9a97a6]">
              <ImageIcon className="size-[18px]" aria-hidden="true" />
              {copy.photoFull}
            </div>
          )}
        </div>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={handleImageSelect}
        />

        {/* 파일 첨부 */}
        <div className="mb-[9px] mt-[20px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          {copy.fileSection}
        </div>
        <div className="flex flex-col items-start gap-2">
          {files.map((f) => (
            <BoardFileCard
              key={f.id}
              name={f.kind === "existing" ? f.attachment.name : f.file.name}
              sizeBytes={f.kind === "existing" ? f.attachment.sizeBytes : f.file.size}
              mimeType={f.kind === "existing" ? f.attachment.mimeType : f.file.type}
              onRemove={() => removeFile(f.id)}
            />
          ))}
          {files.length < BOARD_MAX_FILES && (
            <BoardFileAddButton
              label={copy.fileAddButton}
              onClick={() => fileInputRef.current?.click()}
            />
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.pptx,.ppt"
          multiple
          className="sr-only"
          onChange={handleFileSelect}
        />

        {/* 태그 */}
        <div className="mb-[9px] mt-[20px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          {copy.tagSection}
        </div>
        <div className="flex flex-wrap items-center gap-[7px]">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex h-[30px] items-center gap-[6px] rounded-full bg-primary/[0.09] pl-3 pr-[6px] text-[12.5px] font-extrabold text-primary"
            >
              #{t}
              <button
                type="button"
                onClick={() => removeTag(t)}
                className="inline-flex size-[18px] items-center justify-center rounded-full bg-primary/[0.16] text-primary"
                aria-label={copy.tagRemoveAriaLabel.replace("{tag}", t)}
              >
                <X className="size-[10px]" aria-hidden="true" />
              </button>
            </span>
          ))}
          <div className="inline-flex h-[30px] min-w-[90px] items-center">
            <div className="flex h-[30px] items-center rounded-full border border-transparent px-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  // 작성 폼과 동일 — IME 조합 중(한글·일본어)의 Enter/Space 는 태그를 끊지 않는다.
                  if (
                    (e.key === "Enter" || e.key === " ") &&
                    !e.nativeEvent.isComposing &&
                    tagInput.trim()
                  ) {
                    addTag();
                    e.preventDefault();
                  }
                }}
                onBlur={() => {
                  if (tagInput.trim()) addTag();
                }}
                placeholder={copy.tagPlaceholder}
                className="w-full bg-transparent text-[12.5px] font-bold outline-none placeholder:text-[#9a97a6]"
              />
            </div>
          </div>
        </div>

        {/* 고정 토글 — 권한 있는 사람에게만. 없는 사람에게 비활성 토글을 보여 주면 «고장»으로 읽힌다. */}
        {canPin && (
          <BoardPinToggle
            checked={isPinned}
            onChange={setIsPinned}
            title={copy.pinTitle}
            subtitle={copy.pinSubtitle}
          />
        )}

        <div className="h-[22px]" />
      </div>
    </div>
  );
}
