"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CalendarDays, Check, ChevronRight } from "lucide-react";
import { finishMyRoom, startMyRoom, undoFinishMyRoom } from "@/app/mobile/shift/today/actions";
import { useIsTablet } from "@/components/shell/split-list";
import { TaskToast } from "@/components/tasks/task-toast";
import { haptic } from "@/lib/haptics";
import type { SessionOpError } from "@/lib/cleaning-session-ops";
import { checkInText, dayLabel, timeLabel, tokyoTime } from "@/components/admin/cleaning-assign/format";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { AssignPlace, TodayRoom } from "@/lib/cleaning-assign/data";
import { useBuildingName } from "@/components/shared/building-names";
import type { ShiftDayState } from "@/lib/cleaning-assign/day-state";
import "./shift.css";

/**
 * 오늘 내 방 — 시안 「R · 오늘 내 방」(2026-10-22 HIG 다듬기). 「어젯밤 바뀜」(맨 위 주황 점) → 출근 시각 · 「N개 중 M개 끝남」 + 방 수만큼 나뉜 막대 →
 * 지금 할 방 하나를 크게(체크인 · 같이 · 메모 · 문 번호 · 지도) → 남은 방 · 끝난 방 줄 → 같이 일하는 사람 → 내일.
 * 폰은 「N 청소 시작」이 탭 바 위에 붙어 있고(청소 시작은 지금 청소 타이머 그대로), 폴드는 본문 안, 태블릿 가로는 왼쪽 목록 + 오른쪽 고른 방.
 * docs/product/37-cleaning-shift-assignment.md 「4-3」
 */

/** 오늘 그 방의 청소 기록(진행 중이거나 끝남) — 그 자리에서 끝내기 · 타이머 · 되돌리기용(2026-10-28). */
export type TodayRoomSession = {
  id: string;
  status: "in_progress" | "completed";
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  /** 내가 시작한 기록인가 — 같이 하는 사람이 시작했으면 끝내기는 그 사람이 한다. */
  mine: boolean;
};

type Room = TodayRoom & { buildingLabel: string; doorCode: string | null; mapsUrl: string | null; session: TodayRoomSession | null };

/** `clockIn` — 출근 기록 없이 시작했을 때 「출근하기」 버튼(2026-10-29). */
type Toast = { stamp: number; message: string; undoSessionId: string | null; clockIn?: boolean };

function errorText(error: SessionOpError, copy: CleaningAssignCopy): string {
  if (error === "already_processed_today") return copy.myErrProcessed;
  if (error === "already_active") return copy.myErrActive;
  if (error === "complete_failed" || error === "active_not_found") return copy.myErrFinish;
  if (error === "undo_failed") return copy.myErrUndo;
  return copy.myErrStart;
}

/** 청소 중 흐른 시간 — 1초마다. 시작 시각은 서버 값이라 다시 열어도 이어진다. */
function Elapsed({ startedAt, label }: { startedAt: string; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const text = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return (
    <span className="shf-timer__t" role="timer" aria-label={fill(label, { n: Math.floor(total / 60) })}>
      {text}
    </span>
  );
}

type Data = {
  date: string;
  startMinutes: number;
  rooms: Room[];
  mates: { name: string; rooms: AssignPlace[] }[];
  changedLastNight: { at: string; rooms: AssignPlace[] }[];
  state: ShiftDayState;
  tomorrow: { date: string; state: ShiftDayState; rooms: number };
};

export function TodayRoomsView({ copy, locale, data }: { copy: CleaningAssignCopy; locale: string; data: Data }) {
  const isTablet = useIsTablet();
  const router = useRouter();
  // 「어젯밤 바뀜」 · 같이 일하는 사람의 방 — 건물은 보는 사람 언어로, 독채는 건물 이름 하나만(2026-10-26).
  const bName = useBuildingName();
  const placeText = (place: AssignPlace) =>
    place.roomLabel === place.propertyName ? bName(place.propertyName) : `${bName(place.propertyName)} ${place.roomLabel}`;
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

  // 그 자리에서 시작 · 끝내기(2026-10-28) — 화면을 옮기지 않는다. 서버가 확인한 뒤에만 성공 햅틱(16 「햅틱」).
  const [pending, startTransition] = useTransition();
  const [busyRoom, setBusyRoom] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.undoSessionId || toast.clockIn ? 6000 : 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const start = (r: Room) => {
    haptic("light");
    setBusyRoom(r.roomKey);
    startTransition(async () => {
      const result = await startMyRoom({ roomLabel: r.sessionRoomLabel });
      setBusyRoom(null);
      if (!result.ok) {
        haptic("error");
        setToast({ stamp: Date.now(), message: errorText(result.error, copy), undoSessionId: null });
        return;
      }
      // 시작은 됐다 — 오늘 출근 기록이 없으면 출근하러 가는 길만 알려 준다(막지 않음, 2026-10-29).
      setToast(result.noClockIn ? { stamp: Date.now(), message: copy.myNoClockIn, undoSessionId: null, clockIn: true } : null);
    });
  };
  const finish = (r: Room, sessionId: string) =>
    startTransition(async () => {
      setBusyRoom(r.roomKey);
      const result = await finishMyRoom({ sessionId });
      setBusyRoom(null);
      if (!result.ok) {
        haptic("error");
        setToast({ stamp: Date.now(), message: errorText(result.error, copy), undoSessionId: null });
        return;
      }
      haptic("success");
      setToast({
        stamp: Date.now(),
        message: fill(copy.myFinishedToast, { room: roomName(r), n: Math.max(1, Math.round(result.durationSeconds / 60)) }),
        undoSessionId: sessionId,
      });
    });
  const undo = (sessionId: string) => {
    setToast(null);
    haptic("light");
    startTransition(async () => {
      const result = await undoFinishMyRoom({ sessionId });
      if (!result.ok) {
        haptic("error");
        setToast({ stamp: Date.now(), message: errorText(result.error, copy), undoSessionId: null });
      }
    });
  };

  const actionButton = (r: Room, wide: boolean, withRoom: boolean) => {
    const busy = pending && busyRoom === r.roomKey;
    const cls = (tone: string) => `shf-btn ${tone}${wide ? " is-wide" : ""}`;
    if (r.status === "pending") {
      return (
        <button type="button" className={cls("is-pri")} disabled={pending} aria-busy={busy} onClick={() => start(r)}>
          {busy ? copy.myStarting : withRoom ? fill(copy.startRoom, { room: roomName(r) }) : copy.startCleaning}
        </button>
      );
    }
    if (r.status === "progress" && r.session?.status === "in_progress" && r.session.mine) {
      const sessionId = r.session.id;
      return (
        <button type="button" className={cls("is-ink")} disabled={pending} aria-busy={busy} onClick={() => finish(r, sessionId)}>
          {busy ? copy.myFinishing : withRoom ? fill(copy.myFinishRoom, { room: roomName(r) }) : copy.myFinish}
        </button>
      );
    }
    if (r.status === "progress") {
      return <span className={`shf-note${wide ? " is-wide" : ""}`}>{copy.myMateCleaning}</span>;
    }
    return (
      <Link className={cls("is-gray")} href="/mobile/cleaning">
        {copy.viewRecord}
      </Link>
    );
  };

  /** 청소 중 — 큰 시간 + 시작 시각, 분실물 · 고장 바로가기(내가 시작한 기록만). */
  const timerBlock = (r: Room) =>
    r.status === "progress" && r.session?.status === "in_progress" ? (
      <div className="shf-timer">
        <div className="shf-timer__row">
          <Elapsed startedAt={r.session.startedAt} label={copy.myTimerLabel} />
          <span className="shf-timer__s">{fill(copy.myStartedAt, { time: tokyoTime(r.session.startedAt) })}</span>
        </div>
        {r.session.mine ? (
          <div className="shf-quick">
            <Link href={`/mobile/lost-found/new?sessionId=${r.session.id}`}>{copy.myLost}</Link>
            <Link href={`/mobile/maintenance/new?sessionId=${r.session.id}`}>{copy.myIssue}</Link>
          </div>
        ) : null}
      </div>
    ) : null;

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
            <Link href="/mobile/cleaning?work=1">{copy.myOtherCleaning}</Link>
          </div>
        ) : (
          <>
            {data.changedLastNight.map((change) => (
              <div key={change.at} className="shf-alert" role="status">
                <i aria-hidden="true" />
                <span>
                  <b>{copy.changedLastNight}</b>
                  {" · "}
                  {fill(copy.changedBody, { rooms: change.rooms.map(placeText).join(" · "), time: tokyoTime(change.at) })}
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
                <span className={`shf-cap${current.status === "progress" ? " is-live" : ""}`}>
                  {`${current.status === "progress" ? copy.stateProgressRoom : copy.nowRoom} · ${current.buildingLabel}`}
                </span>
                <div className="shf-now__id">
                  <b>{roomName(current)}</b>
                  {current.usualHeadcount > 1 ? <span>{copy.bigRoom}</span> : null}
                </div>
                {timerBlock(current)}
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
                <div className="shf-now__inline">{actionButton(current, false, false)}</div>
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
                      <span>{mate.rooms.map(placeText).join(" · ")}</span>
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

            {/* 배정에 없는 방 · 셋팅은 청소 화면에서 시작한다(2026-10-28 — 「청소」 메뉴는 배정 담당만 보이지만 화면은 그대로). */}
            <Link className="shf-other" href="/mobile/cleaning?work=1">
              <span>{copy.myOtherCleaning}</span>
              <ChevronRight className="shf-chev" aria-hidden="true" />
            </Link>

            {!isTablet && current ? <div className="shf-cta">{actionButton(current, true, true)}</div> : null}
          </>
        )}
      </div>
      {toast ? (
        <TaskToast
          key={toast.stamp}
          message={toast.message}
          onDismiss={() => setToast(null)}
          action={
            toast.undoSessionId
              ? { label: copy.myUndo, onAction: () => undo(toast.undoSessionId as string) }
              : toast.clockIn
                ? { label: copy.myClockInGo, onAction: () => router.push("/mobile/attendance") }
                : undefined
          }
        />
      ) : null}

      {isTablet && sel ? (
        <aside className="shf-pane" aria-label={`${sel.buildingLabel} ${roomName(sel)}`}>
          <div className="shf-detail">
            <div className="shf-detail__head">
              <span className="shf-detail__day">
                {sel.status === "progress"
                  ? `${copy.stateProgressRoom} · ${sel.buildingLabel}`
                  : sel.roomKey === current?.roomKey
                    ? `${copy.nowRoom} · ${sel.buildingLabel}`
                    : sel.buildingLabel}
              </span>
              <div className="shf-now__id">
                <b>{roomName(sel)}</b>
                {sel.usualHeadcount > 1 ? <span>{copy.bigRoom}</span> : null}
              </div>
            </div>
            {timerBlock(sel)}
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
            {actionButton(sel, true, false)}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
