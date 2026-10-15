"use client";

import { useRef, useState, useTransition } from "react";
import { Package, User } from "lucide-react";
import { createLostItem } from "@/app/mobile/lost-found/new/actions";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import { LostFoundConfirmModal } from "@/components/requests/lost-found-confirm-modal";
import { Button } from "@/components/ui/button";
import { PhotoUploadStrip, usePhotoUpload } from "@/components/requests/photo-upload-progress";
import type { Dictionary } from "@/lib/i18n";
import type { ActiveRoomCatalogItem } from "@/lib/rooms";
import { resolveRequestCatalogLocation } from "@/lib/request-location";
import { getDisplayRoomLabel } from "@/lib/room-label-normalization";

type LostFoundLinkedFormProps = {
  buildingLabels: Record<string, string>;
  cleaningSessionId: string;
  copy: Dictionary["lostFound"];
  defaultRoom: string;
  imgCopy: Dictionary["requestImages"];
  initialPropertyName: string;
  linkedGuestName: string;
  linkedReservationId: string;
  organizationId: string;
  reporterName: string;
  roomCatalog: readonly ActiveRoomCatalogItem[];
};

const FIELD_CLASS =
  "h-12 w-full rounded-xl border border-border bg-background/60 px-3.5 text-sm font-semibold text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20";

const PANEL_CLASS =
  "flex flex-col gap-4 rounded-2xl border border-border bg-surface/70 p-4 shadow-glass backdrop-blur-xl";

function SectionLabel({ children, index }: { children: string; index: number }) {
  return (
    <h2 className="pl-1 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
      {index}. {children}
    </h2>
  );
}

export function LostFoundLinkedForm({
  buildingLabels,
  cleaningSessionId,
  copy,
  defaultRoom,
  imgCopy,
  initialPropertyName,
  linkedGuestName,
  linkedReservationId,
  organizationId,
  reporterName,
  roomCatalog,
}: LostFoundLinkedFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const uploaderRef = useRef<AnnouncementImageUploaderHandle>(null);
  const [itemName, setItemName] = useState("");
  const [memo, setMemo] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // 사진은 「확인」 때 올리고 확인 창에서 사진마다 진행 · 실패한 사진만 다시(2026-10-15, 시안 Motion-C-Upload-Phone).
  const photos = usePhotoUpload(organizationId, "lost-items");

  const resolvedLocation = resolveRequestCatalogLocation(defaultRoom, roomCatalog, buildingLabels);
  const defaultBuilding = initialPropertyName || resolvedLocation.buildingName || "";
  // Collapse Arakicho sub-units (201_2 → 201) to match the picker / calendar. The cleaning_session_id
  // FK keeps the exact session link regardless of the room label.
  const canonicalRoom = getDisplayRoomLabel(defaultBuilding, resolvedLocation.canonicalRoomLabel);
  const buildingDisplay = resolvedLocation.buildingLabel ?? copy.form.noBuildingInfo;
  const roomDisplay = canonicalRoom || copy.form.noRoomInfo;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!defaultBuilding) {
      setValidationError(copy.errors.missing_building);
      return;
    }
    if (!canonicalRoom) {
      setValidationError(copy.errors.invalid_room);
      return;
    }
    if (!itemName.trim()) {
      setValidationError(copy.errors.missing_item_name);
      return;
    }

    setValidationError(null);
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    const form = formRef.current;
    if (!form) return;

    if (!defaultBuilding) {
      setConfirmOpen(false);
      setValidationError(copy.errors.missing_building);
      return;
    }
    if (!canonicalRoom) {
      setConfirmOpen(false);
      setValidationError(copy.errors.invalid_room);
      return;
    }
    if (!itemName.trim()) {
      setConfirmOpen(false);
      setValidationError(copy.errors.missing_item_name);
      return;
    }

    const formData = new FormData(form);
    const requestId = photos.requestId();
    formData.set("id", requestId);
    formData.set("propertyName", defaultBuilding);
    formData.set("roomLabel", canonicalRoom);
    formData.set("itemName", itemName.trim());

    const items = uploaderRef.current?.getItems() ?? [];
    const imageUrls = items.length > 0 ? await photos.run(items) : [];
    // 실패한 사진이 있으면 창에 남아 빨간 「다시」 — 다시 누르면 실패한 것만 올린다.
    if (!imageUrls) return;
    for (const url of imageUrls) {
      formData.append("imageUrls", url);
    }

    startTransition(async () => {
      await createLostItem(formData);
    });
  }

  return (
    <>
      <form className="flex flex-col gap-6" onSubmit={handleSubmit} ref={formRef}>
        <input name="cleaningSessionId" type="hidden" value={cleaningSessionId} />
        <input name="guestName" type="hidden" value={linkedGuestName} />
        <input name="propertyName" type="hidden" value={defaultBuilding} />
        <input name="reservationId" type="hidden" value={linkedReservationId} />
        <input name="roomLabel" type="hidden" value={canonicalRoom} />

        <section className="flex flex-col gap-2">
          <SectionLabel index={1}>{copy.form.sectionLocation}</SectionLabel>
          <div className={PANEL_CLASS}>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{copy.form.building}</span>
              <div className="flex h-12 items-center gap-2 rounded-xl border border-border bg-muted/40 px-3.5">
                <span className="truncate text-sm font-semibold text-foreground">{buildingDisplay}</span>
              </div>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{copy.room}</span>
              <div className="flex h-12 items-center gap-2 rounded-xl border border-border bg-muted/40 px-3.5">
                <span className="truncate text-sm font-semibold text-foreground">{roomDisplay}</span>
              </div>
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <SectionLabel index={2}>{copy.form.sectionDetails}</SectionLabel>
          <div className={PANEL_CLASS}>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{copy.itemName}</span>
              <input
                autoComplete="off"
                className={FIELD_CLASS}
                name="itemName"
                onChange={(event) => {
                  setItemName(event.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder={copy.itemNamePlaceholder}
                required
                type="text"
                value={itemName}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{copy.memo}</span>
              <textarea
                className="min-h-24 w-full resize-none rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-sm font-medium text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
                name="memo"
                onChange={(event) => setMemo(event.target.value)}
                placeholder={copy.memoPlaceholder}
                rows={4}
                value={memo}
              />
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <SectionLabel index={3}>{copy.form.sectionPhotos}</SectionLabel>
          <div className={PANEL_CLASS}>
            <AnnouncementImageUploader
              addImagesLabel={imgCopy.addPhotos}
              errorCountExceeded={imgCopy.errorCount}
              errorSizeExceeded={imgCopy.errorSize}
              errorTypeInvalid={imgCopy.errorType}
              imageAttachmentsLabel={imgCopy.attachments}
              imageLimitLabel={imgCopy.limit}
              imageRemoveLabel={imgCopy.remove}
              ref={uploaderRef}
            />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <SectionLabel index={4}>{copy.form.sectionInfo}</SectionLabel>
          <div className={PANEL_CLASS}>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{copy.reporter}</span>
              <div className="flex h-12 items-center gap-2 rounded-xl border border-border bg-muted/40 px-3.5">
                <User className="size-4 text-[#1F3A5F]" aria-hidden="true" />
                <span className="truncate text-sm font-semibold text-foreground">{reporterName}</span>
              </div>
            </div>
          </div>
        </section>

        {validationError ? (
          <p className="text-xs font-semibold text-destructive">{validationError}</p>
        ) : null}

        <Button
          className="h-14 w-full rounded-2xl text-base font-black shadow-glass"
          disabled={isPending}
          type="submit"
        >
          <Package className="mr-2 size-5" aria-hidden="true" />
          {copy.reportButton}
        </Button>
      </form>

      <LostFoundConfirmModal
        cancelLabel={copy.cancelConfirm}
        confirmLabel={copy.confirmSubmit}
        description={copy.form.confirmDescription}
        onCancel={() => {
          if (photos.running) return;
          photos.abandon();
          setConfirmOpen(false);
        }}
        onConfirm={handleConfirm}
        open={confirmOpen}
        pending={isPending || photos.running}
        rows={[
          { label: copy.form.confirmType, value: copy.form.confirmTypeValue },
          {
            label: copy.form.confirmLocation,
            value: `${roomDisplay} (${buildingDisplay})`,
          },
          { label: copy.form.confirmItem, value: itemName.trim() },
        ]}
        title={copy.confirmationTitle}
      >
        <PhotoUploadStrip
          items={photos.items}
          states={photos.states}
          retryLabel={imgCopy.uploadRetry}
          progressLabel={imgCopy.uploadProgress}
          failedLabel={imgCopy.uploadFailed}
          onRetry={handleConfirm}
        />
      </LostFoundConfirmModal>
    </>
  );
}
