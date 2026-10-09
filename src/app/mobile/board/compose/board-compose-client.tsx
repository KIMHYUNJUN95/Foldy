"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Image as ImageIcon } from "lucide-react";
import { BoardFileCard, BoardFileAddButton } from "@/components/board/board-file-card";
import { BoardPinToggle } from "@/components/board/board-pin-toggle";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import { uploadBoardImage, uploadBoardAttachment, validateBoardFileList } from "@/lib/board";
import { createBoardPost } from "./actions";
import type { Dictionary } from "@/lib/i18n";

type ImageItem = { id: string; file: File; preview: string };
type FileItem = { id: string; file: File; name: string; sizeBytes: number; mimeType: string };

export function BoardComposeClient({
  copy,
  orgId,
}: {
  copy: Dictionary["board"];
  orgId: string;
}) {
  const router = useRouter();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPost = content.trim().length > 0 && !isSubmitting;
  const maxImages = 5;

  // Revoke any outstanding preview object URLs on unmount (e.g. back/cancel or after publish navigates
  // away) so the blob previews aren't leaked.
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(
    () => () => {
      imagesRef.current.forEach((i) => URL.revokeObjectURL(i.preview));
    },
    [],
  );

  function removeImage(id: string) {
    setImages((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item) URL.revokeObjectURL(item.preview);
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

    const remaining = maxImages - images.length;
    const toAdd = selected.slice(0, remaining);

    const newItems: ImageItem[] = [];
    for (const file of toAdd) {
      if (!file.type.startsWith("image/")) continue;
      const compressed = await compressImageFile(file);
      const preview = URL.createObjectURL(compressed);
      newItems.push({ id: crypto.randomUUID(), file: compressed, preview });
    }
    setImages((prev) => [...prev, ...newItems]);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!selected.length) return;

    const remaining = 5 - files.length;
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
      ...toAdd.map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type,
      })),
    ]);
  }

  async function handleSubmit() {
    if (!canPost) return;
    setError(null);
    setIsSubmitting(true);

    const postId = crypto.randomUUID();

    const imageUrls: string[] = [];
    try {
      for (const img of images) {
        const url = await uploadBoardImage({ file: img.file, organizationId: orgId, postId });
        imageUrls.push(url);
      }
    } catch {
      setError(copy.errImageUploadFailed);
      setIsSubmitting(false);
      return;
    }

    const fileAttachments = [];
    try {
      for (const f of files) {
        const att = await uploadBoardAttachment({ file: f.file, organizationId: orgId, postId });
        fileAttachments.push(att);
      }
    } catch {
      setError(copy.errFileUploadFailed);
      setIsSubmitting(false);
      return;
    }

    const result = await createBoardPost({
      id: postId,
      title: title.trim() || null,
      content: content.trim(),
      tags,
      imageUrls,
      fileAttachments,
      isPinned,
      allowComments: true,
    });

    if ("error" in result) {
      setError(copy.errSaveFailed);
      setIsSubmitting(false);
      return;
    }

    router.replace(`/mobile/board/${result.id}`);
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
        <span className="text-[16px] font-black tracking-[-0.02em]">{copy.composeTitle}</span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canPost}
          className="h-9 rounded-full bg-primary px-[18px] text-[13.5px] font-extrabold text-white shadow-[0_10px_18px_-10px_rgb(122_82_230/0.55)] disabled:cursor-not-allowed disabled:bg-[#f4f4f7] disabled:text-[#9a97a6] disabled:shadow-none"
        >
          {copy.publish}
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
        {/* 제목 */}
        <input
          type="text"
          placeholder={copy.titlePlaceholder}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border-0 border-b border-border bg-transparent pb-[11px] pt-1 text-[16px] font-extrabold tracking-[-0.01em] text-foreground outline-none placeholder:font-bold placeholder:text-[#9a97a6]"
        />

        {/* 본문 */}
        <textarea
          placeholder={copy.contentPlaceholder}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          className="min-h-[96px] resize-none bg-transparent py-[14px] text-[13.5px] font-medium leading-[1.7] text-[#3a3746] outline-none placeholder:text-[#9a97a6]"
        />

        {/* 글자수 */}
        <div className="text-right text-[11px] font-bold text-[#9a97a6]">
          <span className="font-mono text-muted-foreground">{content.length}</span> / 1000
        </div>

        {/* 사진 섹션 */}
        <div className="mb-[9px] mt-[20px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          {copy.photoSection}
        </div>
        <div className="flex flex-wrap gap-[9px]">
          {images.map((img) => (
            <div key={img.id} className="relative size-[70px] overflow-hidden rounded-[10px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.preview} alt="" className="size-full object-cover" />
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
          {images.length < maxImages ? (
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

        {/* 파일 첨부 섹션 */}
        <div className="mb-[9px] mt-[20px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          {copy.fileSection}
        </div>
        <div className="flex flex-col items-start gap-2">
          {files.map((f) => (
            <BoardFileCard
              key={f.id}
              name={f.name}
              sizeBytes={f.sizeBytes}
              mimeType={f.mimeType}
              onRemove={() => removeFile(f.id)}
            />
          ))}
          {files.length < 5 && (
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

        {/* 태그 섹션 */}
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
                  // Skip while an IME composition is active (KO/JA) so confirming a candidate with
                  // Enter/Space doesn't prematurely commit a half-composed tag.
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

        {/* 고정 토글 */}
        <BoardPinToggle
          checked={isPinned}
          onChange={setIsPinned}
          title={copy.pinTitle}
          subtitle={copy.pinSubtitle}
        />

        <div className="h-[22px]" />
      </div>
    </div>
  );
}
