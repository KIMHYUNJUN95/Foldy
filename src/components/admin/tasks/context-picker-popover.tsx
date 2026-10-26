"use client";

// 모바일 `ContextPickerSheet` 의 관리자 콘솔 짝 — 같은 건물 → 방 →
// 예약 데이터 흐름(src/actions/task-context.ts 참고)이지만, 하단 시트 대신 데스크톱
// 팝오버(`.pop`)로 그리고, 로컬 초안 + 단일 적용 버튼으로 동작해
// 이 콘솔의 다른 팝오버와 맞춘다 (admin-tasks-console.tsx 의 `SchedulePopover` 참고).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Building2,
  BedDouble,
  Check,
  ChevronLeft,
  Link2,
  Loader2,
  Search,
  Ticket,
  Unlink,
  UserRound,
  X,
} from "lucide-react";
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

// 할 일에 연결할 수 있는 운영 컨텍스트. 모바일 `LinkedContext` 모양을 따르되,
// 관리자 콘솔이 그리지 않는 채널/날짜 필드는 뺐다.
export type TaskContextValue = {
  propertyId: string | null;
  roomId: string | null;
  reservationId: string | null;
  guestName: string | null;
  /** 표시 전용 — 이미 현지화됨 (서버 액션이 세션 로케일로 이름을 해석한다). */
  propertyName: string | null;
  /** 표시 전용 방 라벨. */
  roomLabel: string | null;
};

const EMPTY_VALUE: TaskContextValue = {
  propertyId: null,
  roomId: null,
  reservationId: null,
  guestName: null,
  propertyName: null,
  roomLabel: null,
};

export type ContextPickerCopy = {
  title: string;
  hintBuilding: string;
  hintRoom: string;
  buildings: string;
  rooms: string;
  reservations: string;
  search: string;
  searchClear: string;
  searchEmpty: string;
  searchEmptySub: string;
  noBuilding: string;
  noRooms: string;
  noReservation: string;
  guest: string;
  loading: string;
  back: string;
  clear: string;
  apply: string;
  cancel: string;
  occupied: string;
  vacant: string;
  blocked: string;
  nightsUnit: string;
  channelDirect: string;
  live: string;
  roomsUnit: string;
  todayGuests: string;
  roomSuffix: string;
  bookingId: string;
};

type Step = "building" | "room";

// ── 작은 표시용 헬퍼 ────────────────────────────────────────────────────────────

function Spinner({ label }: { label: string }) {
  return (
    <div className="ctxp__loading" role="status" aria-label={label}>
      <Loader2 className="ctxp__spin" size={18} aria-hidden="true" />
    </div>
  );
}

function EmptyPane({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div className="ctxp__empty">
      <span className="ctxp__emptyicon">{icon}</span>
      <p className="ctxp__emptytitle">{title}</p>
      {sub ? <p className="ctxp__emptysub">{sub}</p> : null}
    </div>
  );
}

function channelLabel(channel: "airbnb" | "booking" | "direct", directLabel: string): string {
  // 채널 브랜드 이름은 번역하지 않는다. 모바일 피커의 기존 선례와 같다.
  return channel === "airbnb" ? "Airbnb" : channel === "booking" ? "Booking" : directLabel;
}

function BuildingRow({
  building,
  copy,
  selected,
  onTap,
}: {
  building: PickerBuilding;
  copy: ContextPickerCopy;
  selected: boolean;
  onTap: () => void;
}) {
  return (
    <button type="button" className={`ritem ${selected ? "on" : ""}`} onClick={onTap}>
      <span className="ic">
        <Building2 size={15} aria-hidden="true" />
      </span>
      <span className="ctxp__rowtext">
        <span className="ctxp__rowtitle">{building.name}</span>
        <span className="ctxp__rowsub">
          {building.totalRooms}
          {copy.roomsUnit}
          {building.todayGuests > 0 ? ` · ${copy.todayGuests} ${building.todayGuests}` : ""}
        </span>
      </span>
      <span className="ic chk">
        <Check size={13} aria-hidden="true" />
      </span>
    </button>
  );
}

function RoomCell({
  room,
  copy,
  selected,
  onTap,
}: {
  room: PickerRoom;
  copy: ContextPickerCopy;
  selected: boolean;
  onTap: () => void;
}) {
  return (
    <button type="button" className={`ctxp__roomcell ${selected ? "on" : ""}`} onClick={onTap}>
      {selected ? (
        <span className="ctxp__roomcheck">
          <Check size={10} aria-hidden="true" />
        </span>
      ) : null}
      <span className="ctxp__roomlabel">{room.label}</span>
      {/*
        투숙이 차단보다 우선이다. 판매를 막아 둔 방에 손님이 들어와 있는 경우가 있는데
        (수기 예약), 작업을 배정하는 사람에게는 「손님이 있다」가 먼저 알아야 할 사실이다.
        손님이 없는데 막혀 있으면 「공실」이 아니라 「차단」으로 보여준다.
      */}
      <span
        className={`ctxp__roomstatus ${room.occupied ? "occ" : room.blocked ? "blk" : ""}`}
      >
        {room.occupied ? copy.occupied : room.blocked ? copy.blocked : copy.vacant}
      </span>
    </button>
  );
}

function ReservationRow({
  res,
  copy,
  selected,
  onTap,
}: {
  res: RoomReservation;
  copy: ContextPickerCopy;
  selected: boolean;
  onTap: () => void;
}) {
  return (
    <button type="button" className={`ritem ${selected ? "on" : ""}`} onClick={onTap}>
      <span className="ic">
        <UserRound size={15} aria-hidden="true" />
      </span>
      <span className="ctxp__rowtext">
        <span className="ctxp__rowtitle">
          {res.guestName}
          {res.isLive ? <span className="ctxp__livebadge">{copy.live}</span> : null}
        </span>
        <span className="ctxp__rowsub">
          {channelLabel(res.channel, copy.channelDirect)} · {res.dateRange} · {res.nightsCount}
          {copy.nightsUnit}
        </span>
      </span>
      <span className="ic chk">
        <Check size={13} aria-hidden="true" />
      </span>
    </button>
  );
}

function SearchResultRow({
  result,
  propertyLabel,
  copy,
  selected,
  onTap,
}: {
  result: ReservationSearchResult;
  /** 현지화된 건물 이름. 호출자가 이미 가져온 건물 목록에서 해석한다. */
  propertyLabel: string;
  copy: ContextPickerCopy;
  selected: boolean;
  onTap: () => void;
}) {
  // 오쿠보식 건물은 displayRoomLabel 이 프로퍼티 이름 그 자체로 해석되므로 그 경우
  // 중복되는 방 접미사를 생략한다 (모바일 시트의 같은 검사와 같다).
  const showRoom = result.displayRoomLabel && result.displayRoomLabel !== result.propertyName;
  return (
    <button type="button" className={`ritem ${selected ? "on" : ""}`} onClick={onTap}>
      <span className="ic">
        <Ticket size={15} aria-hidden="true" />
      </span>
      <span className="ctxp__rowtext">
        <span className="ctxp__rowtitle">
          {result.guestName}
          {result.isLive ? <span className="ctxp__livebadge">{copy.live}</span> : null}
        </span>
        <span className="ctxp__rowsub">
          {propertyLabel}
          {showRoom ? ` · ${result.displayRoomLabel}${copy.roomSuffix}` : ""}
        </span>
        <span className="ctxp__rowsub2">
          {channelLabel(result.channel, copy.channelDirect)} · {result.dateRange} · {result.nightsCount}
          {copy.nightsUnit}
          {result.sourceReservationId ? ` · ${copy.bookingId} ${result.sourceReservationId}` : ""}
        </span>
      </span>
      <span className="ic chk">
        <Check size={13} aria-hidden="true" />
      </span>
    </button>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────────────────

export function ContextPickerPopover({
  value,
  onChange,
  onClose,
  copy,
  style,
}: {
  value: TaskContextValue;
  onChange: (v: TaskContextValue) => void;
  onClose: () => void;
  copy: ContextPickerCopy;
  style?: CSSProperties;
}) {
  const [draft, setDraft] = useState<TaskContextValue>(value);
  const [step, setStep] = useState<Step>("building");

  const [buildings, setBuildings] = useState<PickerBuilding[]>([]);
  const [buildingsLoading, setBuildingsLoading] = useState(true);
  const [selectedBuilding, setSelectedBuilding] = useState<PickerBuilding | null>(null);

  const [rooms, setRooms] = useState<PickerRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<PickerRoom | null>(null);

  const [reservations, setReservations] = useState<RoomReservation[]>([]);
  const [resLoading, setResLoading] = useState(false);
  const [resPeriodLabel, setResPeriodLabel] = useState("");

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ReservationSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 마운트 시점의 들어온 값 스냅샷으로, 이미 연결된 할 일을 다시 열 때 건물/방 패널을
  // 한 번 자동으로 해석하는 데만 쓴다. `useRef` (의존성 아님)로 일회성
  // 하이드레이션 힌트로 둔다 — 이후 `value` prop 변경이 사용자가 작성 중인 초안과 다투면 안 된다.
  const initialValueRef = useRef(value);

  // 건물은 진입 패널이다 — 열릴 때 한 번 가져온다. 이미 연결된 할 일의 방/예약
  // 하이드레이션은 같은 effect 안에서 이어진다 (중첩 await, effect 본문에서 동기
  // setState 없음) 그래서 연결된 할 일에서 팝오버를 다시 열면 전체 경로가 복원된다.
  useEffect(() => {
    let cancelled = false;
    const initial = initialValueRef.current;
    void (async () => {
      let list: PickerBuilding[] = [];
      try {
        list = await fetchPickerBuildings();
      } catch {
        // 빈 목록으로 이어짐
      }
      if (cancelled) return;
      setBuildings(list);
      setBuildingsLoading(false);

      const b = initial.propertyId ? list.find((x) => x.propertyId === initial.propertyId) : undefined;
      if (!b) return;
      setSelectedBuilding(b);
      setStep("room");

      setRoomsLoading(true);
      let roomList: PickerRoom[] = [];
      try {
        roomList = await fetchPickerRooms(b.id);
      } catch {
        // 빈 목록으로 이어짐
      }
      if (cancelled) return;
      setRooms(roomList);
      setRoomsLoading(false);

      const r = initial.roomId ? roomList.find((x) => x.roomId === initial.roomId) : undefined;
      if (!r) return;
      setSelectedRoom(r);

      setResLoading(true);
      try {
        const { reservations: resList, periodLabel } = await fetchRoomReservations(b.id, r.label);
        if (cancelled) return;
        setReservations(resList);
        setResPeriodLabel(periodLabel);
      } catch {
        if (!cancelled) {
          setReservations([]);
          setResPeriodLabel("");
        }
      } finally {
        if (!cancelled) setResLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 디바운스된 건물 간 예약 검색 (건물 패널에서만). 짧은 쿼리 리셋은
  // 이 effect 본문이 아니라 호출 지점(쿼리 onChange / 지우기 버튼)에서 동기적으로 일어나지 않는다.
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const q = query.trim();
    if (q.length < 2) return;
    searchTimerRef.current = setTimeout(() => {
      setSearchLoading(true);
      searchReservations(q)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 400);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isSearchMode = query.trim().length >= 2;

  // 가져오기는 탭 핸들러 자체에서 시작된다 (상태에 반응하는 effect 가 아니라) — 패널은
  // 사용자가 탭해 들어가는 바로 그 순간 "열리며", 여기의 모든 setState 는 동기적이거나
  // (즉각적인 UI 피드백) 비동기 fetch 자신의 콜백 안에 있다.
  const handleBuildingTap = (b: PickerBuilding) => {
    setSelectedBuilding(b);
    setSelectedRoom(null);
    setReservations([]);
    setResPeriodLabel("");
    setStep("room");
    setDraft({
      ...EMPTY_VALUE,
      propertyId: b.propertyId,
      propertyName: b.name,
    });
    setRoomsLoading(true);
    setRooms([]);
    fetchPickerRooms(b.id)
      .then(setRooms)
      .catch(() => setRooms([]))
      .finally(() => setRoomsLoading(false));
  };

  const handleRoomTap = (r: PickerRoom) => {
    const next = selectedRoom?.label === r.label ? null : r;
    setSelectedRoom(next);
    setReservations([]);
    setResPeriodLabel("");
    if (!selectedBuilding) return;
    setDraft((prev) => ({
      ...prev,
      propertyId: r.propertyId ?? selectedBuilding.propertyId,
      propertyName: selectedBuilding.name,
      roomId: next ? r.roomId : null,
      roomLabel: next ? r.label : null,
      reservationId: null,
      guestName: null,
    }));
    if (!next) return;
    setResLoading(true);
    fetchRoomReservations(selectedBuilding.id, next.label)
      .then(({ reservations: list, periodLabel }) => {
        setReservations(list);
        setResPeriodLabel(periodLabel);
      })
      .catch(() => {
        setReservations([]);
        setResPeriodLabel("");
      })
      .finally(() => setResLoading(false));
  };

  const handleReservationTap = (res: RoomReservation) => {
    setDraft((prev) => {
      const already = prev.reservationId === res.id;
      return {
        ...prev,
        reservationId: already ? null : res.id,
        guestName: already ? null : res.guestName,
      };
    });
  };

  const handleSearchResultTap = (r: ReservationSearchResult) => {
    const propertyLabel = buildings.find((b) => b.id === r.propertyName)?.name ?? r.propertyName;
    setDraft({
      propertyId: r.propertyId,
      roomId: r.roomId,
      reservationId: r.id,
      guestName: r.guestName,
      propertyName: propertyLabel,
      roomLabel: r.displayRoomLabel,
    });
  };

  const goBack = () => {
    setStep("building");
    setSelectedBuilding(null);
    setSelectedRoom(null);
    setRooms([]);
    setReservations([]);
    setResPeriodLabel("");
  };

  const handleClear = () => setDraft(EMPTY_VALUE);

  const handleApply = () => {
    onChange(draft);
    onClose();
  };

  const hasDraft = !!(draft.propertyId || draft.roomId || draft.reservationId || draft.guestName);
  const hasCrumb = !!(draft.propertyName || draft.roomLabel || draft.guestName);

  return (
    <div className="pop ctxp" style={style}>
      <div className="ctxp__head">
        {step === "room" ? (
          <button type="button" className="ctxp__back" aria-label={copy.back} onClick={goBack}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
        ) : null}
        <div className="ctxp__headtext">
          <b>{copy.title}</b>
          <span>{step === "room" ? copy.hintRoom : copy.hintBuilding}</span>
        </div>
        {hasDraft ? (
          <button type="button" className="ctxp__clearbtn" onClick={handleClear}>
            <Unlink size={12} aria-hidden="true" />
            {copy.clear}
          </button>
        ) : null}
      </div>

      {hasCrumb ? (
        <div className="ctxp__crumb">
          {draft.propertyName ? (
            <span className="achip set">
              <Building2 className="ic" size={13} aria-hidden="true" />
              {buildings.find((b) => b.id === draft.propertyName)?.name ?? draft.propertyName}
            </span>
          ) : null}
          {draft.roomLabel ? (
            <span className="achip set">
              <BedDouble className="ic" size={13} aria-hidden="true" />
              {draft.roomLabel}
              {copy.roomSuffix}
            </span>
          ) : null}
          {draft.guestName ? (
            <span className="achip set">
              <UserRound className="ic" size={13} aria-hidden="true" />
              {draft.guestName}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="ctxp__body">
        {step === "building" ? (
          <>
            <div className="ctxp__search">
              <span className="ic">
                <Search size={14} aria-hidden="true" />
              </span>
              <input
                type="search"
                autoComplete="off"
                placeholder={copy.search}
                value={query}
                onChange={(e) => {
                  const next = e.target.value;
                  setQuery(next);
                  if (next.trim().length < 2) setSearchResults([]);
                }}
              />
              {query ? (
                <button
                  type="button"
                  aria-label={copy.searchClear}
                  onClick={() => {
                    setQuery("");
                    setSearchResults([]);
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {isSearchMode ? (
              searchLoading ? (
                <Spinner label={copy.loading} />
              ) : searchResults.length > 0 ? (
                <div className="rep-list">
                  {searchResults.map((r) => (
                    <SearchResultRow
                      key={r.id}
                      copy={copy}
                      result={r}
                      propertyLabel={buildings.find((b) => b.id === r.propertyName)?.name ?? r.propertyName}
                      selected={draft.reservationId === r.id}
                      onTap={() => handleSearchResultTap(r)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyPane
                  icon={<Search size={22} aria-hidden="true" />}
                  title={copy.searchEmpty}
                  sub={copy.searchEmptySub}
                />
              )
            ) : buildingsLoading ? (
              <Spinner label={copy.loading} />
            ) : buildings.length > 0 ? (
              <div className="rep-list">
                {buildings.map((b) => (
                  <BuildingRow
                    key={b.id}
                    building={b}
                    copy={copy}
                    selected={selectedBuilding?.id === b.id}
                    onTap={() => handleBuildingTap(b)}
                  />
                ))}
              </div>
            ) : (
              <EmptyPane icon={<Building2 size={22} aria-hidden="true" />} title={copy.noBuilding} />
            )}
          </>
        ) : (
          <>
            <p className="ctxp__seclabel">{copy.rooms}</p>
            {roomsLoading ? (
              <Spinner label={copy.loading} />
            ) : rooms.length > 0 ? (
              <div className="ctxp__roomgrid">
                {rooms.map((r) => (
                  <RoomCell
                    key={r.label}
                    room={r}
                    copy={copy}
                    selected={selectedRoom?.label === r.label}
                    onTap={() => handleRoomTap(r)}
                  />
                ))}
              </div>
            ) : (
              <EmptyPane icon={<BedDouble size={22} aria-hidden="true" />} title={copy.noRooms} />
            )}

            {selectedRoom ? (
              <>
                <p className="ctxp__seclabel ctxp__seclabel--res">
                  {copy.reservations}
                  {resPeriodLabel ? <span className="ctxp__secperiod">· {resPeriodLabel}</span> : null}
                </p>
                {resLoading ? (
                  <Spinner label={copy.loading} />
                ) : reservations.length > 0 ? (
                  <div className="rep-list">
                    {reservations.map((res) => (
                      <ReservationRow
                        key={res.id}
                        res={res}
                        copy={copy}
                        selected={draft.reservationId === res.id}
                        onTap={() => handleReservationTap(res)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyPane icon={<Ticket size={22} aria-hidden="true" />} title={copy.noReservation} />
                )}
              </>
            ) : null}
          </>
        )}
      </div>

      <div className="sch__foot">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          {copy.cancel}
        </button>
        <button type="button" className="btn btn--pri btn--sm" onClick={handleApply}>
          <Link2 size={14} aria-hidden="true" />
          {copy.apply}
        </button>
      </div>
    </div>
  );
}
