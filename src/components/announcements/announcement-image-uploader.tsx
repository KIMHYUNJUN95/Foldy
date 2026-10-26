"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Camera, X } from "lucide-react";

const DEFAULT_MAX_IMAGES = 5;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/gif", "image/jpeg", "image/png", "image/webp"];
const MAX_DIM = 1600;
const COMPRESS_QUALITY = 0.75;

export type PreviewItem = {
  id: string;
  file: File;
  previewUrl: string;
};

export type AnnouncementImageUploaderHandle = {
  getItems: () => PreviewItem[];
};

type Props = {
  addImagesLabel: string;
  errorCountExceeded: string;
  errorSizeExceeded: string;
  errorTypeInvalid: string;
  imageAttachmentsLabel: string;
  imageLimitLabel: string;
  imageRemoveLabel: string;
  /** 선택 가능한 최대 이미지 수. 기본값 5 (기능별 표준 한도). */
  maxImages?: number;
  /** "white" = 화이트 리디자인 요청 폼 모양(이름 · n/max · 72px 타일, order-form.css 의 .ofw-photos). */
  variant?: "default" | "white";
};

export async function compressImageFile(file: File): Promise<File> {
  // GIF: 애니메이션을 보존하기 위해 압축 생략
  if (file.type === "image/gif") return file;

  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  if (width > MAX_DIM || height > MAX_DIM) {
    if (width >= height) {
      height = Math.round((height * MAX_DIM) / width);
      width = MAX_DIM;
    } else {
      width = Math.round((width * MAX_DIM) / height);
      height = MAX_DIM;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // PNG 는 PNG 유지(투명도 보존), WebP 는 WebP 유지, 나머지는 → JPEG
  const outputType =
    file.type === "image/png"
      ? "image/png"
      : file.type === "image/webp"
        ? "image/webp"
        : "image/jpeg";

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(file);
          return;
        }
        const ext = outputType.split("/")[1];
        const baseName = file.name.replace(/\.[^.]+$/, "");
        resolve(new File([blob], `${baseName}.${ext}`, { type: outputType }));
      },
      outputType,
      COMPRESS_QUALITY,
    );
  });
}

export const AnnouncementImageUploader = forwardRef<
  AnnouncementImageUploaderHandle,
  Props
>(function AnnouncementImageUploader(
  {
    addImagesLabel,
    errorCountExceeded,
    errorSizeExceeded,
    errorTypeInvalid,
    imageAttachmentsLabel,
    imageLimitLabel,
    imageRemoveLabel,
    maxImages = DEFAULT_MAX_IMAGES,
    variant = "default",
  },
  ref,
) {
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pickInputRef = useRef<HTMLInputElement>(null);
  // 정리용 effect 에서 쓰도록 현재 항목을 ref 로 추적
  const itemsRef = useRef(items);

  // 매 렌더 뒤 ref 를 최신으로 유지 (렌더 중에 하면 안 됨)
  useEffect(() => {
    itemsRef.current = items;
  });

  // 언마운트 시 모든 blob URL 해제
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getItems: () => items,
    }),
    [items],
  );

  const handlePickChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files ?? []);
      // 삭제 후에 같은 파일을 다시 고를 수 있도록 초기화
      e.target.value = "";
      if (selected.length === 0) return;

      // 검증: 형식
      const invalidType = selected.find((f) => !ALLOWED_TYPES.includes(f.type));
      if (invalidType) {
        setError(errorTypeInvalid);
        return;
      }

      // 검증: 개수 (현재 항목 기준)
      if (itemsRef.current.length + selected.length > maxImages) {
        setError(errorCountExceeded);
        return;
      }

      // 검증: 크기 (압축 전 원본 파일 기준)
      const tooBig = selected.find((f) => f.size > MAX_BYTES);
      if (tooBig) {
        setError(errorSizeExceeded);
        return;
      }

      setError(null);

      const newItems: PreviewItem[] = await Promise.all(
        selected.map(async (file) => {
          const compressed = await compressImageFile(file);
          const previewUrl = URL.createObjectURL(compressed);
          return {
            id: `${Date.now()}-${Math.random()}`,
            file: compressed,
            previewUrl,
          };
        }),
      );

      setItems((prev) => [...prev, ...newItems]);
    },
    [errorTypeInvalid, errorCountExceeded, errorSizeExceeded, maxImages],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
    setError(null);
  }, []);

  if (variant === "white") {
    return (
      <div className="ofw-photos">
        <span className="ofw-photos__k">
          {imageAttachmentsLabel} <em>· {items.length}/{maxImages}</em>
        </span>
        <div className="ofw-photos__row">
          {items.map((item) => (
            <div className="ofw-photos__th" key={item.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" aria-hidden="true" src={item.previewUrl} />
              <button aria-label={imageRemoveLabel} onClick={() => removeItem(item.id)} type="button">
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
          {items.length < maxImages ? (
            <button aria-label={addImagesLabel} className="ofw-photos__add" onClick={() => pickInputRef.current?.click()} type="button">
              <Camera aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <input
          accept="image/gif,image/jpeg,image/png,image/webp"
          aria-hidden="true"
          className="sr-only"
          multiple
          onChange={handlePickChange}
          ref={pickInputRef}
          tabIndex={-1}
          type="file"
        />
        {error !== null ? (
          <p className="ofw-err" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs font-semibold text-muted-foreground">{imageAttachmentsLabel}</span>

      {/* 미리보기 & 추가 버튼을 가로 스크롤 행에 배치 */}
      <div className="flex items-center gap-3 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
        {/* 추가 버튼 — 한도에 도달하면 숨김 */}
        {items.length < maxImages && (
          <button
            className="flex size-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-background/40 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40 hover:text-foreground active:scale-95"
            onClick={() => pickInputRef.current?.click()}
            type="button"
          >
            <Camera className="size-5 text-muted-foreground/80" aria-hidden="true" />
            <span className="text-[11px] font-bold tracking-tight">{addImagesLabel}</span>
          </button>
        )}

        {/* 미리보기 */}
        {items.map((item) => (
          <div
            className="group relative size-20 shrink-0 overflow-hidden rounded-xl border border-border bg-muted/20"
            key={item.id}
          >
            {/* Blob URL 은 Next.js Image 로 최적화할 수 없으므로 일반 img 사용 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              className="size-full object-cover"
              src={item.previewUrl}
            />
            <button
              aria-label={imageRemoveLabel}
              className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white transition-transform hover:scale-105 active:scale-95"
              onClick={() => removeItem(item.id)}
              type="button"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <input
        accept="image/gif,image/jpeg,image/png,image/webp"
        aria-hidden="true"
        className="sr-only"
        multiple
        onChange={handlePickChange}
        ref={pickInputRef}
        tabIndex={-1}
        type="file"
      />

      {error !== null && (
        <p className="text-xs font-semibold text-destructive" role="alert">
          {error}
        </p>
      )}

      <span className="pl-0.5 text-[11px] font-semibold text-muted-foreground">
        {imageLimitLabel}
      </span>
    </div>
  );
});
