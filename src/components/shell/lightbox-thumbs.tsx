"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageLightbox } from "@/components/shell/image-lightbox";

/**
 * 앱 안 {@link ImageLightbox} 로 열리는 정사각형 사진 썸네일 묶음. 설치된 독립 PWA 를 Safari 로 내쫓는
 * `target="_blank"` 새 탭을 대신한다. 호출하는 쪽이
 * 래퍼/썸네일 클래스를 정확히 넘겨 각 화면이 원래 모양을 유지한다 — 이것은
 * `<a>` 이탈을 공용 뷰어를 여는 `<button>` 으로 바꿀 뿐이다.
 */
export function LightboxThumbs({
  urls,
  wrapClassName,
  thumbClassName,
  closeLabel,
  sizes = "72px",
}: {
  urls: string[];
  /** flex-wrap 컨테이너 클래스 (원래 마크업과 같음). */
  wrapClassName: string;
  /** 크기가 정해진 썸네일 상자 클래스 (예전 `<a>` 안에 있던 요소). */
  thumbClassName: string;
  closeLabel: string;
  sizes?: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (urls.length === 0) return null;

  return (
    <div className={wrapClassName}>
      {urls.map((url, idx) => (
        <button key={`${url}-${idx}`} onClick={() => setOpenIndex(idx)} type="button">
          <div className={thumbClassName}>
            <Image alt="" className="object-cover" fill sizes={sizes} src={url} />
          </div>
        </button>
      ))}
      <ImageLightbox closeLabel={closeLabel} onClose={() => setOpenIndex(null)} openIndex={openIndex} urls={urls} />
    </div>
  );
}
