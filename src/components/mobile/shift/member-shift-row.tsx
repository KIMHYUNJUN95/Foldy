import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { monthName, timeLabel } from "@/components/admin/cleaning-assign/format";
import { psKind, type PsKind } from "@/components/admin/cleaning-assign/person-shift-text";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { addDays } from "@/lib/cleaning-assign/day-state";
import { weekOf, type PersonShift } from "@/lib/cleaning-assign/person-shift";
import "@/components/admin/cleaning-assign/person-shift.css";

/**
 * 사용자 상세(모바일)의 「시프트」 줄 — 이달 신청 · 배정 일수 · 다음 근무 · 이번 주 7칸(달력과 같은 모양). 누르면 그 사람 시프트 달력.
 * 배정 권한(`cleaning.assign`)이 있고 그 사람이 현장 인원일 때만 그린다. 시안 72AoNd… ④ · docs/product/37 「4-6」
 */
export function MemberShiftRow({ data, copy, today, href, locale }: { data: PersonShift; copy: CleaningAssignCopy; today: string; href: string; locale: string }) {
  const weekNames = copy.weekdaysShort.split(",");
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const next = data.details.find((d) => d.date >= today && d.rooms.length > 0);
  const rel = next ? (next.date === today ? copy.today : next.date === addDays(today, 1) ? copy.tomorrow : `${Number(next.date.slice(5, 7))}/${Number(next.date.slice(8))}`) : "";
  const title = fill(copy.psRowTitle, { a: data.summary.applied, b: data.summary.assigned, mon: monthName(data.ym, locale) });
  return (
    <section className="psr" aria-label={copy.psSection}>
      <span className="psr-cap">{copy.psSection}</span>
      <Link className="psr-link" href={href} aria-label={`${title} — ${fill(copy.psOpen, { name: data.person.name })}`}>
        <span className="psr-top">
          <span className="psr-text">
            <b>{title}</b>
            <span>{next ? fill(copy.psRowNext, { n: next.rooms.length, rel, time: timeLabel(next.startMinutes) }) : copy.psRowNoNext}</span>
          </span>
          <ChevronRight className="psr-chev" aria-hidden="true" />
        </span>
        <span className="psr-week" aria-hidden="true">
          {weekOf(today).map((date, i) => {
            const day = byDate.get(date);
            const kind: PsKind = day ? psKind(day) : date < today ? "past" : "free";
            return (
              <span key={date} className="psr-d">
                <small>{date === today ? copy.today : weekNames[i]}</small>
                <i className={`is-${kind}${date === today ? " is-today" : ""}${date < today ? " is-before" : ""}`}>{Number(date.slice(8))}</i>
              </span>
            );
          })}
        </span>
      </Link>
    </section>
  );
}
