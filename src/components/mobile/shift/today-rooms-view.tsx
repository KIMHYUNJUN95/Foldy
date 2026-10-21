"use client";

import Link from "next/link";
import { useState } from "react";
import { startCleaningSession } from "@/app/mobile/cleaning/actions";
import { useIsTablet } from "@/components/shell/split-list";
import { dayLabel, shortDate, timeLabel, tokyoTime } from "@/components/admin/cleaning-assign/format";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { TodayRoom } from "@/lib/cleaning-assign/data";
import type { ShiftDayState } from "@/lib/cleaning-assign/day-state";
import "./shift.css";

/**
 * 오늘 내 방 — 시안 「② 오늘 내 방」. 출근 시각 · 방 수 · 끝난 수 → 「어젯밤 바뀜」 → 방 목록(청소 시작은 지금 청소 타이머 그대로) →
 * 오늘 같이 일하는 사람 → 내일 상태. 태블릿 가로는 오른쪽에 고른 방(문 번호 · 청소 시작).
 * docs/product/37-cleaning-shift-assignment.md 「4-3」
 */

type Room = TodayRoom & { buildingLabel: string; doorCode: string | null; mapsUrl: string | null };

type Data = {
  date: string;
  startMinutes: number;
  rooms: Room[];
  mates: { name: string; rooms: string[] }[];
  changedLastNight: { at: string; rooms: string[] }[];
  state: ShiftDayState;
  tomorrow: { date: string; state: ShiftDayState; rooms: number };
};

export function TodayRoomsView({ copy, locale, data }: { copy: CleaningAssignCopy; locale: string; data: Data }) {
  const isTablet = useIsTablet();
  const [selected, setSelected] = useState<string | null>(() => data.rooms.find((r) => r.status !== "done")?.roomKey ?? data.rooms[0]?.roomKey ?? null);
  const done = data.rooms.filter((r) => r.status === "done").length;
  const sel = data.rooms.find((r) => r.roomKey === selected) ?? null;
  const roomName = (r: Room) => (r.roomLabel === r.propertyName ? r.buildingLabel : r.roomLabel);
  const info = (r: Room) => {
    if (r.hasTurnover) return r.arrivingGuests ? fill(copy.turnover, { n: r.arrivingGuests }) : copy.turnoverUnknown;
    if (r.nextCheckInDate) return fill(copy.nextCheckin, { date: shortDate(r.nextCheckInDate) });
    return copy.noCheckin;
  };
  const stateText = (r: Room) => (r.status === "done" ? copy.stateDoneRoom : r.status === "progress" ? copy.stateProgressRoom : copy.stateWaitingRoom);

  const startButton = (r: Room) =>
    r.status === "pending" ? (
      <form action={startCleaningSession}>
        <input type="hidden" name="roomLabel" value={r.sessionRoomLabel} />
        <input type="hidden" name="taskKey" value="checkout" />
        <button type="submit" className="shf-btn is-pri">
          {copy.startCleaning}
        </button>
      </form>
    ) : (
      <Link className="shf-btn is-gray" href="/mobile/cleaning">
        {r.status === "progress" ? copy.stateProgressRoom : copy.viewRecord}
      </Link>
    );

  const tomorrowText =
    data.tomorrow.state === "assigned"
      ? fill(copy.markRooms, { n: data.tomorrow.rooms })
      : data.tomorrow.state === "waiting"
        ? copy.upWaiting
        : data.tomorrow.state === "none"
          ? copy.upNone
          : null;

  return (
    <div className="shf">
      <div className="shf-main">
        <div>
          <span className="shf-date">{dayLabel(data.date, locale)}</span>
          <h1 className="shf-title">{copy.todayTitle}</h1>
        </div>

        {data.rooms.length === 0 ? (
          <div className="shf-empty">
            <b>{copy.emptyTitle}</b>
            <span>{data.state === "none" ? copy.emptyBodyNone : data.state === "waiting" ? copy.emptyBodyWaiting : copy.emptyBodyFree}</span>
            <Link href="/mobile/shift">{copy.goMyShift}</Link>
          </div>
        ) : (
          <>
            <div className="shf-head">
              <b>{timeLabel(data.startMinutes)}</b>
              <span>{fill(copy.todayHeadline, { d: done, n: data.rooms.length })}</span>
            </div>
            {data.changedLastNight.map((change) => (
              <div key={change.at} className="shf-changed" role="status">
                <b>{copy.changedLastNight}</b>
                <span>
                  {fill(copy.changedBody, {
                    rooms: change.rooms.join(" · "),
                    time: tokyoTime(change.at),
                  })}
                </span>
              </div>
            ))}
            <section className="shf-rooms" aria-label={copy.todayTitle}>
              {data.rooms.map((r, index) => (
                <div
                  key={r.roomKey}
                  className={`shf-room${isTablet && selected === r.roomKey ? " is-sel" : ""}`}
                  onClick={() => isTablet && setSelected(r.roomKey)}
                >
                  <div className="shf-room__top">
                    <span className={`shf-room__n${r.status === "done" ? " is-done" : ""}`}>{index + 1}</span>
                    <div className="shf-room__id">
                      <small>{r.buildingLabel}</small>
                      <b>
                        {roomName(r)}
                        {r.usualHeadcount > 1 ? <em>{copy.bigRoom}</em> : null}
                      </b>
                    </div>
                    <span className={`shf-room__st${r.status === "done" ? " is-done" : ""}`}>{stateText(r)}</span>
                  </div>
                  <div className="shf-room__info">
                    <span>{info(r)}</span>
                    <span className="is-dim">{r.mates.length > 0 ? fill(copy.withMate, { names: r.mates.map((m) => m.name).join(" · ") }) : copy.alone}</span>
                    {r.note ? <span className="is-dim">{r.note}</span> : null}
                  </div>
                  {!isTablet ? (
                    <div className="shf-room__act">
                      {startButton(r)}
                      {r.doorCode || r.mapsUrl ? (
                        <details className="shf-door">
                          <summary>{copy.roomLinks}</summary>
                          {r.doorCode ? <b>{r.doorCode}</b> : null}
                          {r.mapsUrl ? (
                            <a href={r.mapsUrl} target="_blank" rel="noreferrer">
                              Google Maps
                            </a>
                          ) : null}
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </section>
            {data.mates.length > 0 ? (
              <section className="shf-mates" aria-label={copy.todayMates}>
                <h2>{copy.todayMates}</h2>
                {data.mates.map((m) => (
                  <div key={m.name} className="shf-mate">
                    <b>{m.name}</b>
                    <span>{m.rooms.join(" · ")}</span>
                  </div>
                ))}
              </section>
            ) : null}
          </>
        )}

        {tomorrowText ? (
          <div className={`shf-tomorrow is-${data.tomorrow.state}`}>
            <b>{fill(copy.tomorrowLine, { date: dayLabel(data.tomorrow.date, locale) })}</b>
            <span>{tomorrowText}</span>
          </div>
        ) : null}
      </div>

      {isTablet && sel ? (
        <aside className="shf-pane" aria-label={`${sel.buildingLabel} ${roomName(sel)}`}>
          <div className="shf-detail">
            <span className="shf-detail__day">
              {sel.buildingLabel}
              {sel.usualHeadcount > 1 ? ` · ${copy.bigRoom}` : ""}
            </span>
            <span className="shf-detail__big">{roomName(sel)}</span>
            <span className="shf-detail__line">{info(sel)}</span>
            <span className="shf-detail__mates">{sel.mates.length > 0 ? fill(copy.withMate, { names: sel.mates.map((m) => m.name).join(" · ") }) : copy.alone}</span>
            {sel.doorCode ? (
              <div className="shf-detail__code">
                <small>{copy.roomLinks}</small>
                <b>{sel.doorCode}</b>
              </div>
            ) : null}
            {sel.mapsUrl ? (
              <a className="shf-link" href={sel.mapsUrl} target="_blank" rel="noreferrer">
                Google Maps
              </a>
            ) : null}
            <span className="shf-sp" />
            {startButton(sel)}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
