"use client";

// 공용 관리자 콘솔 날짜 범위 선택 프리미티브 — 하나로 합친 트리거 ("시작일 – 종료일")
// 범위 선택 캘린더 팝오버를 여는 트리거 (디자인 핸드오프의 `.dpick`/`.calpop` 과 같음).
// 팝오버는 트리거의 getBoundingClientRect 로 계산한 뷰포트 안 좌표와 `position: fixed` 로
// 렌더링한다 (leave-team-calendar.tsx 의 날짜 메뉴 팝오버와 같은, 조상 overflow 를 벗어나는 방식).
// 그래서 스크롤되는 조상(예: `.content`)에 잘리거나
// 사이드바 뒤에 가려지는 일이 없다.
import { Fragment, useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { shiftMonthKey } from "./admin-month-key";

export type AdminDateRangePickerLabels = {
  prevMonth: string;
  nextMonth: string;
  thisMonth: string;
  reset: string;
  apply: string;
  /** 연 ▾ · 월 ▾ 드롭다운의 접근성 이름. */
  pickYear?: string;
  pickMonth?: string;
  /** 시작일 · 종료일 직접 입력 칸의 이름(2026-10-06). 비우면 자리 표시만 보인다. */
  typeStart?: string;
  typeEnd?: string;
};

/**
 * 손으로 친 날짜 → `YYYY-MM-DD`. 「2023-02-01」 · 「2023.2.1」 · 「2023/02/01」 · 「20230201」 · 「2023년 2월 1일」 · 「23.2.1」을
 * 받는다. 없는 날(2/30)은 `null`.
 */
export function parseTypedDate(text: string): string | null {
  const parts = text.trim().split(/[^0-9]+/).filter(Boolean);
  let y: number, m: number, d: number;
  if (parts.length === 1 && parts[0].length === 8) {
    y = Number(parts[0].slice(0, 4));
    m = Number(parts[0].slice(4, 6));
    d = Number(parts[0].slice(6, 8));
  } else if (parts.length === 3) {
    y = Number(parts[0].length === 2 ? `20${parts[0]}` : parts[0]);
    m = Number(parts[1]);
    d = Number(parts[2]);
  } else {
    return null;
  }
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

type AdminDateRangePickerProps = {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  localeTag: string;
  ariaLabel: string;
  labels: AdminDateRangePickerLabels;
  /** `from`/`to` 가 비었을 때 트리거에 남는 문구(예: 「전체 기간」). 없으면 대시만 보인다. */
  emptyLabel?: string;
  /**
   * 고를 수 없는 날(회색·클릭 불가). `pendingFrom` 은 **시작을 찍고 끝을 기다리는 중**일 때의
   * 시작일이다 — 끝으로 고를 수 있는 날과 시작으로 고를 수 있는 날이 다를 때 쓴다(수동 예약:
   * 팔린 밤을 넘어가는 체크아웃은 막는다).
   *
   * 이 값을 주면 범위가 **제약된 것**으로 본다 — 시작보다 앞을 누르면 앞뒤를 바꾸지 않고 그 날부터
   * 다시 고르고(바꾸면 막힌 밤을 낄 수 있다), 「이번 달」 바로가기를 숨긴다(한 달 통째는 제약을
   * 무시한다).
   */
  isDateDisabled?: (dateKey: string, pendingFrom: string | null) => boolean;
  /** 달력이 보여 주는 달이 바뀔 때(열 때 포함). 그 달의 데이터를 늦게 읽는 화면이 쓴다. */
  onMonthChange?: (monthKey: string) => void;
};

function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00+09:00`);
}
function formatDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
function dateLabel(dateKey: string, localeTag: string, withYear = false): string {
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    ...(withYear ? { year: "numeric" } : {}),
    month: "long",
    day: "numeric",
  }).format(parseDateKey(dateKey));
}
function tokyoDayOfWeek(dateKey: string): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", weekday: "short" }).format(
    parseDateKey(dateKey),
  );
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}
function daysInMonthKey(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
/**
 * 달력을 열 달. `from` 이 비어 있으면 **이번 달**이다.
 *
 * 「기간 없음(전체)」은 정당한 상태다 — 채용 지원서 콘솔이 기본값으로 쓴다. 그런데 예전에는
 * `from.slice(0, 7)` 이 빈 문자열을 그대로 넘겨 `new Date("-01T00:00:00+09:00")` 가 되고,
 * 첫 요일을 구하는 Intl 호출이 **RangeError: Invalid time value** 로 화면 전체를 죽였다
 * (2026-09-09). 다른 화면은 전부 기본 기간이 있어 드러나지 않았을 뿐이다.
 */
function calendarMonthOf(from: string): string {
  return from ? from.slice(0, 7) : formatDateKey(new Date()).slice(0, 7);
}

function thisMonthRange(): { from: string; to: string } {
  const todayKey = formatDateKey(new Date());
  const monthKey = todayKey.slice(0, 7);
  const days = daysInMonthKey(monthKey);
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(days).padStart(2, "0")}` };
}

const POPOVER_WIDTH = 292;
const POPOVER_HEIGHT_ESTIMATE = 420;

export function AdminDateRangePicker({
  from,
  to,
  onChange,
  localeTag,
  ariaLabel,
  labels,
  emptyLabel,
  isDateDisabled,
  onMonthChange,
}: AdminDateRangePickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [calendarMonth, setCalendarMonth] = useState(calendarMonthOf(from));
  const [draftFrom, setDraftFrom] = useState<string | null>(from || null);
  const [draftTo, setDraftTo] = useState<string | null>(to || null);
  /**
   * 머리의 연 ▾ · 월 ▾ 드롭다운(2026-10-06 — 몇 년 전 날짜를 달마다 넘겨 찾기 힘들다는 지적). 연은 스크롤 목록, 월은 12칸.
   */
  const [menu, setMenu] = useState<"year" | "month" | null>(null);
  /** 직접 입력 칸의 글자 — 달력에서 고르면 그 날짜로 채운다. */
  const [textFrom, setTextFrom] = useState("");
  const [textTo, setTextTo] = useState("");
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const calendarMonthRef = useRef(calendarMonth);
  useEffect(() => {
    calendarMonthRef.current = calendarMonth;
  }, [calendarMonth]);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openPicker() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
      const vh = typeof window !== "undefined" ? window.innerHeight : 900;
      const left = Math.min(Math.max(rect.left, 12), vw - POPOVER_WIDTH - 12);
      const fitsBelow = rect.bottom + 6 + POPOVER_HEIGHT_ESTIMATE <= vh - 12;
      const top = fitsBelow ? rect.bottom + 6 : Math.max(12, rect.top - POPOVER_HEIGHT_ESTIMATE - 6);
      setPos({ top, left });
    }
    // 방향을 잡도록 트리거의 현재 달로 열되, 선택된 기간 강조는 없이 시작한다 —
    // 적용된 from/to 는 이번 세션에서 사용자가 실제로 날짜를 고른 뒤에만 파랗게 표시된다.
    setCalendarMonth(calendarMonthOf(from));
    onMonthChange?.(calendarMonthOf(from));
    setDraftFrom(null);
    setDraftTo(null);
    setMenu(null);
    setTextFrom("");
    setTextTo("");
    setOpen(true);
  }

  function showMonth(monthKey: string) {
    setCalendarMonth(monthKey);
    onMonthChange?.(monthKey);
  }

  // 연 목록을 열면 고른 해가 가운데 오게(목록이 붙는 순간 한 번).
  function centerSelectedYear(list: HTMLDivElement | null) {
    if (!list) return;
    const selected = list.querySelector<HTMLElement>(".sel");
    if (selected) list.scrollTop = selected.offsetTop - list.clientHeight / 2 + selected.offsetHeight / 2;
  }

  // 날짜 칸 위에서 휠 = 이전/다음 달. 페이지가 같이 굴러가지 않게 막는다(수동 리스너 — React 의 onWheel 은 passive).
  useEffect(() => {
    if (!gridEl) return;
    let acc = 0;
    let last = 0;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      acc += event.deltaY;
      const now = Date.now();
      if (Math.abs(acc) < 40 || now - last < 160) return;
      last = now;
      const next = shiftMonthKey(calendarMonthRef.current, acc > 0 ? 1 : -1);
      acc = 0;
      setCalendarMonth(next);
      onMonthChange?.(next);
    }
    gridEl.addEventListener("wheel", onWheel, { passive: false });
    return () => gridEl.removeEventListener("wheel", onWheel);
  }, [gridEl, onMonthChange]);

  const constrained = Boolean(isDateDisabled);
  /** 끝을 기다리는 중이면 그 시작일. */
  const pendingFrom = draftFrom && !draftTo ? draftFrom : null;

  function setDraft(nextFrom: string | null, nextTo: string | null) {
    setDraftFrom(nextFrom);
    setDraftTo(nextTo);
    setTextFrom(nextFrom ?? "");
    setTextTo(nextTo ?? "");
  }

  function pick(dateKey: string) {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraft(dateKey, null);
    } else if (dateKey <= draftFrom && constrained) {
      setDraft(dateKey, null);
    } else if (dateKey < draftFrom) {
      setDraft(dateKey, draftFrom);
    } else {
      setDraft(draftFrom, dateKey);
    }
  }

  /** 직접 입력 — 읽히는 날짜가 되면 그때 고른 것으로 보고 달력을 그 달로 옮긴다. 막힌 날은 받지 않는다. */
  function typeDate(which: "from" | "to", text: string) {
    (which === "from" ? setTextFrom : setTextTo)(text);
    const key = parseTypedDate(text);
    const usable = key && !(isDateDisabled && isDateDisabled(key, which === "to" ? draftFrom : null)) ? key : null;
    if (which === "from") setDraftFrom(usable);
    else setDraftTo(usable);
    if (usable) showMonth(usable.slice(0, 7));
  }

  function apply() {
    if (draftFrom && draftTo) {
      // 직접 입력은 앞뒤가 바뀔 수 있다 — 바로잡아 넘긴다.
      const [a, b] = draftFrom <= draftTo ? [draftFrom, draftTo] : [draftTo, draftFrom];
      onChange(a, b);
      setOpen(false);
    }
  }

  const days = daysInMonthKey(calendarMonth);
  // 올해가 아닌 날짜는 버튼에 연도까지 — 「2월 1일」만으로는 몇 년인지 모른다.
  const currentYear = formatDateKey(new Date()).slice(0, 4);
  const showYear = Boolean((from && from.slice(0, 4) !== currentYear) || (to && to.slice(0, 4) !== currentYear));
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(localeTag, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2021, i, 15))),
  );
  const draftMonths = new Set([draftFrom?.slice(0, 7), draftTo?.slice(0, 7)].filter(Boolean));
  const draftYears = new Set([draftFrom, draftTo].filter(Boolean).map((key) => Number(key!.slice(0, 4))));
  const yearText = (year: number) =>
    new Intl.DateTimeFormat(localeTag, { timeZone: "UTC", year: "numeric" }).format(new Date(Date.UTC(year, 6, 1)));
  // 올해 −8 ~ +2, 보고 있는 해가 그 밖이면 거기까지 넓힌다.
  const viewYear = Number(calendarMonth.slice(0, 4));
  const firstYear = Math.min(Number(currentYear) - 8, viewYear);
  const lastYear = Math.max(Number(currentYear) + 2, viewYear);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);
  const firstDow = tokyoDayOfWeek(`${calendarMonth}-01`);
  const todayKey = formatDateKey(new Date());
  const dowLabels = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", weekday: "narrow" }).format(
      new Date(`2026-06-${String(i + 7).padStart(2, "0")}T00:00:00+09:00`),
    ),
  );

  /**
   * 이 달의 `dayIndex`(0-based) 칸이 구간 띠를 갖는지. 달 밖이면 false 라, 기간이 이웃 달로
   * 이어져도 격자 끝은 «끊긴 것»으로 보고 둥글게 막는다.
   */
  function hasBand(dayIndex: number): boolean {
    if (dayIndex < 0 || dayIndex >= days || !draftFrom || !draftTo) return false;
    const val = `${calendarMonth}-${String(dayIndex + 1).padStart(2, "0")}`;
    return val >= draftFrom && val <= draftTo;
  }

  return (
    <div className={`dpick${open ? " open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="datepick"
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <span className="ic">
          <CalendarDays />
        </span>
        {from || to || !emptyLabel ? (
          <>
            <span className="v">{from ? dateLabel(from, localeTag, showYear) : ""}</span>
            <span className="dash">–</span>
            <span className="v">{to ? dateLabel(to, localeTag, showYear && to.slice(0, 4) !== from.slice(0, 4)) : ""}</span>
          </>
        ) : (
          <span className="v">{emptyLabel}</span>
        )}
        <span className="ic dd__chev">
          <ChevronDown />
        </span>
      </button>

      {open ? (
        <div
          className="calpop"
          role="dialog"
          aria-label={ariaLabel}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
        >
          <div className="calpop__type">
            {(["from", "to"] as const).map((which, index) => {
              const text = which === "from" ? textFrom : textTo;
              const bad = text.trim() !== "" && !(which === "from" ? draftFrom : draftTo);
              return (
                <Fragment key={which}>
                  {index === 1 ? <span className="calpop__typedash">–</span> : null}
                  <input
                    aria-invalid={bad}
                    aria-label={(which === "from" ? labels.typeStart : labels.typeEnd) ?? "YYYY-MM-DD"}
                    className={`calpop__typein${bad ? " is-bad" : ""}`}
                    inputMode="numeric"
                    onChange={(event) => typeDate(which, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") apply();
                    }}
                    placeholder={(which === "from" ? from : to) || "YYYY-MM-DD"}
                    title={which === "from" ? labels.typeStart : labels.typeEnd}
                    type="text"
                    value={text}
                  />
                </Fragment>
              );
            })}
          </div>
          <div className="calpop__head">
            <button
              type="button"
              className="calpop__nav"
              aria-label={labels.prevMonth}
              onClick={() => showMonth(shiftMonthKey(calendarMonth, -1))}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <div className="calpop__pick">
              <button
                type="button"
                className={`calpop__dd${menu === "year" ? " on" : ""}`}
                aria-expanded={menu === "year"}
                aria-label={labels.pickYear ?? labels.prevMonth}
                onClick={() => setMenu(menu === "year" ? null : "year")}
              >
                {yearText(Number(calendarMonth.slice(0, 4)))}
                <ChevronDown aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`calpop__dd${menu === "month" ? " on" : ""}`}
                aria-expanded={menu === "month"}
                aria-label={labels.pickMonth ?? labels.nextMonth}
                onClick={() => setMenu(menu === "month" ? null : "month")}
              >
                {monthNames[Number(calendarMonth.slice(5)) - 1]}
                <ChevronDown aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              className="calpop__nav"
              aria-label={labels.nextMonth}
              onClick={() => showMonth(shiftMonthKey(calendarMonth, 1))}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          {menu === "year" ? (
            <div className="calpop__years" ref={centerSelectedYear} role="listbox">
              {years.map((year) => (
                <button
                  type="button"
                  key={year}
                  role="option"
                  aria-selected={year === Number(calendarMonth.slice(0, 4))}
                  className={[
                    "calpop__yr",
                    year === Number(calendarMonth.slice(0, 4)) ? "sel" : "",
                    draftYears.has(year) ? "is-draft" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    showMonth(`${year}-${calendarMonth.slice(5)}`);
                    setMenu(null);
                  }}
                >
                  {yearText(year)}
                </button>
              ))}
            </div>
          ) : menu === "month" ? (
            <div className="amp__grid calpop__months">
              {monthNames.map((name, i) => {
                const key = `${calendarMonth.slice(0, 4)}-${String(i + 1).padStart(2, "0")}`;
                const cls = ["amp__m", key === calendarMonth ? "sel" : "", draftMonths.has(key) ? "is-draft" : ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    type="button"
                    key={key}
                    className={cls}
                    onClick={() => {
                      showMonth(key);
                      setMenu(null);
                    }}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          ) : (
          <>
          <div className="calpop__wd">
            {dowLabels.map((label, i) => (
              <span key={`${label}-${i}`} className={i === 0 ? "sun" : ""}>
                {label}
              </span>
            ))}
          </div>
          <div className="calpop__grid" ref={setGridEl}>
            {Array.from({ length: firstDow }, (_, i) => (
              <span key={`pad-${i}`} className="cald cald--pad" />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const day = i + 1;
              const val = `${calendarMonth}-${String(day).padStart(2, "0")}`;
              const isFrom = val === draftFrom;
              const isTo = val === draftTo;
              const inRange = Boolean(draftFrom && draftTo && val > draftFrom && val < draftTo);
              const isSingle = isFrom && !draftTo;
              const isToday = val === todayKey;
              const isOff = isDateDisabled ? isDateDisabled(val, pendingFrom) : false;
              // 띠가 «끊기는» 자리는 둥글게 막는다: 주 경계(토→일), 달 첫날이 주중이라 앞이
              // 빈칸인 자리, 기간이 다음 달로 이어져 격자 끝에서 잘리는 자리.
              // `gridIndex` 는 앞의 빈칸(`cald--pad`)까지 센 값이라 `% 7` 이 그대로 요일이 된다.
              const gridIndex = firstDow + i;
              const isBand = inRange || (isFrom && Boolean(draftTo)) || isTo;
              const capLeft = gridIndex % 7 === 0 || !hasBand(i - 1);
              const capRight = gridIndex % 7 === 6 || !hasBand(i + 1);
              const cls = [
                "cald",
                isFrom ? "is-from" : "",
                isTo ? "is-to" : "",
                isSingle ? "is-single" : "",
                inRange ? "is-range" : "",
                isBand ? "is-band" : "",
                isBand && capLeft ? "is-capl" : "",
                isBand && capRight ? "is-capr" : "",
                isToday ? "is-today" : "",
                isOff ? "is-off" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button type="button" key={val} className={cls} disabled={isOff} onClick={() => pick(val)}>
                  {day}
                </button>
              );
            })}
          </div>
          </>
          )}
          <div className="calpop__foot">
            {constrained ? null : (
              <button
                type="button"
                className="calpop__quick"
                onClick={() => {
                  const range = thisMonthRange();
                  setDraft(range.from, range.to);
                  setCalendarMonth(range.from.slice(0, 7));
                }}
              >
                {labels.thisMonth}
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setDraft(null, null)}
            >
              {labels.reset}
            </button>
            <button
              type="button"
              className={`btn btn--pri btn--sm${draftFrom && draftTo ? "" : " is-disabled"}`}
              onClick={apply}
            >
              {labels.apply}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
