"use client";

/**
 * 메시지 본문 그리기 — 글 · 링크 · 사진(47 §5-8). 본문의 HTML 을 그대로 넣지 않고 조각(`parseMessageBody`)을 React 요소로.
 * 사진은 사본(서명 URL)이 먼저, 없거나 못 불러오면 Airbnb 주소, 그것도 안 되면 조용한 「사진을 불러올 수 없어요」 + 원본 열기.
 * 손님이 올린 사진인데 사본이 없고 Airbnb 서명도 죽었으면(`unavailable`) 깨진 사진 대신 「사진은 Airbnb 에서 볼 수 있어요」.
 * 누르면 공용 `ImageLightbox`(Esc · 맨 위 오버레이 · role=dialog).
 */

import { useCallback, useMemo, useState } from "react";
import { ImageLightbox } from "@/components/shell/image-lightbox";
import { fill, type GmCopy } from "@/components/guest-messages/gm-format";
import { parseMessageBody, type MessageSegment } from "@/lib/guest-messages/message-body";
import type { MessageImageView } from "@/lib/guest-messages/message-media";

type Piece =
  | { kind: "text"; key: string; text: string }
  | { kind: "link"; key: string; href: string; label: string; host: string | null }
  | { kind: "photos"; key: string; indexes: number[] };

/** 조각 → 그릴 덩어리(붙어 있는 사진은 한 묶음). 번역문이 있으면 글은 번역문, 사진 · 링크는 원문의 것. */
export function bodyPieces(body: string, textOverride: string | null): Piece[] {
  const original = parseMessageBody(body);
  let segments: MessageSegment[] = original;
  if (textOverride != null) {
    // 번역문은 글(링크 글이 문장 안에 들어 있음 — 링크를 끝으로 옮겨 붙이지 않는다) + 원문의 사진(뒤에 모아서).
    // 예전 캐시에 앵커가 섞여 있으면 그 링크는 그대로 링크로, 사진 조각은 버린다. 링크를 누르려면 「원문 보기」.
    const translated = parseMessageBody(textOverride).filter((segment) => segment.type !== "image");
    segments = [...translated, ...original.filter((segment) => segment.type === "image")];
  }
  const out: Piece[] = [];
  let photo = 0;
  segments.forEach((segment, i) => {
    if (segment.type === "image") {
      const last = out[out.length - 1];
      if (last && last.kind === "photos") last.indexes.push(photo);
      else out.push({ kind: "photos", key: `p${i}`, indexes: [photo] });
      photo += 1;
    } else if (segment.type === "link") {
      out.push({ kind: "link", key: `l${i}`, href: segment.href, label: segment.label, host: segment.showHost ? segment.host : null });
    } else {
      out.push({ kind: "text", key: `t${i}`, text: segment.text });
    }
  });
  return out;
}

export function MessageBodyView({
  body,
  textOverride = null,
  images,
  copy,
  interactive = true,
  emptyText,
}: {
  body: string;
  textOverride?: string | null;
  images: readonly MessageImageView[];
  copy: GmCopy;
  /** false = 안에 버튼 · 링크를 두지 않는다(말 고르기 버튼 안 — 버튼 안 버튼 금지). */
  interactive?: boolean;
  emptyText?: string;
}) {
  const pieces = useMemo(() => bodyPieces(body, textOverride), [body, textOverride]);
  const [open, setOpen] = useState<number | null>(null);
  const [broken, setBroken] = useState<Record<number, 1 | 2>>({});
  const close = useCallback(() => setOpen(null), []);

  if (pieces.length === 0) return <>{emptyText ?? ""}</>;

  const srcOf = (index: number, kind: "thumb" | "full") => {
    const image = images[index];
    if (!image) return null;
    if (image.unavailable) return null;
    // 사본이 안 열리면(서명 만료 등) Airbnb 주소로 한 번 더.
    if (broken[index] === 1 && image.stored) return image.fallback;
    return kind === "thumb" ? image.thumb : image.full;
  };
  const onError = (index: number) => {
    const image = images[index];
    setBroken((prev) => ({ ...prev, [index]: prev[index] === undefined && image?.stored && image.fallback ? 1 : 2 }));
  };
  // 크게 보기에는 볼 수 있는 사진만(Airbnb 에서만 보이는 사진은 빼고) — 누른 사진의 자리를 그 목록 안 번호로 바꾼다.
  const viewableIndexes = images.flatMap((image, i) => (image.unavailable ? [] : [i]));
  const viewable = viewableIndexes.map((i) => (broken[i] === 1 && images[i].stored ? (images[i].fallback ?? images[i].full) : images[i].full));
  const openAt = open === null ? null : Math.max(0, viewableIndexes.indexOf(open));

  return (
    <>
      {pieces.map((piece) => {
        if (piece.kind === "text") return <span key={piece.key} className="gm-body__text">{piece.text}</span>;
        if (piece.kind === "link") {
          // 글과 실제 가는 곳이 다르면 호스트를 옅게 같이(「안내 (evil.example)」 — 피싱 막기).
          const host = piece.host ? <span className="gm-body__host"> ({piece.host})</span> : null;
          return interactive ? (
            <a key={piece.key} className="gm-body__link" href={piece.href} target="_blank" rel="noopener noreferrer">
              {piece.label}
              {host}
            </a>
          ) : (
            <span key={piece.key} className="gm-body__link">
              {piece.label}
              {host}
            </span>
          );
        }
        return (
          <span key={piece.key} className="gm-photos" data-count={Math.min(piece.indexes.length, 3)}>
            {piece.indexes.map((index) => {
              const n = index + 1;
              const src = srcOf(index, "thumb");
              if (images[index]?.unavailable) {
                return (
                  <span key={index} className="gm-photo gm-photo--broken">
                    <span className="gm-photo__msg">{copy.photoUnavailable}</span>
                  </span>
                );
              }
              if (!src || broken[index] === 2) {
                const original = images[index]?.fallback ?? null;
                return (
                  <span key={index} className="gm-photo gm-photo--broken">
                    <span className="gm-photo__msg">{copy.photoLoadFailed}</span>
                    {interactive && original ? (
                      <a className="gm-body__link" href={original} target="_blank" rel="noopener noreferrer">
                        {copy.photoOpenOriginal}
                      </a>
                    ) : null}
                  </span>
                );
              }
              const img = (
                // 사진은 서명 URL · 바깥 주소라 next/image 최적화를 쓰지 않는다.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="gm-photo__img"
                  src={src}
                  alt={fill(copy.photoAlt, { n })}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  draggable={false}
                  // 모바일 공용 `ImageFadeIn` 이 받아진 사진에 `data-loaded` 를 붙인다 — 수화 전에 붙어도 경고하지 않게.
                  suppressHydrationWarning
                  onError={() => onError(index)}
                />
              );
              return interactive ? (
                <button
                  key={index}
                  type="button"
                  className="gm-photo"
                  aria-label={fill(copy.photoOpen, { n })}
                  onClick={() => setOpen(index)}
                >
                  {img}
                </button>
              ) : (
                <span key={index} className="gm-photo">
                  {img}
                </span>
              );
            })}
          </span>
        );
      })}
      {interactive && viewable.length > 0 ? (
        <ImageLightbox urls={viewable} openIndex={openAt} onClose={close} closeLabel={copy.photoClose} />
      ) : null}
    </>
  );
}
