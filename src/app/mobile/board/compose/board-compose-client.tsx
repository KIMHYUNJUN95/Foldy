"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BoardFileCard } from "@/components/board/board-file-card";
import { BoardPinToggle } from "@/components/board/board-pin-toggle";
import { BoardAttachSection, BoardPostForm, BoardTagPicker } from "@/components/board/board-post-form";
import { haptic } from "@/lib/haptics";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import {
  BOARD_MAX_FILES,
  BOARD_MAX_IMAGES,
  uploadBoardImage,
  uploadBoardAttachment,
  validateBoardFileList,
} from "@/lib/board";
import { createBoardPost } from "./actions";
import type { Dictionary } from "@/lib/i18n";

type ImageItem = { id: string; file: File; preview: string };
type FileItem = { id: string; file: File; name: string; sizeBytes: number; mimeType: string };

/**
 * 글쓰기 — 화이트 리디자인(2026-10-15, 시안 BoardNew-Phone). 셸 안 한 장 폼: 「글쓰기」 + 「전 직원에게 보여요」 · 이름표 칸
 * (제목 선택 · 본문) · 사진 · 파일 · 태그(쓰던 태그를 눌러 고름 + 새 태그) · 맨 위 고정(권한 있는 사람만) · 큰 보라 「올리기」.
 */
export function BoardComposeClient({
  copy,
  orgId,
  canPin,
  tagSuggestions,
}: {
  copy: Dictionary["board"];
  orgId: string;
  /** 작성 경로(`createBoardPost`)와 같은 고정 권한 — 없으면 스위치를 그리지 않는다(서버도 다시 막는다). */
  canPin: boolean;
  tagSuggestions: string[];
}) {
  const router = useRouter();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isPinned, setIsPinned] = useState(false);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPost = content.trim().length > 0 && !isSubmitting;
  const maxImages = BOARD_MAX_IMAGES;

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

  function addTag(t: string) {
    setTags((prev) => (t && !prev.includes(t) && prev.length < 10 ? [...prev, t] : prev));
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
      haptic("error");
      setError(copy.errSaveFailed);
      setIsSubmitting(false);
      return;
    }

    haptic("success");
    router.replace(`/mobile/board/${result.id}`);
  }

  return (
    <BoardPostForm
      canSubmit={canPost}
      content={content}
      copy={copy}
      error={error}
      heading={copy.composeTitle}
      onContent={setContent}
      onSubmit={handleSubmit}
      onTitle={setTitle}
      submitLabel={copy.postSubmit}
      title={title}
    >
      <BoardAttachSection
        canAddFile={files.length < BOARD_MAX_FILES}
        copy={copy}
        maxFiles={BOARD_MAX_FILES}
        maxPhotos={maxImages}
        onAddFile={() => fileInputRef.current?.click()}
        onAddPhoto={() => imageInputRef.current?.click()}
        onRemovePhoto={removeImage}
        photos={images.map((img) => ({ id: img.id, src: img.preview }))}
      >
        {files.map((f) => (
          <BoardFileCard
            key={f.id}
            mimeType={f.mimeType}
            name={f.name}
            onRemove={() => removeFile(f.id)}
            removeLabel={copy.fileRemove}
            sizeBytes={f.sizeBytes}
          />
        ))}
      </BoardAttachSection>
      <input accept="image/*" className="sr-only" multiple onChange={handleImageSelect} ref={imageInputRef} type="file" />
      <input
        accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.pptx,.ppt"
        className="sr-only"
        multiple
        onChange={handleFileSelect}
        ref={fileInputRef}
        type="file"
      />

      <BoardTagPicker copy={copy} onAdd={addTag} onRemove={removeTag} selected={tags} suggestions={tagSuggestions} />

      {canPin ? (
        <BoardPinToggle checked={isPinned} onChange={setIsPinned} subtitle={copy.pinRowSub} title={copy.pinRowTitle} />
      ) : null}
    </BoardPostForm>
  );
}
