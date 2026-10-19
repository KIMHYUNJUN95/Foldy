"use client";

// 대시보드 수동 컴플레인 등록 — 우측 슬라이드 패널 (구현 2026-08-06).
//
// 모바일 등록 폼(`components/complaints/complaint-create.tsx`)과 **같은 서버 경로**를 쓴다:
// `createManualComplaintAction` → `createComplaint`. 화면별로 다른 저장 경로를 만들지 않는다는
// 교차 화면 계약(docs/product/25-complaint-workflow.md → Cross-surface consistency).
//
// 모바일과 다른 점은 연결 방식이다. 모바일은 예약을 고르는 길 하나뿐이라, Beds24를 거치지 않고
// 들어온 예약(전화·워크인·자사 홈페이지)은 건물·객실을 남길 방법이 없었다. 여기서는 세그먼트로
// 예약 연결 / 건물·객실 직접 선택 / 연결 안 함을 고른다.
//
// 시각 계약: 공용 `.panel` 슬라이드오버 + `.fld` + `.btn--pri`. 컴플레인 전용 스타일을 새로 만들지
// 않고 admin-console.css의 공용 primitive를 그대로 쓴다 (CLAUDE.md §4).

import Image from "next/image";
import { useMemo, useRef, useState, useTransition, type ChangeEvent } from "react";
import { Camera, Star, X } from "lucide-react";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import { AdmDropdown, type AdmOption } from "@/components/admin/shared/adm-dropdown";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import {
  createManualComplaintAction,
  uploadManualComplaintImageAction,
} from "@/app/admin/complaints/actions";
import type { PlacePickRow, ReservationPickRow } from "@/lib/complaint-reservations";
import { PLATFORMS, ratingMax, type ComplaintPlatform } from "@/components/complaints/cx-platform";

const MAX_IMAGES = 5;

const PLATFORM_KEYS = Object.keys(PLATFORMS) as ComplaintPlatform[];

type LinkMode = "reservation" | "place" | "none";

/**
 * 사전 전체가 아니라 **문자열만** 받는다. `dictionary.complaints`에는 `ratingOf` 같은 함수 값이
 * 있어 클라이언트 컴포넌트에 통째로 넘기면 RSC 직렬화가 깨진다 (커밋 cb15f7e 회귀 방지).
 */
export type CreatePanelLabels = {
  createTitle: string;
  createSub: string;
  fieldPlatform: string;
  fieldRating: string;
  fieldTitle: string;
  fieldBody: string;
  fieldBodyPlaceholder: string;
  fieldLink: string;
  fieldGuestName: string;
  fieldGuestPlaceholder: string;
  fieldImages: string;
  imagesMax: string;
  submit: string;
  required: string;
  optional: string;
  cancel: string;
  close: string;
  linkModeReservation: string;
  linkModePlace: string;
  linkModeNone: string;
  linkModeHint: string;
  pickBuilding: string;
  pickRoom: string;
  pickerSearch: string;
  pickerStaying: string;
  pickerUpcoming: string;
  pickerLiveTag: string;
  ratingNone: string;
  titleRequired: string;
  createFailed: string;
  platformDirect: string;
};

type Props = {
  labels: CreatePanelLabels;
  reservations: ReservationPickRow[];
  places: PlacePickRow[];
  onClose: () => void;
};

function platformLabel(plat: ComplaintPlatform, labels: CreatePanelLabels): string {
  return plat === "direct" ? labels.platformDirect : PLATFORMS[plat].name;
}

export function ComplaintCreatePanel({ labels, reservations, places, onClose }: Props) {
  const [isPending, startTransition] = useTransition();
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: isPending });

  const [platform, setPlatform] = useState<ComplaintPlatform>("direct");
  const [rating, setRating] = useState(0);
  const [linkMode, setLinkMode] = useState<LinkMode>("reservation");
  const [reservationId, setReservationId] = useState("");
  const [reservationSearch, setReservationSearch] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [roomLabel, setRoomLabel] = useState("");
  const [guestName, setGuestName] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const draftId = useRef(crypto.randomUUID()).current;
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const maxRating = ratingMax(platform);

  const filteredReservations = useMemo(() => {
    const query = reservationSearch.trim().toLowerCase();
    if (!query) return reservations;
    return reservations.filter((row) =>
      `${row.place} ${row.guest} ${row.stay}`.toLowerCase().includes(query),
    );
  }, [reservations, reservationSearch]);

  const buildings = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of places) {
      if (!seen.has(row.propertyName)) seen.set(row.propertyName, row.displayPropertyName);
    }
    return [...seen.entries()].map(([canonical, display]) => ({ canonical, display }));
  }, [places]);

  const roomsForBuilding = useMemo(
    () => places.filter((row) => row.propertyName === propertyName),
    [places, propertyName],
  );

  const selectedReservation = reservations.find((row) => row.reservationId === reservationId);
  const selectedPlace = roomsForBuilding.find((row) => row.roomLabel === roomLabel);

  // 드롭다운은 전부 공용 `AdmDropdown`(.dd)을 쓴다. 네이티브 <select>는 브라우저 기본 목록을
  // 그려서 콘솔과 절대 맞지 않는다 — 날짜 입력에 native date를 금지하는 것과 같은 이유다.
  const platformOptions: AdmOption[] = useMemo(
    () => PLATFORM_KEYS.map((key) => ({ value: key, label: platformLabel(key, labels) })),
    [labels],
  );
  const buildingOptions: AdmOption[] = useMemo(
    () => buildings.map((building) => ({ value: building.canonical, label: building.display })),
    [buildings],
  );
  const roomOptions: AdmOption[] = useMemo(
    () => roomsForBuilding.map((room) => ({ value: room.roomLabel, label: room.displayRoomLabel })),
    [roomsForBuilding],
  );

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || images.length >= MAX_IMAGES) return;

    startTransition(async () => {
      // 서버 액션 본문 상한(1MB)을 넘지 않도록 업로드 전에 압축한다 (CLAUDE.md §8).
      const formData = new FormData();
      formData.append("file", await compressImageFile(file).catch(() => file));
      const result = await uploadManualComplaintImageAction(draftId, formData);
      if ("url" in result) setImages((current) => [...current, result.url]);
      else setError(labels.createFailed);
    });
  }

  function handleSubmit() {
    const title = titleRef.current?.value.trim() ?? "";
    if (!title) {
      setError(labels.titleRequired);
      titleRef.current?.focus();
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.append("platform", platform);
    formData.append("title", title);
    formData.append("description", bodyRef.current?.value ?? "");
    if (rating > 0 && maxRating > 0) formData.append("rating", String(rating));
    images.forEach((url, index) => formData.append(`image_${index}`, url));

    // 연결 방식에 따라 보내는 값이 다르다. 예약을 골랐으면 예약이 건물·객실까지 확정하고,
    // 직접 선택이면 객실 마스터의 정규화된 라벨을 보낸다. `none`이면 아무것도 보내지 않는다.
    if (linkMode === "reservation" && selectedReservation) {
      formData.append("reservation_id", selectedReservation.reservationId);
      formData.append("property_name", selectedReservation.propertyName);
      formData.append("room_label", selectedReservation.roomLabel);
    } else if (linkMode === "place" && selectedPlace) {
      formData.append("property_id", selectedPlace.propertyId);
      formData.append("property_name", selectedPlace.propertyName);
      formData.append("room_id", selectedPlace.roomId);
      formData.append("room_label", selectedPlace.roomLabel);
    }

    const guest =
      guestName.trim() ||
      (linkMode === "reservation" ? (selectedReservation?.guest.trim() ?? "") : "");
    if (guest) formData.append("guest_name", guest);

    startTransition(async () => {
      const result = await createManualComplaintAction(formData);
      if ("id" in result) onClose();
      else setError(labels.createFailed);
    });
  }

  return (
    <>
      <div className="panel-scrim" onClick={isPending ? undefined : onClose} />
      <aside
        className="panel cxw-panel cxw-newp"
        role="dialog"
        aria-modal="true"
        aria-label={labels.createTitle}
        ref={panelRef}
        tabIndex={-1}
      >
        {/* 화이트 리디자인(2026-10-14, 시안 FBNewCx-PC): 제목 + 한 줄 설명, 닫기는 위 × 하나. */}
        <div className="cxw-ph">
          <div className="cxw-ph__main">
            <h2 className="cxw-ph__title is-lg">{labels.createTitle}</h2>
            <span className="cxw-ph__ctx">{labels.createSub}</span>
          </div>
          <button type="button" className="cxw-ph__x" aria-label={labels.close} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="panel__body cxw-pb cxw-form">
          <label className="cxw-nf">
            <span className="cxw-nf__l">
              {labels.fieldTitle} <b className="req">{labels.required}</b>
            </span>
            <input id="cxc-title" name="title" ref={titleRef} autoComplete="off" />
          </label>

          <label className="cxw-nf">
            <span className="cxw-nf__l">
              {labels.fieldBody} {labels.optional}
            </span>
            <textarea id="cxc-body" name="description" ref={bodyRef} rows={3} placeholder={labels.fieldBodyPlaceholder} />
          </label>

          <div className="cxw-fg">
            <span className="cxw-fg__l">{labels.fieldPlatform}</span>
            <div className="cxw-tiles is-4" role="radiogroup" aria-label={labels.fieldPlatform}>
              {platformOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={platform === option.value}
                  className={platform === option.value ? "on" : undefined}
                  onClick={() => {
                    setPlatform(option.value as ComplaintPlatform);
                    // 척도가 다른 플랫폼으로 바꾸면 이전 점수는 의미를 잃는다 — 초기화한다.
                    setRating(0);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* 평점은 척도가 있는 플랫폼에서만 — direct/other는 별점 개념이 없다. */}
          {maxRating > 0 ? (
            <div className="cxw-fg">
              <span className="cxw-fg__l">
                {labels.fieldRating} {labels.optional}
              </span>
              <div className="cxstars">
                {Array.from({ length: maxRating }).map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    className={index < rating ? "cxstar is-on" : "cxstar"}
                    aria-label={String(index + 1)}
                    onClick={() => setRating(index + 1 === rating ? 0 : index + 1)}
                  >
                    <Star aria-hidden="true" />
                  </button>
                ))}
                <span className="cxstars__v">
                  {rating > 0 ? `${rating.toFixed(1)} / ${maxRating}` : labels.ratingNone}
                </span>
              </div>
            </div>
          ) : null}

          <div className="cxw-fg">
            <span className="cxw-fg__l">{labels.fieldLink}</span>
            <div className="cxw-tiles" role="radiogroup" aria-label={labels.fieldLink}>
              {(
                [
                  ["reservation", labels.linkModeReservation],
                  ["place", labels.linkModePlace],
                  ["none", labels.linkModeNone],
                ] as [LinkMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={linkMode === mode}
                  className={linkMode === mode ? "on" : undefined}
                  onClick={() => setLinkMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>

            {linkMode === "reservation" ? (
              <>
                <p className="cxhint">{labels.linkModeHint}</p>
                <input
                  className="cxsearch"
                  value={reservationSearch}
                  placeholder={labels.pickerSearch}
                  onChange={(event) => setReservationSearch(event.target.value)}
                />
                <div className="cxpicklist">
                  {filteredReservations.map((row) => (
                    <button
                      key={row.reservationId}
                      type="button"
                      className={
                        row.reservationId === reservationId ? "cxpickrow is-on" : "cxpickrow"
                      }
                      onClick={() =>
                        setReservationId(row.reservationId === reservationId ? "" : row.reservationId)
                      }
                    >
                      <span className="cxpickrow__t">
                        {row.place}
                        {row.live ? <span className="cxlive">{labels.pickerLiveTag}</span> : null}
                      </span>
                      <span className="cxpickrow__s">
                        {row.guest} · {row.meta}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {linkMode === "place" ? (
              <>
                <AdmDropdown
                  options={buildingOptions}
                  value={propertyName}
                  placeholder={labels.pickBuilding}
                  ariaLabel={labels.pickBuilding}
                  onChange={(next) => {
                    setPropertyName(next);
                    // 건물이 바뀌면 이전 객실은 그 건물 것이 아니다.
                    setRoomLabel("");
                  }}
                />
                <AdmDropdown
                  options={roomOptions}
                  value={roomLabel}
                  placeholder={labels.pickRoom}
                  ariaLabel={labels.pickRoom}
                  disabled={!propertyName}
                  onChange={setRoomLabel}
                />
              </>
            ) : null}
          </div>

          <label className="cxw-nf">
            <span className="cxw-nf__l">
              {labels.fieldGuestName} {labels.optional}
            </span>
            <input
              id="cxc-guest"
              name="guestName"
              value={guestName}
              autoComplete="off"
              placeholder={labels.fieldGuestPlaceholder}
              onChange={(event) => setGuestName(event.target.value)}
            />
          </label>

          <div className="cxw-fg">
            <span className="cxw-fg__l">
              {labels.fieldImages} {labels.optional} · {images.length}/{MAX_IMAGES}
            </span>
            <div className="cxupgrid">
              {images.map((url, index) => (
                <div key={url} className="cxupthumb">
                  <Image src={url} alt="" width={96} height={96} />
                  <button
                    type="button"
                    aria-label={labels.close}
                    onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES ? (
                <button
                  type="button"
                  className="cxupadd"
                  disabled={isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  <Camera aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleImageChange}
            />
          </div>

          {error ? <p className="cxerr">{error}</p> : null}
        </div>

        <div className="cxw-pf">
          <button type="button" className="cxw-btn is-pri" onClick={handleSubmit} disabled={isPending}>
            {isPending ? <span className="cxw-spin" aria-hidden="true" /> : null}
            {labels.submit}
          </button>
        </div>
      </aside>
    </>
  );
}
