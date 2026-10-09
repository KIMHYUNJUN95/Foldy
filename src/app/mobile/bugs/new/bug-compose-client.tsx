"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Menu, User, X } from "lucide-react";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import type { BugCopy } from "@/components/bugs/bug-types";
import { uploadBugReportImageAction, createBugReportAction } from "../actions";

const ALLOWED_TYPES = ["image/gif", "image/jpeg", "image/png", "image/webp"];
const MAX_IMAGES = 5;

type Preview = { id: string; file: File; url: string };

const FIELD_ROW = "flex gap-[13px] border-b border-border/60 px-[18px] py-[16px]";
const FIELD_NO = "w-[22px] shrink-0 pt-[2px] font-mono text-[12px] font-extrabold text-[hsl(222_10%_60%)]";
const FIELD_LABEL = "text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground";

export function BugComposeClient({ copy }: { copy: BugCopy }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // preview URL revoke on unmount
  const previewsRef = useRef(previews);
  useEffect(() => { previewsRef.current = previews; }, [previews]);
  useEffect(
    () => () => { previewsRef.current.forEach((p) => URL.revokeObjectURL(p.url)); },
    [],
  );

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !isPending;

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const allowed = files.filter((f) => ALLOWED_TYPES.includes(f.type));
    const remaining = MAX_IMAGES - previews.length;
    const toAdd = allowed.slice(0, remaining);
    if (toAdd.length === 0) return;

    const newPreviews: Preview[] = toAdd.map((f) => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      url: URL.createObjectURL(f),
    }));
    setPreviews((prev) => [...prev, ...newPreviews]);
  }

  function removePreview(id: string) {
    setPreviews((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  function onSubmit() {
    if (!canSubmit) return;
    setError(null);

    startTransition(async () => {
      // 1단계: title/description만으로 report row 생성 → id 확보
      const baseFormData = new FormData();
      baseFormData.set("title", title.trim());
      baseFormData.set("description", description.trim());

      const createResult = await createBugReportAction(baseFormData);
      if ("error" in createResult) {
        setError(copy.submitError);
        return;
      }

      const reportId = createResult.id;

      // 2단계: 이미지가 있으면 각각 압축 후 업로드
      if (previews.length > 0) {
        for (const preview of previews) {
          try {
            const compressed = await compressImageFile(preview.file);
            const imgForm = new FormData();
            imgForm.set("file", compressed);
            await uploadBugReportImageAction(reportId, imgForm);
          } catch {
            // 이미지 업로드 실패는 non-fatal — report 자체는 이미 생성됨
          }
        }
      }

      router.replace("/mobile/bugs");
    });
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* 상단 chrome (Foldy 워드마크 + 햄버거 / 프로필) */}
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border/60 bg-background px-3">
        <button
          type="button"
          className="inline-flex size-[38px] items-center justify-center rounded-full text-[hsl(222_18%_26%)]"
          aria-label={copy.composeMenuAria}
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <span
          className="whitespace-nowrap text-[20px] text-foreground"
          style={{
            fontFamily: '"Noto Serif", Georgia, serif',
            fontStyle: "italic",
            fontWeight: 600,
          }}
        >
          Foldy
        </span>
        <button
          type="button"
          className="inline-flex size-[38px] items-center justify-center rounded-full text-[hsl(222_18%_26%)]"
          aria-label={copy.composeProfileAria}
        >
          <User className="size-5" aria-hidden="true" />
        </button>
      </div>

      {/* 폼 */}
      <div className="flex-1 overflow-y-auto pb-[18px] pt-[6px]">
        {/* 01 제목 */}
        <div className={FIELD_ROW}>
          <span className={FIELD_NO}>01</span>
          <div className="flex-1">
            <div className={FIELD_LABEL}>{copy.composeTitleLabel}</div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={copy.composeTitlePlaceholder}
              className="mt-[7px] w-full bg-transparent text-[16px] font-bold tracking-[-0.01em] text-foreground outline-none focus:outline-none focus-visible:outline-none placeholder:font-bold placeholder:text-[hsl(222_10%_60%)]"
              style={{
                WebkitAppearance: "none",
                MozAppearance: "none",
                appearance: "none",
                border: 0,
                borderRadius: 0,
                outline: "none",
                boxShadow: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            />
          </div>
        </div>

        {/* 02 설명 */}
        <div className={FIELD_ROW}>
          <span className={FIELD_NO}>02</span>
          <div className="flex-1">
            <div className={FIELD_LABEL}>{copy.composeDescriptionLabel}</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={copy.composeDescriptionPlaceholder}
              rows={4}
              className="mt-[7px] block w-full resize-none bg-transparent text-[14.5px] font-medium leading-[1.6] text-[hsl(222_18%_26%)] outline-none focus:outline-none focus-visible:outline-none placeholder:text-[hsl(222_10%_60%)]"
              style={{
                WebkitAppearance: "none",
                MozAppearance: "none",
                appearance: "none",
                border: 0,
                borderRadius: 0,
                outline: "none",
                boxShadow: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            />
          </div>
        </div>

        {/* 03 스크린샷 */}
        <div className={FIELD_ROW}>
          <span className={FIELD_NO}>03</span>
          <div className="flex-1">
            <div className={FIELD_LABEL}>{copy.composeScreenshotsLabel}</div>
            <div className="mt-[9px] flex flex-wrap gap-[9px]">
              {previews.map((preview) => (
                <div
                  key={preview.id}
                  className="relative size-[62px] overflow-hidden rounded-[9px] border border-[hsl(40_18%_85%)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.url}
                    alt=""
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePreview(preview.id)}
                    className="absolute -right-[5px] -top-[5px] inline-flex size-[18px] items-center justify-center rounded-full border-2 border-background bg-foreground text-white"
                    aria-label={copy.screenshotRemoveAria}
                  >
                    <X className="size-[10px]" aria-hidden="true" />
                  </button>
                </div>
              ))}
              {previews.length < MAX_IMAGES && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex size-[62px] items-center justify-center rounded-[9px] border border-dashed border-border text-muted-foreground"
                  aria-label={copy.screenshotAddAria}
                >
                  <Camera className="size-[17px]" aria-hidden="true" />
                </button>
              )}
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
        </div>

        {/* 인라인 에러 */}
        {error && (
          <p className="px-[18px] pt-[10px] text-[12.5px] font-semibold text-[hsl(4_72%_52%)]">
            {error}
          </p>
        )}
      </div>

      {/* 하단 sticky 제출바 */}
      <div className="shrink-0 border-t border-border bg-surface px-4 pb-[calc(14px+env(safe-area-inset-bottom,0px))] pt-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-gradient-to-br from-[#8a63f0] to-[#5a30cf] text-[15px] font-extrabold text-white shadow-[0_14px_26px_-12px_rgb(122_82_230/0.5)] disabled:bg-none disabled:bg-[#f4f4f7] disabled:text-[hsl(222_10%_60%)] disabled:shadow-none"
        >
          {isPending ? copy.composeSubmitting : copy.composeSubmit}
        </button>
      </div>
    </div>
  );
}
