// 주문 요청 폼 — 품목 한 줄. 화이트 리디자인(2026-10-14, 시안 OrderNew-Phone): 이름표 칸(품목 이름 · 수량) →
// [쇼핑몰 검색(링크가 있으면 주소)] · 사진(n/5) · × → 펼치면 상품 링크 + 붙여넣기 · Amazon/IKEA 에서 찾기 · 메모.
"use client";

import { memo, useCallback, useId, useRef, useState } from "react";
import { Camera, Clipboard, ExternalLink, Search, X } from "lucide-react";
import type { PreviewItem } from "@/components/announcements/announcement-image-uploader";
import type { Dictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const MAX_PHOTOS = 5;
const PHOTO_ALLOWED_TYPES = ["image/gif", "image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const PHOTO_MAX_DIM = 1600;
const PHOTO_COMPRESS_QUALITY = 0.75;

async function compressPhoto(file: File): Promise<File> {
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (width > PHOTO_MAX_DIM || height > PHOTO_MAX_DIM) {
    if (width >= height) { height = Math.round((height * PHOTO_MAX_DIM) / width); width = PHOTO_MAX_DIM; }
    else { width = Math.round((width * PHOTO_MAX_DIM) / height); height = PHOTO_MAX_DIM; }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const outputType = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) { resolve(file); return; }
        const ext = outputType.split("/")[1];
        resolve(new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.${ext}`, { type: outputType }));
      },
      outputType,
      PHOTO_COMPRESS_QUALITY,
    );
  });
}

export type OrderLinkDomain = "amazon" | "ikea" | "other" | null;

export type OrderLineItem = {
  id: string;
  name: string;
  quantity: string;
  link: string;
  memo: string;
};

type OrderItemRowProps = {
  canRemove: boolean;
  copy: Dictionary["mobile"]["orderForm"];
  domain: OrderLinkDomain;
  errors: string[];
  imgCopy: Dictionary["requestImages"];
  index: number;
  item: OrderLineItem;
  onChange: (id: string, patch: Partial<OrderLineItem>) => void;
  onPasteLink: (id: string) => Promise<void>;
  onPhotosChange: (id: string, photos: PreviewItem[]) => void;
  onRemove: (id: string) => void;
  photos: PreviewItem[];
};

/** 상품 링크의 짧은 주소(「amazon.co.jp」 · 「ikea.com/jp」). 링크가 없거나 형식이 아니면 null. */
function linkHost(link: string): string | null {
  const trimmed = link.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const host = u.hostname.replace(/^www\./, "");
    return host === "ikea.com" && u.pathname.startsWith("/jp") ? "ikea.com/jp" : host;
  } catch {
    return null;
  }
}

function normalizeQuantity(value: string) {
  const digits = value.replace(/[^0-9]/g, "");
  return digits.replace(/^0+(?=\d)/, "");
}

function OrderItemRowComponent({
  canRemove,
  copy,
  domain,
  errors,
  imgCopy,
  index,
  item,
  onChange,
  onPasteLink,
  onPhotosChange,
  onRemove,
  photos,
}: OrderItemRowProps) {
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(item.link || item.memo));
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (selected.length === 0) return;

      const invalidType = selected.find((f) => !PHOTO_ALLOWED_TYPES.includes(f.type));
      if (invalidType) { setPhotoError(imgCopy.errorType); return; }

      if (photos.length + selected.length > MAX_PHOTOS) { setPhotoError(imgCopy.errorCount); return; }

      const tooBig = selected.find((f) => f.size > PHOTO_MAX_BYTES);
      if (tooBig) { setPhotoError(imgCopy.errorSize); return; }

      setPhotoError(null);

      const newItems: PreviewItem[] = await Promise.all(
        selected.map(async (file) => {
          const compressed = await compressPhoto(file);
          return {
            id: `${Date.now()}-${Math.random()}`,
            file: compressed,
            previewUrl: URL.createObjectURL(compressed),
          };
        }),
      );

      onPhotosChange(item.id, [...photos, ...newItems]);
    },
    [imgCopy, item.id, onPhotosChange, photos],
  );

  const removePhoto = useCallback(
    (photoId: string) => {
      const target = photos.find((p) => p.id === photoId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      onPhotosChange(item.id, photos.filter((p) => p.id !== photoId));
      setPhotoError(null);
    },
    [item.id, onPhotosChange, photos],
  );

  const hasLinkWarning = item.link.trim().length > 0 && domain === null;
  const host = linkHost(item.link);
  // 품목 id 는 클라이언트에서 무작위로 만들어져 서버 HTML 과 달라진다 — 라벨 연결은 useId 로(하이드레이션 불일치 방지).
  const uid = useId();
  const nameId = `${uid}-name`;
  const qtyId = `${uid}-qty`;

  return (
    <div className="ofw-item">
      <div className="ofw-item__top">
        <div className="ofw-nf ofw-grow">
          <label className="ofw-nf__l" htmlFor={nameId}>
            {copy.wItemName}
          </label>
          <input
            id={nameId}
            autoComplete="off"
            className={cn("ofw-nf__in", errors.includes("name") && "is-err")}
            onChange={(event) => onChange(item.id, { name: event.target.value })}
            placeholder={copy.itemNamePlaceholder}
            type="text"
            value={item.name}
          />
        </div>
        <div className="ofw-nf ofw-qty">
          <label className="ofw-nf__l" htmlFor={qtyId}>
            {copy.quantity}
          </label>
          <input
            id={qtyId}
            autoComplete="off"
            className={cn("ofw-nf__in", errors.includes("quantity") && "is-err")}
            inputMode="numeric"
            onChange={(event) => onChange(item.id, { quantity: normalizeQuantity(event.target.value) })}
            placeholder={copy.quantityPlaceholder}
            type="text"
            value={item.quantity}
          />
        </div>
      </div>

      <div className="ofw-item__bar">
        <button
          aria-expanded={advancedOpen}
          className={cn("ofw-shop", advancedOpen && "is-open", host && "has-link")}
          onClick={() => setAdvancedOpen((open) => !open)}
          type="button"
        >
          {host ? <ExternalLink aria-hidden="true" /> : <Search aria-hidden="true" />}
          <span>{host ?? copy.itemAdvancedToggle}</span>
        </button>
        <button
          aria-label={imgCopy.addPhotos}
          className="ofw-ib"
          disabled={photos.length >= MAX_PHOTOS}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Camera aria-hidden="true" />
          {photos.length > 0 ? <span className="num">{photos.length}/{MAX_PHOTOS}</span> : null}
        </button>
        <input
          accept="image/jpeg,image/png,image/webp,image/gif"
          aria-hidden="true"
          className="sr-only"
          multiple
          onChange={handlePhotoChange}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
        {canRemove ? (
          <button aria-label={`${copy.removeItem} ${index + 1}`} className="ofw-ib" onClick={() => onRemove(item.id)} type="button">
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {photoError ? <p className="ofw-err">{photoError}</p> : null}

      {photos.length > 0 ? (
        <div className="ofw-thumbs">
          {photos.map((photo) => (
            <div className="ofw-thumb" key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" src={photo.previewUrl} />
              <button aria-label={imgCopy.remove} onClick={() => removePhoto(photo.id)} type="button">
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {advancedOpen ? (
        <div className="ofw-more">
          <div className="ofw-more__link">
            <div className="ofw-nf ofw-grow">
              <span className="ofw-nf__l">{copy.wLink}</span>
              <input
                aria-label={copy.wLink}
                autoComplete="off"
                className="ofw-nf__in"
                onChange={(event) => onChange(item.id, { link: event.target.value })}
                placeholder={copy.referenceUrlPlaceholder}
                type="url"
                value={item.link}
              />
            </div>
            <button aria-label={copy.pasteLink} className="ofw-paste" onClick={() => onPasteLink(item.id)} type="button">
              <Clipboard aria-hidden="true" />
            </button>
          </div>
          {hasLinkWarning ? <p className="ofw-warn">{copy.linkWarning}</p> : null}
          <div className="ofw-find">
            <a href="https://www.amazon.co.jp/?ref_=abn_logo" rel="noreferrer" target="_blank">
              {copy.wFindAmazon}
              <ExternalLink aria-hidden="true" />
            </a>
            <a href="https://www.ikea.com/jp/ja/" rel="noreferrer" target="_blank">
              {copy.wFindIkea}
              <ExternalLink aria-hidden="true" />
            </a>
          </div>
          <div className="ofw-nf">
            <span className="ofw-nf__l">{copy.wMemoOpt}</span>
            <input
              aria-label={copy.wMemoOpt}
              autoComplete="off"
              className="ofw-nf__in"
              onChange={(event) => onChange(item.id, { memo: event.target.value })}
              placeholder={copy.itemMemoPlaceholder}
              type="text"
              value={item.memo}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const OrderItemRow = memo(OrderItemRowComponent);
