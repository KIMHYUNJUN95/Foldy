"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageLightbox } from "@/components/shell/image-lightbox";

/**
 * 글 사진 — 화이트 리디자인(2026-10-15, 시안 BoardPost-Phone). 장수가 홀수면 첫 장을 넓게(16:9), 나머지는 2열 정사각.
 * 누르면 공용 전체 화면 `ImageLightbox`(넘겨 보기 · 원본) — `target="_blank"` 는 쓰지 않는다(결정 로그 2026-06-22).
 */
export function BoardImageGrid({
  urls,
  viewPhotoLabel,
  closeLabel,
}: {
  urls: string[];
  viewPhotoLabel: string;
  closeLabel: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (urls.length === 0) return null;
  const heroFirst = urls.length % 2 === 1;

  return (
    <div className="bdw-gal">
      {urls.map((url, index) => {
        const hero = heroFirst && index === 0;
        return (
          <button
            aria-label={`${viewPhotoLabel} ${index + 1}`}
            className={`bdw-gal__ph${hero ? " is-hero" : ""}`}
            key={url}
            onClick={() => setOpenIndex(index)}
            type="button"
          >
            <Image alt="" fill sizes={hero ? "(min-width: 1000px) 680px, 100vw" : "(min-width: 1000px) 340px, 50vw"} src={url} />
          </button>
        );
      })}

      <ImageLightbox closeLabel={closeLabel} onClose={() => setOpenIndex(null)} openIndex={openIndex} urls={urls} />
    </div>
  );
}
