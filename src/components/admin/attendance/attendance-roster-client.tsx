"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { Clock, Phone } from "lucide-react";
import { AdmDropdown } from "../shared/adm-dropdown";
import { loadAdminAttendanceRoster } from "@/app/admin/attendance/roster/actions";
import type { RosterDay, RosterEntry, RosterStatusKey } from "@/lib/attendance-roster";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";

type Att = Dictionary["admin"]["attendanceConsole"];

type Props = {
  initialRosterDay: RosterDay;
  initialTodayDate: string;
  locale: Locale;
  localeTag: string;
  /** 재류카드가 만료된 사람 — 이름 옆 빨간 칩(경고만, docs/product/41 「만료 표시」). */
  expiredCardUserIds?: string[];
};

type StatusMeta = {
  cls: string;
  label: string;
  dotVar: string;
  active?: boolean;
};

function Ic({ children }: { children: ReactNode }) {
  return <span className="ic">{children}</span>;
}

function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00+09:00`);
}

function timeLabel(localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function statusMeta(status: RosterStatusKey, c: Att): StatusMeta {
  const map: Record<RosterStatusKey, StatusMeta> = {
    working: { cls: "work", label: c.rosterStatusWorking, dotVar: "--done", active: true },
    on_break: { cls: "rest", label: c.rosterStatusOnBreak, dotVar: "--warn", active: true },
    done: { cls: "done", label: c.rosterStatusDone, dotVar: "--muted" },
    needs_review: { cls: "review", label: c.rosterStatusNeedsReview, dotVar: "--danger" },
    void: { cls: "void", label: c.rosterStatusVoid, dotVar: "--faint" },
  };
  return map[status];
}

/** 휴게 칸 — 휴게 중이면 「11:30 –」(시작 시각), 끝난 휴게만 있으면 합계 「30분」, 없으면 —.
 *  휴게마다의 시작 · 끝 시각은 명단 데이터에 없다(2026-10-13 시안 컨펌). */
function breakCell(entry: RosterEntry, localeTag: string): string {
  if (entry.hasOpenBreak && entry.openBreakStartedAt) {
    const t = new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(
      new Date(entry.openBreakStartedAt),
    );
    return `${t} –`;
  }
  if (entry.breakCount === 0) return "—";
  return `${Math.round(entry.closedBreakSeconds / 60)}${minUnit(localeTag)}`;
}
function minUnit(localeTag: string): string {
  return localeTag.startsWith("ja") ? "分" : localeTag.startsWith("en") ? "m" : "분"; // i18n-ignore — 분 단위 기호만(로케일 태그로 고름)
}

const STATUS_ORDER: RosterStatusKey[] = ["working", "on_break", "needs_review", "done", "void"];

export function AttendanceRosterClient({
  initialRosterDay,
  initialTodayDate,
  locale,
  localeTag,
  expiredCardUserIds = [],
}: Props) {
  const expiredCards = new Set(expiredCardUserIds);
  const c = getDictionary(locale).admin.attendanceConsole;
  const [rosterDay, setRosterDay] = useState(initialRosterDay);
  const [todayDate, setTodayDate] = useState(initialTodayDate);
  const [liveTime, setLiveTime] = useState(() => timeLabel(localeTag));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const shortDate = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" }).format(
        parseDateKey(rosterDay.operatingDate),
      ),
    [localeTag, rosterDay.operatingDate],
  );
  const [siteFilter, setSiteFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const isToday = rosterDay.operatingDate === todayDate;

  const refreshCurrentDate = useCallback(
    (options?: { silent?: boolean }) => {
      if (!options?.silent) setError(null);
      startTransition(async () => {
        const result = await loadAdminAttendanceRoster(rosterDay.operatingDate, localeTag);
        if (result.ok) {
          setRosterDay(result.rosterDay);
          setTodayDate(result.todayDate);
        } else if (!options?.silent) {
          setError(c.rosterLoadFailed);
        }
      });
    },
    [c.rosterLoadFailed, localeTag, rosterDay.operatingDate],
  );

  useEffect(() => {
    if (!isToday) return;
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshCurrentDate({ silent: true });
    }, 10000);
    return () => window.clearInterval(refreshInterval);
  }, [isToday, refreshCurrentDate]);

  useEffect(() => {
    if (!isToday) return;
    const clockInterval = window.setInterval(() => {
      setLiveTime(timeLabel(localeTag));
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(clockInterval);
  }, [isToday, localeTag]);

  const empty = rosterDay.entries.length === 0;
  const sites = Array.from(new Set(rosterDay.entries.map((e) => e.siteName || c.rosterSiteUnknown))).sort();
  const rows = rosterDay.entries
    .filter((e) => siteFilter === "all" || (e.siteName || c.rosterSiteUnknown) === siteFilter)
    .filter((e) => statusFilter === "all" || e.statusKey === statusFilter)
    .sort((x, y) => STATUS_ORDER.indexOf(x.statusKey) - STATUS_ORDER.indexOf(y.statusKey) || x.clockInTimeLabel.localeCompare(y.clockInTimeLabel));
  const k = rosterDay.counts;
  void nowMs;

  // 화이트 리디자인(2026-10-13, 시안 AttRoster-PC): 날짜 제목 + 실시간 한 줄 · 근무지 · 상태 고르기 → 숫자 넷(근무 중 · 퇴근 완료 ·
  // 검토 필요 · 무효 세션) → 표(직원 · 근무지 · 출근 · 퇴근 · 휴게 · 상태 · 전화). 날짜 고르기는 근태 탭 줄의 공용 피커 그대로.
  return (
    <div className="aroster ro-w">
      <div className="toolbar ro-head">
        <b className="ro-date">{shortDate}</b>
        {isToday ? (
          <span className="ro-live">
            <i aria-hidden="true" />
            {c.rosterLiveLine.replace("{t}", liveTime.slice(0, 5))}
          </span>
        ) : (
          <span className="ro-live is-past">{c.rosterReadOnly}</span>
        )}
        <span className="toolbar__spacer" />
        {!empty ? (
          <>
            <AdmDropdown
              size="sm"
              ariaLabel={c.rosterAllSites}
              value={siteFilter}
              onChange={setSiteFilter}
              options={[{ value: "all", label: c.rosterAllSites }, ...sites.map((x) => ({ value: x, label: x }))]}
            />
            <AdmDropdown
              size="sm"
              ariaLabel={c.rosterAllStatus}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: c.rosterAllStatus },
                ...STATUS_ORDER.map((st) => ({ value: st, label: statusMeta(st, c).label })),
              ]}
            />
          </>
        ) : null}
      </div>

      {error ? <div className="privnote">{error}</div> : null}

      {empty ? (
        <div className="state">
          <span className="state__ic empty">
            <Ic>
              <Clock />
            </Ic>
          </span>
          <div className="state__t">{c.rosterNoEntries}</div>
          <div className="state__s">{c.rosterNoEntriesSub}</div>
          {!isToday ? (
            <div style={{ marginTop: 14 }}>
              <a className="btn btn--pri" href={`?date=${todayDate}`}>
                {c.rosterGoToday}
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="wkpis" style={{ marginTop: 6 }}>
            <div className="wkpi">
              <span className="wkpi__k">{c.rosterStatusWorking}</span>
              <span className="wkpi__v ro-v--now">
                {k.working + k.on_break}
                <small>{c.unitPeople}</small>
              </span>
              <span className="wkpi__d">{k.on_break > 0 ? c.rosterKpiWorkingSub.replace("{n}", String(k.on_break)) : "\u00a0"}</span>
            </div>
            <div className="wkpi">
              <span className="wkpi__k">{c.rosterStatusDone}</span>
              <span className="wkpi__v">
                {k.done}
                <small>{c.unitPeople}</small>
              </span>
            </div>
            <div className="wkpi">
              <span className="wkpi__k">{c.rosterStatusNeedsReview}</span>
              <span className={`wkpi__v${k.needs_review > 0 ? " is-danger" : ""}`}>
                {k.needs_review}
                <small>{c.unitPeople}</small>
              </span>
            </div>
            <div className="wkpi">
              <span className="wkpi__k">{c.rosterKpiVoid}</span>
              <span className="wkpi__v">
                {k.void}
                <small>{c.unitCount}</small>
              </span>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="state">
              <div className="state__s">{c.rosterFilterEmpty}</div>
            </div>
          ) : (
            <table className="qtbl ro-tbl">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 16 }}>{c.rosterColWho}</th>
                  <th>{c.rosterColSite}</th>
                  <th className="r">{c.rosterColIn}</th>
                  <th className="r">{c.rosterColOut}</th>
                  <th className="r">{c.rosterColBreak}</th>
                  <th className="r">{c.rosterColStatus}</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const meta = statusMeta(e.statusKey, c);
                  const site =
                    e.clockOutSiteName && e.clockOutSiteName !== e.siteName
                      ? `${e.siteName} → ${e.clockOutSiteName}`
                      : e.siteName || c.rosterSiteUnknown;
                  const canCall = !!meta.active && !!e.phoneNumber;
                  return (
                    <tr key={e.sessionId}>
                      <td style={{ paddingLeft: 16 }}>
                        <div className="who">
                          <span className="uhead__av" style={{ width: 32, height: 32 }}>
                            {e.avatarInitial}
                          </span>
                          <div>
                            <div className="who__nm">
                              {e.name}
                              {expiredCards.has(e.userId) ? (
                                <span className="adm-idexp" title={c.cardExpiredHint}>
                                  {c.cardExpiredChip}
                                </span>
                              ) : null}
                            </div>
                            <div className="who__sub">{e.role}</div>
                          </div>
                        </div>
                      </td>
                      <td>{site}</td>
                      <td className="r num">{e.clockInTimeLabel}</td>
                      <td className="r num">{e.clockOutTimeLabel ?? <span className="dim-cell">—</span>}</td>
                      <td className="r num">{breakCell(e, localeTag)}</td>
                      <td className="r">
                        <span className={`ro-st ro-st--${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="ro-call">
                        {canCall ? (
                          <a href={`tel:${e.phoneNumber}`} aria-label={c.rosterCallLabel} title={c.rosterCallLabel}>
                            <Phone />
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
