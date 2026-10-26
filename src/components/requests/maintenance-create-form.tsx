"use client";

// 수리 신고 폼 — 화이트 리디자인(2026-10-14, 시안 MaintNew-Phone · MaintNewConfirm-Phone · MaintNew-Fold).

import { useRef, useState, useTransition } from "react";
import { createMaintenanceReport } from "@/app/mobile/maintenance/new/actions";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import type { UrgencyTone } from "@/components/requests/maintenance-confirm-modal";
import { ChoiceTiles, ConfirmFormSheet, PickField, ReadonlyField } from "@/components/requests/request-form-kit";
import { PhotoUploadStrip, usePhotoUpload } from "@/components/requests/photo-upload-progress";
import type { Dictionary } from "@/lib/i18n";
import { maintenanceCategories } from "@/lib/maintenance-constants";
import type { ActiveRoomCatalogItem } from "@/lib/rooms";
import { localizePropertyName } from "@/lib/room-label-normalization";

type MaintenanceCreateFormProps = {
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

/**
 * 방 고르기의 「건물 전체」 값 — 번역된 라벨이 아니라 고정 토큰(2026-10-26). 예전엔 보는 사람 언어의 「건물 전체」가
 * 그대로 room_label 에 저장돼 다른 언어 사용자에게 한국어 · 일본어가 남았다. 서버는 `is_building_only` + room_label "-" 로
 * 저장하고, 화면은 플래그를 보고 사전의 `form.roomBuildingOnly` 를 그린다.
 */
const BUILDING_ONLY_ROOM = "__building_only__";

export function MaintenanceCreateForm({
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
}: MaintenanceCreateFormProps) {
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
  const [urgency, setUrgency] = useState<UrgencyTone>("normal");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState({ item: "", room: "" });
  const [isPending, startTransition] = useTransition();
  // 사진은 「확인」 때 올리고 확인 시트에서 사진마다 진행 · 실패한 사진만 다시(2026-10-15, 시안 Motion-C-Upload-Phone).
  const photos = usePhotoUpload(organizationId, "maintenance-reports");

  const [selectedCategory, setSelectedCategory] = useState("");
  const [photoCount, setPhotoCount] = useState(0);
  const buildings = Array.from(new Set(roomCatalog.map((item) => item.propertyName))).sort();

  // displayRoomLabel(canonicalRoomLabel 아님)을 쓴다. 아라키초 하위 호실(201 / 201_2 = 같은
  // 실제 객실, Beds24 계정 둘)이 "201" 하나로 합쳐져 예약 캘린더와 일치한다.
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
    const issueTitle = String(formData.get("issueTitle") ?? "").trim();
    if (!issueTitle) {
      setValidationError(copy.errors.missing_issue_title);
      return;
    }

    setPhotoCount(uploaderRef.current?.getItems().length ?? 0);
    setSummary({
      item: issueTitle,
      room: `${selectedRoom === BUILDING_ONLY_ROOM ? copy.form.roomBuildingOnly : selectedRoom} · ${localizePropertyName(selectedBuilding, buildingLabels)}`,
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
    const issueTitle = String(formData.get("issueTitle") ?? "").trim();
    if (!issueTitle) {
      setConfirmOpen(false);
      setValidationError(copy.errors.missing_issue_title);
      return;
    }

    const requestId = photos.requestId();
    formData.set("id", requestId);
    formData.set("propertyName", selectedBuilding);
    const isBuildingOnly = selectedRoom === BUILDING_ONLY_ROOM;
    // 「건물 전체」는 번역된 라벨을 방 이름으로 보내지 않는다 — 플래그 + 고정값 "-"(서버도 같은 값으로 저장).
    formData.set("roomLabel", isBuildingOnly ? "-" : selectedRoom);
    formData.set("isBuildingOnly", isBuildingOnly ? "1" : "0");
    formData.set("issueTitle", issueTitle);

    const items = uploaderRef.current?.getItems() ?? [];
    const imageUrls = items.length > 0 ? await photos.run(items) : [];
    // 실패한 사진이 있으면 시트에 남아 빨간 「다시」 — 다시 누르면 실패한 것만 올린다.
    if (!imageUrls) return;
    for (const url of imageUrls) {
      formData.append("imageUrls", url);
    }

    startTransition(async () => {
      await createMaintenanceReport(formData);
    });
  }

  const urgencyOptions = URGENCY_TONES.map((tone) => ({ value: tone, label: copy.form.urgencies[tone] }));

  return (
    <>
      {/* 화이트 리디자인(2026-10-14, 시안 MaintNew-Phone · MaintNewConfirm-Phone · MaintNew-Fold): 이름표 칸 → 카테고리 타일 → 긴급도 4칸 → 확인 시트. */}
      <form action={createMaintenanceReport} className="ofw" onSubmit={handleSubmit} ref={formRef}>
        <input name="cleaningSessionId" type="hidden" value={cleaningSessionId} />
        <input name="propertyName" type="hidden" value={selectedBuilding} />
        <input name="guestName" type="hidden" value={linkedGuestName} />
        <input name="reservationId" type="hidden" value={linkedReservationId} />
        <input name="roomLabel" type="hidden" value={selectedRoom} />
        <input name="category" type="hidden" value={selectedCategory} />
        <input name="priority" type="hidden" value={urgency} />

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
            options={[
              { value: BUILDING_ONLY_ROOM, label: copy.form.roomBuildingOnly },
              ...availableRooms.map((r) => ({ value: r, label: r })),
            ]}
            placeholder={selectedBuilding ? copy.form.roomPlaceholderSelectRoom : copy.form.roomPlaceholderSelectBuilding}
            value={selectedRoom}
          />
          <p className="ofw-field-hint">{copy.wRoomHint}</p>
        </section>

        <section className="ofw-sec">
          <label className="ofw-nf">
            <span className="ofw-nf__l">{copy.issueTitle}</span>
            <input autoComplete="off" className="ofw-nf__in" name="issueTitle" placeholder={copy.issueTitlePlaceholder} type="text" />
          </label>
          <ChoiceTiles
            label={copy.wCategory}
            onChange={setSelectedCategory}
            options={maintenanceCategories.map((key) => ({ value: key, label: copy.form.categories[key] }))}
            value={selectedCategory}
          />
          <ChoiceTiles
            cols={4}
            dangerValue="urgent"
            label={copy.wUrgency}
            onChange={(v) => setUrgency(v as UrgencyTone)}
            options={urgencyOptions}
            value={urgency}
          />
          <label className="ofw-nf">
            <span className="ofw-nf__l">{copy.wDescOpt}</span>
            <textarea className="ofw-nf__in ofw-ta" name="description" placeholder={copy.descriptionPlaceholder} rows={3} />
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
          {copy.wSubmit}
        </button>
      </form>

      {confirmOpen ? (
        <ConfirmFormSheet
          cancelLabel={copy.wCancel}
          confirmLabel={copy.wSend}
          onCancel={() => {
            photos.abandon();
            setConfirmOpen(false);
          }}
          onConfirm={handleConfirm}
          pending={isPending || photos.running}
          rows={[
            { k: copy.wLoc, v: summary.room },
            {
              k: copy.wCategory,
              v: selectedCategory ? copy.form.categories[selectedCategory as keyof typeof copy.form.categories] : copy.wNone,
            },
            { k: copy.wUrgency, v: copy.form.urgencies[urgency], danger: urgency === "urgent" },
            { k: copy.wPhotos, v: photoCount > 0 ? copy.wPhotosN.replace("{n}", String(photoCount)) : copy.wNone },
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
