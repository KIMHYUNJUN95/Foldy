"use client";

// 주문 요청 폼. 화이트 리디자인(2026-10-14, 시안 OrderNew-Phone · OrderConfirm-Phone · Order-Fold): 상자 없이
// 이름표 칸(건물 · 요청자 자동) → 품목 줄(「첫 품목 이름이 요청 제목이 돼요」) → 긴급도 · 사유 → [요청 보내기] →
// 확인 시트(품목 · 수량 · 합계). 제목 칸은 없다 — 서버가 첫 품목 이름을 제목으로 쓴다(createOrderRequest).

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { createOrderRequest } from "@/app/mobile/orders/new/actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type { PreviewItem } from "@/components/announcements/announcement-image-uploader";
import {
  OrderItemRow,
  type OrderLineItem,
  type OrderLinkDomain,
} from "@/components/requests/order-item-row";
import { PhotoUploadStrip, usePhotoUpload } from "@/components/requests/photo-upload-progress";
import type { Dictionary } from "@/lib/i18n";
import { localizePropertyName } from "@/lib/room-label-normalization";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import "@/components/requests/order-form.css";

type OrderCreateFormProps = {
  buildingLabels: Record<string, string>;
  buildings: string[];
  copy: Dictionary["mobile"]["orderForm"];
  imgCopy: Dictionary["requestImages"];
  organizationId: string;
  reporterName: string;
  shareError?: boolean;
  sharedUrl?: string | null;
};

type Urgency = "normal" | "high";
type SharedBannerKind = "injected" | "error" | null;

function createItem(): OrderLineItem {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id, link: "", memo: "", name: "", quantity: "1" };
}

function detectLinkDomain(value: string): OrderLinkDomain {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host === "amazon.co.jp" || host === "www.amazon.co.jp" || host === "amzn.asia") {
      return "amazon";
    }
    if ((host === "ikea.com" || host === "www.ikea.com") && path.startsWith("/jp")) {
      return "ikea";
    }
    return "other";
  } catch {
    return null;
  }
}

export function OrderCreateForm({
  buildingLabels,
  buildings,
  copy,
  imgCopy,
  organizationId,
  reporterName,
  shareError,
  sharedUrl,
}: OrderCreateFormProps) {
  const [items, setItems] = useState<OrderLineItem[]>(() => {
    const first = createItem();
    if (sharedUrl) {
      return [{ ...first, link: sharedUrl }];
    }
    return [first];
  });
  const [sharedBannerKind, setSharedBannerKind] = useState<SharedBannerKind>(
    sharedUrl ? "injected" : shareError ? "error" : null,
  );
  const [urgency, setUrgency] = useState<Urgency>("normal");
  const [reason, setReason] = useState("");
  const [building, setBuilding] = useState("");
  const [buildingOpen, setBuildingOpen] = useState(false);
  const [itemErrors, setItemErrors] = useState<Record<string, string[]>>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // 품목 사진은 「요청 보내기」 때 한 줄로 모아 올리고 확인 시트에서 사진마다 진행 · 실패한 사진만 다시(2026-10-15, 시안 Motion-C-Upload-Phone).
  const uploads = usePhotoUpload(organizationId, "order-images");
  /** 품목별 사진 목록 (itemId → PreviewItem[]) */
  const [itemPhotos, setItemPhotos] = useState<Record<string, PreviewItem[]>>({});

  const buildingRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (buildingRef.current && !buildingRef.current.contains(event.target as Node)) {
        setBuildingOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const totalQuantity = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.quantity || "0"), 0),
    [items],
  );

  const linkDomains = useMemo(() => {
    const next: Record<string, OrderLinkDomain> = {};
    for (const item of items) {
      next[item.id] = detectLinkDomain(item.link);
    }
    return next;
  }, [items]);

  const updateItem = useCallback((id: string, patch: Partial<OrderLineItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
    setItemErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setFormMessage(null);
  }, []);

  const addItem = useCallback(() => {
    setItems((current) => [...current, createItem()]);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((current) => (current.length === 1 ? current : current.filter((item) => item.id !== id)));
    setItemErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    // 삭제된 품목의 사진 blob URL 해제
    setItemPhotos((current) => {
      const photos = current[id] ?? [];
      for (const p of photos) URL.revokeObjectURL(p.previewUrl);
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const handlePhotosChange = useCallback((id: string, photos: PreviewItem[]) => {
    setItemPhotos((current) => ({ ...current, [id]: photos }));
  }, []);

  const pasteLink = useCallback(async (id: string) => {
    try {
      const value = await navigator.clipboard.readText();
      if (!value) return;
      updateItem(id, { link: value.trim() });
    } catch {
      setFormMessage(copy.pasteUnavailable);
    }
  }, [copy.pasteUnavailable, updateItem]);

  function validateItems() {
    const nextErrors: Record<string, string[]> = {};
    for (const item of items) {
      const errors: string[] = [];
      if (!item.name.trim()) errors.push("name");
      if (!item.quantity.trim() || Number(item.quantity) <= 0) errors.push("quantity");
      if (errors.length > 0) nextErrors[item.id] = errors;
    }
    setItemErrors(nextErrors);
    return nextErrors;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormMessage(null);
    if (!building) {
      setFormMessage(copy.confirmMissing);
      return;
    }
    const nextErrors = validateItems();
    if (Object.keys(nextErrors).length > 0) {
      setFormMessage(copy.confirmMissing);
      return;
    }
    setConfirmOpen(true);
  }

  async function handleConfirmSubmit() {
    const form = formRef.current;
    if (!form) return;
    const nextErrors = validateItems();
    if (!building || Object.keys(nextErrors).length > 0) {
      setConfirmOpen(false);
      setFormMessage(copy.confirmMissing);
      return;
    }

    const requestId = uploads.requestId();
    const formData = new FormData(form);
    formData.set("id", requestId);
    formData.set("buildingName", building);
    formData.set("urgency", urgency);
    formData.set("reason", reason);

    // 품목별 사진을 한 줄로 모아 올린 뒤 주소를 다시 품목에 나눠 붙인다. 실패하면 시트에 남아 빨간 「다시」.
    const flat = items.flatMap((item) => (itemPhotos[item.id] ?? []).map((photo) => ({ itemId: item.id, photo })));
    const urls = flat.length > 0 ? await uploads.run(flat.map((f) => f.photo)) : [];
    if (!urls) return;
    const itemsWithPhotos = items.map((item) => {
      const mine = flat.flatMap((f, i) => (f.itemId === item.id ? [urls[i]] : []));
      return mine.length > 0 ? { ...item, imageUrls: mine } : item;
    });
    formData.set("itemsJson", JSON.stringify(itemsWithPhotos));
    startTransition(async () => {
      await createOrderRequest(formData);
    });
  }

  const urgencyLabel = urgency === "high" ? copy.urgencyHigh : copy.urgencyNormal;
  const buildingName = building ? localizePropertyName(building, buildingLabels) : copy.buildingPlaceholder;

  return (
    <>
      <form className="ofw" onSubmit={handleSubmit} ref={formRef}>
        {sharedBannerKind !== null ? (
          <p className={cn("ofw-banner", sharedBannerKind === "error" && "is-err")}>
            <span>{sharedBannerKind === "error" ? copy.shareInvalidUrl : copy.shareInjected}</span>
            <button aria-label={copy.cancel} onClick={() => setSharedBannerKind(null)} type="button">
              <X aria-hidden="true" />
            </button>
          </p>
        ) : null}

        <section className="ofw-sec">
          <div className={cn("ofw-nf ofw-dd", buildingOpen && "is-open")} ref={buildingRef}>
            <span className="ofw-nf__l">{copy.building}</span>
            <button
              aria-expanded={buildingOpen}
              aria-haspopup="listbox"
              className={cn("ofw-nf__in ofw-dd__btn", !building && "is-ph")}
              disabled={buildings.length === 0}
              onClick={() => setBuildingOpen(!buildingOpen)}
              type="button"
            >
              <span>{buildingName}</span>
              <ChevronDown aria-hidden="true" />
            </button>
            {buildingOpen && buildings.length > 0 ? (
              <ul className="ofw-dd__menu" role="listbox">
                {buildings.map((b) => (
                  <li key={b} role="option" aria-selected={building === b}>
                    <button
                      className={building === b ? "on" : ""}
                      onClick={() => {
                        setBuilding(b);
                        setBuildingOpen(false);
                        setFormMessage(null);
                      }}
                      type="button"
                    >
                      {localizePropertyName(b, buildingLabels)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="ofw-nf">
            <span className="ofw-nf__l">{copy.reporter}</span>
            <div className="ofw-nf__in ofw-ro">
              <span>{reporterName}</span>
              <em>{copy.wAuto}</em>
            </div>
          </div>
        </section>

        <section className="ofw-sec ofw-items">
          <div className="ofw-sec__h">
            <b>{copy.itemsTitle}</b>
            <span className="num">{copy.wItemsCount.replace("{n}", String(items.length))}</span>
          </div>
          <p className="ofw-hint">{copy.wTitleHint}</p>
          {items.map((item, index) => (
            <OrderItemRow
              canRemove={items.length > 1}
              copy={copy}
              domain={linkDomains[item.id]}
              errors={itemErrors[item.id] ?? []}
              imgCopy={imgCopy}
              index={index}
              item={item}
              key={item.id}
              onChange={updateItem}
              onPasteLink={pasteLink}
              onPhotosChange={handlePhotosChange}
              onRemove={removeItem}
              photos={itemPhotos[item.id] ?? []}
            />
          ))}
          {items.length < 40 ? (
            <button className="ofw-add" onClick={addItem} type="button">
              <Plus aria-hidden="true" />
              {copy.addItem}
            </button>
          ) : null}
        </section>

        <section className="ofw-sec">
          <div className="ofw-urg">
            <span className="ofw-k">{copy.urgency}</span>
            <div className="ofw-seg" role="radiogroup" aria-label={copy.urgency}>
              {(["normal", "high"] as const).map((tone) => (
                <button
                  aria-checked={urgency === tone}
                  className={urgency === tone ? "on" : ""}
                  key={tone}
                  onClick={() => {
                    haptic("light");
                    setUrgency(tone);
                  }}
                  role="radio"
                  type="button"
                >
                  {tone === "normal" ? copy.urgencyNormal : copy.urgencyHigh}
                </button>
              ))}
            </div>
          </div>
          <label className="ofw-nf">
            <span className="ofw-nf__l">{copy.wReasonOpt}</span>
            <textarea
              className="ofw-nf__in ofw-ta"
              onChange={(e) => setReason(e.target.value)}
              placeholder={copy.reasonPlaceholder}
              rows={2}
              value={reason}
            />
          </label>
        </section>

        {formMessage ? <p className="ofw-err">{formMessage}</p> : null}

        <button className="ofw-submit" disabled={isPending} type="submit">
          {copy.wSubmit}
        </button>
      </form>

      {confirmOpen ? (
        <BottomSheet
          ariaLabel={copy.wConfirmTitle}
          onClose={() => {
            if (uploads.running) return;
            uploads.abandon();
            setConfirmOpen(false);
          }}
        >
          {({ close }) => (
            <div className="ofw-sheet">
              <div className="ofw-sheet__h">
                <h3>{copy.wConfirmTitle}</h3>
                <span>
                  {buildingName} · {urgencyLabel} · {copy.wReporterIs.replace("{who}", reporterName)}
                </span>
              </div>
              <div className="ofw-sheet__list">
                {items.map((item) => (
                  <div className="ofw-sheet__row" key={item.id}>
                    <span>{item.name}</span>
                    <b className="num">× {item.quantity}</b>
                  </div>
                ))}
                <div className="ofw-sheet__sum">
                  <span>{copy.wItemsN.replace("{n}", String(items.length))}</span>
                  <span>{copy.wTotalN.replace("{n}", String(totalQuantity))}</span>
                </div>
              </div>
              <PhotoUploadStrip
                items={uploads.items}
                states={uploads.states}
                retryLabel={imgCopy.uploadRetry}
                progressLabel={imgCopy.uploadProgress}
                failedLabel={imgCopy.uploadFailed}
                onRetry={handleConfirmSubmit}
              />
              <div className="ofw-sheet__btns">
                <button className="ofw-btn is-gray" disabled={uploads.running} onClick={close} type="button">
                  {copy.cancel}
                </button>
                <button className="ofw-btn is-pri" disabled={isPending || uploads.running} onClick={handleConfirmSubmit} type="button">
                  {isPending || uploads.running ? <span className="ofw-spin" aria-hidden="true" /> : null}
                  {copy.wSubmit}
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}
