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
 * 내 시프트 — 시안 「① 내 시프트」. 달력 칸: 연보라 「N방」(배정) · 연노랑 「신청」(배정 전) · 연회색 「배정 없음」 · 흐린 「완료」(지난 날).
 * 색과 글자를 같이 쓴다(색만으로 구분하지 않기). 배정된 날을 누르면 바텀 시트(태블릿 가로는 오른쪽 칸) — 출근 시각 · 방 · 같이 일하는 사람 · 「취소 요청」.
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
  summary: { applied: number; assigned: number };
  propertyLabels: Record<string, string>;
};

export function MyShiftView({ copy, locale, ym, today, nextYm, days, details, upcoming, summary, propertyLabels }: Props) {
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
        setMessage(result.reason === "assigned" ? copy.errAssigned : result.reason === "cancelled" ? copy.errCancelledDay : result.reason === "past" ? copy.errPast : copy.failed);
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

  const detailBlock = (detail: MyShiftDetail | undefined, inSheet: boolean) => {
    if (!detail) return null;
    const rel = detail.date === today ? copy.today : detail.date === nextDayOf(today) ? copy.tomorrow : "";
    return (
      <div className="shf-detail">
        <span className="shf-detail__day">{rel ? fill(copy.sheetDay, { date: dayLabel(detail.date, locale), rel }) : dayLabel(detail.date, locale)}</span>
        <span className="shf-detail__title">{fill(copy.sheetTitle, { n: detail.rooms.length, time: timeLabel(detail.startMinutes) })}</span>
        <div className="shf-detail__rooms">
          {detail.rooms.map((room) => (
            <div key={room.roomKey} className="shf-detail__room">
              <b>{roomText(room)}</b>
              {room.mates.length > 0 ? <span>{fill(copy.withMate, { names: room.mates.join(" · ") })}</span> : null}
            </div>
          ))}
        </div>
        {detail.mates && detail.mates.length > 0 ? <span className="shf-detail__mates">{fill(copy.mates, { names: detail.mates.map((m) => m.name).join(" · ") })}</span> : null}
        {!inSheet ? <span className="shf-sp" /> : null}
        {detail.cancelRequested ? (
          <>
            <span className="shf-detail__pending">{copy.requestPending}</span>
            <button type="button" className="shf-btn is-gray" disabled={pending} onClick={() => cancelRequest(detail.date, true)}>
              {copy.withdrawRequest}
            </button>
          </>
        ) : detail.date >= today ? (
          <>
            <button type="button" className="shf-btn is-danger" disabled={pending} onClick={() => cancelRequest(detail.date, false)}>
              {copy.requestCancel}
            </button>
            <span className="shf-detail__note">{copy.requestCancelNote}</span>
          </>
        ) : null}
      </div>
    );
  };

  const upLine = (d: MyShiftDetail) => {
    if (d.rooms.length > 0) {
      return {
        cls: "",
        sub: d.rooms.flatMap((r) => (r.mates.length ? [fill(copy.withMate, { names: r.mates.join(" · ") })] : [])).join(" · "),
        title: fill(copy.upAssigned, { n: d.rooms.length, rooms: d.rooms.map(roomText).join(" · "), time: timeLabel(d.startMinutes) }),
      };
    }
    if (d.state === "none") return { cls: " is-none", sub: copy.upNoneSub, title: copy.upNone };
    return { cls: " is-wait", sub: copy.upWaitingSub, title: copy.upWaiting };
  };

  return (
    <div className="shf">
      <div className="shf-main">
        <h1 className="shf-title">{copy.myShiftTitle}</h1>
        {nextYm ? (
          <div className="shf-banner">
            <span>{fill(copy.nextMonthBanner, { m: Number(nextYm.slice(5)), mon: monthName(nextYm, locale) })}</span>
            <Link href={`/mobile/shift?ym=${nextYm}`}>{fill(copy.goNextMonth, { m: Number(nextYm.slice(5)), mon: monthName(nextYm, locale) })}</Link>
          </div>
        ) : null}
        <div className="shf-nav">
          <Link className="shf-icon" aria-label={copy.prevMonth} href={`/mobile/shift?ym=${shiftMonthKey(ym, -1)}`}>
            <ChevronLeft aria-hidden="true" />
          </Link>
          <span className="shf-month">{monthTitle(ym, locale)}</span>
          <Link className="shf-icon" aria-label={copy.nextMonth} href={`/mobile/shift?ym=${shiftMonthKey(ym, 1)}`}>
            <ChevronRight aria-hidden="true" />
          </Link>
          <span className="shf-sp" />
          <span className="shf-sum">{fill(copy.monthSummary, { a: summary.applied, b: summary.assigned })}</span>
        </div>

        <div className="shf-cal" role="grid" aria-label={monthTitle(ym, locale)}>
          {weekNames.map((name, i) => (
            <span key={name} className={`shf-wd${i === 0 || i === 6 ? " is-weekend" : ""}`}>
              {name}
            </span>
          ))}
          {Array.from({ length: weekday }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {days.map((day) => {
            const st = cellState(day);
            const mark =
              st === "assigned" ? fill(copy.markRooms, { n: day.rooms }) : st === "waiting" ? copy.markApplied : st === "none" ? copy.markNone : st === "worked" ? copy.markWorked : "";
            const n = Number(day.date.slice(8));
            return (
              <button
                key={day.date}
                type="button"
                role="gridcell"
                className={`shf-day is-${st}${day.date === today ? " is-today" : ""}${paneDate === day.date && isTablet ? " is-sel" : ""}`}
                disabled={day.date < today || pending}
                aria-label={`${dayLabel(day.date, locale)} ${mark}`}
                onClick={() => tap(day)}
              >
                <span className="shf-day__n">{n}</span>
                <span className="shf-day__m">{mark}</span>
              </button>
            );
          })}
        </div>
        <div className="shf-legend">
          <span>
            <i className="is-assigned" />
            {copy.legendMyAssigned}
          </span>
          <span>
            <i className="is-waiting" />
            {copy.legendMyWaiting}
          </span>
          <span>
            <i className="is-none" />
            {copy.legendMyNone}
          </span>
        </div>
        <p className="shf-hint">{copy.tapHint}</p>
        {message ? (
          <p className="shf-msg" role="status" onClick={() => setMessage(null)}>
            {message}
          </p>
        ) : null}

        {upcoming.length > 0 && !isTablet ? (
          <section className="shf-up" aria-label={copy.upcoming}>
            <h2>{copy.upcoming}</h2>
            {upcoming.map((d) => {
              const line = upLine(d);
              return (
                <button key={d.date} type="button" className="shf-uprow" onClick={() => d.rooms.length > 0 && setSheetDate(d.date)}>
                  <span className="shf-uprow__d">
                    <small>{weekdayShort(d.date, locale)}</small>
                    <b>{Number(d.date.slice(8))}</b>
                  </span>
                  <span className="shf-uprow__main">
                    <b className={line.cls}>{line.title}</b>
                    {line.sub ? <span>{line.sub}</span> : null}
                  </span>
                </button>
              );
            })}
          </section>
        ) : null}
      </div>

      {isTablet ? (
        <aside className="shf-pane" aria-label={copy.upcoming}>
          {paneDate && detailBy.get(paneDate)?.rooms.length ? (
            detailBlock(detailBy.get(paneDate), false)
          ) : (
            <section className="shf-up" aria-label={copy.upcoming}>
              <h2>{copy.upcoming}</h2>
              {upcoming.length === 0 ? <p className="shf-up__empty">{copy.upcomingEmpty}</p> : null}
              {upcoming.map((d) => {
                const line = upLine(d);
                return (
                  <button key={d.date} type="button" className="shf-uprow" onClick={() => d.rooms.length > 0 && setPaneDate(d.date)}>
                    <span className="shf-uprow__d">
                      <b>{Number(d.date.slice(8))}</b>
                    </span>
                    <span className="shf-uprow__main">
                      <b className={line.cls}>{line.title}</b>
                      {line.sub ? <span>{line.sub}</span> : null}
                    </span>
                  </button>
                );
              })}
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

function nextDayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
