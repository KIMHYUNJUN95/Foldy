"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowRight, Camera, X } from "lucide-react";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import { uploadBoardImage } from "@/lib/board";
import type { Dictionary } from "@/lib/i18n";
import type { MentionableMember } from "@/components/board/board-mention-sheet";

const MAX_PHOTOS = 3;

type Preview = { id: string; file: File; url: string };

export type ComposerSubmitPayload = {
  content: string;
  imageUrls: string[];
  mentionedUsers: MentionableMember[];
  mentionAll: boolean;
};

/**
 * 댓글 입력 — 화이트 리디자인(2026-10-15, 시안 BoardPost-Phone): 회색 알약 입력 · 회색 카메라 동그라미 · 보라 보내기 동그라미(46px).
 * 화면 아래에 붙는다(`.bdw-cmp` sticky). 멘션은 입력칸에 「@」 를 치면 멘션 시트가 열린다(친 「@」 는 지운다) — 예전의 따로 둔
 * @ 버튼 자리를 시안대로 비웠다. 고른 사람은 입력칸 위 보라 알약으로 보이고, 누르면 다시 고르고 ✕ 로 비운다.
 */
export function BoardComposer({
  postId,
  organizationId,
  disabled = false,
  copy,
  mentionedUsers = [],
  mentionAll = false,
  onOpenMentionSheet,
  onClearMentions,
  onSubmit,
}: {
  postId: string;
  organizationId: string;
  disabled?: boolean;
  copy: Pick<
    Dictionary["board"],
    | "commentHint"
    | "commentAttachPhoto"
    | "commentSend"
    | "commentsDisabled"
    | "commentTooManyPhotos"
    | "errImageUploadFailed"
    | "errSaveFailed"
    | "mentionAll"
    | "mentionClearAriaLabel"
    | "deletePhoto"
  >;
  mentionedUsers?: MentionableMember[];
  mentionAll?: boolean;
  onOpenMentionSheet?: () => void;
  onClearMentions?: () => void;
  // 사진 업로드가 끝난 최종 내용을 부모로(서버 액션 호출은 부모 담당)
  onSubmit?: (payload: ComposerSubmitPayload) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [photos, setPhotos] = useState<Preview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 화면을 떠날 때 남은 미리보기 blob URL 회수.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(
    () => () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    },
    [],
  );

  // 댓글 글은 꼭 있어야 한다(DB CHECK 가 빈 내용을 막는다). 사진은 덧붙임.
  const canSend = value.trim().length > 0 && !isPending;

  if (disabled) {
    return (
      <div className="bdw-cmp">
        <p className="bdw-cmp__off">{copy.commentsDisabled}</p>
      </div>
    );
  }

  function onChangeText(next: string) {
    // 방금 「@」 하나를 쳤으면 그 글자는 지우고 멘션 시트를 연다.
    if (onOpenMentionSheet && next.length === value.length + 1 && next.endsWith("@")) {
      setValue(next.slice(0, -1));
      onOpenMentionSheet();
      return;
    }
    setValue(next);
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (selected.length === 0) return;
    if (photos.length + selected.length > MAX_PHOTOS) {
      setError(copy.commentTooManyPhotos);
      return;
    }
    setError(null);
    const items: Preview[] = [];
    for (const file of selected) {
      if (!file.type.startsWith("image/")) continue;
      const compressed = await compressImageFile(file);
      items.push({ id: crypto.randomUUID(), file: compressed, url: URL.createObjectURL(compressed) });
    }
    setPhotos((prev) => [...prev, ...items]);
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  function send() {
    if (!canSend) return;
    setError(null);
    startTransition(async () => {
      let imageUrls: string[] = [];
      try {
        imageUrls = await Promise.all(
          photos.map((p) => uploadBoardImage({ file: p.file, organizationId, postId, folder: "board-comments" })),
        );
      } catch {
        setError(copy.errImageUploadFailed);
        return;
      }

      if (onSubmit) {
        onSubmit({ content: value.trim(), imageUrls, mentionedUsers, mentionAll });
      } else {
        const { addBoardComment } = await import("@/app/mobile/board/[id]/actions");
        const result = await addBoardComment(postId, value.trim(), imageUrls);
        if ("error" in result) {
          setError(copy.errSaveFailed);
          return;
        }
      }

      photos.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]);
      setValue("");
    });
  }

  const mentionBadgeLabel = mentionAll
    ? `@${copy.mentionAll}`
    : mentionedUsers.length > 0
      ? `@${mentionedUsers.map((u) => u.name).join(" @")}`
      : null;

  return (
    <div className="bdw-cmp">
      {error ? <p className="bdw-cmp__err">{error}</p> : null}

      {mentionBadgeLabel ? (
        <div className="bdw-cmp__mention">
          <button onClick={onOpenMentionSheet} type="button">
            {mentionBadgeLabel}
          </button>
          <button
            aria-label={copy.mentionClearAriaLabel}
            onClick={(e) => {
              e.stopPropagation();
              onClearMentions?.();
            }}
            type="button"
          >
            <X aria-hidden="true" strokeWidth={2.2} />
          </button>
        </div>
      ) : null}

      {photos.length > 0 ? (
        <div className="bdw-cmp__pics">
          {photos.map((p) => (
            <div className="bdw-cmp__pic" key={p.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" src={p.url} />
              <button aria-label={copy.deletePhoto} onClick={() => removePhoto(p.id)} type="button">
                <X aria-hidden="true" strokeWidth={2.4} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="bdw-cmp__row">
        <label className="bdw-cmp__in">
          <input
            aria-label={copy.commentHint}
            enterKeyHint="send"
            onChange={(e) => onChangeText(e.target.value)}
            onKeyDown={(e) => {
              // 한글 · 일본어 조합 중의 Enter 는 보내지 않는다(후보 확정용).
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={copy.commentHint}
            type="text"
            value={value}
          />
        </label>
        <button
          aria-label={copy.commentAttachPhoto}
          className="bdw-cmp__btn"
          disabled={photos.length >= MAX_PHOTOS || isPending}
          onClick={() => fileRef.current?.click()}
          type="button"
        >
          <Camera aria-hidden="true" strokeWidth={1.7} />
        </button>
        <button aria-label={copy.commentSend} className="bdw-cmp__btn is-send" disabled={!canSend} onClick={send} type="button">
          <ArrowRight aria-hidden="true" strokeWidth={2} />
        </button>
      </div>
      <input accept="image/*" className="sr-only" multiple onChange={onPickFiles} ref={fileRef} type="file" />
    </div>
  );
}
