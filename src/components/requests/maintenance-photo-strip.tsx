"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageLightbox } from "@/components/shell/image-lightbox";

type Props = {
  imageUrls: string[];
  closeLabel: string;
  imageAltLabel: string;
};

// 수리 상세 전용 — 큰 2열 카드 대신 96px 가로 줄이라 설명이 첫 화면에 보인다(공용 AnnouncementImageGrid 는 그대로).
export function MaintenancePhotoStrip({ imageUrls, closeLabel, imageAltLabel }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (imageUrls.length === 0) return null;

  return (
    <div className="mdw-shots" data-swipe-back="off">
      {imageUrls.map((url, index) => (
        <button className="mdw-shot" key={url} onClick={() => setOpenIndex(index)} type="button" aria-label={`${imageAltLabel} ${index + 1}`}>
          <Image alt="" fill sizes="96px" src={url} />
        </button>
      ))}
      <ImageLightbox closeLabel={closeLabel} onClose={() => setOpenIndex(null)} openIndex={openIndex} urls={imageUrls} />
    </div>
  );
}
