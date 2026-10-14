import Link from "next/link";
import "./feedback-mobile.css";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { BuildingSummary, PlaceSummary, PlatformStat } from "@/lib/external-reviews";
import { getCanonicalPropertyName } from "@/lib/room-label-normalization";

/** `riskRatio` 는 이미 퍼센트(0~100)다. 20% 이상은 빨강 — PC 콘솔과 같은 경계. */
const HOT = 20;

type Props = {
  locale: Locale;
  summaries: BuildingSummary[];
  from: string;
  to: string;
  by: "building" | "room";
};

function avg(stat: PlatformStat, digits: number): string {
  return stat.average === null || stat.reviewCount === 0 ? "—" : stat.average.toFixed(digits);
}

/**
 * 건물 · 객실별 — 모바일. 화이트 리디자인(2026-10-14, 시안 FBRooms-Phone · FB-Fold):
 * 건물별(건물 줄 + 객실 줄) / 객실별(모든 건물의 객실 한 줄) 전환. 막대는 낮은 평점 비율, % 를 누르면 그 낮은 평점 리뷰만.
 * 집계는 PC 와 같은 `summarizeReviewsByPlace` — 화면별 집계를 따로 만들지 않는다. 플랫폼 평균은 척도가 달라 합치지 않는다.
 */
export function ReviewRoomsBoard({ locale, summaries, from, to, by }: Props) {
  const t = getDictionary(locale).complaints;

  const drill = (buildingName: string, room?: string) => {
    const params = new URLSearchParams({ view: "reviews", risk: "1", from, to, building: getCanonicalPropertyName(buildingName) });
    if (room) params.set("rl", room);
    return `/mobile/complaints?${params.toString()}`;
  };
  const byHref = (value: "building" | "room") => {
    const params = new URLSearchParams({ view: "rooms", from, to });
    if (value === "room") params.set("by", "room");
    return `/mobile/complaints?${params.toString()}`;
  };
  const platformLine = (place: PlaceSummary) =>
    `Airbnb ${avg(place.airbnb, 2)} · ${t.wCountN.replace("{n}", String(place.airbnb.reviewCount))} · ${t.colRisk} ${place.airbnb.riskCount}\n` +
    `Booking ${avg(place.booking, 1)} · ${t.wCountN.replace("{n}", String(place.booking.reviewCount))} · ${t.colRisk} ${place.booking.riskCount}`;
  const roomLine = (place: PlaceSummary) =>
    `A ${avg(place.airbnb, 2)} · B ${avg(place.booking, 1)} · ${t.colRisk} ${place.riskCount}`;

  const Pct = ({ place, href, big }: { place: PlaceSummary; href: string; big?: boolean }) => {
    const ratio = place.riskRatio;
    const text = ratio === null ? "—" : `${Math.round(ratio)}%`;
    const cls = `fbw-pct num${big ? " is-big" : ""}${ratio !== null && ratio >= HOT ? " is-hot" : ""}`;
    return place.riskCount > 0 ? (
      <Link href={href} className={cls}>
        {text}
      </Link>
    ) : (
      <span className={cls}>{text}</span>
    );
  };
  const Bar = ({ place, big }: { place: PlaceSummary; big?: boolean }) => (
    <span className={`fbw-bar${big ? " is-big" : ""}`} aria-hidden="true">
      <i className={(place.riskRatio ?? 0) >= HOT ? "is-hot" : ""} style={{ width: `${Math.min(100, place.riskRatio ?? 0)}%` }} />
    </span>
  );

  if (summaries.length === 0) {
    return (
      <div className="fbw fbw-empty">
        <b>{t.roomsEmptyTitle}</b>
        <span>{t.roomsEmptyBody}</span>
      </div>
    );
  }

  const flat = summaries.flatMap((building) =>
    building.rooms.length === 0
      ? [{ key: building.key, place: building as PlaceSummary, name: building.label || building.name, sub: building.standalone ? t.standalone : "", href: drill(building.name) }]
      : building.rooms.map((room) => ({ key: `${building.key}-${room.key}`, place: room, name: room.name, sub: building.label || building.name, href: drill(building.name, room.name) })),
  );
  flat.sort((a, b) => (b.place.riskRatio ?? -1) - (a.place.riskRatio ?? -1));

  return (
    <div className="fbw fbw-rooms">
      <div className="fbw-rooms__ctl">
        <div className="fbw-seg" role="radiogroup" aria-label={t.viewRooms}>
          <Link href={byHref("building")} role="radio" aria-checked={by === "building"} className={by === "building" ? "on" : undefined} scroll={false}>
            {t.wByBuilding}
          </Link>
          <Link href={byHref("room")} role="radio" aria-checked={by === "room"} className={by === "room" ? "on" : undefined} scroll={false}>
            {t.wByRoom}
          </Link>
        </div>
        <span>{t.wRoomsNoteShort}</span>
      </div>

      {by === "room" ? (
        <div className="fbw-rows">
          {flat.map((row) => (
            <div className="fbw-room is-flat" key={row.key}>
              <span className="fbw-room__name">
                <b>{row.name}</b>
                {row.sub ? <small>{row.sub}</small> : null}
              </span>
              <Bar place={row.place} />
              <span className="fbw-room__sub num">{roomLine(row.place)}</span>
              <Pct place={row.place} href={row.href} />
            </div>
          ))}
        </div>
      ) : (
        <div className="fbw-rows">
          {summaries.map((building) => (
            <section className="fbw-bld" key={building.key}>
              <div className="fbw-bld__h">
                <span className="fbw-bld__name">
                  <b>{building.label || building.name}</b>
                  {building.standalone ? <small>{t.standalone}</small> : null}
                  {building.unmappedCount > 0 ? <small>{t.unmapped.replace("{n}", String(building.unmappedCount))}</small> : null}
                </span>
                <Pct place={building} href={drill(building.name)} big />
              </div>
              <Bar place={building} big />
              <span className="fbw-bld__sub num">{platformLine(building)}</span>
              {building.rooms.length > 0 ? (
                <div className="fbw-bld__rooms">
                  {building.rooms.map((room) => (
                    <div className="fbw-room" key={room.key}>
                      <span className="fbw-room__name">
                        <b>{room.name}</b>
                      </span>
                      <Bar place={room} />
                      <span className="fbw-room__sub num">{roomLine(room)}</span>
                      <Pct place={room} href={drill(building.name, room.name)} />
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
