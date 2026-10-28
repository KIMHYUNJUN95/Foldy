"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Link2,
  Loader2,
  Search,
  UserRound,
  X,
} from "lucide-react";
import type { Dictionary } from "@/lib/i18n";
import {
  CANONICAL_TO_BUILDING_KEY,
  localizePropertyName,
} from "@/lib/room-label-normalization";
import { BottomSheet, useBottomSheetClose, useBottomSheetDragHandle } from "@/components/shell/bottom-sheet";
import type { LinkedContext } from "@/components/tasks/context-link-section";
import {
  fetchPickerBuildings,
  fetchPickerRooms,
  fetchRoomReservations,
  searchReservations,
  type PickerBuilding,
  type PickerRoom,
  type ReservationSearchResult,
  type RoomReservation,
} from "@/actions/task-context";
import { cn } from "@/lib/utils";

type Copy = Dictionary["tasks"];

// ── 단계 타입 ────────────────────────────────────────────────────────────────────────────────
type Step = "building" | "room" | "guest-only";

// ── 스테퍼 바(화면 2 전용) ──────────────────────────────────────────────────────────────
function StepBar({ copy, activeStep }: { copy: Copy; activeStep: 1 | 2 | 3 }) {
  const steps = [copy.contextPickerBuilding, copy.contextPickerRoom, copy.contextPickerReservation];
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((label, i) => {
        const n = i + 1;
        const active = n === activeStep;
        const done = n < activeStep;
        return (
          <div key={label} className="contents">
            <div className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "bg-primary/[0.12] text-primary"
                      : "bg-slate-100 text-slate-400",
                )}
              >
                {n}
              </span>
              <span
                className={cn(
                  "text-[12px] font-bold",
                  active ? "text-primary" : done ? "text-primary/70" : "text-slate-400",
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 ? (
              <span className="h-[1.5px] flex-1 rounded-full bg-border" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── 브레드크럼(화면 3) ────────────────────────────────────────────────────────────────────
function Breadcrumb({
  buildingLabels,
  buildingName,
  roomSuffix,
  roomNumber,
  onBuildingTap,
}: {
  buildingLabels: Record<string, string>;
  buildingName: string;
  roomSuffix: string;
  roomNumber: string | null;
  onBuildingTap: () => void;
}) {
  // getCanonicalRoomLabel() 이 방 라벨로 숙소 이름을 돌려주는 건물에서
  // (예: 오쿠보 건물) 방 번호 자체가 정식 이름이므로 → 현지화하고
  // 방 접미사를 생략해 "大久保A号室" 이나 "오쿠보A호" 가 나오지 않게 한다.
  const isPropertyLabel = roomNumber ? !!CANONICAL_TO_BUILDING_KEY[roomNumber] : false;
  const displayRoomNumber = roomNumber
    ? isPropertyLabel
      ? localizePropertyName(roomNumber, buildingLabels)
      : roomNumber
    : null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <button
        className="inline-flex items-center gap-1 rounded-full bg-primary/[0.09] px-[11px] py-[5px] text-[12px] font-bold text-primary transition-colors active:bg-primary/[0.14]"
        onClick={onBuildingTap}
        type="button"
      >
        <Building2 className="size-3" aria-hidden="true" />
        {buildingName}
      </button>
      {displayRoomNumber ? (
        <>
          <span className="text-[12px] text-muted-foreground/50">›</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/[0.09] px-[11px] py-[5px] text-[12px] font-bold text-primary">
              <DoorOpen className="size-3" aria-hidden="true" />
            {displayRoomNumber}
            {isPropertyLabel ? null : roomSuffix}
            </span>
          </>
        ) : null}
    </div>
  );
}

// ── 건물 행 ─────────────────────────────────────────────────────────────────────────────
function BuildingRow({
  building,
  copy,
  onTap,
}: {
  building: PickerBuilding;
  copy: Copy;
  onTap: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-[14px] border border-border bg-surface px-3 py-3 text-left transition-colors active:bg-slate-50"
      onClick={onTap}
      type="button"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-slate-100 text-slate-500">
        <Building2 className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-extrabold tracking-[-0.01em] text-foreground">
          {building.name}
        </span>
        <span className="mt-0.5 block text-[11.5px] font-semibold text-muted-foreground">
          {building.totalRooms}
          {copy.contextPickerRoomsUnit}
          {building.todayGuests > 0 ? ` · ${copy.contextPickerTodayGuests} ${building.todayGuests}` : ""}
        </span>
      </span>
      <ChevronRight className="size-[17px] shrink-0 text-muted-foreground/40" aria-hidden="true" />
    </button>
  );
}

// ── 방 칸 ────────────────────────────────────────────────────────────────────────────────
function RoomCell({
  buildingLabels,
  room,
  selected,
  copy,
  onTap,
}: {
  buildingLabels: Record<string, string>;
  room: PickerRoom;
  selected: boolean;
  copy: Copy;
  onTap: () => void;
}) {
  // 오쿠보 방식 건물은 정식 숙소 이름을 방 라벨로 쓰므로 — 현지화한다.
  const displayLabel = localizePropertyName(room.label, buildingLabels);
  return (
    <button
      className={cn(
        "relative flex aspect-square flex-col items-center justify-center gap-[3px] rounded-[13px] border transition-all",
        selected
          ? "border-primary bg-primary/[0.08] shadow-[0_0_0_2.5px_color-mix(in_oklab,#7a52e6_22%,transparent)]"
          : "border-border bg-surface",
      )}
      onClick={onTap}
      type="button"
    >
      {/* 체크 표시 */}
      {selected ? (
        <span className="absolute right-[5px] top-[5px] flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
        </span>
      ) : null}
      <span
        className={cn(
          "text-[15px] font-black tracking-[-0.02em]",
          selected ? "text-primary" : "text-foreground",
        )}
      >
        {displayLabel}
      </span>
      <span
        className={cn(
          "text-[9.5px] font-bold",
          // 투숙 > 차단 > 공실. 막아 둔 방에 수기 예약이 들어와 있으면 손님이 먼저다.
          room.occupied
            ? "text-rose-600"
            : room.blocked
              ? "text-slate-500"
              : "text-muted-foreground/50",
        )}
      >
        {room.occupied
          ? copy.contextPickerOccupied
          : room.blocked
            ? copy.contextPickerBlocked
            : copy.contextPickerVacant}
      </span>
    </button>
  );
}

// ── 예약 행 ──────────────────────────────────────────────────────────────────────────
function ReservationRow({
  res,
  selected,
  copy,
  onTap,
}: {
  res: RoomReservation;
  selected: boolean;
  copy: Copy;
  onTap: () => void;
}) {
  const isAir = res.channel === "airbnb";
  const channelLabel = isAir ? "Airbnb" : res.channel === "booking" ? "Booking" : copy.contextChannelDirect;
  const nightsLabel = `${res.nightsCount}${copy.contextPickerNightsUnit}`;
  return (
    <button
      className={cn(
        "flex w-full items-center gap-[11px] rounded-[14px] border px-3 py-3 text-left transition-all",
        selected ? "border-primary bg-primary/[0.08]" : "border-border bg-surface",
      )}
      onClick={onTap}
      type="button"
    >
      {/* 아바타 */}
      <span
        className={cn(
          "flex size-[38px] shrink-0 items-center justify-center rounded-[11px] text-[14px] font-black text-white",
          isAir
            ? "bg-gradient-to-br from-[#ff718c] to-[#f05273]"
            : res.channel === "booking"
              ? "bg-gradient-to-br from-[#19b7d2] to-[#1197b9]"
              : "bg-gradient-to-br from-slate-400 to-slate-500",
        )}
        aria-hidden="true"
      >
        {res.initials}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-foreground">
          <span className="truncate">{res.guestName}</span>
          {res.isLive ? (
            <span className="shrink-0 rounded-full bg-green-100 px-[7px] py-[2px] text-[9.5px] font-extrabold text-green-700">
              {copy.contextPickerLive}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
          {channelLabel} · {res.dateRange} · {nightsLabel}
        </div>
      </div>

      {/* 원형 체크 */}
      <span
        className={cn(
          "flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          selected ? "border-primary bg-primary text-white" : "border-border",
        )}
      >
        {selected ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : null}
      </span>
    </button>
  );
}

// ── 예약 검색 결과 행 ────────────────────────────────────────────────────────────
function ReservationSearchRow({
  buildingLabels,
  copy,
  result,
  onTap,
}: {
  buildingLabels: Record<string, string>;
  copy: Copy;
  result: ReservationSearchResult;
  onTap: () => void;
}) {
  const isAir = result.channel === "airbnb";
  const channelLabel = isAir ? "Airbnb" : result.channel === "booking" ? "Booking" : copy.contextChannelDirect;
  const nightsLabel = `${result.nightsCount}${copy.contextPickerNightsUnit}`;
  const localizedBuilding = localizePropertyName(result.propertyName, buildingLabels);
  // 오쿠보 방식 건물은 displayRoomLabel === propertyName 이므로 방 접미사를 생략한다.
  const showRoom = result.displayRoomLabel && result.displayRoomLabel !== result.propertyName;
  const locationStr = showRoom
    ? `${localizedBuilding} · ${result.displayRoomLabel}${copy.contextPickerRoomSuffix}`
    : localizedBuilding;

  return (
    <button
      className="flex w-full items-start gap-[11px] rounded-[14px] border border-border bg-surface px-3 py-3 text-left transition-all active:bg-slate-50"
      onClick={onTap}
      type="button"
    >
      {/* 아바타 */}
      <span
        className={cn(
          "flex size-[38px] shrink-0 items-center justify-center rounded-[11px] text-[14px] font-black text-white",
          isAir
            ? "bg-gradient-to-br from-[#ff718c] to-[#f05273]"
            : result.channel === "booking"
              ? "bg-gradient-to-br from-[#19b7d2] to-[#1197b9]"
              : "bg-gradient-to-br from-slate-400 to-slate-500",
        )}
        aria-hidden="true"
      >
        {result.initials}
      </span>

      <div className="min-w-0 flex-1">
        {/* 게스트 이름 + 라이브 배지 */}
        <div className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-foreground">
          <span className="truncate">{result.guestName}</span>
          {result.isLive ? (
            <span className="shrink-0 rounded-full bg-green-100 px-[7px] py-[2px] text-[9.5px] font-extrabold text-green-700">
              {copy.contextPickerLive}
            </span>
          ) : null}
        </div>
        {/* Beds24 예약 ID */}
        {result.sourceReservationId ? (
          <div className="mt-[2px] text-[10.5px] font-semibold text-muted-foreground/70">
            {copy.contextPickerBookingId} {result.sourceReservationId}
          </div>
        ) : null}
        {/* 건물 · 방 */}
        <div className="mt-[3px] text-[11.5px] font-semibold text-muted-foreground">
          {locationStr}
        </div>
        {/* 채널 · 날짜 · 박수 */}
        <div className="mt-[2px] text-[11px] font-semibold text-muted-foreground/70">
          {channelLabel} · {result.dateRange} · {nightsLabel}
        </div>
      </div>
    </button>
  );
}

// ── 보조 버튼 행 ───────────────────────────────────────────────────────────────────────────
function AltButton({
  icon,
  label,
  onClick,
  emphasized = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  emphasized?: boolean;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-[12px] border text-[12.5px] font-bold transition-colors active:bg-slate-50",
        emphasized
          ? "border-primary/20 bg-primary/[0.045] text-primary/85"
          : "border-border bg-surface text-muted-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

// ── 메인 컴포넌트 ───────────────────────────────────────────────────────────────────────────
type ContextPickerProps = {
  buildingLabels: Record<string, string>;
  copy: Copy;
  initialPropertyName?: string;
  onClose: () => void;
  onSelect?: (ctx: LinkedContext) => void;
};

/**
 * 건물 → 객실 → 예약 고르기 시트. 틀은 공용 `BottomSheet`(2026-10-19 — 손으로 만든 시트를 공용으로: 끌어 닫기 · 태블릿
 * 가운데 카드 · 바탕 잠금 · Esc 가 다른 시트와 같다). 안의 단계 화면은 `ContextPickerBody`.
 */
export function ContextPickerSheet({ onClose, ...props }: ContextPickerProps) {
  return (
    <BottomSheet
      ariaLabel={props.copy.contextPickerTitle}
      className="flex max-h-[92dvh] flex-col"
      onClose={onClose}
      zIndexClassName="z-[70]"
    >
      <ContextPickerBody {...props} />
    </BottomSheet>
  );
}

function ContextPickerBody({
  buildingLabels,
  copy,
  initialPropertyName,
  onSelect,
}: Omit<ContextPickerProps, "onClose">) {
  const [step, setStep] = useState<Step>("building");
  const [buildings, setBuildings] = useState<PickerBuilding[]>([]);
  const [buildingsLoading, setBuildingsLoading] = useState(true);
  const [selectedBuilding, setSelectedBuilding] = useState<PickerBuilding | null>(null);
  const [buildingRooms, setBuildingRooms] = useState<PickerRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [selectedResIdx, setSelectedResIdx] = useState<number | null>(null);
  const [roomReservations, setRoomReservations] = useState<RoomReservation[]>([]);
  const [resPeriodLabel, setResPeriodLabel] = useState("");
  const [resLoading, setResLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [resSearchResults, setResSearchResults] = useState<ReservationSearchResult[]>([]);
  const [resSearchLoading, setResSearchLoading] = useState(false);
  const [guestDraft, setGuestDraft] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // 고르면 시트를 닫는다 — 공용 시트가 미끄러져 나간 뒤 부모의 onClose 를 부른다.
  const dismiss = useBottomSheetClose();
  const dragHandleProps = useBottomSheetDragHandle();

  useEffect(() => {
    fetchPickerBuildings()
      .then((b) => {
        setBuildings(b);
        if (initialPropertyName) {
          const found = b.find((x) => x.id === initialPropertyName);
          if (found) {
            setSelectedBuilding(found);
            setStep("room");
            setRoomsLoading(true);
            fetchPickerRooms(found.id)
              .then(setBuildingRooms)
              .catch(() => setBuildingRooms([]))
              .finally(() => setRoomsLoading(false));
          }
        }
      })
      .catch(() => setBuildings([]))
      .finally(() => setBuildingsLoading(false));
  }, [initialPropertyName]);

  // 건물 단계에 들어가면 검색창에 포커스
  useEffect(() => {
    if (step === "building") {
      setTimeout(() => searchRef.current?.focus(), 80);
    }
  }, [step]);

  // 디바운스된 예약 검색 — 검색어가 2자 이상일 때 실행된다.
  // effect 안의 동기 setState lint 오류를 피하려고 모든 setState 는 비동기 콜백 안에 둔다.
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const q = search.trim();
    if (q.length < 2) return;
    searchTimerRef.current = setTimeout(() => {
      setResSearchLoading(true);
      searchReservations(q)
        .then(setResSearchResults)
        .catch(() => setResSearchResults([]))
        .finally(() => setResSearchLoading(false));
    }, 400);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  const isSearchMode = search.trim().length >= 2;

  const handleSearchResultTap = (result: ReservationSearchResult) => {
    onSelect?.({
      propertyId: result.propertyId,
      roomId: result.roomId,
      propertyName: result.propertyName,
      roomLabel: result.displayRoomLabel,
      reservationId: result.id,
      guestName: result.guestName,
      channel: result.channel,
      checkinDate: result.checkinDate,
      checkoutDate: result.checkoutDate,
    });
    dismiss();
  };

  const handleBuildingTap = async (b: PickerBuilding) => {
    setSelectedBuilding(b);
    setSelectedRoom(null);
    setSelectedResIdx(null);
    setRoomReservations([]);
    setResPeriodLabel("");
    setBuildingRooms([]);
    setRoomsLoading(true);
    setStep("room");
    try {
      const rooms = await fetchPickerRooms(b.id);
      setBuildingRooms(rooms);
    } catch {
      setBuildingRooms([]);
    } finally {
      setRoomsLoading(false);
    }
  };

  const goBackToBuilding = () => {
    setStep("building");
    setSelectedBuilding(null);
    setSelectedRoom(null);
    setSelectedResIdx(null);
    setRoomReservations([]);
    setResPeriodLabel("");
    setBuildingRooms([]);
    setSearch("");
    setResSearchResults([]);
  };

  const handleRoomTap = async (roomNum: string) => {
    const next = selectedRoom === roomNum ? null : roomNum;
    setSelectedRoom(next);
    setSelectedResIdx(null);
    setRoomReservations([]);
    setResPeriodLabel("");

    if (next && selectedBuilding) {
      setResLoading(true);
      try {
        const { reservations, periodLabel } = await fetchRoomReservations(
          selectedBuilding.id,
          next,
        );
        setRoomReservations(reservations);
        setResPeriodLabel(periodLabel);
      } catch {
        setRoomReservations([]);
      } finally {
        setResLoading(false);
      }
    }
  };

  const handleResTap = (idx: number) => {
    setSelectedResIdx((prev) => (prev === idx ? null : idx));
  };

  // 현재 선택된 방 칸(링크에 저장되는 방/숙소 UUID 를 가진다).
  const selectedRoomObj = selectedRoom
    ? (buildingRooms.find((r) => r.label === selectedRoom) ?? null)
    : null;

  const handleRoomOnlyLink = () => {
    if (!selectedBuilding || !selectedRoom) return;
    onSelect?.({
      propertyId: selectedBuilding.propertyId ?? selectedRoomObj?.propertyId ?? null,
      roomId: selectedRoomObj?.roomId ?? null,
      propertyName: selectedBuilding.id,
      roomLabel: selectedRoom,
      reservationId: null,
      guestName: null,
      channel: null,
      checkinDate: null,
      checkoutDate: null,
    });
    dismiss();
  };

  const handleBuildingOnlyLink = () => {
    if (!selectedBuilding) return;
    onSelect?.({
      propertyId: selectedBuilding.propertyId ?? null,
      roomId: null,
      propertyName: selectedBuilding.id,
      roomLabel: null,
      reservationId: null,
      guestName: null,
      channel: null,
      checkinDate: null,
      checkoutDate: null,
    });
    dismiss();
  };

  const handleConfirmLink = () => {
    if (!selectedBuilding || !selectedRoom || selectedResIdx === null) return;
    const res = roomReservations[selectedResIdx];
    onSelect?.({
      propertyId: selectedBuilding.propertyId ?? selectedRoomObj?.propertyId ?? null,
      roomId: selectedRoomObj?.roomId ?? null,
      propertyName: selectedBuilding.id,
      roomLabel: selectedRoom,
      reservationId: res.id,
      guestName: res.guestName,
      channel: res.channel,
      checkinDate: res.checkinDate,
      checkoutDate: res.checkoutDate,
    });
    dismiss();
  };

  const handleGuestConfirm = () => {
    const name = guestDraft.trim();
    if (!name) return;
    onSelect?.({
      propertyId: selectedBuilding?.propertyId ?? null,
      roomId: selectedRoomObj?.roomId ?? null,
      propertyName: selectedBuilding?.id ?? null,
      roomLabel: selectedRoom,
      reservationId: null,
      guestName: name,
      channel: null,
      checkinDate: null,
      checkoutDate: null,
    });
    dismiss();
  };

  if (!hydrated) return null;

  const isRoomStep = step === "room";
  const canConfirm = isRoomStep && selectedRoom !== null && selectedResIdx !== null;

  const sheetTitle = isRoomStep ? copy.contextPickerRoomTitle : copy.contextPickerTitle;
  const sheetSub = isRoomStep
    ? copy.contextPickerRoomSub
    : step === "guest-only"
      ? copy.contextPickerGuestSub
      : copy.contextPickerHint;

  return (
    <>
        {/* ── 고정 헤더 ── */}
        <div className="shrink-0">
          <div className="mb-3.5 flex items-start gap-3" {...dragHandleProps}>
            {step !== "building" ? (
              <button
                aria-label={copy.backToList}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors active:bg-slate-200"
                onClick={
                  step === "guest-only" && selectedBuilding
                    ? () => setStep("room")
                    : step === "guest-only"
                      ? () => setStep("building")
                      : goBackToBuilding
                }
                type="button"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-black tracking-[-0.02em] text-foreground">
                {sheetTitle}
              </p>
              <p className="mt-[3px] text-[12px] font-medium text-muted-foreground">{sheetSub}</p>
            </div>
          </div>

          {/* 스테퍼 — 건물 단계만 */}
          {step === "building" || step === "guest-only" ? (
            <div className="mb-3.5">
              <StepBar activeStep={1} copy={copy} />
            </div>
          ) : null}

          {/* 브레드크럼 — 방 단계만 */}
          {isRoomStep && selectedBuilding ? (
            <Breadcrumb
              buildingLabels={buildingLabels}
              buildingName={selectedBuilding.name}
              roomSuffix={copy.contextPickerRoomSuffix}
              roomNumber={selectedRoom}
              onBuildingTap={goBackToBuilding}
            />
          ) : null}

          {/* 검색 — 건물 단계만 */}
          {step === "building" ? (
            <div className="relative mb-3">
              <Search
                className="pointer-events-none absolute left-[13px] top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50"
                aria-hidden="true"
              />
              <input
                className="h-11 w-full rounded-[13px] border border-border bg-background px-4 pl-[37px] text-[13.5px] font-medium text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary"
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="search"
                onChange={(e) => setSearch(e.target.value)}
                placeholder={copy.contextPickerSearch}
                ref={searchRef}
                type="search"
                value={search}
              />
              {search ? (
                <button
                  aria-label={copy.filterClear}
                  className="absolute right-2.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
                  onClick={() => setSearch("")}
                  type="button"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ── 스크롤 본문 ── */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-5 pt-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

          {/* ── 단계: 건물 ── */}
          {step === "building" ? (
            <>
              {isSearchMode ? (
                /* ── 검색 결과 모드 ── */
                <>
                  {resSearchLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="size-5 animate-spin text-muted-foreground/40" aria-hidden="true" />
                    </div>
                  ) : resSearchResults.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {resSearchResults.map((r) => (
                        <ReservationSearchRow
                          buildingLabels={buildingLabels}
                          copy={copy}
                          key={r.id}
                          result={r}
                          onTap={() => handleSearchResultTap(r)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-10 text-center">
                      <UserRound className="mb-2 size-9 text-slate-300" aria-hidden="true" />
                      <p className="text-[13px] font-semibold text-muted-foreground">
                        {copy.contextPickerResSearchEmpty}
                      </p>
                      <p className="mt-1 text-[11.5px] text-muted-foreground/60">
                        {copy.contextPickerResSearchEmptySub}
                      </p>
                    </div>
                  )}

                  {/* 보조 버튼: 건물 둘러보기 + 게스트만 */}
                  <div className="mt-3 flex gap-2">
                    <AltButton
                      icon={<Building2 className="size-[15px] text-muted-foreground" aria-hidden="true" />}
                      label={copy.contextPickerBrowseBuildings}
                      onClick={() => setSearch("")}
                    />
                    <AltButton
                      icon={<UserRound className="size-[15px] text-muted-foreground" aria-hidden="true" />}
                      label={copy.contextPickerGuestOnly}
                      onClick={() => {
                        setStep("guest-only");
                        setSearch("");
                      }}
                    />
                  </div>
                </>
              ) : (
                /* ── 건물 목록 모드 ── */
                <>
                  {buildingsLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="size-5 animate-spin text-muted-foreground/40" aria-hidden="true" />
                    </div>
                  ) : buildings.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {buildings.map((b) => (
                        <BuildingRow building={b} copy={copy} key={b.id} onTap={() => { void handleBuildingTap(b); }} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-10 text-center">
                      <Building2 className="mb-2 size-9 text-slate-300" aria-hidden="true" />
                      <p className="text-[13px] font-semibold text-muted-foreground">
                        {copy.contextPickerNoBuilding}
                      </p>
                    </div>
                  )}

                  {/* 게스트만 보조 */}
                  <div className="mt-3 flex gap-2">
                    <AltButton
                      icon={<UserRound className="size-[15px] text-muted-foreground" aria-hidden="true" />}
                      label={copy.contextPickerGuestOnly}
                      onClick={() => {
                        setStep("guest-only");
                        setSearch("");
                      }}
                    />
                  </div>
                </>
              )}
            </>
          ) : null}

          {/* ── 단계: 방 + 예약 ── */}
          {isRoomStep ? (
            <>
              <p className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                {copy.contextPickerRoom}
              </p>
              {roomsLoading ? (
                <div className="mb-[6px] flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground/40" aria-hidden="true" />
                </div>
              ) : buildingRooms.length > 0 ? (
                <div className="mb-[6px] grid grid-cols-4 gap-2">
                  {buildingRooms.map((r) => (
                    <RoomCell
                      buildingLabels={buildingLabels}
                      copy={copy}
                      key={r.label}
                      room={r}
                      selected={selectedRoom === r.label}
                      onTap={() => { void handleRoomTap(r.label); }}
                    />
                  ))}
                </div>
              ) : (
                <div className="mb-[6px] flex flex-col items-center rounded-2xl border border-dashed border-border py-6 text-center">
                  <DoorOpen className="mb-1.5 size-7 text-slate-300" aria-hidden="true" />
                  <p className="text-[12.5px] font-semibold text-muted-foreground">
                    {copy.contextPickerNoRooms}
                  </p>
                </div>
              )}

              {selectedRoom ? (
                <>
                  {/* 기간이 있는 섹션 라벨 */}
                  <div className="mb-2 mt-[14px] flex items-center gap-1.5">
                    <p className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                      {copy.contextPickerResSec}
                    </p>
                    {resPeriodLabel ? (
                      <span className="text-[10px] font-semibold text-muted-foreground/60">
                        · {resPeriodLabel}
                      </span>
                    ) : null}
                  </div>

                  {/* 로딩 */}
                  {resLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-muted-foreground/40" aria-hidden="true" />
                    </div>
                  ) : roomReservations.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {roomReservations.map((res, idx) => (
                        <ReservationRow
                          copy={copy}
                          key={res.id}
                          res={res}
                          selected={selectedResIdx === idx}
                          onTap={() => handleResTap(idx)}
                        />
                      ))}
                    </div>
                  ) : (
                    /* 빈 상태 */
                    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border py-8 text-center">
                      <p className="text-[12.5px] font-semibold text-muted-foreground">
                        {copy.contextPickerNoReservations}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                        {resPeriodLabel}
                      </p>
                    </div>
                  )}
                </>
              ) : null}

              {/* 보조 버튼 */}
              <div className="mt-3 flex gap-2">
                <AltButton
                  icon={<Building2 className="size-[15px]" aria-hidden="true" />}
                  label={copy.contextPickerBuildingOnly}
                  onClick={handleBuildingOnlyLink}
                  emphasized
                />
                <AltButton
                  icon={<DoorOpen className="size-[15px]" aria-hidden="true" />}
                  label={copy.contextPickerRoomOnly}
                  onClick={handleRoomOnlyLink}
                  emphasized={selectedRoom !== null}
                />
              </div>
            </>
          ) : null}

          {/* ── 단계: 게스트만 ── */}
          {step === "guest-only" ? (
            <div className="flex flex-col gap-3 pt-1">
              {/* 긴급 컨텍스트 콜아웃 */}
              <div className="rounded-2xl border border-amber-200/60 bg-amber-50/60 px-4 py-3">
                <p className="text-[11.5px] font-semibold leading-[1.6] text-amber-800/90">
                  {copy.contextPickerGuestHint}
                </p>
              </div>

              <div>
                <p className="mb-2 px-0.5 text-[12px] font-extrabold text-foreground">
                  {copy.contextPickerGuestLabel}
                </p>
                <input
                  autoFocus
                  className="h-12 w-full rounded-2xl border border-border bg-surface px-4 text-[15px] font-bold text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-primary"
                  onChange={(e) => setGuestDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // 한글 · 일본어 조합 중 Enter 는 글자 확정이라 제출하지 않는다(keyCode 229 = 조합 중).
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                      e.preventDefault();
                      handleGuestConfirm();
                    }
                  }}
                  placeholder={copy.contextPickerGuestPlaceholder}
                  value={guestDraft}
                />
              </div>
              <button
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[14px] font-extrabold text-primary-foreground transition-opacity disabled:opacity-40"
                disabled={!guestDraft.trim()}
                onClick={handleGuestConfirm}
                type="button"
              >
                <UserRound className="size-4" aria-hidden="true" />
                {copy.contextPickerGuestConfirm}
              </button>
            </div>
          ) : null}
        </div>

        {/* ── 고정 하단 CTA — 방 단계만 ── */}
        {isRoomStep ? (
          <div className="-mx-5 shrink-0 border-t-[0.5px] border-[var(--separator)] bg-surface px-5 pt-3">
            <button
              className={cn(
                "flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] text-[14.5px] font-extrabold transition-colors",
                canConfirm
                  ? "bg-primary text-primary-foreground"
                  : "bg-slate-100 text-muted-foreground/60",
              )}
              disabled={!canConfirm}
              onClick={handleConfirmLink}
              type="button"
            >
              <Link2 className="size-[17px]" aria-hidden="true" />
              {copy.contextLinkConfirm}
            </button>
          </div>
        ) : null}
    </>
  );
}
