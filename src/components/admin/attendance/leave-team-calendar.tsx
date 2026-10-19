"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Info, UserPlus } from "lucide-react";
import type { LeaveQueueItem, LeaveType } from "@/lib/annual-leave-approvals-server";
import type { Dictionary, Locale } from "@/lib/i18n";

type Lc = Dictionary["admin"]["leaveConsole"];

/** Internal calendar-bar shape, derived from real approved requests (LeaveQueueItem). */
type CalLeave = {
  id: string;
  name: string;
  type: LeaveType;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  dur: LeaveQueueItem["durationUnit"];
};

// Bar accent (--c) / background (--b) per leave type — CSS vars, matching the handoff exactly.
function typeAccent(type: LeaveType): { c: string; b: string } {
  switch (type) {
    case "paid":
      return { c: "var(--info)", b: "var(--info-bg)" };
    case "annual":
      return { c: "var(--violet)", b: "var(--violet-bg)" };
    case "special":
      return { c: "var(--warn)", b: "var(--warn-bg)" };
    default:
      return { c: "var(--adm-muted)", b: "var(--adm-surface)" };
  }
}

function typeLabel(type: LeaveType, lc: Lc): string {
  switch (type) {
    case "paid":
      return lc.typePaid;
    case "annual":
      return lc.typeAnnual;
    case "special":
      return lc.typeSpecial;
    default:
      return lc.typeOther;
  }
}

/** yyyy-mm-dd → day-of-month number */
function dayNum(iso: string): number {
  return Number(iso.slice(8, 10));
}

type WeekSeg = {
  leave: CalLeave;
  startDow: number;
  span: number;
  contL: boolean;
  contR: boolean;
  lane: number;
};

function weekdayLabels(locale: Locale): string[] {
  const base = new Date(Date.UTC(2026, 0, 4)); // a Sunday
  const tag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    return new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" }).format(d);
  });
}

export function LeaveTeamCalendar({
  lc,
  locale,
  items,
  onSelect,
  onCreateRequest,
}: {
  lc: Lc;
  locale: Locale;
  /** Approved org-wide leave requests (calendar shows approved-only). */
  items: LeaveQueueItem[];
  /** Called with the request id when a calendar bar is clicked → opens the detail panel. */
  onSelect: (requestId: string) => void;
  /** Called when an empty day cell's popover action is chosen → opens the request modal for that date. */
  onCreateRequest: (mode: "proxy" | "self", date: string) => void;
}) {
  const today = new Date();
  const [y, setY] = useState(today.getFullYear());
  const [m, setM] = useState(today.getMonth() + 1); // 1-12
  // Popover anchored to a clicked empty day cell (viewport coords).
  const [dayMenu, setDayMenu] = useState<{ iso: string; x: number; y: number } | null>(null);

  const WD = weekdayLabels(locale);

  const { weeks } = useMemo(() => {
    const firstDow = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, "0");
    const mStart = `${y}-${mm}-01`;
    const mEnd = `${y}-${mm}-${String(daysInMonth).padStart(2, "0")}`;

    const approved: CalLeave[] = items
      .map((it) => ({
        id: it.id,
        name: it.applicantName,
        type: it.leaveType,
        start: it.startDate,
        end: it.endDate,
        dur: it.durationUnit,
      }))
      .filter((r) => r.start <= mEnd && r.end >= mStart);

    const info: Record<number, { dow: number; wk: number }> = {};
    for (let day = 1; day <= daysInMonth; day += 1) {
      info[day] = { dow: (firstDow + day - 1) % 7, wk: Math.floor((firstDow + day - 1) / 7) };
    }
    const numWeeks = Math.max(...Object.values(info).map((x) => x.wk)) + 1;

    const weekSegs: WeekSeg[][] = Array.from({ length: numWeeks }, () => []);
    approved.forEach((r) => {
      const clampL = r.start < mStart;
      const clampR = r.end > mEnd;
      const s = clampL ? 1 : dayNum(r.start);
      const e = clampR ? daysInMonth : dayNum(r.end);
      let day = s;
      while (day <= e) {
        const wk = info[day].wk;
        let segEnd = day;
        while (segEnd + 1 <= e && info[segEnd + 1] && info[segEnd + 1].wk === wk) segEnd += 1;
        weekSegs[wk].push({
          leave: r,
          startDow: info[day].dow,
          span: segEnd - day + 1,
          contL: day > s || (day === s && clampL),
          contR: segEnd < e || (segEnd === e && clampR),
          lane: 0,
        });
        day = segEnd + 1;
      }
    });

    // greedy lane packing per week
    const weeks = weekSegs.map((segs, wk) => {
      const sorted = segs.slice().sort((a, b) => a.startDow - b.startDow || b.span - a.span);
      const laneEnd: number[] = [];
      sorted.forEach((sg) => {
        let placed = -1;
        for (let li = 0; li < laneEnd.length; li += 1) {
          if (sg.startDow > laneEnd[li]) {
            placed = li;
            break;
          }
        }
        if (placed < 0) {
          placed = laneEnd.length;
          laneEnd.push(-1);
        }
        laneEnd[placed] = sg.startDow + sg.span - 1;
        sg.lane = placed;
      });
      const lanes = Math.max(1, laneEnd.length);
      const rowH = 30 + lanes * 26 + 8;
      const dayByCol: Record<number, number> = {};
      for (let day = 1; day <= daysInMonth; day += 1) {
        if (info[day].wk === wk) dayByCol[info[day].dow] = day;
      }
      return { wk, segs: sorted, rowH, dayByCol };
    });

    return { weeks };
  }, [y, m, items]);

  const isThisMonth = y === today.getFullYear() && m === today.getMonth() + 1;
  const todayDay = isThisMonth ? today.getDate() : 0;

  // Close the day-cell popover on Escape.
  useEffect(() => {
    if (!dayMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDayMenu(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dayMenu]);

  const mm = String(m).padStart(2, "0");
  const isoFor = (day: number) => `${y}-${mm}-${String(day).padStart(2, "0")}`;

  function openDayMenu(e: React.MouseEvent, day: number) {
    setDayMenu({ iso: isoFor(day), x: e.clientX, y: e.clientY });
  }

  function pickCreate(mode: "proxy" | "self") {
    if (!dayMenu) return;
    const iso = dayMenu.iso;
    setDayMenu(null);
    onCreateRequest(mode, iso);
  }

  const menuDateLabel = dayMenu
    ? new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US", {
        month: "long",
        day: "numeric",
      }).format(new Date(`${dayMenu.iso}T00:00:00`))
    : "";

  function nav(delta: "y-1" | "m-1" | "m+1" | "y+1" | "today") {
    if (delta === "today") {
      setY(today.getFullYear());
      setM(today.getMonth() + 1);
      return;
    }
    if (delta === "y-1") setY((v) => v - 1);
    if (delta === "y+1") setY((v) => v + 1);
    if (delta === "m-1") {
      setM((v) => (v === 1 ? (setY((yy) => yy - 1), 12) : v - 1));
    }
    if (delta === "m+1") {
      setM((v) => (v === 12 ? (setY((yy) => yy + 1), 1) : v + 1));
    }
  }

  const monthLabel = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "long",
  }).format(new Date(y, m - 1, 1));

  return (
    <div className="card calcard">
      <div className="calcard__head">
        <span className="card__t">{lc.calendarTitle}</span>
        <div className="calnav">
          <button type="button" className="calnav__b" title={lc.calendarPrevYear} onClick={() => nav("y-1")}>
            <ChevronsLeft className="ic" />
          </button>
          <button type="button" className="calnav__b" title={lc.calendarPrevMonth} onClick={() => nav("m-1")}>
            <ChevronLeft className="ic" />
          </button>
          <span className="calnav__label">{monthLabel}</span>
          <button type="button" className="calnav__b" title={lc.calendarNextMonth} onClick={() => nav("m+1")}>
            <ChevronRight className="ic" />
          </button>
          <button type="button" className="calnav__b" title={lc.calendarNextYear} onClick={() => nav("y+1")}>
            <ChevronsRight className="ic" />
          </button>
          {isThisMonth ? null : (
            <button type="button" className="calnav__today" onClick={() => nav("today")}>
              {lc.calendarToday}
            </button>
          )}
        </div>
        <span className="pill pill--done">
          <span className="d" />
          {lc.calendarApprovedOnly}
        </span>
        <span className="lcal__legend">
          {(["paid", "annual", "special", "other"] as LeaveType[]).map((t) => {
            const accent = typeAccent(t);
            return (
              <span className="lcal__lg" key={t}>
                <span className="dot" style={{ background: accent.c }} />
                {typeLabel(t, lc)}
              </span>
            );
          })}
        </span>
      </div>

      <div className="tt">
        <div className="ttwk">
          {WD.map((w, i) => (
            <div key={i} className={`ttwd${i === 0 ? " sun" : i === 6 ? " sat" : ""}`}>
              {w}
            </div>
          ))}
        </div>
        {weeks.map(({ wk, segs, rowH, dayByCol }) => (
          <div className="ttweek" style={{ minHeight: rowH }} key={wk}>
            <div className="ttcells">
              {Array.from({ length: 7 }).map((_, col) => {
                const day = dayByCol[col];
                const isToday = day === todayDay;
                return (
                  <div
                    key={col}
                    className={`ttcell${day ? " ttcell--open" : ""}${isToday ? " is-today" : ""}${col === 0 ? " sun" : col === 6 ? " sat" : ""}`}
                    onClick={day ? (e) => openDayMenu(e, day) : undefined}
                    role={day ? "button" : undefined}
                    tabIndex={day ? 0 : undefined}
                    aria-label={day ? lc.calendarAddLeaveAria(String(day)) : undefined}
                    onKeyDown={
                      day
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setDayMenu({ iso: isoFor(day), x: r.left + 12, y: r.top + 12 });
                            }
                          }
                        : undefined
                    }
                  >
                    {day ? <span className="ttnum">{day}</span> : null}
                    {day ? <span className="ttadd" aria-hidden="true">+</span> : null}
                  </div>
                );
              })}
            </div>
            <div className="ttbars">
              {segs.map((sg) => {
                const accent = typeAccent(sg.leave.type);
                const left = (sg.startDow / 7) * 100;
                const width = (sg.span / 7) * 100;
                const showHalf = sg.span === 1 && sg.leave.dur !== "full";
                return (
                  <button
                    type="button"
                    key={`${sg.leave.id}-${sg.startDow}`}
                    className={`ttbar${sg.contL ? " cl" : ""}${sg.contR ? " cr" : ""}`}
                    style={
                      {
                        left: `calc(${left}% + 4px)`,
                        width: `calc(${width}% - 8px)`,
                        top: 30 + sg.lane * 26,
                        "--c": accent.c,
                        "--b": accent.b,
                      } as React.CSSProperties
                    }
                    title={`${sg.leave.name} · ${typeLabel(sg.leave.type, lc)}`}
                    onClick={() => onSelect(sg.leave.id)}
                  >
                    {showHalf ? (
                      <span className="ttbar__h">{sg.leave.dur === "am" ? "AM" : "PM"}</span>
                    ) : null}
                    <span className="ttbar__nm">{sg.leave.name.split(" ")[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="locknote">
        <span className="ic">
          <Info />
        </span>
        {lc.calendarFootnote}
      </div>

      {dayMenu ? (
        <>
          <div className="ttmenu-scrim" onClick={() => setDayMenu(null)} aria-hidden="true" />
          <div
            className="ttmenu"
            role="menu"
            style={{
              top: Math.min(dayMenu.y + 6, (typeof window !== "undefined" ? window.innerHeight : 900) - 132),
              left: Math.min(dayMenu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 216),
            }}
          >
            <div className="ttmenu__h">{menuDateLabel}</div>
            <button type="button" className="ttmenu__b" role="menuitem" onClick={() => pickCreate("proxy")}>
              <span className="ic">
                <UserPlus />
              </span>
              {lc.btnProxyRequest}
            </button>
            <button type="button" className="ttmenu__b" role="menuitem" onClick={() => pickCreate("self")}>
              <span className="ic">
                <CalendarPlus />
              </span>
              {lc.btnSelfRequest}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
