"use client";

import { useState } from "react";
import "./leave.css";
import { AIc, AttIcon } from "./att-icons";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { tokyoToday } from "@/lib/annual-leave";
import type { Dictionary } from "@/lib/i18n";

// D · 날짜 범위 캘린더 (바텀시트) — L2 신청서 "휴가 기간" 필드 탭 시 올라온다.
// 시작일 → 종료일을 탭해 범위를 선택하고, 선택 구간이 이어진 밴드로 강조된다. 지난 날짜는 비활성.
// 오전/오후 반차(singleDay)일 때는 하루만 선택 가능 — 탭 즉시 그 날 하루로 확정된다.
// 경조휴가(fixedRangeDays)는 하루만 탭해도 그 날짜부터 고정 일수만큼의 기간이 자동 계산되어
// 시작일~종료일로 표시된다(예: 3일 고정이면 탭한 날 ~ +2일).
// 실제 연/월 이동 캘린더(hire-date-picker.tsx와 동일한 날짜 연산) — 목업 고정 월이 아니다.
// 월/연도 라벨을 탭하면 연도 스테퍼 + 12개월 그리드로 전환된다.

type LeaveCopy = Dictionary["leave"];

function localeTag(locale: string): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstWeekday(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function LeaveDatePicker({
  locale,
  copy: c,
  startDate,
  endDate,
  singleDay = false,
  fixedRangeDays,
  onApply,
  onClose,
}: {
  locale: string;
  copy: LeaveCopy;
  startDate: string;
  endDate: string;
  singleDay?: boolean;
  /** 예: 경조사 휴가 — 하루를 누르면 그 날짜부터 이 일수만큼 자동으로 채운다. */
  fixedRangeDays?: number;
  onApply: (start: string, end: string) => void;
  onClose: () => void;
}) {
  const today = tokyoToday();
  const showSingleDate = singleDay && !fixedRangeDays;
  const [dStart, setDStart] = useState<string>(startDate);
  const [dEnd, setDEnd] = useState<string | null>(showSingleDate ? startDate : endDate);
  const [ym, setYm] = useState(() => startDate.slice(0, 7));
  const [view, setView] = useState<"days" | "months">("days");
  const [viewYear, setViewYear] = useState(() => Number(startDate.slice(0, 4)));

  function tap(key: string) {
    // 지난 날짜도 허용한다 — 휴가를 먼저 쓰고 나중에 신청하는 경우가 있다.
    if (fixedRangeDays) {
      // 예: 경조사 휴가 — 한 번 탭하면 시작일이 정해지고 고정 기간이 자동으로 따라온다
      setDStart(key);
      setDEnd(addDaysISO(key, fixedRangeDays - 1));
      return;
    }
    if (singleDay) {
      // 반차 신청은 하루만 선택할 수 있다
      setDStart(key);
      setDEnd(key);
      return;
    }
    if (dEnd !== null || key < dStart) {
      // 새 범위 시작
      setDStart(key);
      setDEnd(null);
    } else {
      // 두 번째 탭으로 범위 완성(같은 날 → 1일 범위)
      setDEnd(key);
    }
  }

  const [year, month] = ym.split("-").map(Number);
  const tag = localeTag(locale);
  const monthLabel = new Intl.DateTimeFormat(tag, { year: "numeric", month: "long" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(tag, { month: "short" }).format(new Date(Date.UTC(2021, i, 1))),
  );
  const lead = firstWeekday(year, month);
  const total = daysInMonth(year, month);
  const days = dEnd !== null ? Math.round((new Date(dEnd).getTime() - new Date(dStart).getTime()) / 86400000) + 1 : null;

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < lead; i++) cells.push(<div className="dpick__cell pad" key={`pad${i}`} />);
  for (let d = 1; d <= total; d++) {
    const key = `${ym}-${String(d).padStart(2, "0")}`;
    let cls = "";
    if (dEnd !== null) {
      if (key === dStart && key === dEnd) cls = "rsingle";
      else if (key === dStart) cls = "rstart";
      else if (key === dEnd) cls = "rend";
      else if (key > dStart && key < dEnd) cls = "inrange";
    } else if (key === dStart) {
      cls = "rsingle";
    }
    if (key === today && !/r(start|end|single)/.test(cls)) cls += " today";
    cells.push(
      <button type="button" className={`dpick__cell ${cls}`.trim()} key={key} onClick={() => tap(key)}>
        <span className="dpick__d">{d}</span>
      </button>,
    );
  }

  return (
    <BottomSheet onClose={onClose} className="pb-[max(16px,env(safe-area-inset-bottom))]">
      {({ close }) => (
        <div className="lv-sheet">
          <div className="lsheet__h">
            <span className="lsheet__ic bg-pick">
              <AIc>{AttIcon.calendar}</AIc>
            </span>
            <span className="lsheet__t">{c.fPeriod}</span>
          </div>

          <div className="dpick__sum">
            {showSingleDate ? (
              <div className="dpick__sumcol">
                <span className="dpick__sumk">{c.fDate}</span>
                <span className="dpick__sumv mono">{dStart}</span>
              </div>
            ) : (
              <>
                <div className="dpick__sumcol">
                  <span className="dpick__sumk">{c.fStart}</span>
                  <span className="dpick__sumv mono">{dStart}</span>
                </div>
                <span className="dpick__sumar">
                  <AIc>{AttIcon.arrowR}</AIc>
                </span>
                <div className="dpick__sumcol">
                  <span className="dpick__sumk">{c.fEnd}</span>
                  <span className={`dpick__sumv mono${dEnd === null ? " ph" : ""}`}>
                    {dEnd === null ? c.pickDate : dEnd}
                  </span>
                </div>
              </>
            )}
            {!showSingleDate && days !== null ? <span className="dpick__sumd">{c.fDays(days)}</span> : null}
          </div>

          <div className="dpick__nav">
            <button
              type="button"
              className="lcal__month"
              aria-label={c.calPickMonth}
              onClick={() => {
                setViewYear(year);
                setView("months");
              }}
            >
              {monthLabel}
            </button>
            <span className="lcal__navsp" />
            <button
              type="button"
              className="lcal__navbtn"
              aria-label={c.calPrevMonth}
              onClick={() => setYm((m) => shiftMonth(m, -1))}
            >
              {AttIcon.back}
            </button>
            <button type="button" className="lcal__navbtn" aria-label={c.calNextMonth} onClick={() => setYm((m) => shiftMonth(m, 1))}>
              {AttIcon.chevR}
            </button>
          </div>

          {view === "months" ? (
            <>
              <div className="dpick__yrnav">
                <button
                  type="button"
                  className="lcal__navbtn"
                  aria-label={c.calPrevYear}
                  onClick={() => setViewYear((y) => y - 1)}
                >
                  {AttIcon.back}
                </button>
                <span className="dpick__yr">{viewYear}</span>
                <button
                  type="button"
                  className="lcal__navbtn"
                  aria-label={c.calNextYear}
                  onClick={() => setViewYear((y) => y + 1)}
                >
                  {AttIcon.chevR}
                </button>
              </div>
              <div className="dpick__mgrid">
                {monthNames.map((name, i) => {
                  const m = i + 1;
                  const targetYm = `${viewYear}-${String(m).padStart(2, "0")}`;
                  return (
                    <button
                      type="button"
                      key={m}
                      className={`dpick__mcell${targetYm === ym ? " sel" : ""}`}
                      onClick={() => {
                        setYm(targetYm);
                        setView("days");
                      }}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="dpick__wkrow">
                {c.calWk.map((w, i) => (
                  <div className={`dpick__wd${i === 0 ? " sun" : i === 6 ? " sat" : ""}`} key={i}>
                    {w}
                  </div>
                ))}
              </div>
              <div className="dpick__grid">{cells}</div>
            </>
          )}

          <div className="lsheet__btns" style={{ marginTop: 14 }}>
            <button type="button" className="lbtn lbtn--ghost" onClick={close}>
              {c.close}
            </button>
            <button
              type="button"
              className={`lbtn lbtn--primary${dEnd === null ? " dim" : ""}`}
              disabled={dEnd === null}
              onClick={() => {
                if (dEnd === null) return;
                onApply(dStart, dEnd);
                close();
              }}
            >
              <AIc>{AttIcon.check}</AIc>
              {c.applyDate}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
