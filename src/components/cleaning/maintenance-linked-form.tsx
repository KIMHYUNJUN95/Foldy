"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, User, Wrench } from "lucide-react";
import { createMaintenanceReport } from "@/app/mobile/maintenance/new/actions";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import {
  MaintenanceConfirmModal,
  type UrgencyTone,
} from "@/components/requests/maintenance-confirm-modal";
import { PhotoUploadStrip, usePhotoUpload } from "@/components/requests/photo-upload-progress";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n";
import { maintenanceCategories } from "@/lib/maintenance-constants";
import type { ActiveRoomCatalogItem } from "@/lib/rooms";
import { resolveRequestCatalogLocation } from "@/lib/request-location";
import { getDisplayRoomLabel } from "@/lib/room-label-normalization";
import { cn } from "@/lib/utils";

type MaintenanceLinkedFormProps = {
  buildingLabels: Record<string, string>;
  cleaningSessionId: string;
  copy: Dictionary["maintenance"];
  defaultRoom: string;
  imgCopy: Dictionary["requestImages"];
  initialPropertyName: string;
  linkedGuestName: string;
  linkedReservationId: string;
  organizationId: string;
  reporterName: string;
  roomCatalog: readonly ActiveRoomCatalogItem[];
};

const URGENCY_TONES: readonly UrgencyTone[] = ["low", "normal", "high", "urgent"];

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

function urgencyChipClass(tone: UrgencyTone, active: boolean) {
  if (active) {
    if (tone === "urgent") return "border-destructive bg-destructive/10 text-destructive";
    return "border-primary bg-primary/10 text-primary";
  }
  return "border-border bg-surface/80 text-foreground hover:bg-muted/60";
}

export function MaintenanceLinkedForm({
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
}: MaintenanceLinkedFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const uploaderRef = useRef<AnnouncementImageUploaderHandle>(null);
  const [issueTitle, setIssueTitle] = useState("");
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [urgency, setUrgency] = useState<UrgencyTone>("normal");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // 사진은 「확인」 때 올리고 확인 창에서 사진마다 진행 · 실패한 사진만 다시(2026-10-15, 시안 Motion-C-Upload-Phone).
  const photos = usePhotoUpload(organizationId, "maintenance-reports");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const categoryDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) {
        setCategoryOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const resolvedLocation = resolveRequestCatalogLocation(defaultRoom, roomCatalog, buildingLabels);
  const defaultBuilding = initialPropertyName || resolvedLocation.buildingName || "";
  // Collapse Arakicho sub-units (201_2 → 201) so the linked report shows the same room as the picker /
  // calendar. The cleaning_session_id FK keeps the exact session link regardless of the room label.
  const canonicalRoom = getDisplayRoomLabel(defaultBuilding, resolvedLocation.canonicalRoomLabel);
  const buildingDisplay = resolvedLocation.buildingLabel ?? copy.form.noBuildingInfo;
  const roomDisplay = canonicalRoom || copy.form.noRoomInfo;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!issueTitle.trim()) {
      setValidationError(copy.errors.missing_issue_title);
      return;
    }
    setValidationError(null);
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    const form = formRef.current;
    if (!form) return;
    if (!issueTitle.trim()) {
      setConfirmOpen(false);
      setValidationError(copy.errors.missing_issue_title);
      return;
    }

    const formData = new FormData(form);
    const requestId = photos.requestId();
    formData.set("id", requestId);
    formData.set("propertyName", defaultBuilding);
    formData.set("roomLabel", canonicalRoom);
    formData.set("issueTitle", issueTitle.trim());

    const items = uploaderRef.current?.getItems() ?? [];
    const imageUrls = items.length > 0 ? await photos.run(items) : [];
    // 실패한 사진이 있으면 창에 남아 빨간 「다시」 — 다시 누르면 실패한 것만 올린다.
    if (!imageUrls) return;
    for (const url of imageUrls) {
      formData.append("imageUrls", url);
    }

    startTransition(async () => {
      await createMaintenanceReport(formData);
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

        <section className={cn("flex flex-col gap-2 relative transition-all duration-150", categoryOpen ? "z-20" : "z-10")}>
          <SectionLabel index={2}>{copy.form.sectionDetails}</SectionLabel>
          <div className={PANEL_CLASS}>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{copy.issueTitle}</span>
              <input
                autoComplete="off"
                className={FIELD_CLASS}
                name="issueTitle"
                onChange={(event) => {
                  setIssueTitle(event.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder={copy.issueTitlePlaceholder}
                required
                type="text"
                value={issueTitle}
              />
            </label>

            <div className="flex flex-col gap-2" ref={categoryDropdownRef}>
              <span className="text-xs font-semibold text-muted-foreground">{copy.form.categoryLabel}</span>
              <input name="category" type="hidden" value={selectedCategory} />
              <div className="relative">
                <button
                  className={cn(
                    "flex h-12 w-full items-center justify-between rounded-xl border border-border bg-background/60 px-3.5 text-sm font-semibold text-foreground outline-none transition-colors cursor-pointer select-none text-left",
                    categoryOpen && "border-primary ring-2 ring-primary/20",
                  )}
                  onClick={() => setCategoryOpen(!categoryOpen)}
                  type="button"
                >
                  <span className={cn("truncate text-sm font-semibold", !selectedCategory && "text-muted-foreground/70")}>
                    {selectedCategory
                      ? copy.form.categories[selectedCategory as keyof typeof copy.form.categories]
                      : copy.form.categoryPlaceholder}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-200"
                    style={{ transform: categoryOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>
                {categoryOpen && (
                  <ul className="absolute left-0 z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-glass backdrop-blur-xl divide-y divide-border/20">
                    {maintenanceCategories.map((key) => (
                      <li
                        className={cn(
                          "flex h-10 w-full cursor-pointer items-center rounded-lg px-3 text-sm font-semibold transition-colors",
                          selectedCategory === key ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/80",
                        )}
                        key={key}
                        onClick={() => {
                          setSelectedCategory(key);
                          setCategoryOpen(false);
                        }}
                      >
                        {copy.form.categories[key]}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{copy.form.urgencyLabel}</span>
              <input name="priority" type="hidden" value={urgency} />
              <div className="flex flex-wrap gap-2">
                {URGENCY_TONES.map((tone) => (
                  <button
                    aria-pressed={urgency === tone}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm font-bold transition-colors active:scale-95",
                      urgencyChipClass(tone, urgency === tone),
                    )}
                    key={tone}
                    onClick={() => setUrgency(tone)}
                    type="button"
                  >
                    {copy.form.urgencies[tone]}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{copy.description}</span>
              <textarea
                className="min-h-24 w-full resize-none rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-sm font-medium text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
                name="description"
                onChange={(event) => setDescription(event.target.value)}
                placeholder={copy.descriptionPlaceholder}
                rows={4}
                value={description}
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
                <User className="size-4 text-primary" aria-hidden="true" />
                <span className="truncate text-sm font-semibold text-foreground">{reporterName}</span>
              </div>
            </div>
          </div>
        </section>

        {validationError ? (
          <p className="text-xs font-semibold text-destructive">{validationError}</p>
        ) : null}

        <Button
          className="h-14 w-full rounded-2xl bg-[#315F91] text-base font-black text-white shadow-[0_18px_34px_-22px_rgba(49,95,145,0.68)] hover:bg-[#274D76]"
          disabled={isPending}
          type="submit"
        >
          <Wrench className="mr-2 size-5" aria-hidden="true" />
          {copy.reportButton}
        </Button>
      </form>

      <MaintenanceConfirmModal
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
          { label: copy.form.confirmItem, value: issueTitle.trim() },
        ]}
        title={copy.confirmationTitle}
        urgencyLabel={copy.form.confirmUrgency}
        urgencyTone={urgency}
        urgencyValue={copy.form.urgencies[urgency]}
      >
        <PhotoUploadStrip
          items={photos.items}
          states={photos.states}
          retryLabel={imgCopy.uploadRetry}
          progressLabel={imgCopy.uploadProgress}
          failedLabel={imgCopy.uploadFailed}
          onRetry={handleConfirm}
        />
      </MaintenanceConfirmModal>
    </>
  );
}
