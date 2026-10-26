"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requestShiftCancel, toggleMyShift } from "@/app/mobile/shift/actions";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useIsTablet } from "@/components/shell/split-list";
import { useToastMotion } from "@/components/shell/use-toast-motion";
import { dayLabel, monthName, monthTitle, timeLabel, weekdayShort } from "@/components/admin/cleaning-assign/format";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { MyShiftDay, MyShiftDetail } from "@/lib/cleaning-assign/data";
import { haptic } from "@/lib/haptics";
import "./shift.css";

/**
 * 내 시프트 — 시안 「R · 내 시프트」(2026-10-22 HIG 다듬기, 캔버스 3dCCKr2…). 달력: 배정 = 채운 보라 원 + 「N방」, 신청(배정 전) = 옅은 보라
 * 빈 원, 배정 없음 = 흐린 숫자 + 「없음」, 지난날 · 일한 날 = 흐린 숫자. 범례 없이 모양 + 글자로 구분(색만으로 구분하지 않기).
 * 위에 「다음 근무」 한 줄 → 누르면 바텀 시트(태블릿 가로는 오른쪽 칸) — 출근 시각 · 방 · 같이 일하는 사람 · 「취소 요청」.
 * 신청은 「신청하기」 토글을 켰을 때만(시안 V9NDwf…, 2026-10-22) — 켜면 누르는 즉시 저장 · 원이 그려지고 숫자가 넘어간다,
 * 꺼진 채 누르면 토글이 흔들리며 「먼저 켜 주세요」, 끄면 「N월 신청 N일 · 저장돼 있어요」 토스트. 들어올 때마다 꺼진 채 시작.
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
  const [applying, setApplying] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  /** 방금 넣은 날 · 뺀 날 — 원 그리기 · 줄며 사라지기 움직임. */
  const [just, setJust] = useState<Record<string, "on" | "off">>({});
  const [tick, setTick] = useState(0);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastRef = useToastMotion<HTMLDivElement>(() => setSavedToast(null));
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inflight = useRef(0);
  const failed = useRef<Set<string>>(new Set());
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
    if (!applying) {
      // 꺼져 있으면 신청하지 않고 토글을 살짝 흔들어 알려 준다(선택 반응 — light, 햅틱 공용 규칙).
      haptic("light");
      setNudge((n) => n + 1);
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(() => setNudge(0), 2200);
      return;
    }
    // 빠르게 연달아 누를 수 있게 — 화면은 바로 바뀌고(잠그지 않음), 저장은 누른 순서대로 줄 세워 보낸다.
    // 바라는 상태를 보내므로 같은 날을 여러 번 눌러도 마지막 상태로 맞는다. 새로고침은 줄이 다 비었을 때 한 번.
    const cur = cellState(day);
    const apply = !(cur === "waiting" || cur === "none");
    const date = day.date;
    setOptimistic((prev) => ({ ...prev, [date]: apply }));
    setJust((prev) => ({ ...prev, [date]: apply ? "on" : "off" }));
    setTick((n) => n + 1);
    // 날 고르기 · 풀기는 선택 토글 — 둘 다 light(햅틱 공용 규칙 · medium 은 꾹 눌러 집기 전용).
    haptic("light");
    inflight.current += 1;
    queue.current = queue.current
      .then(async () => {
        const result = await toggleMyShift({ apply, date }).catch(() => ({ ok: false as const, reason: "error" as const }));
        if (!result.ok) {
          haptic("error");
          failed.current.add(date);
          setMessage(result.reason === "assigned" ? copy.errAssigned : result.reason === "cancelled" ? copy.errCancelledDay : result.reason === "past" ? copy.errPast : result.reason === "tooFar" ? copy.errTooFar : copy.failed);
        }
      })
      .finally(() => {
        inflight.current -= 1;
        if (inflight.current > 0) return;
        // 실패한 날만 바로 원래대로, 나머지는 새 데이터가 올 때까지 그대로 둔다(깜빡임 없음).
        const undo = failed.current;
        failed.current = new Set();
        if (undo.size > 0) setOptimistic((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !undo.has(key))));
        router.refresh();
      });
  }

  // 서버 데이터가 화면 상태를 따라잡으면 그날의 임시 표시를 지운다.
  // 관리자가 그 사이 방을 배정했거나(assigned) 날이 지나 버린(worked · past) 날도 지운다 — 신청 · 취소로는 그 상태에
  // 닿지 않아 전에는 임시 「신청」 표시가 배정된 날 위에 계속 남았다(2026-10-26 버그 수정).
  useEffect(() => {
    if (inflight.current > 0) return;
    setOptimistic((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([date, applied]) => {
          const day = days.find((d) => d.date === date);
          if (!day) return false;
          if (day.state !== "waiting" && day.state !== "none" && day.state !== "free") return false;
          return (day.state === "waiting" || day.state === "none") !== applied;
        }),
      );
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [days]);

  function toggleApplying() {
    if (applying) {
      setApplying(false);
      setJust({});
      if (tick > 0) {
        setSavedToast(fill(copy.applyModeSaved, { m: Number(ym.slice(5)), mon: monthName(ym, locale), n: appliedCount }));
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setSavedToast(null), 2600);
      }
      setTick(0);
    } else {
      setApplying(true);
      setNudge(0);
      setSavedToast(null);
    }
    haptic("light");
  }

  useEffect(
    () => () => {
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

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
    // 배정된 날은 서버 상태가 이긴다 — 임시 표시가 정리되기 전 한 번의 그림에서도.
    if (opt === undefined || day.rooms > 0) return day.state;
    return opt ? "waiting" : "free";
  };

  // 이달 신청 일수 — 일한 날 · 배정 · 배정 전 · 배정 없음(화면에 보이는 상태 그대로).
  const appliedCount = days.filter((day) => {
    const st = cellState(day);
    return st === "waiting" || st === "none" || st === "assigned" || st === "worked";
  }).length;
  const [countBefore, countAfter] = copy.applyModeCount.split("{n}").map((part) => fill(part, { m: Number(ym.slice(5)), mon: monthName(ym, locale) }));

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

        <section className={`shf-mode${nudge > 0 && !applying ? " is-nudge" : ""}`} key={nudge > 0 ? `n${nudge}` : "mode"} aria-label={copy.applyMode}>
          <span className="shf-mode__text">
            <b>{copy.applyMode}</b>
            {applying ? (
              <span className="shf-mode__count">
                {countBefore}
                <span className="shf-mode__n">
                  <b key={tick} className={tick > 0 ? "is-tick" : undefined}>
                    {appliedCount}
                  </b>
                </span>
                {countAfter}
              </span>
            ) : (
              <span className={nudge > 0 ? "shf-mode__hint is-nudge" : "shf-mode__hint"}>{nudge > 0 ? copy.applyModeNudge : copy.applyModeOff}</span>
            )}
          </span>
          <button type="button" role="switch" aria-checked={applying} aria-label={copy.applyMode} className="shf-sw" onClick={toggleApplying}>
            <i />
          </button>
        </section>

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

        <section className={`shf-calbox${applying ? " is-applying" : ""}`} aria-label={monthTitle(ym, locale)}>
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
                  className={`shf-day is-${st}${day.date === today ? " is-today" : ""}${paneDate === day.date && isTablet ? " is-sel" : ""}${just[day.date] ? ` is-just-${just[day.date]}` : ""}`}
                  disabled={day.date < today}
                  aria-label={`${dayLabel(day.date, locale)}${day.date === today ? ` ${copy.today}` : ""} ${spoken}`}
                  onClick={() => tap(day)}
                >
                  <span className="shf-day__n">
                    {st === "waiting" || (st === "free" && just[day.date] === "off") ? (
                      <svg className="shf-day__ring" viewBox="0 0 40 40" aria-hidden="true">
                        <circle cx="20" cy="20" r="19.2" pathLength={100} />
                      </svg>
                    ) : null}
                    <span className="shf-day__t">{n}</span>
                  </span>
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
          {copy.ringHint} {applying ? copy.tapHintOn : copy.tapHintOff}
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

      {savedToast ? (
        <div ref={toastRef} className="shf-toast" role="status">
          <svg viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="9" r="8" />
            <path d="M5.4 9.2l2.4 2.4 4.8-5" pathLength={100} />
          </svg>
          <span>{savedToast}</span>
        </div>
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
