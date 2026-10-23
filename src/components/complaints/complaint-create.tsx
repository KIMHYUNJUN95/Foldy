"use client";

import { useMemo, useRef, useState, useTransition, type ChangeEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import {
  createComplaintAction,
  uploadComplaintImageAction,
} from "@/actions/complaints";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import type { PlacePickRow, ReservationPickRow } from "@/lib/complaint-reservations";
import { Camera, ChevronDown, Star, X } from "lucide-react";
import { ChoiceTiles, ConfirmFormSheet, PickField } from "@/components/requests/request-form-kit";
import { haptic } from "@/lib/haptics";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import { ImageLightbox } from "./image-lightbox";
import { type LinkTarget, type PlatformKey } from "./complaint-mock";
import { CIc, CxIcon } from "./cx-icons";
import { PLATFORMS, platformName, ratingMax } from "./cx-platform";
// 예약 고르기 시트 안쪽은 기존 모양(.cx-*)을 그대로 쓴다.
import "./complaints.css";
import "./feedback-mobile.css";

const MAX_IMAGES = 5;

/**
 * 등록 폼의 플랫폼 선택지 (목업 2l 의 2x2 그리드).
 *
 * `null` 이 «기타» 다 — `PlatformKey` 에는 `other` 가 없고, 제출 시 `plat ?? "other"` 로
 * 저장되는 기존 규약을 그대로 쓴다. 별도 타입을 만들지 않는다.
 */
const PLATFORM_CHOICES: (PlatformKey | null)[] = ["airbnb", "booking", "direct", null];
const PLATFORM_LABEL = (key: PlatformKey | null, dict: Dictionary) => (key ? platformName(key, dict) : dict.complaints.platformOther);


function RatingInput({
  plat,
  value,
  onChange,
  dict,
}: {
  plat: PlatformKey;
  value: number;
  onChange: (value: number) => void;
  dict: Dictionary;
}) {
  const max = ratingMax(plat);
  if (!max) return <p className="fbw-hint">{dict.complaints.ratingNone}</p>;

  return (
    <div className="fbw-stars" role="radiogroup" aria-label={dict.complaints.fieldRating}>
      {Array.from({ length: max }).map((_, index) => (
        <button
          key={index}
          type="button"
          role="radio"
          aria-checked={index + 1 === value}
          className={index < value ? "on" : undefined}
          onClick={() => {
            haptic("light");
            onChange(index + 1 === value ? 0 : index + 1);
          }}
          aria-label={`${index + 1}`}
        >
          <Star aria-hidden="true" />
        </button>
      ))}
      <span className="num">{value > 0 ? `${value.toFixed(1)} / ${max}` : "—"}</span>
    </div>
  );
}

type LinkMode = "reservation" | "place" | "none";

/**
 * 컴플레인 등록 — 모바일. 화이트 리디자인(2026-10-14, 시안 FBNew-Phone · FBNewConfirm-Phone):
 * 제목 · 내용 이름표 칸 → 플랫폼 4칸 → 평점 별(척도 있는 플랫폼만) → 「어디 건인가요」(예약 · 건물 · 객실 · 연결 안 함) →
 * 예약 고르기 / 건물 · 객실 고르기 → 고객명 → 사진 → 「컴플레인 등록」 → 확인 시트.
 * 「건물 · 객실」은 PC 등록 패널과 같은 길이다 — Beds24 밖 예약(전화 · 워크인 · 자사 홈페이지)도 객실 집계에 들어가게(사용자 승인).
 * 저장 경로는 그대로 `createComplaintAction`. See docs/product/25-complaint-workflow.md → 「화이트 리디자인」.
 */
export function ComplaintCreate({
  initialLinked = null,
  locale,
  pickRows,
  places,
}: {
  initialLinked?: LinkTarget | null;
  locale: string;
  pickRows: ReservationPickRow[];
  places: PlacePickRow[];
}) {
  const dict = getDictionary(locale);
  const t = dict.complaints;
  const router = useRouter();

  const [plat, setPlat] = useState<PlatformKey | null>(initialLinked?.plat ?? null);
  const [rating, setRating] = useState(0);
  const [linked, setLinked] = useState<LinkTarget | null>(initialLinked);
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [pickerStep, setPickerStep] = useState<"buildings" | "rooms" | "guests">("buildings");
  const [pickerProperty, setPickerProperty] = useState<string | null>(null);
  const [pickerRoom, setPickerRoom] = useState<string | null>(null);
  const [guestName, setGuestName] = useState(
    initialLinked?.guestName ?? initialLinked?.guest ?? "",
  );
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [linkMode, setLinkMode] = useState<LinkMode>("reservation");
  const [placeBuilding, setPlaceBuilding] = useState("");
  const [placeRoom, setPlaceRoom] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [titleText, setTitleText] = useState("");

  const placeBuildings = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of places) if (!seen.has(row.propertyName)) seen.set(row.propertyName, row.displayPropertyName);
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [places]);
  const placeRooms = useMemo(
    () => places.filter((row) => row.propertyName === placeBuilding).map((row) => ({ value: row.roomLabel, label: row.displayRoomLabel })),
    [places, placeBuilding],
  );

  const draftId = useRef(crypto.randomUUID()).current;
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetPickerState() {
    setSearch("");
    setPickerStep("buildings");
    setPickerProperty(null);
    setPickerRoom(null);
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploadedImages.length >= MAX_IMAGES) return;

    startTransition(async () => {
      // 서버 액션 본문 상한(1MB)을 넘지 않도록 업로드 전에 압축한다 (CLAUDE.md §8).
      const formData = new FormData();
      formData.append("file", await compressImageFile(file).catch(() => file));
      const result = await uploadComplaintImageAction(draftId, formData);
      if ("url" in result) {
        setUploadedImages((current) => [...current, result.url]);
      }
    });
  }

  function handleRemoveImage(index: number) {
    setUploadedImages((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function handleSubmit() {
    startTransition(async () => {
      const formData = new FormData();
      formData.append("platform", plat ?? "other");
      formData.append("title", titleRef.current?.value ?? "");
      formData.append("description", bodyRef.current?.value ?? "");

      if (rating > 0) formData.append("rating", String(rating));
      uploadedImages.forEach((url, index) => formData.append(`image_${index}`, url));

      if (linkMode === "reservation" && linked) {
        if (linked.reservationId) formData.append("reservation_id", linked.reservationId);
        if (linked.propertyName) formData.append("property_name", linked.propertyName);
        if (linked.roomLabel) formData.append("room_label", linked.roomLabel);
      } else if (linkMode === "place" && placeBuilding) {
        formData.append("property_name", placeBuilding);
        if (placeRoom) formData.append("room_label", placeRoom);
      }
      if (guestName.trim()) formData.append("guest_name", guestName.trim());

      const result = await createComplaintAction(formData);
      if ("id" in result) {
        haptic("success");
        router.push(`/mobile/complaints/${result.id}`);
      } else {
        setConfirmOpen(false);
        setSubmitError(true);
        haptic("error");
      }
    });
  }

  const placeLabel =
    linkMode === "reservation" && linked
      ? linked.place
      : linkMode === "place" && placeBuilding
        ? `${placeBuildings.find((b) => b.value === placeBuilding)?.label ?? placeBuilding}${placeRoom ? ` · ${placeRooms.find((r) => r.value === placeRoom)?.label ?? placeRoom}` : ""}`
        : t.linkModeNone;

  function openConfirm() {
    if (!titleRef.current?.value.trim()) {
      setTitleError(true);
      titleRef.current?.focus();
      haptic("error");
      return;
    }
    setTitleError(false);
    setSubmitError(false);
    setTitleText(titleRef.current.value.trim());
    setConfirmOpen(true);
  }

  return (
    <div className="fbw fbw-form">
      <div className="ofw-head">
        <h1>{t.wCreateTitle}</h1>
        <p>{t.wCreateSub}</p>
      </div>

      <section className="ofw-sec">
        <label className="ofw-nf">
          <span className="ofw-nf__l">{t.fieldTitle}</span>
          <input
            ref={titleRef}
            name="title"
            autoComplete="off"
            className={`ofw-nf__in${titleError ? " is-err" : ""}`}
            aria-invalid={titleError}
            aria-describedby={titleError ? "cxn-title-err" : undefined}
            onChange={() => titleError && setTitleError(false)}
          />
        </label>
        {titleError ? (
          <p className="fbw-err" id="cxn-title-err" role="alert">
            {t.titleRequired}
          </p>
        ) : null}
        <label className="ofw-nf">
          <span className="ofw-nf__l">
            {t.wContent} {t.wOptional}
          </span>
          <textarea ref={bodyRef} name="description" rows={3} className="ofw-nf__in ofw-ta" placeholder={t.fieldBodyPlaceholder} />
        </label>
      </section>

      <section className="ofw-sec">
        <div className="fbw-fg">
          <span className="ofw-k">{t.wPlatform}</span>
          <div className="fbw-tiles" role="radiogroup" aria-label={t.wPlatform}>
            {PLATFORM_CHOICES.map((key) => (
              <button
                key={key ?? "other"}
                type="button"
                role="radio"
                aria-checked={plat === key}
                className={plat === key ? "on" : undefined}
                onClick={() => {
                  haptic("light");
                  setPlat(key);
                  // 척도가 다른 플랫폼으로 바꾸면 이전 점수는 의미를 잃는다.
                  setRating(0);
                }}
              >
                {PLATFORM_LABEL(key, dict)}
              </button>
            ))}
          </div>
        </div>
        {plat !== null && ratingMax(plat) > 0 ? (
          <div className="fbw-fg">
            <span className="ofw-k">
              {t.fieldRating} {t.wOptional}
            </span>
            <RatingInput plat={plat} value={rating} onChange={setRating} dict={dict} />
          </div>
        ) : null}
      </section>

      <section className="ofw-sec">
        <ChoiceTiles
          label={t.wWhere}
          value={linkMode}
          onChange={(value) => setLinkMode(value as LinkMode)}
          options={[
            { value: "reservation", label: t.wLinkReservation },
            { value: "place", label: t.linkModePlace },
            { value: "none", label: t.linkModeNone },
          ]}
        />
        {linkMode === "reservation" ? (
          <div className="ofw-nf fbw-pickwrap">
            <span className="ofw-nf__l">{t.wLinkReservation}</span>
            <button type="button" className={`ofw-nf__in fbw-pickbtn${linked ? " has-x" : " is-ph"}`} onClick={() => setShowPicker(true)} aria-haspopup="dialog">
              <span>{linked ? `${linked.guest} · ${linked.place} · ${linked.stay}` : t.wPickReservation}</span>
              {linked ? null : <ChevronDown aria-hidden="true" />}
            </button>
            {linked ? (
              <button
                type="button"
                className="fbw-pickbtn__x"
                aria-label={t.wClearLink}
                onClick={() => {
                  setLinked(null);
                  setGuestName("");
                }}
              >
                <X aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
        {linkMode === "place" ? (
          <>
            <PickField
              label={t.metaBuilding}
              value={placeBuilding}
              placeholder={t.pickBuilding}
              options={placeBuildings}
              onChange={(value) => {
                setPlaceBuilding(value);
                setPlaceRoom("");
              }}
            />
            <PickField
              label={t.metaRoom}
              value={placeRoom}
              placeholder={t.pickRoom}
              options={placeRooms}
              disabled={!placeBuilding}
              onChange={setPlaceRoom}
            />
          </>
        ) : null}
        {linkMode !== "none" ? <p className="fbw-hint">{t.wLinkHint}</p> : null}
        <label className="ofw-nf">
          <span className="ofw-nf__l">
            {t.fieldGuestName} {t.wOptional}
          </span>
          <input
            name="guestName"
            autoComplete="off"
            className="ofw-nf__in"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            placeholder={t.fieldGuestPlaceholder}
          />
        </label>
      </section>

      <section className="ofw-sec">
        <div className="fbw-fg">
          <span className="ofw-k">
            {t.photosTitle} <em className="fbw-opt">{`${t.wOptional} · ${uploadedImages.length}/${MAX_IMAGES}`}</em>
          </span>
          <div className="fbw-photos">
            {uploadedImages.map((url, index) => (
              <div key={url} className="fbw-photo">
                <button type="button" className="fbw-photo__img" aria-label={`${t.photosTitle} ${index + 1}`} onClick={() => setLightboxIndex(index)}>
                  <Image src={url} alt="" fill sizes="72px" />
                </button>
                <button type="button" className="fbw-photo__x" aria-label={t.lightboxClose} onClick={() => handleRemoveImage(index)}>
                  <X aria-hidden="true" />
                </button>
              </div>
            ))}
            {uploadedImages.length < MAX_IMAGES ? (
              <button type="button" className="fbw-photo__add" aria-label={t.fieldImages} onClick={() => fileInputRef.current?.click()} disabled={isPending}>
                {isPending ? <span className="fbw-spin is-pri" aria-hidden="true" /> : <Camera aria-hidden="true" />}
              </button>
            ) : null}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} />
        </div>
      </section>

      {submitError ? (
        <p className="fbw-err" role="alert">
          {t.createFailed}
        </p>
      ) : null}

      <button type="button" className="ofw-submit" onClick={openConfirm} disabled={isPending}>
        {t.submit}
      </button>

      {confirmOpen ? (
        <ConfirmFormSheet
          title={t.wConfirmCreate}
          sub={titleText}
          rows={[
            {
              k: t.wPlatform,
              v: `${PLATFORM_LABEL(plat, dict)}${rating > 0 && plat ? ` · ${rating.toFixed(1)} / ${ratingMax(plat)}` : ""}`,
            },
            { k: t.wWhereShort, v: placeLabel },
            { k: t.photosTitle, v: uploadedImages.length > 0 ? t.wPhotosN.replace("{n}", String(uploadedImages.length)) : "—" },
          ]}
          cancelLabel={t.cancel}
          confirmLabel={t.wSubmit}
          pending={isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleSubmit}
        />
      ) : null}

      {lightboxIndex !== null && uploadedImages.length > 0 && (
        <ImageLightbox
          images={uploadedImages}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          labels={{
            close: t.lightboxClose,
            photo: t.lightboxPhoto,
          }}
        />
      )}

      {showPicker && (
        <BottomSheet
          onClose={() => {
            setShowPicker(false);
            resetPickerState();
          }}
          className="max-h-[82dvh] flex flex-col"
        >
          {({ close }) => {
            const closePicker = () => {
              resetPickerState();
              close();
            };

            const goBack = () => {
              setSearch("");
              if (pickerStep === "guests") {
                setPickerStep("rooms");
                setPickerRoom(null);
                return;
              }
              setPickerStep("buildings");
              setPickerProperty(null);
            };

            const query = search.trim().toLowerCase();

            if (pickerStep === "buildings") {
              const seen = new Set<string>();
              const buildings: { canonical: string; display: string }[] = [];

              for (const row of pickRows) {
                if (seen.has(row.propertyName)) continue;
                seen.add(row.propertyName);
                buildings.push({
                  canonical: row.propertyName,
                  display: row.displayPropertyName,
                });
              }

              buildings.sort((left, right) => left.display.localeCompare(right.display));

              const filtered = query
                ? buildings.filter((building) => building.display.toLowerCase().includes(query))
                : buildings;

              return (
                <div className="cx cx-sheet">
                  <div className="cx-sheet__head">
                    <p className="cx-sheet__title">{t.pickerTitle}</p>
                    <p className="cx-sheet__sub">{t.pickerSub}</p>
                  </div>
                  <div className="cx-search">
                    <span className="ic cx-search__ic">{CxIcon.search}</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t.pickerTitle}
                      autoFocus
                    />
                  </div>
                  <div className="cx-picker-scroll">
                    {filtered.length === 0 ? (
                      <div className="cx-pick-empty">—</div>
                    ) : (
                      filtered.map(({ canonical, display }) => {
                        const hasLive = pickRows.some(
                          (row) => row.propertyName === canonical && row.live,
                        );

                        return (
                          <button
                            key={canonical}
                            type="button"
                            className="cx-bldrow"
                            onClick={() => {
                              setPickerProperty(canonical);
                              setPickerStep("rooms");
                              setSearch("");
                            }}
                          >
                            <span className="cx-bldrow__ic">
                              <CIc>{CxIcon.building}</CIc>
                            </span>
                            <span className="cx-bldrow__n">{display}</span>
                            {hasLive && <span className="cx-rrow__live">{t.pickerLiveTag}</span>}
                            <span className="cx-bldrow__chev">{CxIcon.chevR}</span>
                          </button>
                        );
                      })
                    )}
                    <button type="button" className="cx-roomonly" onClick={closePicker}>
                      <CIc>{CxIcon.door}</CIc>
                      {t.pickerRoomOnly}
                    </button>
                  </div>
                </div>
              );
            }

            if (pickerStep === "rooms" && pickerProperty) {
              const rowsInProperty = pickRows.filter(
                (row) => row.propertyName === pickerProperty,
              );
              const seen = new Set<string>();
              const rooms: { canonical: string; display: string }[] = [];

              for (const row of rowsInProperty) {
                if (seen.has(row.roomLabel)) continue;
                seen.add(row.roomLabel);
                rooms.push({
                  canonical: row.roomLabel,
                  display: row.displayRoomLabel,
                });
              }

              rooms.sort((left, right) => left.display.localeCompare(right.display));

              const filtered = query
                ? rooms.filter((room) => room.display.toLowerCase().includes(query))
                : rooms;

              const headerBuilding =
                rowsInProperty[0]?.displayPropertyName ?? pickerProperty;

              return (
                <div className="cx cx-sheet">
                  <div className="cx-sheet__head cx-sheet__head--nav">
                    <button type="button" className="cx-back" onClick={goBack}>
                      <CIc>{CxIcon.chevR}</CIc>
                    </button>
                    <p className="cx-sheet__title">{headerBuilding}</p>
                  </div>
                  <div className="cx-search">
                    <span className="ic cx-search__ic">{CxIcon.search}</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t.metaRoom}
                      autoFocus
                    />
                  </div>
                  <div className="cx-picker-scroll">
                    {filtered.length === 0 ? (
                      <div className="cx-pick-empty">—</div>
                    ) : (
                      filtered.map(({ canonical, display }) => {
                        const hasLive = rowsInProperty.some(
                          (row) => row.roomLabel === canonical && row.live,
                        );
                        const count = rowsInProperty.filter(
                          (row) => row.roomLabel === canonical,
                        ).length;

                        return (
                          <button
                            key={canonical}
                            type="button"
                            className="cx-bldrow"
                            onClick={() => {
                              setPickerRoom(canonical);
                              setPickerStep("guests");
                              setSearch("");
                            }}
                          >
                            <span className="cx-bldrow__ic">
                              <CIc>{CxIcon.door}</CIc>
                            </span>
                            <span className="cx-bldrow__n">{display}</span>
                            {hasLive && <span className="cx-rrow__live">{t.pickerLiveTag}</span>}
                            <span className="cx-bldrow__cnt">{count}</span>
                            <span className="cx-bldrow__chev">{CxIcon.chevR}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            }

            if (pickerStep === "guests" && pickerProperty && pickerRoom) {
              const rowsInRoom = pickRows.filter(
                (row) => row.propertyName === pickerProperty && row.roomLabel === pickerRoom,
              );
              const stayingRows = rowsInRoom.filter((row) => row.group === "staying");
              const upcomingRows = rowsInRoom.filter((row) => row.group === "upcoming");
              const filtered = query
                ? rowsInRoom.filter((row) => row.guest.toLowerCase().includes(query))
                : rowsInRoom;
              const filteredStaying = filtered.filter((row) => row.group === "staying");
              const filteredUpcoming = filtered.filter((row) => row.group === "upcoming");
              const headerRoom = rowsInRoom[0]?.displayRoomLabel ?? pickerRoom;
              const headerBuilding = rowsInRoom[0]?.displayPropertyName ?? pickerProperty;

              const selectRow = (row: ReservationPickRow) => {
                setLinked({
                  plat: row.plat,
                  propertyName: row.propertyName,
                  roomLabel: row.roomLabel,
                  place: row.place,
                  guest: row.guest,
                  guestName: row.guest,
                  stay: row.stay,
                  reservationId: row.reservationId,
                });
                setPlat(row.plat);
                setGuestName(row.guest);
                setRating(0);
                closePicker();
              };

              return (
                <div className="cx cx-sheet">
                  <div className="cx-sheet__head cx-sheet__head--nav">
                    <button type="button" className="cx-back" onClick={goBack}>
                      <CIc>{CxIcon.chevR}</CIc>
                    </button>
                    <div>
                      <p className="cx-sheet__title">{headerRoom}</p>
                      <p className="cx-sheet__sub">{headerBuilding}</p>
                    </div>
                  </div>
                  {stayingRows.length + upcomingRows.length > 1 && (
                    <div className="cx-search">
                      <span className="ic cx-search__ic">{CxIcon.search}</span>
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t.metaGuest}
                        autoFocus
                      />
                    </div>
                  )}
                  <div className="cx-picker-scroll">
                    {filteredStaying.length > 0 && (
                      <>
                        <p className="cx-glabel">{t.pickerStaying}</p>
                        {filteredStaying.map((row) => (
                          <PickRow
                            key={row.reservationId}
                            row={row}
                            liveLabel={t.pickerLiveTag}
                            onClick={() => selectRow(row)}
                          />
                        ))}
                      </>
                    )}
                    {filteredUpcoming.length > 0 && (
                      <>
                        <p className="cx-glabel">{t.pickerUpcoming}</p>
                        {filteredUpcoming.map((row, index) => (
                          <div key={row.reservationId}>
                            {index > 0 && <div className="cx-rsep" />}
                            <PickRow
                              row={row}
                              liveLabel={t.pickerLiveTag}
                              onClick={() => selectRow(row)}
                            />
                          </div>
                        ))}
                      </>
                    )}
                    {filtered.length === 0 && <div className="cx-pick-empty">—</div>}
                  </div>
                </div>
              );
            }

            return null;
          }}
        </BottomSheet>
      )}
    </div>
  );
}

function PickRow({
  row,
  liveLabel,
  onClick,
}: {
  row: ReservationPickRow;
  liveLabel: string;
  onClick: () => void;
}) {
  const platform = PLATFORMS[row.plat];

  return (
    <button type="button" className="cx-rrow" onClick={onClick}>
      <span className="cx-rrow__av" style={{ background: platform.avg }}>
        {row.guest.slice(0, 1)}
      </span>
      <div className="cx-rrow__b">
        <div className="cx-rrow__n">
          {row.place}
          {row.live && <span className="cx-rrow__live">{liveLabel}</span>}
        </div>
        <div className="cx-rrow__meta">
          {row.guest} · {row.meta}
        </div>
      </div>
      <span className="cx-rrow__chev">{CxIcon.chevR}</span>
    </button>
  );
}
