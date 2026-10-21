"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { MoreHorizontal, Phone, Search } from "lucide-react";
import {
  addApplicantForDay,
  addRoomForDay,
  answerTraineeCheck,
  applyDaySuggestions,
  assignToRoom,
  cancelPersonDay,
  holdRoom,
  loadOpenCountsForMonth,
  releaseHold,
  resolveCancelRequest,
  saveMyMainProperties,
  setDayStartTime,
  unassignFromRoom,
  type AssignFail,
} from "@/app/admin/cleaning-assign/actions";
import { AdminDatePicker } from "@/components/admin/shared/admin-date-picker";
import { AdminTimePicker } from "@/components/admin/shared/admin-time-picker";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { AdminUndoToast } from "@/components/admin/shared/admin-undo-toast";
import type { Dictionary } from "@/lib/i18n";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { BoardPerson, BoardRoom, DayBoard } from "@/lib/cleaning-assign/data";
import { haptic } from "@/lib/haptics";
import { agoText, checkInText, dayLabel, roleLabel, shortDate, timeLabel, timeValue, tokyoTime } from "./format";
import "./cleaning-assign.css";

/**
 * 청소 배정 — 하루 보기(PC). 시안 「③ 배정 하루 보기」(https://claude.ai/artifact/Fz6ux5HZDwHtDQ5CmDBV64).
 *
 * 왼쪽 = 그날 청소할 방(미배정 · 밀려 온 방 · 취소된 방이 위, 건물별 목록), 오른쪽 = 신청자 목록(신청 / 배정 전 / 신청 안 함).
 * **사람을 누르면 고른 상태** — 그 사람 방이 강조되고, 다른 방은 「+ 넣기」, 들어간 방은 「빼기」(끌기 없이 누르기로 — 키보드 · 한 손 조작).
 * 저장은 방 한 건씩 서버 액션으로. 다른 담당자와 겹치면 「방금 다른 담당자가 바꿨어요」 + 새로 불러오기. 20초마다 새로 불러온다(실시간).
 * docs/product/37-cleaning-shift-assignment.md 「4-2」
 */

type Shared = Dictionary["admin"]["shared"];
type ListTab = "applied" | "waiting" | "none";

type Props = {
  board: DayBoard;
  copy: CleaningAssignCopy;
  locale: string;
  today: string;
  shared: Shared;
  propertyLabels: Record<string, string>;
  roomOptions: { roomKey: string; propertyName: string; label: string }[];
  canCompare: boolean;
};

const REFRESH_MS = 20_000;

export function AssignDayBoard({ board, copy, locale, today, shared, propertyLabels, roomOptions, canCompare }: Props) {
  const router = useRouter();
  const { toast, showToast, dismiss } = useAdminToast();
  const [pending, startTransition] = useTransition();
  const [pickId, setPickId] = useState<string | null>(null);
  const [tab, setTab] = useState<ListTab>("applied");
  const [query, setQuery] = useState("");
  const [onlyMine, setOnlyMine] = useState(board.mainProperties.length > 0);
  const [menuRoom, setMenuRoom] = useState<string | null>(null);
  const [deferRoom, setDeferRoom] = useState<{ roomKey: string; origin: string; until: string; reason: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [buildingPicker, setBuildingPicker] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [timeEdit, setTimeEdit] = useState<string | null>(null);
  const [showAllRooms, setShowAllRooms] = useState<Record<string, boolean>>({});
  const [peopleLimit, setPeopleLimit] = useState(40);

  const label = (name: string) => propertyLabels[name] ?? name;
  const people = board.people;
  const personById = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);
  const picked = pickId ? (personById.get(pickId) ?? null) : null;

  // 실시간 — 화면이 보일 때만 20초마다 새로 불러온다.
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible" && !pending) router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [router, pending]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPickId(null);
      setMenuRoom(null);
      setDeferRoom(null);
      setAddOpen(false);
      setBuildingPicker(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function run(task: () => Promise<{ ok: true } | AssignFail>, success?: string) {
    startTransition(async () => {
      const result = await task();
      if (result.ok) {
        haptic("success");
        if (success) showToast(success);
      } else {
        haptic("error");
        showToast(result.reason === "conflict" ? copy.conflict : copy.failed);
      }
      router.refresh();
    });
  }

  // 미루기 · 처리 끝 — 5초 「실행 취소」(뺀 배정까지 되돌린다). 지난 뒤에는 방 줄의 「되돌리기」.
  const [undo, setUndo] = useState<{ stamp: number; message: string; roomKey: string; originDate: string; restore: string[] } | null>(null);
  function hold(room: { roomKey: string; propertyName: string; roomLabel: string }, input: { originDate: string; kind: "defer" | "resolved"; untilDate?: string; reason?: string }) {
    const name = room.roomLabel === room.propertyName ? label(room.propertyName) : `${label(room.propertyName)} ${room.roomLabel}`;
    startTransition(async () => {
      const result = await holdRoom({ date: board.date, roomKey: room.roomKey, ...input });
      if (result.ok) {
        haptic("success");
        setUndo({
          message: input.kind === "resolved" ? fill(copy.heldResolved, { room: name }) : fill(copy.heldDeferred, { date: shortDate(input.untilDate ?? nextDay(board.date)), room: name }),
          originDate: input.originDate,
          restore: result.removed,
          roomKey: room.roomKey,
          stamp: Date.now(),
        });
      } else {
        haptic("error");
        showToast(copy.failed);
      }
      router.refresh();
    });
  }

  const visibleProperty = (name: string) => !onlyMine || board.mainProperties.length === 0 || board.mainProperties.includes(name);

  const rooms = board.rooms.filter((room) => visibleProperty(room.propertyName));
  const cancelledRooms = rooms.filter((room) => room.cancelled && room.people.length > 0);
  const openRooms = rooms.filter(
    (room) => !room.cancelled && room.status === "pending" && !room.deferredUntil && (room.people.length === 0 || room.people.length < room.usualHeadcount || room.source === "carry"),
  );
  const openKeys = new Set(openRooms.map((room) => room.roomKey));
  const restRooms = rooms.filter((room) => !room.cancelled && !openKeys.has(room.roomKey));
  const byBuilding = new Map<string, BoardRoom[]>();
  for (const room of restRooms) byBuilding.set(room.propertyName, [...(byBuilding.get(room.propertyName) ?? []), room]);
  const suggestCount = openRooms.reduce((sum, room) => sum + room.suggested.length, 0);
  // 미배정도 건물별로 나눠 객실 순서대로(board.rooms 가 이미 건물 순서 → 객실 번호 순) — 건물 이름은 묶음 제목에 한 번만.
  const openByBuilding = new Map<string, BoardRoom[]>();
  for (const room of openRooms) openByBuilding.set(room.propertyName, [...(openByBuilding.get(room.propertyName) ?? []), room]);

  const toggleRoom = (room: BoardRoom) => {
    if (!picked) return;
    const inRoom = room.people.some((p) => p.userId === picked.userId);
    run(() => (inRoom ? unassignFromRoom({ date: board.date, roomKey: room.roomKey, userId: picked.userId }) : assignToRoom({ date: board.date, roomKey: room.roomKey, userId: picked.userId })));
  };

  const roomInfo = (room: BoardRoom) => checkInText(room, copy);

  const roomRow = (room: BoardRoom, opts: { open?: boolean; grouped?: boolean } = {}) => {
    const mine = picked ? room.people.some((p) => p.userId === picked.userId) : false;
    const need = Math.max(0, room.usualHeadcount - room.people.length);
    const origin = room.carriedFrom ?? board.date;
    return (
      <div key={room.roomKey} className={`cas-room${mine ? " is-mine" : ""}${room.status !== "pending" ? " is-quiet" : ""}`}>
        <div className="cas-room__id">
          {opts.open && !opts.grouped ? <span className="cas-room__bld">{label(room.propertyName)}</span> : null}
          <span className="cas-room__no">{room.roomLabel === room.propertyName ? label(room.propertyName) : room.roomLabel}</span>
          {!opts.open ? <span className="cas-room__sub">{roomInfo(room)}</span> : null}
        </div>
        <div className="cas-room__body">
          {room.source === "carry" && room.carryDays > 0 ? <span className="cas-tag is-warn">{fill(copy.tagCarry, { n: room.carryDays + 1 })}</span> : null}
          {room.source === "extra" ? <span className="cas-tag is-blue">{copy.tagExtra}</span> : null}
          {room.usualHeadcount > 1 ? (
            <span className="cas-tag">
              {need > 0 ? fill(copy.tagBig, { have: room.people.length, more: need, need: room.usualHeadcount }) : copy.bigRoom}
            </span>
          ) : null}
          {room.deferredUntil ? <span className="cas-tag is-warn">{fill(copy.deferredTo, { date: shortDate(room.deferredUntil) })}</span> : null}
          {room.status === "progress" ? <span className="cas-tag is-pri">{copy.statusProgress}</span> : null}
          {room.status === "done" ? <span className="cas-tag">{room.resolvedHold ? copy.tagResolved : copy.statusDone}</span> : null}
          {opts.open ? <span className="cas-room__note">{[roomInfo(room), room.note, room.holdReason].filter(Boolean).join(" · ")}</span> : null}
          {room.people.map((p) => (
            <span key={p.userId} className={`cas-chip${picked?.userId === p.userId ? " is-picked" : ""}`} title={p.by ? `${p.by} · ${tokyoTime(p.at, true)}` : undefined}>
              {p.name}
              {p.trainee ? <small>{fill(copy.traineeShort, { n: personById.get(p.userId)?.traineeCount ?? "" })}</small> : null}
            </span>
          ))}
        </div>
        <div className="cas-room__act">
          {room.usualHeadcount > 1 && room.people.length > 0 ? <span className="cas-room__count">{`${room.people.length}/${room.usualHeadcount}`}</span> : null}
          {picked && room.status === "pending" && !room.deferredUntil ? (
            <button type="button" className={mine ? "cas-btn is-ghost" : "cas-btn is-line"} disabled={pending} onClick={() => toggleRoom(room)}>
              {mine ? copy.removeHere : copy.addHere}
            </button>
          ) : null}
          {!picked && opts.open && room.suggested.length > 0 ? (
            <>
              <span className="cas-room__hint">{copy.suggest}</span>
              <button
                type="button"
                className="cas-btn is-soft"
                disabled={pending}
                onClick={() => run(() => assignToRoom({ date: board.date, roomKey: room.roomKey, userId: room.suggested[0].userId }))}
              >
                {fill(copy.put, { name: room.suggested[0].name })}
              </button>
            </>
          ) : null}
          {room.deferredUntil || room.resolvedHold ? (
            <button type="button" className="cas-btn is-ghost" disabled={pending} onClick={() => run(() => releaseHold({ date: board.date, originDate: origin, roomKey: room.roomKey }))}>
              {copy.undoHold}
            </button>
          ) : room.status === "pending" ? (
            <div className="cas-menu">
              <button type="button" className="cas-icon" aria-label={copy.moreActions} aria-expanded={menuRoom === room.roomKey} onClick={() => setMenuRoom(menuRoom === room.roomKey ? null : room.roomKey)}>
                <MoreHorizontal aria-hidden="true" />
              </button>
              {menuRoom === room.roomKey ? (
                <div className="cas-pop" role="menu">
                  <button type="button" role="menuitem" onClick={() => setDeferRoom({ origin, reason: "", roomKey: room.roomKey, until: nextDay(board.date) })}>
                    {copy.deferNextDay}
                  </button>
                  <button type="button" role="menuitem" onClick={() => setDeferRoom({ origin, reason: "", roomKey: room.roomKey, until: "" })}>
                    {copy.deferPick}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuRoom(null);
                      hold(room, { kind: "resolved", originDate: origin });
                    }}
                  >
                    {copy.resolve}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  // ── 사람 목록 ──
  const applied = people.filter((p) => p.applied && !p.cancelled);
  const waiting = applied.filter((p) => p.rooms.length === 0);
  const notApplied = people.filter((p) => !p.applied && (p.role === "part_time_staff" || p.role === "staff" || p.role === "field_manager"));
  const q = query.trim().toLowerCase();
  const matches = (p: BoardPerson) => !q || p.name.toLowerCase().includes(q) || p.phone.replace(/\D/g, "").endsWith(q.replace(/\D/g, "") || "_");
  const list =
    tab === "none"
      ? notApplied.filter(matches).sort((a, b) => (b.lastWorked ?? "").localeCompare(a.lastWorked ?? "") || a.name.localeCompare(b.name, locale))
      : (tab === "waiting" ? waiting : [...applied, ...people.filter((p) => p.cancelled)])
          .filter(matches)
          .sort((a, b) => Number(a.rooms.length > 0 || a.cancelled) - Number(b.rooms.length > 0 || b.cancelled) || a.name.localeCompare(b.name, locale));
  const suggestFor = new Map<string, string>();
  for (const room of openRooms) for (const s of room.suggested) if (!suggestFor.has(s.userId)) suggestFor.set(s.userId, `${label(room.propertyName)} ${room.roomLabel}`);

  const personSub = (p: BoardPerson) => {
    if (p.cancelled) return copy.statePersonCancelled;
    if (p.rooms.length === 0) return suggestFor.has(p.userId) ? fill(copy.stateWaitingSuggest, { room: suggestFor.get(p.userId)! }) : copy.stateWaiting;
    const rooms = p.rooms.map((r) => `${label(r.propertyName)} ${r.roomLabel}${r.withOthers > 0 ? ` ${fill(copy.withOthers, { n: r.withOthers + 1 })}` : ""}`).join(" · ");
    return fill(copy.stateAssigned, { n: p.rooms.length, rooms });
  };

  const stats = [
    { label: copy.statRooms, n: board.counts.rooms, unit: copy.unitRoom, warn: false },
    { label: copy.statOpen, n: board.counts.open, unit: copy.unitRoom, warn: board.counts.open > 0 },
    { label: copy.statApplied, n: board.counts.applied, unit: copy.unitPerson, warn: false },
    { label: copy.statAssigned, n: board.counts.assigned, unit: copy.unitPerson, warn: false },
    { label: copy.statWaiting, n: board.counts.waiting, unit: copy.unitPerson, warn: board.counts.waiting > 0 },
  ];

  const mineList = board.mainProperties.map(label).join(" · ");

  return (
    <div className="cas" onClick={() => menuRoom && setMenuRoom(null)}>
      <div className="cas-bar">
        <div className="cas-seg" role="tablist" aria-label={copy.title}>
          <span role="tab" aria-selected="true" className="on">
            {copy.viewDay}
          </span>
          <Link role="tab" aria-selected="false" href={`/admin/cleaning-assign?view=month&ym=${board.date.slice(0, 7)}`}>
            {copy.viewMonth}
          </Link>
        </div>
        <AdminDatePicker
          date={board.date}
          todayDate={today}
          localeTag={locale}
          basePath="/admin/cleaning-assign"
          allowFuture
          loadMarks={loadOpenMarks}
          markLabel={copy.calendarOpenMark}
          labels={{
            nextDay: shared.dateNextDay,
            nextMonth: shared.dateNextMonth,
            open: shared.dateSelect,
            pastTag: shared.datePastTag,
            prevDay: shared.datePrevDay,
            prevMonth: shared.datePrevMonth,
            today: shared.dateToday,
            todayTag: shared.dateTodayTag,
          }}
        />
        <span className="cas-live">
          <i aria-hidden="true" />
          {board.lastChange ? fill(copy.live, { ago: agoText(board.lastChange.at, now, copy), name: board.lastChange.name }) : copy.liveNone}
        </span>
        <span className="cas-sp" />
        <div className="cas-menu">
          <button type="button" className="cas-btn is-ghost" aria-expanded={buildingPicker} onClick={() => setBuildingPicker(!buildingPicker)}>
            {onlyMine && board.mainProperties.length > 0 ? fill(copy.myBuildings, { list: mineList }) : copy.allBuildings} ⌄
          </button>
          {buildingPicker ? (
            <BuildingPicker
              copy={copy}
              all={Object.keys(propertyLabels)}
              label={label}
              initial={board.mainProperties}
              onlyMine={onlyMine}
              onShowAll={() => {
                setOnlyMine(false);
                setBuildingPicker(false);
              }}
              onSave={(list) => {
                setBuildingPicker(false);
                setOnlyMine(list.length > 0);
                run(() => saveMyMainProperties({ properties: list }), copy.saved);
              }}
            />
          ) : null}
        </div>
        <button type="button" className="cas-btn is-ghost" onClick={() => setAddOpen(true)}>
          {copy.addRoom}
        </button>
        <button
          type="button"
          className="cas-btn is-soft"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await applyDaySuggestions({ date: board.date, onlyFixed: true });
              showToast(result.ok ? (result.added > 0 ? fill(copy.added, { n: result.added }) : copy.nothingToAdd) : copy.failed);
              router.refresh();
            })
          }
        >
          {copy.fixedFirst}
        </button>
        <Link className="cas-btn is-ghost" href="/admin/cleaning-assign/settings">
          {copy.settingsLink}
        </Link>
        {canCompare ? (
          <Link className="cas-btn is-ghost" href={`/admin/cleaning-assign/compare?ym=${board.date.slice(0, 7)}`}>
            {copy.compareLink}
          </Link>
        ) : null}
      </div>

      <div className="cas-stats">
        {stats.map((s) => (
          <div key={s.label}>
            <span>{s.label}</span>
            <b className={s.warn ? "is-warn" : ""}>
              {s.n}
              <small>{s.unit}</small>
            </b>
          </div>
        ))}
      </div>

      <div className="cas-grid">
        <section className="cas-rooms" aria-label={copy.statRooms}>
          {picked ? (
            <div className="cas-pickbar" role="status">
              <span>{fill(copy.pickBanner, { n: picked.rooms.length, name: picked.name })}</span>
              <span className="cas-sp" />
              <button type="button" className="cas-btn is-ghost" onClick={() => setPickId(null)}>
                {copy.pickClear}
              </button>
            </div>
          ) : null}

          <div className="cas-h">
            <h2>{copy.openTitle}</h2>
            <span className={openRooms.length ? "is-warn" : ""}>{openRooms.length}</span>
            <span className="cas-sp" />
            {suggestCount > 0 && !picked ? (
              <button
                type="button"
                className="cas-btn is-pri"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await applyDaySuggestions({ date: board.date });
                    showToast(result.ok ? (result.added > 0 ? fill(copy.added, { n: result.added }) : copy.nothingToAdd) : copy.failed);
                    router.refresh();
                  })
                }
              >
                {fill(copy.applyAll, { n: suggestCount })}
              </button>
            ) : null}
          </div>
          {openRooms.length === 0 && cancelledRooms.length === 0 ? <p className="cas-empty">{board.rooms.length === 0 ? copy.noRooms : copy.noOpen}</p> : null}
          {[...openByBuilding.entries()].map(([name, list]) => (
            <div key={name} className="cas-bld is-open">
              <div className="cas-h is-sub">
                <h3>{label(name)}</h3>
                <span>{list.length}</span>
              </div>
              {list.map((room) => roomRow(room, { grouped: true, open: true }))}
            </div>
          ))}

          {cancelledRooms.map((room) => (
            <div key={room.roomKey} className="cas-room is-cancelled">
              <div className="cas-room__id">
                <span className="cas-room__bld">{label(room.propertyName)}</span>
                <span className="cas-room__no">{room.roomLabel}</span>
              </div>
              <div className="cas-room__body">
                <span className="cas-tag is-danger">{copy.tagCancelled}</span>
                <span className="cas-room__note">{fill(copy.cancelledBody, { names: room.people.map((p) => p.name).join(" · ") })}</span>
              </div>
              <div className="cas-room__act is-stack">
                {room.people.map((p) => (
                  <div key={p.userId} className="cas-room__pair">
                    <button
                      type="button"
                      className="cas-btn is-gray"
                      disabled={pending}
                      onClick={() => {
                        setPickId(p.userId);
                        run(() => unassignFromRoom({ date: board.date, roomKey: room.roomKey, userId: p.userId }));
                      }}
                    >
                      {`${p.name} · ${copy.attachElsewhere}`}
                    </button>
                    <button type="button" className="cas-btn is-danger-text" disabled={pending} onClick={() => run(() => cancelPersonDay({ date: board.date, userId: p.userId }))}>
                      {copy.cancelDay}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {[...byBuilding.entries()].map(([name, list]) => {
            const limit = showAllRooms[name] ? list.length : 12;
            return (
              <div key={name} className="cas-bld">
                <div className="cas-h">
                  <h2>{label(name)}</h2>
                  <span>{list.length}</span>
                </div>
                {list.slice(0, limit).map((room) => roomRow(room))}
                {list.length > limit ? (
                  <button type="button" className="cas-more" onClick={() => setShowAllRooms({ ...showAllRooms, [name]: true })}>
                    {fill(copy.roomsMore, { n: list.length - limit, name: label(name) })}
                  </button>
                ) : null}
              </div>
            );
          })}
        </section>

        <aside className="cas-people" aria-label={copy.applicants}>
          <div className="cas-h">
            <h2>{copy.applicants}</h2>
            <span>{fill(copy.applicantsSub, { applied: applied.length, none: notApplied.length, total: applied.length + notApplied.length })}</span>
          </div>
          <div className="cas-ptabs">
            <div role="tablist" aria-label={copy.applicants}>
              {(
                [
                  ["applied", fill(copy.tabApplied, { n: applied.length })],
                  ["waiting", fill(copy.tabWaiting, { n: waiting.length })],
                  ["none", fill(copy.tabNone, { n: notApplied.length })],
                ] as const
              ).map(([key, text]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>
                  {text}
                </button>
              ))}
            </div>
            <label className="cas-search">
              <Search aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchName} aria-label={copy.searchName} />
            </label>
          </div>
          {tab === "none" ? <p className="cas-hint">{fill(copy.noneHint, { date: dayLabel(board.date, locale) })}</p> : null}
          {list.slice(0, peopleLimit).map((p) =>
            tab === "none" ? (
              <div key={p.userId} className="cas-person">
                <div className="cas-person__main">
                  <span className="cas-person__name">
                    {p.name}
                    <small className="is-muted">{roleLabel(p.role, copy)}</small>
                    {p.priority ? <small>{copy.prio}</small> : null}
                  </span>
                  <span className="cas-person__sub">{p.lastWorked ? fill(copy.lastWorked, { date: shortDate(p.lastWorked), n: p.monthDays }) : copy.neverWorked}</span>
                </div>
                {p.phone ? (
                  <a className="cas-phone" href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>
                    <Phone aria-hidden="true" />
                    {p.phone}
                  </a>
                ) : null}
                <button type="button" className="cas-btn is-soft" disabled={pending} onClick={() => run(() => addApplicantForDay({ date: board.date, userId: p.userId }), copy.done)}>
                  {copy.putInstead}
                </button>
              </div>
            ) : (
              // 줄 어디를 눌러도 고르지만 버튼 역할은 이름 칸 하나 — 줄 전체를 버튼으로 두면 안의 「취소 받아 주기」 등이 버튼 속 버튼이 된다.
              <div
                key={p.userId}
                className={`cas-person is-pickable${pickId === p.userId ? " is-picked" : ""}${p.cancelled ? " is-quiet" : ""}`}
                onClick={() => !p.cancelled && setPickId(pickId === p.userId ? null : p.userId)}
              >
                <div className="cas-person__main">
                  <button
                    type="button"
                    className="cas-person__pick"
                    aria-pressed={pickId === p.userId}
                    disabled={p.cancelled}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPickId(pickId === p.userId ? null : p.userId);
                    }}
                  >
                  <span className="cas-person__name">
                    {p.name}
                    {p.priority ? <small>{copy.prio}</small> : null}
                    {p.trainee ? <small title={fill(copy.traineeBuildings, { list: Object.entries(p.traineeByProperty).map(([k, v]) => `${label(k)} ${v}`).join(" · ") })}>{fill(copy.traineeNth, { n: p.traineeCount + (p.rooms.length > 0 ? 0 : 1) })}</small> : null}
                    {p.fixed.slice(0, 1).map((f) => (
                      <small key={f.propertyName} className="is-muted">{`${label(f.propertyName)} ${fill(copy.tierBadge, { n: f.tier })}`}</small>
                    ))}
                    {p.source === "admin" ? <small className="is-muted">{copy.byAdmin}</small> : null}
                  </span>
                  <span className={`cas-person__sub${p.rooms.length === 0 && !p.cancelled ? " is-warn" : ""}`}>{personSub(p)}</span>
                  </button>
                  {p.cancelRequested ? (
                    <span className="cas-person__req" onClick={(event) => event.stopPropagation()}>
                      <b>{copy.cancelRequest}</b>
                      {p.cancelRequestNote ? ` · ${p.cancelRequestNote}` : ""}
                      <button type="button" className="cas-btn is-danger-text" disabled={pending} onClick={() => run(() => resolveCancelRequest({ accept: true, date: board.date, userId: p.userId }))}>
                        {copy.cancelRequestAccept}
                      </button>
                      <button type="button" className="cas-btn is-ghost" disabled={pending} onClick={() => run(() => resolveCancelRequest({ accept: false, date: board.date, userId: p.userId }))}>
                        {copy.cancelRequestReject}
                      </button>
                    </span>
                  ) : null}
                  {p.traineeAsk ? (
                    <span className="cas-person__req is-amber" onClick={(event) => event.stopPropagation()}>
                      <b>{copy.traineeAsk}</b>
                      <button type="button" className="cas-btn is-ghost" disabled={pending} onClick={() => run(() => answerTraineeCheck({ currentCount: p.traineeCount, done: true, userId: p.userId }))}>
                        {copy.traineeDone}
                      </button>
                      <button type="button" className="cas-btn is-ghost" disabled={pending} onClick={() => run(() => answerTraineeCheck({ currentCount: p.traineeCount, done: false, userId: p.userId }))}>
                        {copy.traineeKeep}
                      </button>
                    </span>
                  ) : null}
                </div>
                <div className="cas-person__time" onClick={(event) => event.stopPropagation()}>
                  {timeEdit === p.userId ? (
                    <div className="cas-timeedit">
                      <AdminTimePicker
                        value={timeValue(p.startMinutes)}
                        ariaLabel={copy.startTime}
                        onChange={(value) => {
                          setTimeEdit(null);
                          run(() => setDayStartTime({ date: board.date, time: value, userId: p.userId }));
                        }}
                      />
                      <button type="button" className="cas-btn is-ghost" onClick={() => { setTimeEdit(null); run(() => setDayStartTime({ date: board.date, time: null, userId: p.userId })); }}>
                        {copy.startTimeReset}
                      </button>
                    </div>
                  ) : (
                    <button type="button" className={`cas-time${p.startException ? " is-ex" : ""}`} aria-label={`${copy.startTime} ${timeLabel(p.startMinutes)}`} onClick={() => setTimeEdit(p.userId)}>
                      {timeLabel(p.startMinutes)}
                    </button>
                  )}
                  {!p.cancelled && p.applied ? (
                    <button type="button" className="cas-btn is-danger-text is-tiny" disabled={pending} onClick={() => run(() => cancelPersonDay({ date: board.date, userId: p.userId }))}>
                      {copy.cancelDay}
                    </button>
                  ) : null}
                  {p.cancelled ? (
                    // 취소한 일정 되돌리기 — 「대신 넣기」와 같은 서버 액션(취소된 신청을 살린다).
                    <button type="button" className="cas-btn is-soft is-tiny" disabled={pending} onClick={() => run(() => addApplicantForDay({ date: board.date, userId: p.userId }), copy.done)}>
                      {copy.restoreDay}
                    </button>
                  ) : null}
                </div>
              </div>
            ),
          )}
          {list.length > peopleLimit ? (
            <button type="button" className="cas-more" onClick={() => setPeopleLimit(peopleLimit + 40)}>
              {fill(copy.more, { n: list.length - peopleLimit })}
            </button>
          ) : null}
        </aside>
      </div>

      {deferRoom ? (
        <>
          <div className="modal-scrim on" onClick={() => setDeferRoom(null)} />
          <div className="modal on cas-modal" role="dialog" aria-modal="true" aria-labelledby="cas-defer-t">
            <h3 id="cas-defer-t">{deferRoom.until && deferRoom.until === nextDay(board.date) ? copy.deferNextDay : copy.deferPick}</h3>
            {deferRoom.until !== nextDay(board.date) ? (
              <label className="cas-field">
                <span>{copy.deferUntilLabel}</span>
                <AdminDatePicker
                  value={deferRoom.until}
                  min={nextDay(board.date)}
                  onChange={(value) => setDeferRoom({ ...deferRoom, until: value })}
                  labels={{ nextMonth: shared.dateNextMonth, prevMonth: shared.datePrevMonth, today: shared.dateToday }}
                  localeTag={locale}
                  ariaLabel={copy.deferUntilLabel}
                />
              </label>
            ) : null}
            <label className="cas-field">
              <span>{copy.reasonPlaceholder}</span>
              <input value={deferRoom.reason} maxLength={120} onChange={(event) => setDeferRoom({ ...deferRoom, reason: event.target.value })} />
            </label>
            <div className="cas-modal__f">
              <button type="button" className="cas-btn is-gray" onClick={() => setDeferRoom(null)}>
                {copy.cancel}
              </button>
              <button
                type="button"
                className="cas-btn is-pri"
                disabled={pending || !deferRoom.until}
                onClick={() => {
                  const target = deferRoom;
                  const room = board.rooms.find((item) => item.roomKey === target.roomKey);
                  setDeferRoom(null);
                  setMenuRoom(null);
                  if (room) hold(room, { kind: "defer", originDate: target.origin, reason: target.reason, untilDate: target.until });
                }}
              >
                {copy.confirm}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {addOpen ? (
        <AddRoomDialog
          copy={copy}
          date={board.date}
          locale={locale}
          label={label}
          roomOptions={roomOptions}
          people={applied.concat(notApplied)}
          busy={pending}
          onClose={() => setAddOpen(false)}
          onSubmit={(input) => {
            setAddOpen(false);
            run(() => addRoomForDay({ date: board.date, ...input }), copy.done);
          }}
        />
      ) : null}

      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
      {undo && !toast ? (
        <AdminUndoToast
          stamp={undo.stamp}
          message={undo.message}
          undoLabel={copy.undoHold}
          pending={pending}
          onExpire={() => setUndo(null)}
          onUndo={() => {
            const target = undo;
            setUndo(null);
            run(() => releaseHold({ date: board.date, originDate: target.originDate, restore: target.restore, roomKey: target.roomKey }), copy.heldUndone);
          }}
        />
      ) : null}
    </div>
  );
}

/** 날짜 고르기 달력의 날짜별 미배정 수 — 실패하면 숫자 없이 둔다. */
async function loadOpenMarks(monthKey: string): Promise<Record<string, number>> {
  const result = await loadOpenCountsForMonth({ ym: monthKey });
  return result.ok ? result.counts : {};
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function BuildingPicker({
  copy,
  all,
  label,
  initial,
  onlyMine,
  onShowAll,
  onSave,
}: {
  copy: CleaningAssignCopy;
  all: string[];
  label: (name: string) => string;
  initial: string[];
  onlyMine: boolean;
  onShowAll: () => void;
  onSave: (list: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>(initial);
  return (
    <div className="cas-pop is-wide" role="dialog" aria-label={copy.pickBuildings} onClick={(event) => event.stopPropagation()}>
      <b className="cas-pop__t">{copy.pickBuildings}</b>
      {all.map((name) => (
        <label key={name} className="cas-check">
          <input type="checkbox" checked={chosen.includes(name)} onChange={(event) => setChosen(event.target.checked ? [...chosen, name] : chosen.filter((n) => n !== name))} />
          {label(name)}
        </label>
      ))}
      <div className="cas-pop__f">
        {onlyMine ? (
          <button type="button" className="cas-btn is-ghost" onClick={onShowAll}>
            {copy.allBuildings}
          </button>
        ) : null}
        <button type="button" className="cas-btn is-pri" onClick={() => onSave(chosen)}>
          {copy.saveBuildings}
        </button>
      </div>
    </div>
  );
}

function AddRoomDialog({
  copy,
  date,
  locale,
  label,
  roomOptions,
  people,
  busy,
  onClose,
  onSubmit,
}: {
  copy: CleaningAssignCopy;
  date: string;
  locale: string;
  label: (name: string) => string;
  roomOptions: { roomKey: string; propertyName: string; label: string }[];
  people: BoardPerson[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { roomKey: string; note: string; userIds: string[] }) => void;
}) {
  const buildings = [...new Set(roomOptions.map((option) => option.propertyName))];
  const [building, setBuilding] = useState(buildings[0] ?? "");
  const [roomKey, setRoomKey] = useState("");
  const [note, setNote] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const rooms = roomOptions.filter((option) => option.propertyName === building);
  return (
    <>
      <div className="modal-scrim on" onClick={onClose} />
      <div className="modal on cas-modal" role="dialog" aria-modal="true" aria-labelledby="cas-add-t">
        <div>
          <h3 id="cas-add-t">{copy.addRoomTitle}</h3>
          <p className="cas-modal__sub">{fill(copy.addRoomSub, { date: dayLabel(date, locale) })}</p>
        </div>
        <label className="cas-field">
          <span>{copy.building}</span>
          <AdmDropdown
            value={building}
            ariaLabel={copy.building}
            onChange={(value) => {
              setBuilding(value);
              setRoomKey("");
            }}
            options={buildings.map((name) => ({ label: label(name), value: name }))}
          />
        </label>
        <label className="cas-field">
          <span>{copy.room}</span>
          <AdmDropdown value={roomKey} ariaLabel={copy.room} onChange={setRoomKey} options={rooms.map((option) => ({ label: option.label, value: option.roomKey }))} searchable />
        </label>
        <label className="cas-field">
          <span>{copy.memoOptional}</span>
          <input value={note} maxLength={60} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="cas-field">
          <span>{copy.peopleOptional}</span>
          <div className="cas-chips">
            {userIds.map((id) => (
              <button key={id} type="button" className="cas-chip is-x" onClick={() => setUserIds(userIds.filter((u) => u !== id))}>
                {people.find((p) => p.userId === id)?.name} ✕
              </button>
            ))}
          </div>
          <AdmDropdown
            value=""
            ariaLabel={copy.peopleOptional}
            placeholder={copy.searchName}
            searchable
            onChange={(value) => value && !userIds.includes(value) && setUserIds([...userIds, value])}
            options={people.filter((p) => !userIds.includes(p.userId)).map((p) => ({ label: p.name, value: p.userId }))}
          />
        </div>
        <div className="cas-modal__f">
          <button type="button" className="cas-btn is-gray" onClick={onClose}>
            {copy.cancel}
          </button>
          <button type="button" className="cas-btn is-pri" disabled={busy || !roomKey} onClick={() => onSubmit({ note, roomKey, userIds })}>
            {userIds.length > 0 ? copy.addAndPut : copy.addOnly}
          </button>
        </div>
      </div>
    </>
  );
}
