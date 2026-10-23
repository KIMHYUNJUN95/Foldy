"use client";

/**
 * AttendanceRoster — 매니저/오피스 역할 전용 일일 출근자 명단.
 * 화이트 리디자인(2026-10-13, 시안 AttRosterM-Phone · Fold · Tablet): 제목 · 「오늘 n명 출근 · 실시간」 → ‹ 날짜 › · 오늘 →
 * 상태 막대 + 범례 → 줄(이름 · 역할 · 현장 · 출근 → 퇴근 · 상태 · 전화). 태블릿 가로는 왼쪽 달력 · 요약 | 오른쪽 줄.
 * 날짜 변경 시 router.replace로 ?date= 파라미터를 업데이트해 서버 컴포넌트를 재실행.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import "./attendance.css";
import { AIc, AttIcon } from "./att-icons";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { WeeklyLimitBadge } from "@/components/shared/weekly-limit-badge";
import type { WeeklyLimitChip } from "@/lib/staff-documents/weekly-limit";
import { getDictionary } from "@/lib/i18n";
import type { RosterDay, RosterEntry } from "@/lib/attendance-roster";

export type { RosterDay, RosterEntry };

type Props = {
  rosterDay: RosterDay;
  operatingDate: string;  // currently selected date "YYYY-MM-DD"
  todayDate: string;      // today in Tokyo "YYYY-MM-DD"
  locale: string;
  /** 「주 28시간」 칩(docs/product/41 R4) — 서버가 `staff_documents.view` 를 본 뒤에만 채운다. */
  weeklyLimit?: Record<string, WeeklyLimitChip>;
};

// ─── 날짜 유틸 ────────────────────────────────────────────────────────────────

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmtKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localeTag(locale: string): string {
  if (locale === "ko") return "ko-KR";
  if (locale === "ja") return "ja-JP";
  return "en-US";
}

function dowLabels(locale: string) {
  const formatter = new Intl.DateTimeFormat(localeTag(locale), {
    weekday: "short",
    timeZone: "UTC",
  });
  return Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(Date.UTC(2026, 5, 7 + i))).replace(/\.$/, ""),
  );
}

function fmtDateMeta(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}

// ─── 직원 줄 ──────────────────────────────────────────────────────────────────

const ORDER: RosterEntry["statusKey"][] = ["working", "on_break", "needs_review", "done", "void"];

function RosterLine({
  entry,
  copy,
  weekly,
}: {
  entry: RosterEntry;
  copy: ReturnType<typeof getDictionary>["attendance"];
  weekly: WeeklyLimitChip | null;
}) {
  const isActive = entry.statusKey === "working" || entry.statusKey === "on_break";
  const canCall = isActive && !!entry.phoneNumber;
  const site = entry.statusKey === "done" && entry.clockOutSiteName ? entry.clockOutSiteName : entry.siteName;
  const label =
    entry.statusKey === "working"
      ? copy.rosterStatusWorking
      : entry.statusKey === "on_break"
        ? copy.rosterStatusOnBreak
        : entry.statusKey === "done"
          ? copy.rosterDoneShort
          : entry.statusKey === "needs_review"
            ? copy.rosterStatusNeedsReview
            : copy.rosterStatusVoid;
  return (
    <div className={`ro-line is-${entry.statusKey}`}>
      <span className="ro-line__av">{entry.avatarInitial}</span>
      <span className="ro-line__b">
        <span className="ro-line__t">
          {entry.name} <small>{entry.role}</small>
          <WeeklyLimitBadge chip={weekly} copy={copy} />
        </span>
        <span className="ro-line__m">
          {site ? `${site} · ` : ""}
          {entry.clockInTimeLabel} → {entry.clockOutTimeLabel ?? ""}
        </span>
      </span>
      <span className="ro-line__s">{label}</span>
      {canCall ? (
        <a href={`tel:${entry.phoneNumber}`} className="ro-line__call" aria-label={`${entry.name} ${copy.rosterCallLabel}`}>
          <AIc>{AttIcon.phone}</AIc>
        </a>
      ) : (
        <span className="ro-line__call is-empty" aria-hidden="true" />
      )}
    </div>
  );
}

/** 태블릿 가로 왼쪽 달력 — 월요일 시작, 오늘 이후는 고를 수 없음. */
function MiniCal({
  selected,
  todayKey,
  onSelect,
  locale,
  copy,
}: {
  selected: Date;
  todayKey: string;
  onSelect: (key: string) => void;
  locale: string;
  copy: ReturnType<typeof getDictionary>["attendance"];
}) {
  const [y, setY] = useState(selected.getFullYear());
  const [m, setM] = useState(selected.getMonth());
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const wd = new Intl.DateTimeFormat(localeTag(locale), { weekday: "short", timeZone: "UTC" });
  const heads = Array.from({ length: 7 }, (_, i) => wd.format(new Date(Date.UTC(2024, 0, 1 + i))));
  const title = new Intl.DateTimeFormat(localeTag(locale), { year: "numeric", month: "long" }).format(new Date(y, m, 1));
  const canNext = fmtKey(new Date(y, m + 1, 1)) <= todayKey;
  return (
    <div className="ro-cal">
      <div className="ro-cal__h">
        <button type="button" aria-label={copy.monthPrev} onClick={() => (m === 0 ? (setM(11), setY(y - 1)) : setM(m - 1))}>
          ‹
        </button>
        <b>{title}</b>
        <button type="button" aria-label={copy.monthNext} disabled={!canNext} onClick={() => (m === 11 ? (setM(0), setY(y + 1)) : setM(m + 1))}>
          ›
        </button>
        {fmtKey(selected) !== todayKey ? (
          <button type="button" className="ro-cal__today" onClick={() => onSelect(todayKey)}>
            {copy.rosterTodayTag}
          </button>
        ) : null}
      </div>
      <div className="ro-cal__g">
        {heads.map((h, i) => (
          <span key={h} className={`ro-cal__wd${i === 5 ? " is-sat" : i === 6 ? " is-sun" : ""}`}>
            {h}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const k = fmtKey(new Date(y, m, i + 1));
          const future = k > todayKey;
          return (
            <button
              key={k}
              type="button"
              disabled={future}
              aria-pressed={k === fmtKey(selected)}
              className={`ro-cal__d${k === fmtKey(selected) ? " is-on" : ""}${k === todayKey ? " is-today" : ""}`}
              onClick={() => onSelect(k)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── 달력 시트 ────────────────────────────────────────────────────────────────

type CalendarSheetProps = {
  selectedDate: Date;
  todayDate: Date;
  hasDataDates: Set<string>;
  onSelect: (date: Date) => void;
  onClose: () => void;
  copy: ReturnType<typeof getDictionary>["attendance"];
  locale: string;
};

function CalendarSheet({ selectedDate, todayDate, hasDataDates, onSelect, onClose, copy, locale }: CalendarSheetProps) {
  const [calY, setCalY] = useState(selectedDate.getFullYear());
  const [calM, setCalM] = useState(selectedDate.getMonth());
  const [pendingDate, setPendingDate] = useState<Date>(selectedDate);

  const leadDow = new Date(calY, calM, 1).getDay();
  const daysInMonth = new Date(calY, calM + 1, 0).getDate();

  const canNext = new Date(calY, calM + 1, 1) <= todayDate;

  const cells = useMemo(() => {
    const items: { day: number; date: Date; isFuture: boolean; isToday: boolean; isSel: boolean; hasData: boolean }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(calY, calM, d);
      items.push({
        day: d,
        date,
        isFuture: date > todayDate,
        isToday: fmtKey(date) === fmtKey(todayDate),
        isSel: fmtKey(date) === fmtKey(pendingDate),
        hasData: hasDataDates.has(fmtKey(date)),
      });
    }
    return items;
  }, [calY, calM, daysInMonth, todayDate, pendingDate, hasDataDates]);

  const monthLabel = new Intl.DateTimeFormat(
    locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US",
    { year: "numeric", month: "long" }
  ).format(new Date(calY, calM, 1));

  return (
    <BottomSheet onClose={onClose} ariaLabel={copy.rosterPageTitle}>
      <div className="att">
        <div className="roster-cal-head">
          <span className="roster-cal-m">{monthLabel}</span>
          <div className="roster-cal-nav">
            <button
              type="button"
              onClick={() => { if (calM === 0) { setCalM(11); setCalY(y => y - 1); } else setCalM(m => m - 1); }}
              aria-label={copy.monthPrev}
            >
              <AIc>{AttIcon.back}</AIc>
            </button>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => { if (!canNext) return; if (calM === 11) { setCalM(0); setCalY(y => y + 1); } else setCalM(m => m + 1); }}
              aria-label={copy.monthNext}
            >
              <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="roster-cal-dow">
          {dowLabels(locale).map((l) => <span key={l}>{l}</span>)}
        </div>
        <div className="roster-cal-grid">
          {cells.map((cell, i) => {
            const cls = [
              "cal-btn",
              cell.isFuture ? "future" : "",
              cell.isToday ? "today" : "",
              cell.isSel ? "sel" : "",
              cell.hasData ? "has" : "",
            ].filter(Boolean).join(" ");
            const style = i === 0 ? { gridColumnStart: leadDow + 1 } : undefined;
            return (
              <button
                key={cell.day}
                type="button"
                className={cls}
                style={style}
                disabled={cell.isFuture}
                onClick={() => !cell.isFuture && setPendingDate(cell.date)}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
        <div className="roster-cal-foot">
          <button type="button" className="ghost" onClick={() => { setPendingDate(todayDate); }}>
            {copy.rosterGoToday}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => { onSelect(pendingDate); onClose(); }}
          >
            {copy.rosterViewThisDate}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function AttendanceRoster({ rosterDay, operatingDate, todayDate, locale, weeklyLimit = {} }: Props) {
  const copy = getDictionary(locale).attendance;
  const router = useRouter();
  const [calOpen, setCalOpen] = useState(false);

  const todayDateObj = useMemo(() => parseDate(todayDate), [todayDate]);
  const selectedDateObj = useMemo(() => parseDate(operatingDate), [operatingDate]);

  const hasDataDates = useMemo(() => {
    const set = new Set<string>();
    if (rosterDay.entries.length > 0) set.add(rosterDay.operatingDate);
    return set;
  }, [rosterDay]);

  const navigateToDate = useCallback((dateKey: string) => {
    router.replace(`/mobile/attendance/roster?date=${dateKey}`);
  }, [router]);
  const handleCalSelect = useCallback((date: Date) => navigateToDate(fmtKey(date)), [navigateToDate]);
  const shiftDay = (n: number) => {
    const d = new Date(selectedDateObj);
    d.setDate(d.getDate() + n);
    const k = fmtKey(d);
    if (k <= todayDate) navigateToDate(k);
  };

  const isToday = operatingDate === todayDate;
  const dateLabel = fmtDateMeta(selectedDateObj, locale);
  const k = rosterDay.counts;
  const total = Math.max(1, k.total);
  const active = k.working + k.on_break;
  const entries = [...rosterDay.entries].sort(
    (a, b) => ORDER.indexOf(a.statusKey) - ORDER.indexOf(b.statusKey) || a.clockInTimeLabel.localeCompare(b.clockInTimeLabel),
  );
  const legend = [
    { key: "work", label: copy.rosterStatusWorking, n: active },
    { key: "done", label: copy.rosterDoneShort, n: k.done },
    { key: "review", label: copy.rosterStatusNeedsReview, n: k.needs_review },
    { key: "void", label: copy.rosterStatusVoid, n: k.void },
  ];

  return (
    <div className="att att--rosterw">
      <div className="ro-left">
        <div className="ptitle-row">
          <div>
            <h1 className="ptitle">{copy.rosterPageTitle}</h1>
            <div className="ptitle__sub">
              {(isToday ? copy.rosterSubToday : copy.rosterSubDay).replace("{n}", String(k.total))}
              {isToday ? (
                <span className="ro-live">
                  {" · "}
                  <i aria-hidden="true" />
                  {copy.rosterLiveLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="ro-daterow">
          <button type="button" className="ro-daterow__arrow" aria-label={copy.rosterPrevDay} onClick={() => shiftDay(-1)}>
            <AIc>{AttIcon.back}</AIc>
          </button>
          <button type="button" className="ro-daterow__d" onClick={() => setCalOpen(true)} aria-label={copy.rosterDateSelectLabel}>
            {dateLabel}
            <AIc>{AttIcon.caret}</AIc>
          </button>
          <button
            type="button"
            className="ro-daterow__arrow is-next"
            aria-label={copy.rosterNextDay}
            disabled={isToday}
            onClick={() => shiftDay(1)}
          >
            <AIc>{AttIcon.back}</AIc>
          </button>
          {!isToday ? (
            <button type="button" className="ro-daterow__today" onClick={() => navigateToDate(todayDate)}>
              {copy.rosterTodayTag}
            </button>
          ) : null}
        </div>

        <MiniCal selected={selectedDateObj} todayKey={todayDate} onSelect={navigateToDate} locale={locale} copy={copy} />

        {k.total > 0 ? (
          <div className="ro-sum">
            <b className="ro-sum__d">{dateLabel}</b>
            <div className="ro-bar" aria-hidden="true">
              {active > 0 ? <i className="is-work" style={{ flex: active / total }} /> : null}
              {k.done > 0 ? <i className="is-done" style={{ flex: k.done / total }} /> : null}
              {k.needs_review > 0 ? <i className="is-review" style={{ flex: k.needs_review / total }} /> : null}
              {k.void > 0 ? <i className="is-void" style={{ flex: k.void / total }} /> : null}
            </div>
            <div className="ro-legend">
              {legend.map((l) => (
                <span key={l.key} className={`is-${l.key}`}>
                  <i aria-hidden="true" />
                  {l.label}
                  <b>{l.n}</b>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="ro-right">
        {k.total > 0 ? (
          <div className="ro-right__h">
            <b>{copy.rosterListTitle.replace("{date}", isToday ? copy.rosterTodayTag : dateLabel).replace("{n}", String(k.total))}</b>
            <span>{copy.rosterActiveFirst}</span>
          </div>
        ) : null}
        {entries.length === 0 ? (
          <div className="roster-empty">
            <div className="roster-empty__ic">
              <AIc>{AttIcon.clock}</AIc>
            </div>
            <div className="roster-empty__t">{copy.rosterNoEntries}</div>
            <div className="roster-empty__s">{copy.rosterNoEntriesSub}</div>
          </div>
        ) : (
          entries.map((entry) => (
            <RosterLine key={entry.sessionId} entry={entry} copy={copy} weekly={weeklyLimit[entry.userId] ?? null} />
          ))
        )}
      </div>

      {/* 날짜 선택 캘린더 BottomSheet */}
      {calOpen && (
        <CalendarSheet
          selectedDate={selectedDateObj}
          todayDate={todayDateObj}
          hasDataDates={hasDataDates}
          onSelect={handleCalSelect}
          onClose={() => setCalOpen(false)}
          copy={copy}
          locale={locale}
        />
      )}
    </div>
  );
}
