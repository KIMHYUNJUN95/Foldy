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
  tagSuggestions,
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
  tagSuggestions: string[];
}) {
  const router = useRouter();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(initial.title ?? "");
  const [content, setContent] = useState(initial.content);
  const [tags, setTags] = useState<string[]>(initial.tags);
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
      haptic("error");
      setError(copy.errSaveFailed);
      setIsSubmitting(false);
      return;
    }
    haptic("success");

    // 상세로 되돌린다. `replace` 라 뒤로가기가 수정 화면으로 되돌아오지 않는다.
    router.replace(`/mobile/board/${postId}`);
  }

  return (
    <BoardPostForm
      canSubmit={canSave}
      content={content}
      copy={copy}
      error={error}
      heading={copy.editTitle}
      onContent={setContent}
      onSubmit={handleSubmit}
      onTitle={setTitle}
      submitLabel={copy.submitEdit}
      title={title}
    >
      <BoardAttachSection
        canAddFile={files.length < BOARD_MAX_FILES}
        copy={copy}
        maxFiles={BOARD_MAX_FILES}
        maxPhotos={BOARD_MAX_IMAGES}
        onAddFile={() => fileInputRef.current?.click()}
        onAddPhoto={() => imageInputRef.current?.click()}
        onRemovePhoto={removeImage}
        photos={images.map((img) => ({ id: img.id, src: img.kind === "existing" ? img.url : img.preview }))}
      >
        {files.map((f) => (
          <BoardFileCard
            key={f.id}
            mimeType={f.kind === "existing" ? f.attachment.mimeType : f.file.type}
            name={f.kind === "existing" ? f.attachment.name : f.file.name}
            onRemove={() => removeFile(f.id)}
            removeLabel={copy.fileRemove}
            sizeBytes={f.kind === "existing" ? f.attachment.sizeBytes : f.file.size}
          />
        ))}
      </BoardAttachSection>
      <input accept="image/*" aria-hidden="true" className="sr-only" multiple onChange={handleImageSelect} ref={imageInputRef} tabIndex={-1} type="file" />
      <input
        accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.pptx,.ppt"
        aria-hidden="true"
        className="sr-only"
        multiple
        onChange={handleFileSelect}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <BoardTagPicker copy={copy} onAdd={addTag} onRemove={removeTag} selected={tags} suggestions={tagSuggestions} />

      {/* 고정 스위치 — 권한 있는 사람에게만. 없는 사람에게 꺼진 스위치를 보여 주면 «고장»으로 읽힌다. */}
      {canPin ? (
        <BoardPinToggle checked={isPinned} onChange={setIsPinned} subtitle={copy.pinRowSub} title={copy.pinRowTitle} />
      ) : null}
    </BoardPostForm>
  );
}
