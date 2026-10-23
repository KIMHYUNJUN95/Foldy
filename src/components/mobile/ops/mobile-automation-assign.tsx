"use client";

import { type CSSProperties, useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import {
  addCleaningExtraRoom,
  loadAssigneeBoard,
  removeCleaningExtraRoom,
  saveCleaningAssignee,
  sendAutomationNow,
  type AssigneeRoomView,
  type CleaningRoomOptionGroup,
} from "@/actions/ops-automation";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { DatePickerSheet } from "@/components/shell/date-picker-sheet";
import type { AutomationPageData } from "@/lib/automation/console-data";
import type { AutomationLocale } from "@/lib/automation/jobs";
import type { Dictionary } from "@/lib/i18n";
import { ymdShift } from "@/lib/tokyo-date";
import { MobileConfirm, Rich, errorTextOf, fill } from "./mobile-automation-settings";
import "./mobile-automation-form.css";

/**
 * 모바일 자동화 — 청소 · 셋팅 명단의 담당자 칸(시안 AutoMAssign-Phone, 2026-10-15). PC `AssignPane` 과 같은 동작 · 같은 서버 액션:
 * 날짜(기기 날짜 입력) → 건물별 객실, 객실마다 이름 한 칸(벗어나거나 「완료」면 저장) → 발송 뒤 바뀐 곳이 있으면 노란 띠에서 정정본
 * (가운데 확인 창 먼저) · 청소 객실 직접 추가는 바텀시트(검색 · 메모).
 *
 * 도메인 계약: docs/product/36-automation-control.md 「담당자」 · 「모바일」
 */

type Copy = Dictionary["automation"];
type Board = { date: string; rooms: AssigneeRoomView[]; sent: boolean; roomOptions: CleaningRoomOptionGroup[] };

const mdOf = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
// 서버와 브라우저의 Intl 결과가 달라 날짜 글자는 붙은 뒤에만 Intl 로 바꾼다(PC 와 같다).
const noopSubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
function dayLabel(ymd: string, localeTag: string) {
  return new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "long", timeZone: "Asia/Tokyo", weekday: "short" }).format(
    new Date(`${ymd}T12:00:00+09:00`),
  );
}

export function MobileAutomationAssign({
  data,
  copy,
  view,
  flash,
  localeTag,
  userLocale,
}: {
  data: AutomationPageData;
  copy: Copy;
  view: boolean;
  flash: (text: string) => void;
  localeTag: string;
  userLocale: AutomationLocale;
}) {
  const a = copy.assign;
  const w = copy.white;
  const m = copy.mobileForm;
  const hydrated = useHydrated();
  const [date, setDate] = useState(data.today);
  const [board, setBoard] = useState<Board | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, startBusy] = useTransition();
  const rooms = board?.date === date ? board.rooms : null;
  const sent = board?.date === date ? board.sent : false;
  const setRooms = (update: (current: AssigneeRoomView[]) => AssigneeRoomView[]) =>
    setBoard((current) => (current ? { ...current, rooms: update(current.rooms) } : current));

  const reload = useCallback(() => {
    loadAssigneeBoard(date, userLocale).then((result) => {
      if (!result.ok) {
        flash(errorTextOf(copy, result.error));
        setBoard({ date, roomOptions: [], rooms: [], sent: false });
        return;
      }
      setBoard({ date, roomOptions: result.roomOptions, rooms: result.rooms, sent: result.sent });
      setNames(Object.fromEntries(result.rooms.map((room) => [room.roomKey, room.names])));
    });
  }, [copy, date, flash, userLocale]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!savedKey) return;
    const timer = window.setTimeout(() => setSavedKey(null), 1400);
    return () => window.clearTimeout(timer);
  }, [savedKey]);

  const commit = (room: AssigneeRoomView) => {
    const value = names[room.roomKey] ?? "";
    if (value === room.names) return;
    startBusy(async () => {
      const result = await saveCleaningAssignee({ date, names: value, roomKey: room.roomKey });
      if (!result.ok) return flash(errorTextOf(copy, result.error));
      setRooms((current) => current.map((item) => (item.roomKey === room.roomKey ? { ...item, names: value.trim() } : item)));
      setSavedKey(room.roomKey);
      flash(a.saved);
    });
  };

  const removeRoom = (room: AssigneeRoomView) => {
    startBusy(async () => {
      const result = await removeCleaningExtraRoom({ date, roomKey: room.roomKey });
      if (!result.ok) return flash(errorTextOf(copy, result.error));
      flash(a.extraRemoved);
      reload();
    });
  };

  const changed = (rooms ?? []).filter((room) => sent && room.sentNames !== null && (names[room.roomKey] ?? "").trim() !== (room.sentNames ?? ""));
  const sendCorrection = () => {
    startBusy(async () => {
      const result = await sendAutomationNow({ correction: true, date, jobKey: "cleaning_list" });
      setConfirming(false);
      if (!result.ok) return flash(errorTextOf(copy, result.error));
      flash(a.correctionSent);
      reload();
    });
  };

  const groups = (section: "cleaning" | "setting") => {
    const byBuilding = new Map<string, AssigneeRoomView[]>();
    for (const room of (rooms ?? []).filter((item) => item.section === section)) {
      byBuilding.set(room.label, [...(byBuilding.get(room.label) ?? []), room]);
    }
    return [...byBuilding.entries()];
  };
  const counts = {
    c: (rooms ?? []).filter((room) => room.section === "cleaning").length,
    s: (rooms ?? []).filter((room) => room.section === "setting").length,
  };

  const roomLabel = (room: AssigneeRoomView) =>
    room.kind === "extra"
      ? room.note || a.extraDefault
      : room.kind === "no_checkin"
        ? room.pax !== null
          ? `${a.noCheckIn} (${room.pax})`
          : a.noCheckIn
        : `${room.guestName ?? "-"}${room.pax !== null ? ` (${room.pax})` : ""}`;

  const rel =
    date === data.today ? m.relToday : date === ymdShift(data.today, 1) ? m.relTomorrow : date === ymdShift(data.today, -1) ? m.relYesterday : null;
  const dateText = hydrated ? dayLabel(date, localeTag) : mdOf(date);

  let rowIndex = 0;
  const renderRows = (items: AssigneeRoomView[]) =>
    items.map((room) => {
      const isChanged = changed.some((item) => item.roomKey === room.roomKey);
      return (
        <div className="maf-ar" key={room.roomKey} style={{ "--i": Math.min(rowIndex++, 14) } as CSSProperties}>
          <div className="maf-ar__top">
            <b className="maf-ar__code">{room.code}</b>
            <span className="maf-ar__label">{roomLabel(room)}</span>
            {isChanged ? <span className="maf-ar__chg">{w.changedTag}</span> : null}
            {room.kind === "extra" && !view ? (
              <button
                aria-label={`${room.code} ${a.removeRoom}`}
                className="maf-ar__rm"
                disabled={busy}
                onClick={() => removeRoom(room)}
                title={a.removeRoom}
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            ) : null}
          </div>
          <span className="maf-ar__field">
            <input
              aria-label={`${room.code} ${a.namePlaceholder}`}
              className="maf-input"
              disabled={view}
              enterKeyHint="done"
              maxLength={120}
              onBlur={() => commit(room)}
              onChange={(event) => setNames((current) => ({ ...current, [room.roomKey]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
              placeholder={w.namePlaceholder}
              value={names[room.roomKey] ?? ""}
            />
            {savedKey === room.roomKey ? (
              <span aria-hidden="true" className="maf-ar__ok">
                <Check size={16} strokeWidth={2.6} />
              </span>
            ) : null}
          </span>
        </div>
      );
    });

  const cleaningGroups = groups("cleaning");
  const settingGroups = groups("setting");
  const listedKeys = new Set((rooms ?? []).filter((room) => room.section === "cleaning").map((room) => room.roomKey));
  const optionGroups = (board?.date === date ? board.roomOptions : [])
    .map((group) => ({ ...group, rooms: group.rooms.filter((room) => !listedKeys.has(room.roomKey)) }))
    .filter((group) => group.rooms.length > 0);

  return (
    <div className="maf maf-assign">
      <div className="maf-atool">
        <button aria-label={copy.preview.date} className="maf-date" onClick={() => setPicking(true)} type="button">
          <span className="maf-date__t">
            {dateText}
            {rel ? ` · ${rel}` : ""}
          </span>
          <ChevronDown aria-hidden="true" size={14} />
        </button>
        {picking ? (
          <DatePickerSheet
            labels={{ nextMonth: copy.mobile.dateNext, prevMonth: copy.mobile.datePrev, title: copy.mobile.pickDate, today: copy.mobile.dateToday }}
            locale={localeTag}
            onClose={() => setPicking(false)}
            onSelect={(next) => {
              setPicking(false);
              setDate(next);
            }}
            today={data.today}
            value={date}
          />
        ) : null}
        {rooms !== null ? <span className="maf-atool__n">{fill(w.assignCount, counts)}</span> : null}
      </div>

      {changed.length > 0 ? (
        <div className="maf-band">
          <span className="maf-band__t">
            <Rich text={fill(w.changedCount, { n: changed.length })} />
          </span>
          <button className="maf-band__b" disabled={view || busy} onClick={() => setConfirming(true)} type="button">
            {a.sendCorrection}
          </button>
        </div>
      ) : null}

      {view ? <div className="maf-ro">{a.viewOnly}</div> : null}

      {rooms === null ? (
        <div className="maf-loading" aria-busy="true">
          <span className="maf-muted">{copy.preview.loading}</span>
          <i className="maf-skel" />
          <i className="maf-skel" />
          <i className="maf-skel" />
        </div>
      ) : rooms.length === 0 ? (
        <>
          <div className="maf-empty">{a.empty}</div>
          {!view ? <AddRow copy={copy} onOpen={() => setAdding(true)} /> : null}
        </>
      ) : (
        <>
          {cleaningGroups.length === 0 ? (
            <>
              <span className="maf-h">{a.cleaning}</span>
              <div className="maf-row maf-muted">{a.none}</div>
            </>
          ) : (
            cleaningGroups.map(([label, items]) => (
              <div className="maf-agroup" key={`c-${label}`}>
                <span className="maf-h">{label}</span>
                {renderRows(items)}
              </div>
            ))
          )}
          {!view ? <AddRow copy={copy} onOpen={() => setAdding(true)} /> : null}
          <span className="maf-h">{a.setting}</span>
          {settingGroups.length === 0 ? (
            <div className="maf-row maf-muted">{a.none}</div>
          ) : (
            settingGroups.map(([label, items]) => (
              <div className="maf-agroup" key={`s-${label}`}>
                {settingGroups.length > 1 ? <span className="maf-sh">{label}</span> : null}
                {renderRows(items)}
              </div>
            ))
          )}
        </>
      )}
      <span className="maf-note maf-foot">{a.note}</span>

      {adding ? (
        <BottomSheet ariaLabel={a.addRoom} className="max-h-[86dvh] flex flex-col" onClose={() => setAdding(false)}>
          {({ close }) => (
            <AddRoomSheet
              copy={copy}
              date={date}
              flash={flash}
              groups={optionGroups}
              onAdded={() => {
                close();
                reload();
              }}
            />
          )}
        </BottomSheet>
      ) : null}

      {confirming ? (
        <MobileConfirm
          body={fill(m.correctionBody, { n: changed.length })}
          busy={busy}
          keepLabel={m.keep}
          okLabel={a.sendCorrection}
          onKeep={() => setConfirming(false)}
          onOk={sendCorrection}
          title={m.correctionTitle}
        />
      ) : null}
    </div>
  );
}

function AddRow({ copy, onOpen }: { copy: Copy; onOpen: () => void }) {
  return (
    <button className="maf-addrow" onClick={onOpen} type="button">
      <Plus aria-hidden="true" size={17} strokeWidth={2.4} />
      {copy.assign.addRoom}
      <span>{copy.mobileForm.addRoomShort}</span>
    </button>
  );
}

/** 청소 객실 추가 시트 — 건물별 객실 코드(이미 명단에 있는 방은 뺌) · 검색 · 메모 → 추가. */
function AddRoomSheet({
  copy,
  date,
  groups,
  flash,
  onAdded,
}: {
  copy: Copy;
  date: string;
  groups: CleaningRoomOptionGroup[];
  flash: (text: string) => void;
  onAdded: () => void;
}) {
  const a = copy.assign;
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState("");
  const [note, setNote] = useState("");
  const [busy, startBusy] = useTransition();
  const q = query.trim().toLowerCase();
  const shown = groups
    .map((group) => ({
      ...group,
      rooms: q && !group.label.toLowerCase().includes(q) ? group.rooms.filter((room) => room.code.toLowerCase().includes(q)) : group.rooms,
    }))
    .filter((group) => group.rooms.length > 0);

  const add = () => {
    if (!picked) return;
    startBusy(async () => {
      const result = await addCleaningExtraRoom({ date, note, roomKey: picked });
      if (!result.ok) return flash(errorTextOf(copy, result.error));
      flash(a.extraAdded);
      onAdded();
    });
  };

  return (
    <div className="maf-sheet">
      <div className="maf-sheet__h">
        <h3>{a.addRoom}</h3>
        <span>{a.addRoomHint}</span>
      </div>
      <label className="maf-search">
        <Search aria-hidden="true" size={16} />
        <input
          aria-label={a.addRoomSearch}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={a.addRoomSearch}
          type="search"
          value={query}
        />
      </label>
      <div className="maf-sheet__list">
        {shown.length === 0 ? (
          <div className="maf-muted maf-sheet__none">{copy.mobileForm.noRoomMatch}</div>
        ) : (
          shown.map((group) => (
            <div className="maf-sheet__g" key={group.propertyName}>
              <span className="maf-sh">{group.label}</span>
              <div className="maf-codes">
                {group.rooms.map((room) => (
                  <button
                    aria-pressed={picked === room.roomKey}
                    className={`maf-code${picked === room.roomKey ? " is-on" : ""}`}
                    key={room.roomKey}
                    onClick={() => setPicked((current) => (current === room.roomKey ? "" : room.roomKey))}
                    type="button"
                  >
                    {room.code}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="maf-sheet__foot">
        <input
          aria-label={a.addRoomNote}
          className="maf-input"
          enterKeyHint="done"
          maxLength={60}
          onChange={(event) => setNote(event.target.value)}
          placeholder={a.addRoomNote}
          value={note}
        />
        <button className="maf-btn is-primary is-wide" disabled={busy || !picked} onClick={add} type="button">
          {a.addRoomButton}
        </button>
      </div>
    </div>
  );
}

