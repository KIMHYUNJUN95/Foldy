"use client";

// 분실물 신고 폼 — 화이트 리디자인(2026-10-14, 시안 LFNew-Phone · LFNewConfirm-Phone · LFNew-Fold).

import { useRef, useState, useTransition } from "react";
import { createLostItem } from "@/app/mobile/lost-found/new/actions";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import { ChoiceTiles, ConfirmFormSheet, PickField, ReadonlyField } from "@/components/requests/request-form-kit";
import { PhotoUploadStrip, usePhotoUpload } from "@/components/requests/photo-upload-progress";
import type { Dictionary, Locale } from "@/lib/i18n";
import { tokyoToday } from "@/lib/tokyo-date";
import { lostItemCategories } from "@/lib/lost-found-constants";
import type { ActiveRoomCatalogItem } from "@/lib/rooms";
import { localizePropertyName } from "@/lib/room-label-normalization";

type LostFoundCreateFormProps = {
  buildingLabels: Record<string, string>;
  cleaningSessionId: string;
  copy: Dictionary["lostFound"];
  defaultRoom: string;
  imgCopy: Dictionary["requestImages"];
  initialPropertyName: string;
  locale: Locale;
  linkedGuestName: string;
  linkedReservationId: string;
  organizationId: string;
  reporterName: string;
  roomCatalog: readonly ActiveRoomCatalogItem[];
};

export function LostFoundCreateForm({
  buildingLabels,
  cleaningSessionId,
  copy,
  defaultRoom,
  imgCopy,
  initialPropertyName,
  locale,
  linkedGuestName,
  linkedReservationId,
  organizationId,
  reporterName,
  roomCatalog,
}: LostFoundCreateFormProps) {
  const inferredInitialBuilding = (() => {
    if (initialPropertyName) return initialPropertyName;
    if (!defaultRoom) return "";
    const matches = roomCatalog.filter((item) => item.canonicalRoomLabel === defaultRoom);
    return matches.length === 1 ? matches[0]?.propertyName ?? "" : "";
  })();
  const inferredInitialRoom = inferredInitialBuilding ? defaultRoom : "";

  const formRef = useRef<HTMLFormElement>(null);
  const uploaderRef = useRef<AnnouncementImageUploaderHandle>(null);
  const [selectedBuilding, setSelectedBuilding] = useState(inferredInitialBuilding);
  const [selectedRoom, setSelectedRoom] = useState(inferredInitialRoom);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState({ item: "", building: "", room: "" });
  const [isPending, startTransition] = useTransition();
  // 사진은 「확인」 때 올리고 확인 시트에서 사진마다 진행 · 실패한 사진만 다시(2026-10-15, 시안 Motion-C-Upload-Phone).
  const photos = usePhotoUpload(organizationId, "lost-items");

  const [selectedCategory, setSelectedCategory] = useState("");
  const [photoCount, setPhotoCount] = useState(0);

  // Deduplicate and sort active properties
  const buildings = Array.from(new Set(roomCatalog.map((item) => item.propertyName))).sort();

  // Rooms for the selected building — deduped by displayRoomLabel so Arakicho sub-units (201 / 201_2
  // = the same physical room, two Beds24 accounts) collapse to one "201" entry, matching the calendar.
  const availableRooms = (() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of roomCatalog) {
      if (item.propertyName === selectedBuilding && !seen.has(item.displayRoomLabel)) {
        seen.add(item.displayRoomLabel);
        result.push(item.displayRoomLabel);
      }
    }
    return result.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  })();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    if (!selectedBuilding) {
      setValidationError(copy.errors.missing_building);
      return;
    }
    if (!selectedRoom) {
      setValidationError(copy.errors.invalid_room);
      return;
    }

    const formData = new FormData(event.currentTarget);
    const itemName = String(formData.get("itemName") ?? "").trim();
    if (!itemName) {
      setValidationError(copy.errors.missing_item_name);
      return;
    }

    setPhotoCount(uploaderRef.current?.getItems().length ?? 0);
    setSummary({
      item: itemName,
      building: selectedBuilding,
      room: selectedRoom,
    });
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    const form = formRef.current;
    if (!form) return;

    if (!selectedBuilding) {
      setConfirmOpen(false);
      setValidationError(copy.errors.missing_building);
      return;
    }
    if (!selectedRoom) {
      setConfirmOpen(false);
      setValidationError(copy.errors.invalid_room);
      return;
    }

    const formData = new FormData(form);
    const itemName = String(formData.get("itemName") ?? "").trim();
    if (!itemName) {
      setConfirmOpen(false);
      setValidationError(copy.errors.missing_item_name);
      return;
    }

    const requestId = photos.requestId();
    formData.set("id", requestId);
    formData.set("propertyName", selectedBuilding);
    formData.set("roomLabel", selectedRoom);
    formData.set("itemName", itemName);

    const items = uploaderRef.current?.getItems() ?? [];
    const imageUrls = items.length > 0 ? await photos.run(items) : [];
    // 실패한 사진이 있으면 시트에 남아 빨간 「다시」 — 다시 누르면 실패한 것만 올린다.
    if (!imageUrls) return;
    for (const url of imageUrls) {
      formData.append("imageUrls", url);
    }

    startTransition(async () => {
      await createLostItem(formData);
    });
  }

  const disposeLabel = (() => {
    const [y, m, d] = tokyoToday().split("-").map(Number);
    const due = new Date(Date.UTC(y, m - 1, d + 14));
    return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(due);
  })();

  return (
    <>
      {/* 화이트 리디자인(2026-10-14, 시안 LFNew-Phone · LFNewConfirm-Phone · LFNew-Fold): 상자 없이 이름표 칸 → 분류 타일 → 확인 시트. */}
      <form action={createLostItem} className="ofw" onSubmit={handleSubmit} ref={formRef}>
        <input name="cleaningSessionId" type="hidden" value={cleaningSessionId} />
        <input name="guestName" type="hidden" value={linkedGuestName} />
        <input name="reservationId" type="hidden" value={linkedReservationId} />
        <input name="propertyName" type="hidden" value={selectedBuilding} />
        <input name="roomLabel" type="hidden" value={selectedRoom} />
        <input name="category" type="hidden" value={selectedCategory} />

        <section className="ofw-sec">
          <PickField
            label={copy.form.building}
            onChange={(v) => {
              setSelectedBuilding(v);
              setSelectedRoom("");
              setValidationError(null);
            }}
            options={buildings.map((b) => ({ value: b, label: localizePropertyName(b, buildingLabels) }))}
            placeholder={copy.form.buildingPlaceholder}
            value={selectedBuilding}
          />
          <PickField
            disabled={!selectedBuilding}
            emptyText={copy.form.noRoomsInBuilding}
            label={copy.room}
            onChange={(v) => {
              setSelectedRoom(v);
              setValidationError(null);
            }}
            options={availableRooms.map((r) => ({ value: r, label: r }))}
            placeholder={selectedBuilding ? copy.form.roomPlaceholderSelectRoom : copy.form.roomPlaceholderSelectBuilding}
            value={selectedRoom}
          />
        </section>

        <section className="ofw-sec">
          <label className="ofw-nf">
            <span className="ofw-nf__l">{copy.itemName}</span>
            <input autoComplete="off" className="ofw-nf__in" name="itemName" placeholder={copy.itemNamePlaceholder} type="text" />
          </label>
          <ChoiceTiles
            label={copy.wCategory}
            onChange={setSelectedCategory}
            options={lostItemCategories.map((key) => ({ value: key, label: copy.categoryLabels[key] }))}
            value={selectedCategory}
          />
          <label className="ofw-nf">
            <span className="ofw-nf__l">{copy.wMemoOpt}</span>
            <textarea className="ofw-nf__in ofw-ta" name="memo" placeholder={copy.memoPlaceholder} rows={2} />
          </label>
        </section>

        <section className="ofw-sec">
          <AnnouncementImageUploader
            addImagesLabel={imgCopy.addPhotos}
            errorCountExceeded={imgCopy.errorCount}
            errorSizeExceeded={imgCopy.errorSize}
            errorTypeInvalid={imgCopy.errorType}
            imageAttachmentsLabel={copy.wPhotosOpt}
            imageLimitLabel={imgCopy.limit}
            imageRemoveLabel={imgCopy.remove}
            ref={uploaderRef}
            variant="white"
          />
          <ReadonlyField label={copy.reporter} tail={copy.wAuto} value={reporterName} />
        </section>

        {validationError ? (
          <p className="ofw-err" role="alert">
            {validationError}
          </p>
        ) : null}

        <button className="ofw-submit" disabled={isPending} type="submit">
          {copy.reportButton}
        </button>
      </form>

      {confirmOpen ? (
        <ConfirmFormSheet
          cancelLabel={copy.wCancel}
          confirmLabel={copy.wRegister}
          onCancel={() => {
            photos.abandon();
            setConfirmOpen(false);
          }}
          onConfirm={handleConfirm}
          pending={isPending || photos.running}
          rows={[
            { k: copy.wLoc, v: `${summary.room} · ${localizePropertyName(summary.building, buildingLabels)}` },
            {
              k: copy.wCategory,
              v: selectedCategory ? copy.categoryLabels[selectedCategory as keyof typeof copy.categoryLabels] : copy.wNone,
            },
            { k: copy.wPhotos, v: photoCount > 0 ? copy.wPhotosN.replace("{n}", String(photoCount)) : copy.wNone },
            { k: copy.wKeep, v: copy.wKeepValue.replace("{date}", disposeLabel) },
          ]}
          sub={summary.item}
          title={copy.wConfirmTitle}
        >
          <PhotoUploadStrip
            items={photos.items}
            states={photos.states}
            retryLabel={imgCopy.uploadRetry}
            progressLabel={imgCopy.uploadProgress}
            failedLabel={imgCopy.uploadFailed}
            onRetry={handleConfirm}
          />
        </ConfirmFormSheet>
      ) : null}
    </>
  );
}
