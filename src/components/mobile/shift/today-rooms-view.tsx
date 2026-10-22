"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, Check, ChevronRight } from "lucide-react";
import { startCleaningSession } from "@/app/mobile/cleaning/actions";
import { useIsTablet } from "@/components/shell/split-list";
import { checkInText, dayLabel, timeLabel, tokyoTime } from "@/components/admin/cleaning-assign/format";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { TodayRoom } from "@/lib/cleaning-assign/data";
import type { ShiftDayState } from "@/lib/cleaning-assign/day-state";
import "./shift.css";

/**
 * 오늘 내 방 — 시안 「R · 오늘 내 방」(2026-10-22 HIG 다듬기). 「어젯밤 바뀜」(맨 위 주황 점) → 출근 시각 · 「N개 중 M개 끝남」 + 방 수만큼 나뉜 막대 →
 * 지금 할 방 하나를 크게(체크인 · 같이 · 메모 · 문 번호 · 지도) → 남은 방 · 끝난 방 줄 → 같이 일하는 사람 → 내일.
 * 폰은 「N 청소 시작」이 탭 바 위에 붙어 있고(청소 시작은 지금 청소 타이머 그대로), 폴드는 본문 안, 태블릿 가로는 왼쪽 목록 + 오른쪽 고른 방.
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
  // 지금 할 방 = 청소 중인 방, 없으면 순서상 첫 대기 방. 폰 · 폴드는 이 방 하나를 크게, 나머지는 「남은 방」 · 「끝난 방」 줄로.
  const current = data.rooms.find((r) => r.status === "progress") ?? data.rooms.find((r) => r.status === "pending") ?? null;
  const rest = data.rooms.filter((r) => r.status !== "done" && r.roomKey !== current?.roomKey);
  const doneRooms = data.rooms.filter((r) => r.status === "done");
  const orderOf = (r: Room) => data.rooms.indexOf(r) + 1;
  const roomName = (r: Room) => (r.roomLabel === r.propertyName ? r.buildingLabel : r.roomLabel);
  const info = (r: Room) => checkInText(r, copy);
  const withText = (r: Room) => (r.mates.length > 0 ? r.mates.map((m) => m.name).join(" · ") : copy.alone);
  const stateText = (r: Room) => (r.status === "done" ? copy.stateDoneRoom : r.status === "progress" ? copy.stateProgressRoom : copy.stateWaitingRoom);

  // 청소 시작 = 지금 청소 타이머 그대로(폼). 청소 중이면 청소 화면으로 이어서, 끝난 방은 기록.
  const startButton = (r: Room, wide: boolean, withRoom: boolean) =>
    r.status === "pending" ? (
      <form action={startCleaningSession} className={wide ? "shf-cta__form" : undefined}>
        <input type="hidden" name="roomLabel" value={r.sessionRoomLabel} />
        <input type="hidden" name="taskKey" value="checkout" />
        <button type="submit" className={`shf-btn is-pri${wide ? " is-wide" : ""}`}>
          {withRoom ? fill(copy.startRoom, { room: roomName(r) }) : copy.startCleaning}
        </button>
      </form>
    ) : (
      <Link className={`shf-btn ${r.status === "progress" ? "is-pri" : "is-gray"}${wide ? " is-wide" : ""}`} href="/mobile/cleaning">
        {r.status === "progress" ? copy.continueCleaning : copy.viewRecord}
      </Link>
    );

  const facts = (r: Room) => [
    { k: copy.factCheckin, v: info(r) },
    { k: copy.factWith, v: withText(r) },
    ...(r.note ? [{ k: copy.factNote, v: r.note }] : []),
    ...(r.doorCode ? [{ k: copy.factDoor, v: r.doorCode, code: true }] : []),
  ];

  const tomorrowText =
    data.tomorrow.state === "assigned"
      ? fill(copy.roomsN, { n: data.tomorrow.rooms })
      : data.tomorrow.state === "waiting"
        ? copy.upWaiting
        : data.tomorrow.state === "none"
          ? copy.upNone
          : null;

  const roomRow = (r: Room, pickable: boolean) => (
    <button
      key={r.roomKey}
      type="button"
      className={`shf-rrow${pickable && selected === r.roomKey ? " is-sel" : ""}`}
      onClick={() => pickable && setSelected(r.roomKey)}
    >
      <span className={`shf-rrow__n${r.status === "done" ? " is-done" : ""}`}>{orderOf(r)}</span>
      <span className="shf-rrow__main">
        <span className="shf-rrow__text">
          <b>
            {roomName(r)}
            {r.usualHeadcount > 1 ? <em>{copy.bigRoom}</em> : null}
          </b>
          <span>{info(r)}</span>
        </span>
        <span className={`shf-rrow__st${r.status === "done" ? " is-done" : ""}`}>{stateText(r)}</span>
      </span>
    </button>
  );

  return (
    <div className={`shf${current && !isTablet ? " has-cta" : ""}`}>
      <div className="shf-main">
        <div className="shf-titles">
          <span className="shf-sub">{dayLabel(data.date, locale)}</span>
          <h1 className="shf-title">{copy.todayTitle}</h1>
        </div>

        {data.rooms.length === 0 ? (
          <div className="shf-empty">
            <CalendarDays className="shf-empty__ic" aria-hidden="true" />
            <b>{copy.emptyTitle}</b>
            <span>{data.state === "none" ? copy.emptyBodyNone : data.state === "waiting" ? copy.emptyBodyWaiting : copy.emptyBodyFree}</span>
            {tomorrowText ? <span className="shf-empty__next">{`${fill(copy.tomorrowLine, { date: dayLabel(data.tomorrow.date, locale) })} · ${tomorrowText}`}</span> : null}
            <Link href="/mobile/shift">{copy.goMyShift}</Link>
          </div>
        ) : (
          <>
            {data.changedLastNight.map((change) => (
              <div key={change.at} className="shf-alert" role="status">
                <i aria-hidden="true" />
                <span>
                  <b>{copy.changedLastNight}</b>
                  {" · "}
                  {fill(copy.changedBody, { rooms: change.rooms.join(" · "), time: tokyoTime(change.at) })}
                </span>
              </div>
            ))}

            <div className="shf-prog">
              <div className="shf-prog__row">
                <b>{fill(copy.startAt, { time: timeLabel(data.startMinutes) })}</b>
                <span>{fill(copy.progressDone, { n: data.rooms.length, d: done })}</span>
              </div>
              <div
                className="shf-prog__bar"
                role="progressbar"
                aria-label={copy.todayTitle}
                aria-valuemin={0}
                aria-valuemax={data.rooms.length}
                aria-valuenow={done}
                style={{ gridTemplateColumns: `repeat(${data.rooms.length}, minmax(0, 1fr))` }}
              >
                {data.rooms.map((r) => (
                  <i key={r.roomKey} className={r.status === "done" ? "is-done" : ""} />
                ))}
              </div>
            </div>

            {!isTablet && current ? (
              <section className="shf-now" aria-label={`${copy.nowRoom} ${roomName(current)}`}>
                <span className="shf-cap">{`${copy.nowRoom} · ${current.buildingLabel}`}</span>
                <div className="shf-now__id">
                  <b>{roomName(current)}</b>
                  {current.usualHeadcount > 1 ? <span>{copy.bigRoom}</span> : null}
                </div>
                <div className="shf-facts">
                  {facts(current).map((f) => (
                    <div key={f.k} className="shf-fact">
                      <span>{f.k}</span>
                      <b className={"code" in f ? "is-code" : undefined}>{f.v}</b>
                    </div>
                  ))}
                  {current.mapsUrl ? (
                    <a className="shf-fact is-link" href={current.mapsUrl} target="_blank" rel="noreferrer">
                      <span>Google Maps</span>
                      <ChevronRight className="shf-chev" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
                <div className="shf-now__inline">{startButton(current, false, false)}</div>
              </section>
            ) : null}

            {!isTablet && rest.length > 0 ? (
              <section className="shf-group" aria-label={copy.restRooms}>
                <span className="shf-cap">{copy.restRooms}</span>
                <div className="shf-rlist">{rest.map((r) => roomRow(r, false))}</div>
              </section>
            ) : null}

            {!isTablet && doneRooms.length > 0 ? (
              <section className="shf-group" aria-label={copy.doneRooms}>
                <span className="shf-cap">{copy.doneRooms}</span>
                <div className="shf-rlist">
                  {doneRooms.map((r) => (
                    <Link key={r.roomKey} className="shf-donerow" href="/mobile/cleaning">
                      <Check className="shf-donerow__ic" aria-hidden="true" />
                      <span className="shf-donerow__main">
                        <b>{roomName(r)}</b>
                        <span>{withText(r)}</span>
                      </span>
                      <ChevronRight className="shf-chev" aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {isTablet ? (
              <section className="shf-group" aria-label={copy.todayTitle}>
                <div className="shf-rlist">{data.rooms.map((r) => roomRow(r, true))}</div>
              </section>
            ) : null}

            {data.mates.length > 0 ? (
              <section className="shf-group" aria-label={copy.todayMates}>
                <span className="shf-cap">{copy.matesHead}</span>
                <div className="shf-up">
                  {data.mates.map((mate) => (
                    <div key={mate.name} className="shf-mate">
                      <b>{mate.name}</b>
                      <span>{mate.rooms.join(" · ")}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {tomorrowText ? (
              <div className="shf-mate is-tomorrow">
                <b>{fill(copy.tomorrowLine, { date: dayLabel(data.tomorrow.date, locale) })}</b>
                <span>{tomorrowText}</span>
              </div>
            ) : null}

            {!isTablet && current ? <div className="shf-cta">{startButton(current, true, true)}</div> : null}
          </>
        )}
      </div>

      {isTablet && sel ? (
        <aside className="shf-pane" aria-label={`${sel.buildingLabel} ${roomName(sel)}`}>
          <div className="shf-detail">
            <div className="shf-detail__head">
              <span className="shf-detail__day">{sel.roomKey === current?.roomKey ? `${copy.nowRoom} · ${sel.buildingLabel}` : sel.buildingLabel}</span>
              <div className="shf-now__id">
                <b>{roomName(sel)}</b>
                {sel.usualHeadcount > 1 ? <span>{copy.bigRoom}</span> : null}
              </div>
            </div>
            <div className="shf-list">
              {facts(sel).map((f) => (
                <div key={f.k} className="shf-fact">
                  <span>{f.k}</span>
                  <b className={"code" in f ? "is-code" : undefined}>{f.v}</b>
                </div>
              ))}
            </div>
            {sel.mapsUrl ? (
              <a className="shf-fact is-link is-card" href={sel.mapsUrl} target="_blank" rel="noreferrer">
                <span>Google Maps</span>
                <ChevronRight className="shf-chev" aria-hidden="true" />
              </a>
            ) : null}
            <span className="shf-sp" />
            {startButton(sel, true, false)}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
