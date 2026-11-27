"use client";

import { RequestImage } from "@/components/request-image";
import { useState } from "react";
import { ImageLightbox } from "@/components/shell/image-lightbox";

type AnnouncementImageGridProps = {
  imageUrls: string[];
  closeLabel: string;
  imageAltLabel: string;
  /** plain = 화이트 리디자인(2026-10-15) — 테두리 · 그림자 없는 2열, 한 장이면 넓게. 스타일은 announcements-mobile.css. */
  variant?: "grid" | "feature" | "plain";
};

export function AnnouncementImageGrid({
  imageUrls,
  closeLabel,
  imageAltLabel,
  variant = "grid",
}: AnnouncementImageGridProps) {
  // 사진 <RequestImage> 마다 suppressHydrationWarning — 모바일 공용 `ImageFadeIn` 이 받아진 사진에 `data-loaded` 를 붙이는데,
  // 문서째 새로 받는 상세(태블릿 2분할 칸)에서는 그게 이 부분 수화보다 먼저라 경고가 났다(2026-11-20, 공지 unslop B5).
  // `target="_blank"` 는 설치된 독립 실행형 PWA 를 사진 하나 보려고 별도 Safari 탭으로 내보내므로,
  // 그 대신 앱 안 라이트박스로 사진을 연다.
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (imageUrls.length === 0) {
    return null;
  }

  const lightbox = (
    <ImageLightbox
      closeLabel={closeLabel}
      onClose={() => setOpenIndex(null)}
      openIndex={openIndex}
      urls={imageUrls}
    />
  );

  if (variant === "plain") {
    return (
      <div className={`ntw-shots${imageUrls.length === 1 ? " is-one" : ""}`}>
        {imageUrls.map((url, index) => (
          <button className="ntw-shot" key={url} onClick={() => setOpenIndex(index)} type="button" aria-label={`${imageAltLabel} ${index + 1}`}>
            <RequestImage alt="" fill sizes={imageUrls.length === 1 ? "(max-width: 640px) 100vw, 640px" : "(max-width: 640px) 50vw, 320px"} src={url} suppressHydrationWarning />
          </button>
        ))}
        {lightbox}
      </div>
    );
  }

  if (variant === "feature") {
    const isSingle = imageUrls.length === 1;
    return (
      <div className={isSingle ? "mt-4" : "mt-4 grid grid-cols-2 gap-2"}>
        {imageUrls.map((url, index) => (
          <button
            className="group block w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white text-left shadow-[0_14px_28px_-24px_rgba(31,58,95,0.42)]"
            key={url}
            onClick={() => setOpenIndex(index)}
            type="button"
          >
            <RequestImage
              alt={`${imageAltLabel} ${index + 1}`}
              className="h-[160px] w-full object-cover transition-transform group-hover:scale-[1.02]"
              height={480}
              sizes={isSingle ? "(max-width: 640px) 100vw, 460px" : "(max-width: 640px) 50vw, 230px"}
              src={url}
              suppressHydrationWarning
              width={960}
            />
          </button>
        ))}
        {lightbox}
      </div>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-3">
      {imageUrls.map((url, index) => (
        <button
          className="group block w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white text-left shadow-[0_12px_24px_-22px_rgba(31,58,95,0.42)]"
          key={url}
          onClick={() => setOpenIndex(index)}
          type="button"
        >
          <RequestImage
            alt={`${imageAltLabel} ${index + 1}`}
            className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.02] sm:aspect-[4/3]"
            height={900}
            sizes="(max-width: 640px) 50vw, 220px"
            src={url}
            suppressHydrationWarning
            width={1200}
          />
        </button>
      ))}
      {lightbox}
    </div>
  );
}
