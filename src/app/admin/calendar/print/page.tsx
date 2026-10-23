import type { CSSProperties } from "react";
import { AdminCalendarPrintActions } from "@/components/admin/calendar/admin-calendar-print-actions";
import {
  buildMonthLabel,
  getAdminCalendarDashboardData,
} from "@/lib/admin-calendar-dashboard";
import { requireAdminSession } from "@/lib/admin-session";
import { getDictionary } from "@/lib/i18n";
import { localizePropertyName, localizeRoomPlaceLabel } from "@/lib/room-label-normalization";

type PageProps = {
  searchParams: Promise<{
    month?: string;
    property?: string;
  }>;
};

const PRINT_CHANNEL_STYLE = {
  airbnb: {
    accent: "#f05273",
    background: "#fff1f4",
  },
  booking: {
    accent: "#4168b0",
    background: "#edf3ff",
  },
  manual: {
    accent: "#68768a",
    background: "#f1f4f8",
  },
} as const;

function dayOfWeek(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function weekdayLabel(date: string, locale: "ko" | "ja" | "en") {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${date}T00:00:00Z`));
}

function diffDays(start: string, end: string) {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  return Math.max(0, Math.round((endTime - startTime) / 86_400_000));
}

export default async function AdminCalendarPrintPage({ searchParams }: PageProps) {
  const [session, params] = await Promise.all([requireAdminSession(), searchParams]);
  const data = await getAdminCalendarDashboardData(session, params);
  const dictionary = getDictionary(data.locale);
  const copy = dictionary.admin.calendar;
  const buildingLabels = dictionary.cleaning.buildingLabels;
  const rangeStart = `${data.selectedMonth}-01`;
  const rangeEndExclusive = `${data.nextMonth}-01`;
  const backHref = `/admin/calendar?${new URLSearchParams({
    month: data.selectedMonth,
    ...(data.selectedProperty ? { property: data.selectedProperty } : {}),
  }).toString()}`;

  const groups = data.propertyOptions
    .filter((propertyName) => (data.selectedProperty ? propertyName === data.selectedProperty : true))
    .map((propertyName) => ({
      propertyName,
      reservations: data.reservations.filter((reservation) => reservation.propertyName === propertyName),
      rows: data.roomRows.filter((row) => row.propertyName === propertyName),
    }))
    .filter((group) => group.rows.length > 0);

  return (
    <main className="admcal-print">
      <style>{`
        @page {
          size: A4 landscape;
          margin: 10mm;
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background: #f4efe7;
          color: #1f2937;
          font-family: "Pretendard", "Noto Sans KR", "Segoe UI", sans-serif;
        }

        .admcal-print {
          min-height: 100vh;
          padding: 24px;
        }

        .admcal-print__toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          max-width: 1200px;
          margin: 0 auto 20px;
          padding: 14px 18px;
          border: 1px solid #ded4c7;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.9);
          box-shadow: 0 18px 34px -30px rgba(31, 41, 55, 0.35);
        }

        .admcal-print__ghost,
        .admcal-print__primary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 132px;
          height: 40px;
          padding: 0 16px;
          border-radius: 999px;
          border: 1px solid #d9cfbf;
          font-size: 13px;
          font-weight: 800;
          text-decoration: none;
          white-space: nowrap;
          cursor: pointer;
        }

        .admcal-print__ghost {
          background: #fff;
          color: #475569;
        }

        .admcal-print__primary {
          background: #304b8f;
          border-color: #304b8f;
          color: #fff;
        }

        .admcal-print__hint {
          flex: 1;
          margin: 0;
          color: #6b7280;
          font-size: 12px;
          font-weight: 600;
          text-align: center;
        }

        .admcal-print__sheet {
          width: 277mm;
          min-height: 190mm;
          margin: 0 auto 18px;
          padding: 10mm 10mm 9mm;
          border: 1px solid #dfd3c3;
          border-radius: 16px;
          background: #fffdfa;
          box-shadow: 0 24px 48px -40px rgba(31, 41, 55, 0.28);
          break-after: page;
        }

        .admcal-print__sheet:last-child {
          break-after: auto;
        }

        .admcal-print__header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 10px;
        }

        .admcal-print__eyebrow {
          color: #7b8799;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .admcal-print__title {
          margin: 6px 0 0;
          font-size: 24px;
          font-weight: 900;
          letter-spacing: -0.03em;
        }

        .admcal-print__subtitle {
          margin: 4px 0 0;
          color: #5b6473;
          font-size: 13px;
          font-weight: 700;
        }

        .admcal-print__meta {
          color: #6b7280;
          font-size: 12px;
          font-weight: 700;
          text-align: right;
        }

        .admcal-print__grid {
          --label-width: 34mm;
          /* Fit the label column + all day columns inside the A4 sheet content
             width (~257mm; 256mm leaves ~1mm slack for the grid border) so 30/31-day
             months no longer overflow and clip the right-side dates. */
          --day-width: calc((256mm - var(--label-width)) / ${data.dates.length});
          border: 1px solid #ded7cc;
          border-radius: 12px;
          overflow: hidden;
        }

        .admcal-print__head,
        .admcal-print__row {
          display: grid;
          grid-template-columns: var(--label-width) repeat(${data.dates.length}, var(--day-width));
        }

        .admcal-print__head {
          background: #f4efe7;
        }

        .admcal-print__corner,
        .admcal-print__room {
          padding: 5px 8px;
          border-right: 1px solid #ded7cc;
          border-bottom: 1px solid #ded7cc;
        }

        .admcal-print__corner {
          color: #7b8799;
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .admcal-print__room {
          display: flex;
          align-items: center;
          background: #fffdfa;
          font-size: 12px;
          font-weight: 800;
        }

        .admcal-print__day {
          padding: 4px 0 5px;
          border-right: 1px solid #e7e0d7;
          border-bottom: 1px solid #ded7cc;
          text-align: center;
        }

        .admcal-print__day:last-child,
        .admcal-print__cell:last-child {
          border-right: 0;
        }

        .admcal-print__day-week {
          display: block;
          font-size: 8px;
          font-weight: 800;
        }

        .admcal-print__day-number {
          display: block;
          margin-top: 1px;
          font-size: 10px;
          font-weight: 900;
        }

        .admcal-print__day.is-sun {
          color: #dc4b4b;
        }

        .admcal-print__day.is-sat {
          color: #315fb5;
        }

        .admcal-print__track {
          position: relative;
          grid-column: 2 / -1;
          display: grid;
          grid-template-columns: repeat(${data.dates.length}, var(--day-width));
          min-height: 8.4mm;
          background: #fff;
        }

        .admcal-print__cell {
          border-right: 1px solid #f0e8dd;
          border-bottom: 1px solid #efe7dc;
        }

        .admcal-print__cell.is-sun {
          background: #fff7f7;
        }

        .admcal-print__cell.is-sat {
          background: #f8fbff;
        }

        .admcal-print__cell.is-today {
          background: #fff2cf;
        }

        .admcal-print__bar {
          position: absolute;
          top: 1.1mm;
          height: 6.2mm;
          padding: 0 1.6mm;
          border-radius: 6px;
          border: 1px solid var(--bar-accent);
          border-left-width: 2px;
          background: var(--bar-bg);
          color: var(--bar-accent);
          font-size: 8.5px;
          font-weight: 800;
          line-height: 6mm;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .admcal-print__empty {
          padding: 24px;
          border: 1px dashed #d9cfbf;
          border-radius: 14px;
          background: #fff;
          color: #6b7280;
          font-size: 13px;
          font-weight: 700;
          text-align: center;
        }

        @media print {
          body {
            background: #fff;
          }

          .admcal-print {
            padding: 0;
          }

          .admcal-print__toolbar {
            display: none;
          }

          .admcal-print__sheet {
            margin: 0;
            border: 0;
            border-radius: 0;
            box-shadow: none;
          }
        }
      `}</style>

      <AdminCalendarPrintActions
        backHref={backHref}
        backLabel={copy.backToCalendar}
        hint={copy.printHint}
        printLabel={copy.printAction}
      />

      {data.isOutOfWindow ? (
        <section className="admcal-print__sheet">
          <div className="admcal-print__header">
            <div>
              <div className="admcal-print__eyebrow">Foldy</div>
              <h1 className="admcal-print__title">{buildMonthLabel(data.selectedMonth, data.locale)}</h1>
              <p className="admcal-print__subtitle">{copy.outOfWindowTitle}</p>
            </div>
          </div>
          <div className="admcal-print__empty">{copy.outOfWindowBody}</div>
        </section>
      ) : groups.length === 0 ? (
        <section className="admcal-print__sheet">
          <div className="admcal-print__header">
            <div>
              <div className="admcal-print__eyebrow">Foldy</div>
              <h1 className="admcal-print__title">{buildMonthLabel(data.selectedMonth, data.locale)}</h1>
              <p className="admcal-print__subtitle">{copy.emptyTitle}</p>
            </div>
          </div>
          <div className="admcal-print__empty">{copy.emptyBodyNoReservations}</div>
        </section>
      ) : (
        groups.map((group) => (
          <section className="admcal-print__sheet" key={group.propertyName}>
            <div className="admcal-print__header">
              <div>
                <div className="admcal-print__eyebrow">{copy.printEyebrow}</div>
                <h1 className="admcal-print__title">{buildMonthLabel(data.selectedMonth, data.locale)}</h1>
                <p className="admcal-print__subtitle">
                  {localizePropertyName(group.propertyName, buildingLabels)}
                </p>
              </div>
              <div className="admcal-print__meta">
                {copy.exportA4}
                <br />
                {group.rows.length} {copy.room}
              </div>
            </div>

            <div className="admcal-print__grid">
              <div className="admcal-print__head">
                <div className="admcal-print__corner">{copy.room}</div>
                {data.dates.map((date) => {
                  const dow = dayOfWeek(date);
                  return (
                    <div
                      className={[
                        "admcal-print__day",
                        dow === 0 ? "is-sun" : "",
                        dow === 6 ? "is-sat" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={date}
                    >
                      <span className="admcal-print__day-week">{weekdayLabel(date, data.locale)}</span>
                      <span className="admcal-print__day-number">{date.slice(8)}</span>
                    </div>
                  );
                })}
              </div>

              {group.rows.map((row) => {
                const roomReservations = group.reservations.filter(
                  (reservation) =>
                    reservation.roomKey === row.key &&
                    reservation.checkInDate < rangeEndExclusive &&
                    reservation.checkOutDate > rangeStart,
                );

                return (
                  <div className="admcal-print__row" key={row.key}>
                    <div className="admcal-print__room">{localizeRoomPlaceLabel(row.displayRoomLabel, buildingLabels)}</div>
                    <div className="admcal-print__track">
                      {data.dates.map((date) => {
                        const dow = dayOfWeek(date);
                        return (
                          <div
                            className={[
                              "admcal-print__cell",
                              dow === 0 ? "is-sun" : "",
                              dow === 6 ? "is-sat" : "",
                              date === data.today ? "is-today" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            key={`${row.key}-${date}`}
                          />
                        );
                      })}

                      {roomReservations.map((reservation) => {
                        const visibleStart =
                          reservation.checkInDate < rangeStart ? rangeStart : reservation.checkInDate;
                        const visibleEnd =
                          reservation.checkOutDate > rangeEndExclusive
                            ? rangeEndExclusive
                            : reservation.checkOutDate;
                        const startUnit = diffDays(rangeStart, visibleStart);
                        const span = Math.max(1, diffDays(visibleStart, visibleEnd));
                        const style = PRINT_CHANNEL_STYLE[reservation.channel];
                        return (
                          <div
                            className="admcal-print__bar"
                            key={reservation.id}
                            style={
                              {
                                "--bar-accent": style.accent,
                                "--bar-bg": style.background,
                                left: `calc(${startUnit} * var(--day-width) + 1.2mm)`,
                                width: `calc(${span} * var(--day-width) - 2.4mm)`,
                              } as CSSProperties
                            }
                            title={`${reservation.guestName} · ${reservation.checkInDate} - ${reservation.checkOutDate}`}
                          >
                            {reservation.guestName}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
