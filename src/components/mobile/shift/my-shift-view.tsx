"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requestShiftCancel, toggleMyShift } from "@/app/mobile/shift/actions";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useIsTablet } from "@/components/shell/split-list";
import { dayLabel, monthName, monthTitle, timeLabel, weekdayShort } from "@/components/admin/cleaning-assign/format";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { MyShiftDay, MyShiftDetail } from "@/lib/cleaning-assign/data";
import { haptic } from "@/lib/haptics";
import "./shift.css";

/**
 * 내 시프트 — 시안 「R · 내 시프트」(2026-10-22 HIG 다듬기, 캔버스 3dCCKr2…). 달력: 배정 = 채운 보라 원 + 「N방」, 신청(배정 전) = 옅은 보라
 * 빈 원, 배정 없음 = 흐린 숫자 + 「없음」, 지난날 · 일한 날 = 흐린 숫자. 범례 없이 모양 + 글자로 구분(색만으로 구분하지 않기).
 * 위에 「다음 근무」 한 줄 → 누르면 바텀 시트(태블릿 가로는 오른쪽 칸) — 출근 시각 · 방 · 같이 일하는 사람 · 「취소 요청」.
 * docs/product/37-cleaning-shift-assignment.md 「4-1」
 */

type Props = {
  copy: CleaningAssignCopy;
  locale: string;
  ym: string;
  today: string;
  nextYm: string | null;
  days: MyShiftDay[];
  details: MyShiftDetail[];
  upcoming: MyShiftDetail[];
  /** 이달 신청 · 배정 일수 — 다듬은 화면에서는 안 보인다(달력이 대신). */
  summary: { applied: number; assigned: number };
  propertyLabels: Record<string, string>;
};

export function MyShiftView({ copy, locale, ym, today, nextYm, days, details, upcoming, propertyLabels }: Props) {
  const router = useRouter();
  const isTablet = useIsTablet();
  const [pending, startTransition] = useTransition();
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [paneDate, setPaneDate] = useState<string | null>(() => upcoming.find((d) => d.rooms.length > 0)?.date ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const detailBy = new Map(details.map((d) => [d.date, d]));
  const label = (name: string) => propertyLabels[name] ?? name;
  const roomText = (r: { propertyName: string; roomLabel: string }) => (r.roomLabel === r.propertyName ? label(r.propertyName) : `${label(r.propertyName)} ${r.roomLabel}`);

  const weekday = new Date(`${ym}-01T00:00:00Z`).getUTCDay();
  const weekNames = copy.weekdaysShort.split(",");

  function tap(day: MyShiftDay) {
    if (day.date < today) return;
    if (day.rooms > 0) {
      if (isTablet) setPaneDate(day.date);
      else setSheetDate(day.date);
      return;
    }
    const before = day.state === "waiting" || day.state === "none";
    setOptimistic({ ...optimistic, [day.date]: !before });
    startTransition(async () => {
      const result = await toggleMyShift({ date: day.date });
      if (result.ok) {
        haptic("light");
      } else {
        haptic("error");
        setMessage(result.reason === "assigned" ? copy.errAssigned : result.reason === "cancelled" ? copy.errCancelledDay : result.reason === "past" ? copy.errPast : result.reason === "tooFar" ? copy.errTooFar : copy.failed);
      }
      setOptimistic({});
      router.refresh();
    });
  }

  function cancelRequest(date: string, withdraw: boolean) {
    startTransition(async () => {
      const result = await requestShiftCancel({ date, withdraw });
      if (result.ok) haptic("success");
      else {
        haptic("error");
        setMessage(copy.failed);
      }
      router.refresh();
    });
  }

  const cellState = (day: MyShiftDay) => {
    const opt = optimistic[day.date];
    if (opt === undefined) return day.state;
    return opt ? "waiting" : "free";
  };

  const relOf = (date: string) => (date === today ? copy.today : date === nextDayOf(today) ? copy.tomorrow : "");

  const detailBlock = (detail: MyShiftDetail | undefined, inSheet: boolean) => {
    if (!detail) return null;
    const rel = relOf(detail.date);
    return (
      <div className="shf-detail">
        <div className="shf-detail__head">
          <span className="shf-detail__day">{rel ? fill(copy.sheetDay, { date: dayLabel(detail.date, locale), rel }) : dayLabel(detail.date, locale)}</span>
          <span className="shf-detail__title">{fill(copy.startAt, { time: timeLabel(detail.startMinutes) })}</span>
        </div>
        <div className="shf-group">
          <span className="shf-cap">{fill(copy.roomsN, { n: detail.rooms.length })}</span>
          <div className="shf-list">
            {detail.rooms.map((room) => (
              <div key={room.roomKey} className="shf-row is-two">
                <b>{roomText(room)}</b>
                <span>{room.mates.length > 0 ? fill(copy.withMate, { names: room.mates.join(" · ") }) : copy.alone}</span>
              </div>
            ))}
          </div>
        </div>
        {detail.mates && detail.mates.length > 0 ? (
          <div className="shf-group">
            <span className="shf-cap">{copy.matesHead}</span>
            <div className="shf-list">
              <div className="shf-row">{detail.mates.map((m) => m.name).join(" · ")}</div>
            </div>
          </div>
        ) : null}
        {!inSheet ? <span className="shf-sp" /> : null}
        <div className="shf-detail__act">
          {detail.cancelRequested ? (
            <>
              <span className="shf-detail__pending">{copy.requestPending}</span>
              <button type="button" className="shf-textbtn" disabled={pending} onClick={() => cancelRequest(detail.date, true)}>
                {copy.withdrawRequest}
              </button>
            </>
          ) : detail.date >= today ? (
            <>
              <button type="button" className="shf-textbtn is-danger" disabled={pending} onClick={() => cancelRequest(detail.date, false)}>
                {copy.requestCancel}
              </button>
              <span className="shf-detail__note">{copy.requestCancelNote}</span>
            </>
          ) : null}
        </div>
      </div>
    );
  };

  const upLine = (d: MyShiftDetail) => {
    if (d.rooms.length > 0) {
      return {
        cls: "",
        sub: d.rooms.map(roomText).join(" · "),
        title: fill(copy.nextShiftTitle, { rel: "", time: timeLabel(d.startMinutes), n: d.rooms.length }).trim(),
      };
    }
    if (d.state === "none") return { cls: " is-none", sub: copy.upNoneSub, title: copy.upNone };
    return { cls: "", sub: copy.upWaitingSub, title: copy.upWaiting };
  };

  // 다음 근무 — 폰 · 폴드는 달력 위 한 줄(누르면 시트). 태블릿은 오른쪽 칸이 같은 일을 한다.
  const next = upcoming.find((d) => d.rooms.length > 0) ?? null;
  const listed = upcoming.filter((d) => d.date !== next?.date);
  const m = nextYm ? Number(nextYm.slice(5)) : 0;
  const daysLeft = monthEndDay(today) - Number(today.slice(8));

  const upRows = (onPick: (date: string) => void, withWeekday: boolean) =>
    listed.map((d) => {
      const line = upLine(d);
      return (
        <button key={d.date} type="button" className="shf-uprow" onClick={() => d.rooms.length > 0 && onPick(d.date)}>
          <span className="shf-uprow__d">
            {withWeekday ? <small>{weekdayShort(d.date, locale)}</small> : null}
            <b>{Number(d.date.slice(8))}</b>
          </span>
          <span className="shf-uprow__main">
            <b className={line.cls}>{line.title}</b>
            {line.sub ? <span>{line.sub}</span> : null}
          </span>
        </button>
      );
    });

  return (
    <div className="shf">
      <div className="shf-main">
        <div className="shf-top">
          {nextYm ? <Link href={`/mobile/shift?ym=${nextYm}`}>{fill(copy.applyNextMonth, { m, mon: monthName(nextYm, locale) })}</Link> : null}
        </div>
        <div className="shf-titles">
          <h1 className="shf-title">{copy.myShiftTitle}</h1>
          {nextYm ? <span className="shf-sub">{fill(copy.nextMonthDue, { m, mon: monthName(nextYm, locale), n: daysLeft })}</span> : null}
        </div>

        {next && !isTablet ? (
          <section className="shf-group" aria-label={copy.nextShift}>
            <span className="shf-cap">{copy.nextShift}</span>
            <button type="button" className="shf-next" onClick={() => setSheetDate(next.date)}>
              <span className="shf-next__d">{Number(next.date.slice(8))}</span>
              <span className="shf-next__main">
                <span className="shf-next__text">
                  <b>{fill(copy.nextShiftTitle, { rel: relOf(next.date) || dayLabel(next.date, locale), time: timeLabel(next.startMinutes), n: next.rooms.length })}</b>
                  <span>{next.rooms.map(roomText).join(" · ")}</span>
                </span>
                <ChevronRight className="shf-chev" aria-hidden="true" />
              </span>
            </button>
          </section>
        ) : null}

        <section className="shf-calbox" aria-label={monthTitle(ym, locale)}>
          <div className="shf-nav">
            <span className="shf-month">{monthTitle(ym, locale)}</span>
            <span className="shf-sp" />
            <Link className="shf-icon" aria-label={copy.prevMonth} href={`/mobile/shift?ym=${shiftMonthKey(ym, -1)}`}>
              <ChevronLeft aria-hidden="true" />
            </Link>
            <Link className="shf-icon is-last" aria-label={copy.nextMonth} href={`/mobile/shift?ym=${shiftMonthKey(ym, 1)}`}>
              <ChevronRight aria-hidden="true" />
            </Link>
          </div>
          <div className="shf-cal" role="grid" aria-label={monthTitle(ym, locale)}>
            {weekNames.map((name) => (
              <span key={name} className="shf-wd">
                {name}
              </span>
            ))}
            {Array.from({ length: weekday }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {days.map((day) => {
              const st = cellState(day);
              // 달력에 쓰는 글자는 둘뿐 — 배정 「N방」, 배정 없음 「없음」. 신청은 빈 원, 지난날 · 일한 날은 흐린 숫자.
              const mark = st === "assigned" ? fill(copy.markRooms, { n: day.rooms }) : st === "none" ? copy.markNoneShort : "";
              const spoken =
                st === "assigned" ? fill(copy.markRooms, { n: day.rooms }) : st === "waiting" ? copy.markApplied : st === "none" ? copy.markNone : st === "worked" ? copy.markWorked : "";
              const n = Number(day.date.slice(8));
              return (
                <button
                  key={day.date}
                  type="button"
                  role="gridcell"
                  className={`shf-day is-${st}${day.date === today ? " is-today" : ""}${paneDate === day.date && isTablet ? " is-sel" : ""}`}
                  disabled={day.date < today || pending}
                  aria-label={`${dayLabel(day.date, locale)}${day.date === today ? ` ${copy.today}` : ""} ${spoken}`}
                  onClick={() => tap(day)}
                >
                  <span className="shf-day__n">{n}</span>
                  <span className="shf-day__m">{mark}</span>
                </button>
              );
            })}
          </div>
        </section>
        {message ? (
          <p className="shf-msg" role="status" onClick={() => setMessage(null)}>
            {message}
          </p>
        ) : null}

        {listed.length > 0 && !isTablet ? (
          <section className="shf-group" aria-label={copy.upcoming}>
            <span className="shf-cap">{copy.upcoming}</span>
            <div className="shf-up">{upRows(setSheetDate, true)}</div>
          </section>
        ) : null}
        <p className="shf-hint">
          {copy.ringHint} {copy.tapHint}
        </p>
      </div>

      {isTablet ? (
        <aside className="shf-pane" aria-label={copy.upcoming}>
          {paneDate && detailBy.get(paneDate)?.rooms.length ? (
            detailBlock(detailBy.get(paneDate), false)
          ) : (
            <section className="shf-group" aria-label={copy.upcoming}>
              <span className="shf-cap">{copy.upcoming}</span>
              {upcoming.length === 0 ? <p className="shf-up__empty">{copy.upcomingEmpty}</p> : null}
              <div className="shf-up">{upRows(setPaneDate, false)}</div>
            </section>
          )}
        </aside>
      ) : null}

      {sheetDate ? (
        <BottomSheet onClose={() => setSheetDate(null)} ariaLabel={dayLabel(sheetDate, locale)}>
          <div className="shf-sheet">{detailBlock(detailBy.get(sheetDate), true)}</div>
        </BottomSheet>
      ) : null}
    </div>
  );
}

/** 이달 마지막 날(1~31) — 「N일 남음」. */
function monthEndDay(date: string): number {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
}

function nextDayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
