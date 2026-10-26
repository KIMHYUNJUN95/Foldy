"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { resolveCancelRequest, toggleApplicationForUser } from "@/actions/cleaning-assign-shift";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { dayLabel, monthTitle } from "@/components/admin/cleaning-assign/format";
import { PersonShiftCalendar, PersonShiftDay, PersonShiftStats, PersonShiftUpcoming, psPersonLine } from "@/components/admin/cleaning-assign/person-shift-parts";
import type { PsAction } from "@/components/admin/cleaning-assign/person-shift-text";
import { useBuildingName } from "@/components/shared/building-names";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useIsTablet } from "@/components/shell/split-list";
import type { CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { PersonShift } from "@/lib/cleaning-assign/person-shift";
import { haptic } from "@/lib/haptics";
import { phoneHref } from "@/lib/phone-format";
import "./shift.css";

/**
 * 사람별 시프트 달력 — 모바일(관리자, 사용자 상세 → 「시프트」, 시안 72AoNd… ⑤~⑧, 2026-10-23). PC 패널과 같은 조각(`person-shift-parts`).
 * 폰 = 날짜를 누르면 공용 바텀 시트 · 폴드 = 달력 아래에 그날 · 태블릿 가로 = 오른쪽 옅은 회색 칸.
 * docs/product/37-cleaning-shift-assignment.md 「4-6」
 */

const FOLD_QUERY = "(min-width: 600px)";
function subscribeFold(listener: () => void) {
  const query = window.matchMedia(FOLD_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
function useIsFold(): boolean {
  return useSyncExternalStore(subscribeFold, () => window.matchMedia(FOLD_QUERY).matches, () => false);
}

export function PersonShiftView({
  data,
  copy,
  locale,
  today,
  basePath,
  cardExpired = false,
}: {
  data: PersonShift;
  copy: CleaningAssignCopy;
  locale: string;
  today: string;
  basePath: string;
  /** 재류카드 만료 — 이름 아래 빨간 칩(막지 않음, docs/product/41 「만료 표시」). */
  cardExpired?: boolean;
}) {
  const router = useRouter();
  const isTablet = useIsTablet();
  const isFold = useIsFold();
  const building = useBuildingName();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const person = data.person;
  // 태블릿은 오른쪽 칸이 늘 하나를 보여 준다 — 처음은 오늘부터 첫 일정, 없으면 오늘(이번 달일 때).
  const fallback = data.details.find((d) => d.date >= today)?.date ?? (data.days.some((d) => d.date === today) ? today : data.days[0].date);
  const paneDate = selected ?? fallback;

  function pick(date: string) {
    if (isTablet) {
      setSelected(date);
      return;
    }
    if (isFold) {
      setSelected(selected === date ? null : date);
      return;
    }
    setSelected(date);
    setSheet(true);
  }

  function act(action: PsAction, date: string) {
    startTransition(async () => {
      const result =
        action === "accept" || action === "reject"
          ? await resolveCancelRequest({ accept: action === "accept", date, userId: person.userId })
          : await toggleApplicationForUser({ date, userId: person.userId });
      if (result.ok) {
        haptic("success");
        setMessage(null);
        setSheet(false);
      } else {
        haptic("error");
        setMessage(result.reason === "conflict" ? copy.errAssigned : copy.failed);
      }
      router.refresh();
    });
  }

  const call = person.phone ? (
    <a className="psc-btn" href={phoneHref(person.phone)}>
      {copy.psCall}
    </a>
  ) : null;
  const day = (date: string) => (
    <PersonShiftDay data={data} date={date} copy={copy} locale={locale} today={today} label={building} pc={false} pending={pending} onAction={act} extra={call} />
  );

  return (
    <div className="shf psv">
      <div className="shf-main">
        <div className="psv-head">
          <span className="psv-av" aria-hidden="true">
            {person.name.slice(0, 1)}
          </span>
          <span className="psv-name">
            <h1>{person.name}</h1>
            <span>{psPersonLine(person, copy)}</span>
            {cardExpired ? (
              <span className="psv-idexp" title={copy.cardExpiredHint}>
                {copy.cardExpired}
              </span>
            ) : null}
          </span>
        </div>
        <PersonShiftStats summary={data.summary} copy={copy} />
        <section className="shf-calbox" aria-label={monthTitle(data.ym, locale)}>
          <div className="shf-nav">
            <span className="shf-month">{monthTitle(data.ym, locale)}</span>
            <span className="shf-sp" />
            <Link className="shf-icon" aria-label={copy.prevMonth} href={`${basePath}?ym=${shiftMonthKey(data.ym, -1)}`}>
              <ChevronLeft aria-hidden="true" />
            </Link>
            <Link className="shf-icon is-last" aria-label={copy.nextMonth} href={`${basePath}?ym=${shiftMonthKey(data.ym, 1)}`}>
              <ChevronRight aria-hidden="true" />
            </Link>
          </div>
          <PersonShiftCalendar data={data} copy={copy} locale={locale} today={today} selected={isTablet ? paneDate : isFold ? selected : null} onPick={pick} />
        </section>
        {message ? (
          <p className="shf-msg" role="status" onClick={() => setMessage(null)}>
            {message}
          </p>
        ) : null}
        {!isTablet ? isFold && selected ? day(selected) : <PersonShiftUpcoming data={data} copy={copy} locale={locale} today={today} label={building} limit={4} onPick={pick} /> : null}
        <p className="shf-hint">{copy.psLegend}</p>
      </div>

      {isTablet ? (
        <aside className="shf-pane psv-pane" aria-label={copy.psSection}>
          {day(paneDate)}
        </aside>
      ) : null}

      {sheet && selected && !isTablet && !isFold ? (
        <BottomSheet onClose={() => setSheet(false)} ariaLabel={dayLabel(selected, locale)}>
          <div className="shf-sheet psv-sheet">{day(selected)}</div>
        </BottomSheet>
      ) : null}
    </div>
  );
}
