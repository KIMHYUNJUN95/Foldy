"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { applyMonthSuggestions, previewMonthSuggestions, toggleApplicationForUser } from "@/app/admin/cleaning-assign/actions";
import { AdminMonthPicker } from "@/components/admin/shared/admin-month-picker";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import type { Dictionary } from "@/lib/i18n";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { MonthBoard } from "@/lib/cleaning-assign/data";
import { haptic } from "@/lib/haptics";
import { AssignPersonPanel } from "./assign-person-panel";
import { monthName, shortDate, weekdayShort } from "./format";
import "./cleaning-assign.css";

/**
 * 청소 배정 — 월 보기(PC). 시안 「④ 배정 월 보기」. 날짜 × 사람 표: 점 = 신청만 · 옅은 보라 숫자 = 배정(방 수) · 보라 테두리 = 제안(반영 전).
 * 위 세 줄 = 청소 방(예약 기준) · 신청 · 미배정 방. 「N월 자동 제안」 → 미리 보기 → 반영(미배정 방만 채움 — 이미 배정된 방은 그대로).
 * 칸을 누르면 신청 넣기/빼기(배정 있는 칸은 하루 보기에서), 날짜를 누르면 그날 하루 보기.
 * 이름을 누르면 오른쪽에 그 사람 시프트 달력(`AssignPersonPanel`, 2026-10-23 · 「4-6」) — 그 줄 · 고른 날 열이 옅은 보라.
 * docs/product/37-cleaning-shift-assignment.md 「4-2」
 */

type Shared = Dictionary["admin"]["shared"];

type Preview = { proposals: Map<string, number>; fill: number; open: number; shortDays: string[] };

export function AssignMonthBoard({
  board,
  copy,
  locale,
  today,
  shared,
  canCompare,
  buildingLabels,
  expiredCardUserIds = [],
}: {
  board: MonthBoard;
  copy: CleaningAssignCopy;
  locale: string;
  today: string;
  shared: Shared;
  canCompare: boolean;
  buildingLabels: Record<string, string>;
  /** 재류카드가 만료된 사람 — 이름 옆 빨간 칩(막지 않음, docs/product/41 「만료 표시」). */
  expiredCardUserIds?: string[];
}) {
  const expiredCards = new Set(expiredCardUserIds);
  const router = useRouter();
  const { toast, showToast, dismiss } = useAdminToast();
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [limit, setLimit] = useState(30);
  const [personId, setPersonId] = useState<string | null>(null);
  const [panelDate, setPanelDate] = useState<string | null>(null);
  const mon = monthName(board.ym, locale);
  const people = board.people;

  const closePanel = useCallback(() => {
    setPersonId(null);
    setPanelDate(null);
  }, []);
  const stepPerson = useCallback(
    (dir: -1 | 1) => {
      const visible = people.slice(0, limit);
      if (visible.length === 0) return;
      const index = visible.findIndex((p) => p.userId === personId);
      setPersonId(visible[(index + dir + visible.length) % visible.length].userId);
      setPanelDate(null);
    },
    [people, limit, personId],
  );

  const columns = useMemo(() => `168px repeat(${board.days.length}, minmax(0, 1fr))`, [board.days.length]);

  function runPreview() {
    startTransition(async () => {
      const result = await previewMonthSuggestions({ ym: board.ym });
      if (!result.ok) {
        showToast(copy.failed);
        return;
      }
      const proposals = new Map<string, number>();
      for (const p of result.proposals) proposals.set(`${p.userId}|${p.workDate}`, (proposals.get(`${p.userId}|${p.workDate}`) ?? 0) + 1);
      setPreview({ fill: result.proposals.length, open: result.openTotal, proposals, shortDays: result.shortDays });
    });
  }

  function apply() {
    startTransition(async () => {
      const result = await applyMonthSuggestions({ ym: board.ym });
      if (result.ok) {
        haptic("success");
        showToast(fill(copy.added, { n: result.added }));
        setPreview(null);
      } else {
        haptic("error");
        showToast(copy.failed);
      }
      router.refresh();
    });
  }

  function toggleCell(userId: string, date: string) {
    startTransition(async () => {
      const result = await toggleApplicationForUser({ date, userId });
      if (!result.ok) showToast(result.reason === "conflict" ? copy.errAssigned : copy.failed);
      router.refresh();
    });
  }

  return (
    <div className={`cas${personId ? " has-panel" : ""}`}>
      <div className="cas-bar">
        <div className="cas-seg" role="tablist" aria-label={copy.title}>
          <Link role="tab" aria-selected="false" href={`/admin/cleaning-assign?date=${board.ym === today.slice(0, 7) ? today : `${board.ym}-01`}`}>
            {copy.viewDay}
          </Link>
          <span role="tab" aria-selected="true" className="on">
            {copy.viewMonth}
          </span>
        </div>
        <AdminMonthPicker
          ym={board.ym}
          localeTag={locale}
          basePath="/admin/cleaning-assign"
          preserveQueryKeys={["view"]}
          labels={{
            nextMonth: shared.dateNextMonth,
            nextYear: shared.dateNextYear,
            open: shared.dateSelect,
            prevMonth: shared.datePrevMonth,
            prevYear: shared.datePrevYear,
            thisMonth: shared.dateThisMonth,
          }}
        />
        <span className="cas-hintline">{copy.monthNoDeadline}</span>
        <span className="cas-sp" />
        <Link className="cas-btn is-ghost" href="/admin/cleaning-assign/settings">
          {copy.settingsLink}
        </Link>
        {canCompare ? (
          <Link className="cas-btn is-ghost" href={`/admin/cleaning-assign/compare?ym=${board.ym}`}>
            {copy.compareLink}
          </Link>
        ) : null}
        <button type="button" className="cas-btn is-pri" disabled={pending} onClick={runPreview}>
          {fill(copy.monthSuggest, { m: Number(board.ym.slice(5)), mon })}
        </button>
      </div>

      {preview ? (
        <div className="cas-preview" role="status">
          <b>{copy.previewTitle}</b>
          <span>{fill(copy.previewBody, { fill: preview.fill, open: preview.open })}</span>
          {preview.shortDays.length > 0 ? (
            <span className="is-danger">{fill(copy.previewShort, { days: preview.shortDays.slice(0, 6).map(shortDate).join(" · "), n: preview.shortDays.length })}</span>
          ) : null}
          <span className="cas-sp" />
          <button type="button" className="cas-btn is-ghost" onClick={() => setPreview(null)}>
            {copy.cancel}
          </button>
          <button type="button" className="cas-btn is-pri" disabled={pending || preview.fill === 0} onClick={apply}>
            {fill(copy.previewApply, { n: preview.fill })}
          </button>
        </div>
      ) : null}

      <div className="cas-legend">
        <span>
          <i className="cas-dot" />
          {copy.legendApplied}
        </span>
        <span>
          <i className="cas-cellmark is-on">2</i>
          {copy.legendAssigned}
        </span>
        <span>
          <i className="cas-cellmark is-sug">1</i>
          {copy.legendSuggested}
        </span>
        <span>{copy.legendHint}</span>
      </div>

      <div className="cas-month" role="grid" aria-label={copy.viewMonth}>
        <div className="cas-mrow is-head" role="row" style={{ gridTemplateColumns: columns }}>
          <span />
          {board.days.map((date) => {
            const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
            return (
              <Link key={date} role="columnheader" href={`/admin/cleaning-assign?date=${date}`} className={`cas-mday${wd === 0 || wd === 6 ? " is-weekend" : ""}${date === today ? " is-today" : ""}${date === panelDate ? " is-picked" : ""}`}>
                <small>{weekdayShort(date, locale)}</small>
                <b>{Number(date.slice(8))}</b>
              </Link>
            );
          })}
        </div>
        {(
          [
            [copy.sumRooms, (i: number) => board.totals[i].rooms, false],
            [copy.sumApplied, (i: number) => board.totals[i].applied, true],
            [copy.sumOpen, (i: number) => board.totals[i].open, true],
          ] as const
        ).map(([text, value, warnable], rowIndex) => (
          <div key={text} className="cas-mrow is-sum" role="row" style={{ gridTemplateColumns: columns }}>
            <span className="cas-mlabel">{text}</span>
            {board.days.map((date, i) => {
              const v = value(i);
              // 지난 날은 경고하지 않는다 — 이미 끝난 날의 「미배정」은 기록일 뿐 할 일이 아니다.
              const past = date < today;
              const short = !past && rowIndex === 1 && board.totals[i].applied === 0 && board.totals[i].rooms > 0;
              const open = !past && rowIndex === 2 && v > 0 && !(preview && !preview.shortDays.includes(date));
              return (
                <span key={date} className={`cas-msum${(warnable && (short || open)) ? " is-warn" : ""}${v === 0 ? " is-zero" : ""}${past ? " is-past" : ""}`}>
                  {rowIndex === 2 && preview && !preview.shortDays.includes(date) ? 0 : v}
                </span>
              );
            })}
          </div>
        ))}
        {people.slice(0, limit).map((person) => (
          <div key={person.userId} className={`cas-mrow${person.userId === personId ? " is-picked" : ""}`} role="row" style={{ gridTemplateColumns: columns }}>
            <span className="cas-mname">
              <button
                type="button"
                className="cas-mname__open"
                aria-label={fill(copy.psOpen, { name: person.name })}
                aria-pressed={person.userId === personId}
                onClick={() => {
                  setPersonId(person.userId === personId ? null : person.userId);
                  setPanelDate(null);
                }}
              >
                {person.name}
              </button>
              {expiredCards.has(person.userId) ? (
                <small className="cas-idexp" title={`${copy.cardExpired} — ${copy.cardExpiredHint}`}>
                  {copy.cardExpiredShort}
                </small>
              ) : null}
              {person.tag === "fixed" && person.fixedTier ? <small>{fill(copy.tierBadge, { n: person.fixedTier })}</small> : null}
              {person.tag === "priority" ? <small>{copy.prio}</small> : null}
              {person.tag === "trainee" ? <small>{copy.colTrainee}</small> : null}
              <span className="cas-sp" />
              {person.total > 0 ? <em>{fill(copy.monthTotal, { n: person.total })}</em> : null}
            </span>
            {person.cells.map((cell, i) => {
              const date = board.days[i];
              const sug = preview?.proposals.get(`${person.userId}|${date}`) ?? 0;
              const past = date < today;
              const content =
                cell.rooms > 0 ? (
                  <i className="cas-cellmark is-on">{cell.rooms}</i>
                ) : sug > 0 ? (
                  <i className="cas-cellmark is-sug">{sug}</i>
                ) : cell.applied && !cell.cancelled ? (
                  <i className="cas-dot" />
                ) : null;
              return (
                <button
                  key={date}
                  type="button"
                  role="gridcell"
                  className={`cas-mcell${date === panelDate ? " is-picked" : ""}`}
                  disabled={pending || past || cell.rooms > 0}
                  aria-label={`${person.name} ${shortDate(date)}`}
                  onClick={() => toggleCell(person.userId, date)}
                >
                  {content}
                </button>
              );
            })}
          </div>
        ))}
        {people.length > limit ? (
          <button type="button" className="cas-more" onClick={() => setLimit(limit + 30)}>
            {fill(copy.more, { n: people.length - limit })}
          </button>
        ) : null}
      </div>
      {personId ? (
        <AssignPersonPanel
          key={personId}
          userId={personId}
          ym={board.ym}
          today={today}
          copy={copy}
          locale={locale}
          buildingLabels={buildingLabels}
          refreshKey={board}
          onClose={closePanel}
          onStep={stepPerson}
          onDate={setPanelDate}
          onMessage={showToast}
        />
      ) : null}
      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}
