"use client";

/**
 * 직원 건의 — 댓글 작성기(Step 5).
 * 확정된 `.ccomposer` 바를 실제 댓글 생성에 연결한다. 보이는 모든 참여자(
 * 작성자 / 수신자 / 참조)가 쓸 수 있다. 텍스트와/또는 사진(최대 5장, 공용
 * 압축 + `request-images` 업로드 재사용)을 지원한다. 사진이 붙으면 바 위에 작은 미리보기 줄이 생긴다.
 * 바 자체의 시각 처리는 바뀌지 않았다.
 */

import { useRef, useState, useTransition } from "react";
import { createStaffSuggestionComment } from "@/app/mobile/suggestions/actions";
import {
  compressImageFile,
  type PreviewItem,
} from "@/components/announcements/announcement-image-uploader";
import { uploadRequestImages } from "@/components/requests/request-image-upload";
import type { Dictionary } from "@/lib/i18n";
import { Ic, SgIcon } from "./sg-icons";
import { haptic } from "@/lib/haptics";

const MAX_PHOTOS = 5;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/gif", "image/jpeg", "image/png", "image/webp"];

export function SuggestionCommentComposer({
  suggestionId,
  organizationId,
  copy,
}: {
  suggestionId: string;
  organizationId: string;
  copy: Dictionary["mobile"]["suggestions"];
}) {
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<PreviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const canSend = (text.trim().length > 0 || photos.length > 0) && !isPending;

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (selected.length === 0) return;
    if (selected.some((f) => !ALLOWED_TYPES.includes(f.type))) return;
    if (selected.some((f) => f.size > MAX_BYTES)) return;
    if (photos.length + selected.length > MAX_PHOTOS) {
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

  function send() {
    if (!canSend) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("suggestionId", suggestionId);
      fd.set("body", text.trim());
      if (photos.length > 0) {
        try {
          const { imageUrls } = await uploadRequestImages({
            items: photos.slice(0, MAX_PHOTOS),
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
      const result = await createStaffSuggestionComment(fd);
      if (!result.ok) {
        haptic("error");
        setError(copy.errors.save_failed);
        return;
      }
      haptic("light");
      for (const p of photos) URL.revokeObjectURL(p.previewUrl);
      setText("");
      setPhotos([]);
    });
  }

  return (
    <div className="csheet__footer">
      {error ? (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: "6px 16px",
            color: "#c0392b",
            fontSize: "12px",
            fontWeight: 700,
          }}
        >
          {error}
        </p>
      ) : null}
      {photos.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "8px 16px 0",
            overflowX: "auto",
          }}
        >
          {photos.map((p) => (
            <div
              key={p.id}
              style={{
                position: "relative",
                width: "52px",
                height: "52px",
                borderRadius: "10px",
                flex: "0 0 auto",
                backgroundImage: `url(${p.previewUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <button
                type="button"
                aria-label={copy.removePhoto}
                onClick={() => removePhoto(p.id)}
                style={{
                  position: "absolute",
                  top: "-6px",
                  right: "-6px",
                  width: "20px",
                  height: "20px",
                  borderRadius: "999px",
                  background: "rgba(15,23,42,0.72)",
                  color: "#fff",
                  fontSize: "11px",
                  lineHeight: "20px",
                  textAlign: "center",
                }}
              >
                {SgIcon.x}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="csheet__composer">
        <button
          type="button"
          className="csheet__att"
          onClick={() => fileRef.current?.click()}
          disabled={photos.length >= MAX_PHOTOS}
        >
          {SgIcon.paperclip}
        </button>
        <input
          type="text"
          enterKeyHint="send"
          className="csheet__in"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={copy.commentPlaceholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className="csheet__send"
          onClick={send}
          disabled={!canSend}
          style={!canSend ? { opacity: 0.5 } : undefined}
          aria-label={copy.commentSend}
        >
          {isPending ? <Ic>{SgIcon.send}</Ic> : SgIcon.send}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/gif,image/jpeg,image/png,image/webp"
        multiple
        style={{ display: "none" }}
        onChange={onPickFiles}
      />
    </div>
  );
}
