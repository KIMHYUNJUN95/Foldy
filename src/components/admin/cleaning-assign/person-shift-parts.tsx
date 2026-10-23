"use client";

import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { PersonShift, PersonShiftDetail } from "@/lib/cleaning-assign/person-shift";
import { dayLabel, roleLabel, timeLabel, weekdayShort } from "./format";
import { psActionLabel, psActions, psHeadline, psKind, psMark, psRoomLine, psStatus, type PsAction } from "./person-shift-text";
import "./person-shift.css";

/**
 * 사람별 시프트 달력 — PC 패널(월 보기 오른쪽)과 모바일 화면(사용자 상세 → 시프트)이 같이 쓰는 조각.
 * 시안 https://claude.ai/artifact/72AoNdG58EEJw5JB8oAqtX · docs/product/37-cleaning-shift-assignment.md 「4-6」
 */

export function psRoomText(room: { propertyName: string; roomLabel: string }, label: (name: string) => string): string {
  return room.roomLabel === room.propertyName ? label(room.propertyName) : `${label(room.propertyName)} ${room.roomLabel}`;
}

/** 「아르바이트 · 기본 출근 9:45 · 우선」 */
export function psPersonLine(person: PersonShift["person"], copy: CleaningAssignCopy): string {
  return [roleLabel(person.role, copy), fill(copy.psBaseStart, { time: timeLabel(person.startMinutes) }), person.priority ? copy.prio : "", person.trainee ? copy.colTrainee : ""]
    .filter(Boolean)
    .join(" · ");
}

export function PersonShiftStats({ summary, copy }: { summary: PersonShift["summary"]; copy: CleaningAssignCopy }) {
  const items = [
    [summary.applied, copy.psUnitDay, copy.psStatApplied],
    [summary.assigned, copy.psUnitDay, copy.psStatAssigned],
    [summary.rooms, copy.psUnitRoom, copy.psStatRooms],
    [summary.worked, copy.psUnitDay, copy.psStatWorked],
  ] as const;
  return (
    <div className="psc-stats">
      {items.map(([n, unit, label]) => (
        <span key={label} className="psc-stat">
          <b>
            {n}
            <small>{unit}</small>
          </b>
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
}

export function PersonShiftCalendar({
  data,
  copy,
  locale,
  today,
  selected,
  onPick,
}: {
  data: PersonShift;
  copy: CleaningAssignCopy;
  locale: string;
  today: string;
  selected: string | null;
  onPick: (date: string) => void;
}) {
  const weekNames = copy.weekdaysShort.split(",");
  const lead = new Date(`${data.ym}-01T00:00:00Z`).getUTCDay();
  return (
    <div className="psc-cal" role="grid" aria-label={data.ym}>
      {weekNames.map((name, i) => (
        <span key={name} className={`psc-wd${i === 0 ? " is-sun" : ""}`}>
          {name}
        </span>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <span key={`b${i}`} />
      ))}
      {data.days.map((day) => {
        const kind = psKind(day);
        const mark = psMark(kind, day.rooms, copy);
        const status = psStatus(kind, copy).label;
        return (
          <button
            key={day.date}
            type="button"
            role="gridcell"
            aria-selected={selected === day.date}
            aria-label={`${dayLabel(day.date, locale)}${day.date === today ? ` ${copy.today}` : ""} ${mark || status}`}
            className={`psc-day is-${kind}${day.date === today ? " is-today" : ""}${selected === day.date ? " is-sel" : ""}${day.date < today ? " is-before" : ""}`}
            onClick={() => onPick(day.date)}
          >
            <span className="psc-day__n">
              {kind === "waiting" ? (
                <svg className="psc-day__ring" viewBox="0 0 40 40" aria-hidden="true">
                  <circle cx="20" cy="20" r="19" />
                </svg>
              ) : null}
              {kind === "request" ? <i className="psc-day__flag" aria-hidden="true" /> : null}
              <span className="psc-day__t">{Number(day.date.slice(8))}</span>
            </span>
            <span className="psc-day__m">{mark}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 다가오는 일정 — 오늘부터 신청 · 배정된 날. */
export function PersonShiftUpcoming({
  data,
  copy,
  locale,
  today,
  label,
  limit,
  onPick,
}: {
  data: PersonShift;
  copy: CleaningAssignCopy;
  locale: string;
  today: string;
  label: (name: string) => string;
  limit: number;
  onPick: (date: string) => void;
}) {
  const rows = data.details.filter((d) => d.date >= today && d.state !== "none").slice(0, limit);
  return (
    <section className="psc-up" aria-label={copy.psUpcoming}>
      <span className="psc-cap">{copy.psUpcoming}</span>
      {rows.length === 0 ? <p className="psc-empty">{copy.psUpcomingEmpty}</p> : null}
      {rows.map((d) => {
        const day = data.days.find((x) => x.date === d.date);
        const kind = day ? psKind(day) : "waiting";
        const title = kind === "waiting" ? copy.psStWaiting : kind === "request" ? `${copy.psStReq} · ${fill(copy.psHeadRooms, { n: d.rooms.length, time: timeLabel(d.startMinutes) })}` : fill(copy.psHeadRooms, { n: d.rooms.length, time: timeLabel(d.startMinutes) });
        const sub = kind === "waiting" ? fill(copy.psSubWaiting, { n: d.openRooms }) : d.rooms.map((r) => psRoomText(r, label)).join(" · ");
        return (
          <button key={d.date} type="button" className="psc-uprow" onClick={() => onPick(d.date)}>
            <span className="psc-uprow__d">
              <small>{d.date === today ? copy.today : weekdayShort(d.date, locale)}</small>
              <b>{Number(d.date.slice(8))}</b>
            </span>
            <span className="psc-uprow__main">
              <b className={`is-${kind}`}>{title}</b>
              <span>{sub}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}

/** 고른 날 — 상태 · 큰 줄 · 방 목록 · 할 수 있는 일. */
export function PersonShiftDay({
  data,
  date,
  copy,
  locale,
  today,
  label,
  pc,
  pending,
  onAction,
  extra,
}: {
  data: PersonShift;
  date: string;
  copy: CleaningAssignCopy;
  locale: string;
  today: string;
  label: (name: string) => string;
  pc: boolean;
  pending: boolean;
  onAction: (action: PsAction, date: string) => void;
  /** 모바일 「전화하기」 같은 덧붙임 버튼. */
  extra?: React.ReactNode;
}) {
  const day = data.days.find((d) => d.date === date);
  if (!day) return null;
  const detail: PersonShiftDetail | undefined = data.details.find((d) => d.date === date);
  const kind = psKind(day);
  const status = psStatus(kind, copy);
  const { head, sub } = psHeadline(kind, date, detail, copy, today);
  const rel = date === today ? copy.today : "";
  const actions = psActions(kind, date, today, pc);
  return (
    <section className="psc-detail" aria-label={dayLabel(date, locale)}>
      <div className="psc-detail__top">
        <span className="psc-detail__day">{rel ? `${dayLabel(date, locale)} · ${rel}` : dayLabel(date, locale)}</span>
        <span className={`psc-detail__st is-${status.tone}`}>{status.label}</span>
      </div>
      <b className="psc-detail__head">{head}</b>
      {sub ? <span className="psc-detail__sub">{sub}</span> : null}
      {detail && detail.rooms.length > 0 ? (
        <div className="psc-rooms">
          {detail.rooms.map((room) => {
            const line = psRoomLine(room, kind, copy);
            return (
              <div key={room.roomKey} className="psc-room">
                <span className="psc-room__main">
                  <b>{psRoomText(room, label)}</b>
                  <span>{line.sub}</span>
                </span>
                {line.right ? <span className={`psc-room__r is-${line.tone}`}>{line.right}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {detail?.cancelNote && kind === "request" ? <p className="psc-detail__note">{detail.cancelNote}</p> : null}
      {actions.length > 0 || extra ? (
        <div className="psc-acts">
          {actions.map((action, i) => (
            <button key={action} type="button" className={`psc-btn${i === 0 && action !== "removeApply" ? " is-pri" : ""}`} disabled={pending} onClick={() => onAction(action, date)}>
              {psActionLabel(action, copy)}
            </button>
          ))}
          {extra}
        </div>
      ) : null}
    </section>
  );
}
