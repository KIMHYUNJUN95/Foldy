"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Camera, Send, X } from "lucide-react";
import { BoardAvatar } from "@/components/board/board-avatar";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import { uploadBoardImage } from "@/lib/board";
import { cn } from "@/lib/utils";
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

export function BoardComposer({
  postId,
  organizationId,
  myInitial,
  disabled = false,
  copy,
  // 멘션 상태 (부모 board-detail-client가 관리)
  mentionedUsers = [],
  mentionAll = false,
  onOpenMentionSheet,
  onClearMentions,
  onSubmit,
}: {
  postId: string;
  organizationId: string;
  myInitial: string;
  disabled?: boolean;
  copy: Pick<
    Dictionary["board"],
    | "commentPlaceholder"
    | "commentAttachPhoto"
    | "commentSend"
    | "commentsDisabled"
    | "commentTooManyPhotos"
    | "errImageUploadFailed"
    | "errSaveFailed"
    | "mentionAll"
    | "mentionButtonAriaLabel"
    | "mentionClearAriaLabel"
  >;
  mentionedUsers?: MentionableMember[];
  mentionAll?: boolean;
  // @ 아이콘 탭 → 부모에게 멘션 시트 열기 요청
  onOpenMentionSheet?: () => void;
  // 멘션 배지의 X 탭 → 현재 선택을 모두 비움
  onClearMentions?: () => void;
  // 이미지 업로드 완료 후 최종 페이로드를 부모로 전달 (서버 액션 호출은 부모 담당)
  onSubmit?: (payload: ComposerSubmitPayload) => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [photos, setPhotos] = useState<Preview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Revoke any outstanding preview object URLs on unmount (e.g. navigating away with photos attached).
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

  // Comment text is required (the DB CHECK forbids empty content); photos are an optional supplement.
  const canSend = value.trim().length > 0 && !isPending;

  if (disabled) {
    return (
      <div className="shrink-0 border-t border-border bg-background px-[14px] py-[14px] pb-[calc(14px+env(safe-area-inset-bottom,0px))] text-center text-[12.5px] font-semibold text-muted-foreground">
        {copy.commentsDisabled}
      </div>
    );
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
          photos.map((p) =>
            uploadBoardImage({
              file: p.file,
              organizationId,
              postId,
              folder: "board-comments",
            }),
          ),
        );
      } catch {
        setError(copy.errImageUploadFailed);
        return;
      }

      if (onSubmit) {
        // 부모(board-detail-client)가 서버 액션 호출을 담당
        onSubmit({ content: value.trim(), imageUrls, mentionedUsers, mentionAll });
      } else {
        // fallback: 멘션 없이 직접 호출 (하위 호환)
        const { addBoardComment } = await import("@/app/mobile/board/[id]/actions");
        const result = await addBoardComment(postId, value.trim(), imageUrls);
        if ("error" in result) {
          setError(copy.errSaveFailed);
          return;
        }
        router.refresh();
      }

      photos.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]);
      setValue("");
    });
  }

  // 멘션 배지 표시 텍스트 (시트 열기 전 현재 선택 요약)
  const mentionBadgeLabel =
    mentionAll
      ? `@${copy.mentionAll}`
      : mentionedUsers.length > 0
        ? `@${mentionedUsers.map((u) => u.name).join(" @")}`
        : null;

  return (
    <div className="shrink-0 border-t border-border bg-background px-[14px] py-[11px] pb-[calc(11px+env(safe-area-inset-bottom,0px))]">
      {error && (
        <div className="mb-[8px] text-[11.5px] font-semibold text-[#c5282e]">{error}</div>
      )}

      {/* 선택된 멘션 배지 미리보기 — 텍스트는 시트 재오픈, X는 멘션 초기화 */}
      {mentionBadgeLabel && (
        <div className="mb-[8px] inline-flex items-center gap-[5px] rounded-full bg-primary/[0.09] pl-[10px] pr-[4px] py-[3px] text-[12px] font-bold text-primary">
          <button
            type="button"
            onClick={onOpenMentionSheet}
            className="leading-none"
          >
            {mentionBadgeLabel}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClearMentions?.();
            }}
            aria-label={copy.mentionClearAriaLabel}
            className="inline-flex size-[18px] items-center justify-center rounded-full bg-primary/[0.16] text-primary"
          >
            <X className="size-[11px]" aria-hidden="true" />
          </button>
        </div>
      )}

      {photos.length > 0 && (
        <div className="mb-[9px] flex gap-[8px]">
          {photos.map((p) => (
            <div key={p.id} className="relative size-[54px] overflow-hidden rounded-[9px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="size-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(p.id)}
                className="absolute -right-[5px] -top-[5px] inline-flex size-[18px] items-center justify-center rounded-full border-2 border-background bg-foreground text-white"
                aria-label={copy.commentAttachPhoto}
              >
                <X className="size-[9px]" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-[9px]">
        <BoardAvatar initial={myInitial} size={32} />
        <div
          className={cn(
            "flex flex-1 items-center gap-2 h-[42px] rounded-full border bg-surface pl-[14px] pr-[6px]",
            focused
              ? "border-primary shadow-[0_0_0_3px_rgb(122_82_230/0.12)]"
              : "border-border",
          )}
        >
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              // Ignore Enter while an IME composition is active (KO/JA) so confirming a candidate
              // doesn't submit a half-composed comment.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={copy.commentPlaceholder}
            // The square outline came from globals.css `:focus-visible { outline: 2px solid ... }`,
            // which is UNLAYERED and therefore beats Tailwind's layered `focus-visible:outline-none`
            // utility (text inputs match :focus-visible even on touch). An inline `outline: none`
            // beats any stylesheet rule (no !important on the global), so it reliably kills it.
            // appearance-none also removes the native mobile form-field chrome.
            style={{
              outline: "none",
              WebkitAppearance: "none",
              MozAppearance: "none",
              appearance: "none",
              borderRadius: 0,
              WebkitTapHighlightColor: "transparent",
            }}
            className="flex-1 bg-transparent text-[13px] font-medium text-foreground outline-none focus:outline-none focus-visible:outline-none placeholder:text-[#9a97a6]"
          />
          {/* @ 멘션 트리거 버튼 */}
          {onOpenMentionSheet && (
            <button
              type="button"
              onClick={onOpenMentionSheet}
              className={cn(
                "inline-flex size-[30px] shrink-0 items-center justify-center rounded-full disabled:opacity-40",
                (mentionAll || mentionedUsers.length > 0)
                  ? "text-primary"
                  : "text-muted-foreground",
              )}
              aria-label={copy.mentionButtonAriaLabel}
            >
              <AtSign className="size-[17px]" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={photos.length >= MAX_PHOTOS || isPending}
            className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full text-muted-foreground disabled:opacity-40"
            aria-label={copy.commentAttachPhoto}
          >
            <Camera className="size-[19px]" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label={copy.commentSend}
          className="inline-flex size-[42px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8a63f0] to-[#5a30cf] text-white shadow-[0_10px_20px_-10px_rgb(122_82_230/0.6)] disabled:opacity-50"
        >
          <Send className="size-[19px]" aria-hidden="true" />
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={onPickFiles}
      />
    </div>
  );
}
