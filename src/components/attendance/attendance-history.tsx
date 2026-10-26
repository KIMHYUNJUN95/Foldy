"use client";

/**
 * 근무 기록(본인) — 화이트 리디자인(2026-10-13, 시안 AttHist-Phone · Fold · Tablet).
 * 제목 · 월 알약 → 「검토 필요 n건 ›」 한 줄 → 달력(근무 점 · 검토 필요 빨간 점) → 날짜별 줄.
 * 태블릿 가로는 왼쪽 달력 | 오른쪽 월 기록. 기록을 누르면 상세 시트(태블릿은 가운데 카드).
 */

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import "./attendance.css";
import { AIc, AttIcon } from "./att-icons";
import { MonthSwitcher } from "./month-switcher";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type {
  AttendanceSessionView,
  AttendanceTodaySummary,
} from "@/lib/attendance-history";
import { getDictionary, type Dictionary } from "@/lib/i18n";

type AttendanceCopy = Dictionary["attendance"];

function fmtDur(sec: number, hourLabel: string, minLabel: string): string {
  const safe = Math.max(0, Math.floor(sec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h > 0) return `${h}${hourLabel} ${m}${minLabel}`;
  if (m > 0) return `${m}${minLabel}`;
  return `0${minLabel}`;
}

function methodLabel(m: string | null, copy: AttendanceCopy): string {
  if (m === "gps_qr") return copy.methodGpsQr;
  if (m === "gps_wifi") return copy.methodGpsWifi;
  if (m === "manual") return copy.methodManual;
  return "—";
}

function amPm(label: string | null, amLabel: string, pmLabel: string): string | null {
  if (!label) return null;
  const h = parseInt(label.split(":")[0], 10);
  return h < 12 ? amLabel : pmLabel;
}

/** 세션을 operatingDate 로 묶는다(기존 순서 유지 = 내림차순). */
function groupByDate(sessions: AttendanceSessionView[]) {
  const groups: { date: string; sessions: AttendanceSessionView[] }[] = [];
  for (const s of sessions) {
    const last = groups[groups.length - 1];
    if (last && last.date === s.operatingDate) {
      last.sessions.push(s);
    } else {
      groups.push({ date: s.operatingDate, sessions: [s] });
    }
  }
  return groups;
}

/** 간단한 날짜 그룹 라벨: "오늘 6/18" / "6/17" + 로케일 요일. */
function dateGroupLabel(
  date: string,
  todayDate: string,
  locale: string,
  todayLabel: string,
): { d: string; wd: string } {
  const dt = new Date(`${date}T00:00:00+09:00`);
  const mm = dt.getMonth() + 1;
  const dd = dt.getDate();
  const wd = new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(dt);
  const isToday = date === todayDate;
  return { d: isToday ? `${todayLabel} ${mm}/${dd}` : `${mm}/${dd}`, wd };
}

function StatusChips({ s, copy }: { s: AttendanceSessionView; copy: AttendanceCopy }) {
  return (
    <>
      {s.status === "open" ? (
        <span className="chip c-open"><span className="d" />{copy.sessOpen}</span>
      ) : s.status === "invalid" ? (
        <span className="chip c-invalid">{copy.statusInvalid}</span>
      ) : s.status === "reopened" ? (
        <span className="chip c-info">{copy.sessReopened}</span>
      ) : (
        <span className="chip c-done"><AIc>{AttIcon.check}</AIc>{copy.sessDone}</span>
      )}
      {s.reviewState === "review_required" ? (
        <span className="chip c-warn">{copy.statusReviewRequired}</span>
      ) : null}
      {s.manualCreated ? <span className="chip c-info">{copy.methodManual}</span> : null}
      {s.correctionStatus === "requested" ? (
        <span className="chip c-info">{copy.sessCorrRequested}</span>
      ) : s.correctionStatus === "in_review" ? (
        <span className="chip c-warn">{copy.sessCorrInReview}</span>
      ) : s.correctionStatus === "approved" ? (
        <span className="chip c-done">{copy.sessCorrApproved}</span>
      ) : s.correctionStatus === "rejected" ? (
        <span className="chip c-danger">{copy.sessCorrRejected}</span>
      ) : null}
    </>
  );
}

function TimeCol({
  label,
  siteName,
  lbl,
  isOpen,
  isMissing,
  missingLabel,
  missingOutLabel,
  openLabel,
  amLabel,
  pmLabel,
}: {
  label: string | null;
  siteName: string | null;
  lbl: string;
  isOpen: boolean;
  isMissing: boolean;
  missingLabel: string;
  missingOutLabel?: string;
  openLabel: string;
  amLabel: string;
  pmLabel: string;
}) {
  const period = amPm(label, amLabel, pmLabel);
  return (
    <div className="io__col">
      <div className="io__lbl">{lbl}</div>
      {isOpen ? (
        <div className="io__time">{openLabel}</div>
      ) : label ? (
        <>
          <div className="io__time">
            {label}
            {period ? <span className="io__period">{period}</span> : null}
          </div>
          <div className="io__site">
            <AIc>{AttIcon.pin}</AIc>
            {siteName ?? "—"}
          </div>
        </>
      ) : isMissing ? (
        <>
          <div className="io__time missing">{missingLabel}</div>
          {missingOutLabel ? (
            <div className="io__site" style={{ color: "var(--warn)" }}>
              {missingOutLabel}
            </div>
          ) : null}
        </>
      ) : (
        <div className="io__time">--:--</div>
      )}
    </div>
  );
}

function FlaggedSessionPicker({
  sessions,
  copy,
  locale,
  todayDate,
  onSelect,
  onClose,
}: {
  sessions: AttendanceSessionView[];
  copy: AttendanceCopy;
  locale: string;
  todayDate: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet onClose={onClose}>
      <div className="att">
        <h3 className="rsheet__t">{copy.histSelectFlaggedSession}</h3>
        <div style={{ marginTop: 10 }}>
          {sessions.map((s) => {
            const { d, wd } = dateGroupLabel(s.operatingDate, todayDate, locale, copy.histToday);
            const missOut = !s.clockOutLabel && s.status !== "open";
            return (
              <button
                key={s.id}
                type="button"
                className="srow srow--flag"
                style={{ width: "100%", textAlign: "left", marginBottom: 8 }}
                onClick={() => onSelect(s.id)}
              >
                <div className="srow__top">
                  <div className="srow__chips">
                    <StatusChips s={s} copy={copy} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--att-muted)", flexShrink: 0 }}>
                    {d} ({wd})
                  </span>
                </div>
                <div className="inout">
                  <TimeCol
                    label={s.clockInLabel}
                    siteName={s.clockInSiteName}
                    lbl={copy.histClockIn}
                    isOpen={false}
                    isMissing={false}
                    missingLabel={copy.histNoRecord}
                    openLabel={copy.sessOpen}
                    amLabel={copy.amLabel}
                    pmLabel={copy.pmLabel}
                  />
                  <div className="io__arrow"><AIc>{AttIcon.arrowR}</AIc></div>
                  <TimeCol
                    label={s.clockOutLabel}
                    siteName={s.clockOutSiteName}
                    lbl={copy.histClockOut}
                    isOpen={s.status === "open"}
                    isMissing={missOut}
                    missingLabel={copy.histNoRecord}
                    missingOutLabel={copy.reasonMissingOut}
                    openLabel={copy.sessOpen}
                    amLabel={copy.amLabel}
                    pmLabel={copy.pmLabel}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </BottomSheet>
  );
}

/** "+1일" — 퇴근이 출근(운영일) 다음 날 이후면 며칠 뒤인지(도쿄 기준). */
function nextDayOffset(s: AttendanceSessionView): number {
  if (!s.clockOutAt) return 0;
  const outDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(s.clockOutAt));
  const diff = Math.round(
    (new Date(`${outDate}T00:00:00Z`).getTime() - new Date(`${s.operatingDate}T00:00:00Z`).getTime()) / 86400000,
  );
  return diff > 0 ? diff : 0;
}

const LONG_SHIFT_SEC = 12 * 3600;

/** 줄 오른쪽 아래 한 마디 — 데이터로 알 수 있는 것만. */
function rowTag(s: AttendanceSessionView, copy: AttendanceCopy): { text: string; tone: "" | "now" | "danger" | "muted" } {
  if (s.status === "open") return { text: copy.sessOpen, tone: "now" };
  if (s.status === "invalid") return { text: copy.statusInvalid, tone: "muted" };
  if (s.correctionStatus === "requested") return { text: copy.sessCorrRequested, tone: "now" };
  if (s.correctionStatus === "in_review") return { text: copy.sessCorrInReview, tone: "now" };
  if (!s.clockOutLabel) return { text: `${copy.reasonMissingOut} · ${copy.histCorrShort}`, tone: "danger" };
  if (s.reviewState === "review_required" || s.isAbnormal) return { text: copy.statusReviewRequired, tone: "danger" };
  const parts: string[] = [];
  if ((s.workedSec ?? 0) > LONG_SHIFT_SEC) parts.push(copy.histLongShift);
  if (s.correctionStatus === "approved") parts.push(copy.sessCorrApproved);
  if (s.correctionStatus === "rejected") parts.push(copy.sessCorrRejected);
  return { text: parts.join(" · "), tone: "" };
}

function isFlaggedSession(s: AttendanceSessionView) {
  return s.reviewState === "review_required" || s.isAbnormal || (!s.clockOutLabel && s.status !== "open" && s.status !== "invalid");
}

/** 진행 중 기록의 근무 시간 — 1분마다 다시 센다(출근 → 지금 − 끝난 휴게 − 진행 중 휴게). */
function useLiveWorked(s: AttendanceSessionView | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!s || s.status !== "open") return;
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, [s]);
  if (!s || s.status !== "open" || !s.clockInAt) return null;
  const openBreak = s.breaks.find((b) => b.endedAt === null);
  const openBreakSec = openBreak ? (now - new Date(openBreak.startedAt).getTime()) / 1000 : 0;
  return Math.max(0, Math.floor((now - new Date(s.clockInAt).getTime()) / 1000 - s.breakTotalSec - openBreakSec));
}

function HistRow({ s, copy, onClick }: { s: AttendanceSessionView; copy: AttendanceCopy; onClick: () => void }) {
  const live = useLiveWorked(s);
  const worked = live ?? s.workedSec;
  const plus = nextDayOffset(s);
  const tag = rowTag(s, copy);
  const method = methodLabel(s.clockInMethod, copy);
  const meta = [
    s.clockInSiteName ?? "—",
    method !== "—" ? method : null,
    copy.histBreakMin.replace("{min}", String(Math.round(s.breakTotalSec / 60))),
  ].filter(Boolean);
  return (
    <button type="button" className="atth-row" onClick={onClick}>
      <span className="atth-row__b">
        <span className="atth-row__io">
          {s.clockInLabel ?? "--:--"} → {s.status === "open" ? copy.sessOpen : (s.clockOutLabel ?? "—")}
          {plus > 0 ? <sup>{copy.histNextDay.replace("{n}", String(plus))}</sup> : null}
        </span>
        <span className="atth-row__m">{meta.join(" · ")}</span>
      </span>
      <span className="atth-row__r">
        <b>{worked != null && (s.clockOutLabel || s.status === "open") ? fmtDur(worked, copy.durationHour, copy.durationMin) : "—"}</b>
        {tag.text ? <span className={tag.tone ? `is-${tag.tone}` : undefined}>{tag.text}</span> : null}
      </span>
    </button>
  );
}

/** 달력 — 월요일 시작, 근무한 날 보라 점 · 검토 필요 빨간 점, 오늘 이후는 옅게. */
function HistCalendar({
  ym,
  todayDate,
  locale,
  marks,
  selected,
  onSelect,
}: {
  ym: string;
  todayDate: string;
  locale: string;
  marks: Map<string, "work" | "flag">;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // 0 = 월
  const wdFmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  // 2024-01-01 은 월요일 — 요일 머리글을 월~일로.
  const weekdays = Array.from({ length: 7 }, (_, i) => wdFmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
  return (
    <div className="atth-cal">
      {weekdays.map((w, i) => (
        <span key={w} className={`atth-cal__wd${i === 5 ? " is-sat" : i === 6 ? " is-sun" : ""}`}>
          {w}
        </span>
      ))}
      {Array.from({ length: firstDow }, (_, i) => (
        <span key={`b${i}`} />
      ))}
      {Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const date = `${ym}-${String(day).padStart(2, "0")}`;
        const mark = marks.get(date);
        const cls = `atth-day${date > todayDate ? " is-future" : ""}${date === todayDate ? " is-today" : ""}${selected === date ? " is-on" : ""}`;
        const inner = (
          <>
            {day}
            <span className="atth-day__dot">{mark ? <i className={mark === "flag" ? "is-flag" : undefined} /> : null}</span>
          </>
        );
        return (
          <span key={date} className="atth-cal__cell">
            {mark ? (
              <button type="button" className={cls} onClick={() => onSelect(date)} aria-pressed={selected === date}>
                {inner}
              </button>
            ) : (
              <span className={cls}>{inner}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function AttendanceHistory({
  summary,
  sessions,
  ym,
  currentYm,
  locale,
}: {
  summary: AttendanceTodaySummary;
  sessions: AttendanceSessionView[];
  ym: string;
  currentYm: string;
  locale: string;
}) {
  const copy = getDictionary(locale).attendance;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const close = () => setSelectedId(null);

  function dur(sec: number) {
    return fmtDur(sec, copy.durationHour, copy.durationMin);
  }

  const todayDate = summary.date;
  const flagged = sessions.filter(isFlaggedSession);
  const groups = groupByDate(sessions);
  const marks = useMemo(() => {
    const map = new Map<string, "work" | "flag">();
    for (const s of sessions) {
      if (isFlaggedSession(s)) map.set(s.operatingDate, "flag");
      else if (!map.has(s.operatingDate)) map.set(s.operatingDate, "work");
    }
    return map;
  }, [sessions]);
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const selectedDate = pickedDate ?? (marks.has(todayDate) ? todayDate : (groups[0]?.date ?? null));

  const monthName = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    new Date(`${ym}-01T00:00:00Z`),
  );
  // 월 합계는 정상 기록만(검토 필요 · 무효 · 진행 중 제외) — 급여 화면의 인정 시간과 같은 기준.
  const monthWorked = sessions
    .filter((s) => s.status !== "open" && s.status !== "invalid" && !isFlaggedSession(s))
    .reduce((acc, s) => acc + (s.workedSec ?? 0), 0);
  const monthLine = copy.histMonthLine
    .replace("{month}", monthName)
    .replace("{days}", String(marks.size))
    .replace("{dur}", dur(monthWorked));

  function pickDate(date: string) {
    setPickedDate(date);
    document.getElementById(`atth-${date}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // 기록 상세 — 폰 · 폴드는 바텀시트, 태블릿 가로는 오른쪽 칸. 내용은 하나.
  const detail = (target: AttendanceSessionView) => (
    <div className="att">
      <h3 className="rsheet__t">{target.dateLabel}</h3>
      <div className="histsheet__chips">
        <StatusChips s={target} copy={copy} />
      </div>
      <div className="recap">
        <div className="recap__r">
          <span className="recap__k">
            <AIc>{AttIcon.pin}</AIc>{copy.histClockIn}
          </span>
          <span className="recap__v">
            <span className="mono">{target.clockInLabel ?? "--:--"}</span> ·{" "}
            {target.clockInSiteName ?? "—"} ·{" "}
            {methodLabel(target.clockInMethod, copy)}
          </span>
        </div>
        <div className="recap__r">
          <span className="recap__k">
            <AIc>{AttIcon.logout}</AIc>{copy.histClockOut}
          </span>
          <span className="recap__v">
            {target.clockOutLabel ? (
              <>
                <span className="mono">{target.clockOutLabel}</span> ·{" "}
                {target.clockOutSiteName ?? "—"} ·{" "}
                {methodLabel(target.clockOutMethod, copy)}
              </>
            ) : target.status === "open" ? (
              copy.sessOpen
            ) : (
              copy.histNoRecord
            )}
          </span>
        </div>
        <div className="recap__r">
          <span className="recap__k">{copy.histWorkTime}</span>
          <span className="recap__v">
            {target.workedSec != null ? dur(target.workedSec) : "—"}
          </span>
        </div>
        <div className="recap__r">
          <span className="recap__k">{copy.histBreakTotal}</span>
          <span className="recap__v">
            {dur(target.breakTotalSec)}
            {target.breakCount ? copy.histBreakCountSuffix(target.breakCount) : ""}
          </span>
        </div>
      </div>

      {target.breaks.length > 0 ? (
        <div className="histbreaks">
          {target.breaks.map((b, i) => (
            <div className="histbreaks__r" key={`${b.startedAt}-${i}`}>
              <span className="histbreaks__k">{copy.histBreakRowLabel(i + 1)}</span>
              <span className="mono">
                {b.startedLabel} – {b.endedLabel ?? copy.sessOpen}
              </span>
              <span className="histbreaks__d">
                {b.durationSec != null ? dur(b.durationSec) : copy.sessOpen}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {target.isAbnormal ? (
        <div className="failnote warn">
          <AIc>{AttIcon.warn}</AIc>
          <div>
            <b>{copy.histAbnormalTitle}</b>
            <p>{copy.histAbnormalBody}</p>
          </div>
        </div>
      ) : null}

      {target.correctionStatus ? (
        <Link
          href={target.correctionRequestId ? `/mobile/attendance/correction/status?id=${target.correctionRequestId}` : "/mobile/attendance/correction/status"}
          className="ghostbtn"
          style={{ marginTop: "12px" }}
        >
          <AIc>{AttIcon.info}</AIc>{copy.histViewCorrStatus}
        </Link>
      ) : (
        <Link
          href={`/mobile/attendance/correction?sessionId=${target.id}`}
          className="ghostbtn"
          style={{ marginTop: "12px" }}
        >
          <AIc>{AttIcon.edit}</AIc>{copy.histRequestCorr}
        </Link>
      )}
    </div>
  );

  return (
    <div className="att att--hist att--histw">
      <div className="atth-left">
        <div className="ptitle-row">
          <div>
            <h1 className="ptitle">{copy.historyTitle}</h1>
            <div className="ptitle__sub">{monthLine}</div>
            {flagged.length > 0 ? (
              <button
                type="button"
                className="atth-review"
                onClick={() => {
                  if (flagged.length === 1) setSelectedId(flagged[0].id);
                  else setPickerOpen(true);
                }}
              >
                <i aria-hidden="true" />
                {copy.statusReviewRequired} {copy.histFlaggedCount(flagged.length)}
                <AIc>{AttIcon.chevR}</AIc>
              </button>
            ) : null}
          </div>
          <MonthSwitcher
            ym={ym}
            currentYm={currentYm}
            basePath="/mobile/attendance/history"
            locale={locale}
            labels={{ prev: copy.monthPrev, next: copy.monthNext, select: copy.monthSelect }}
          />
        </div>

        <div className="atth-legend">
          <span><i />{copy.histLegendWork}</span>
          <span><i className="is-flag" />{copy.statusReviewRequired}</span>
        </div>
        <HistCalendar ym={ym} todayDate={todayDate} locale={locale} marks={marks} selected={selectedDate} onSelect={pickDate} />
      </div>

      <div className="atth-right">
        <div className="atth-right__h">
          <b>{copy.histMonthRecords.replace("{month}", monthName)}</b>
          <span>{copy.histTapDayHint}</span>
        </div>
        {sessions.length === 0 ? <p className="atth-empty">{copy.histEmpty}</p> : null}
        {groups.map((g) => {
          return (
            <section key={g.date} id={`atth-${g.date}`} className={`atth-group${selectedDate === g.date ? " is-on" : ""}`}>
              <h2 className="atth-group__d">
                {g.sessions[0].dateLabel}{g.date === todayDate ? ` · ${copy.histToday}` : ""}
              </h2>
              {g.sessions.map((s) => (
                <HistRow key={s.id} s={s} copy={copy} onClick={() => setSelectedId(s.id)} />
              ))}
            </section>
          );
        })}
      </div>

      {pickerOpen && (
        <FlaggedSessionPicker
          sessions={flagged}
          copy={copy}
          locale={locale}
          todayDate={todayDate}
          onSelect={(id) => {
            setPickerOpen(false);
            setSelectedId(id);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {selected && <BottomSheet onClose={close}>{detail(selected)}</BottomSheet>}
    </div>
  );
}
