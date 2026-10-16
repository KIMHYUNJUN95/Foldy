"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { BuildingMapCopy, MapBadge, MapBuilding, MapPulse } from "@/components/calendar/building-map/building-map";
import type { DashboardBuildingMap as MapData, DashBuilding, DashFeedItem } from "@/lib/admin-building-map";
import type { Dictionary } from "@/lib/i18n";
import { getPropertyLocation } from "@/lib/property-locations";
import "./dashboard-building-map.css";

// 지도(신주쿠구 경계 데이터 포함)는 카드가 그려질 때 따로 받는다 — 홈의 다른 칸은 먼저 뜬다.
const BuildingMap = dynamic(() => import("@/components/calendar/building-map/building-map").then((m) => m.BuildingMap), { ssr: false });

type ConsoleCopy = Dictionary["admin"]["console"];
type MapKey = Extract<keyof ConsoleCopy, `dhMap${string}`> | "dhRealtime" | "dhCleaningLink";
/** 이 카드가 쓰는 문구만(콘솔 사전엔 함수 값이 있어 통째로 클라이언트에 못 넘긴다). */
export type MapCardCopy = Pick<ConsoleCopy, MapKey>;
type Console = MapCardCopy;
type Filter = "status" | "cleaning" | "inout";

const PANEL_W = 344;
const PANEL_GAP = 18;
/** 왼쪽 위 제목 · 필터 자리 — 이름표가 피한다. */
const HEAD_BOX: [number, number, number, number] = [0, 0, 470, 150];
/** 화면 자리 보정(px) — STAY ARI 를 오쿠보 집들 위로(2026-10-16 사용자 「스테이아리가 더 위쪽이어야 함」, 시안 배치). */
const NUDGE: Record<string, [number, number]> = { "STAY ARI Apartment Hotel": [-10, -56] };

/**
 * 대시보드 홈 「오늘의 건물」(2026-10-16, 시안 Motion-D-MapDash-PC).
 *
 * 예약 캘린더와 같은 모형 지도(`BuildingMap`)에 건물마다 오늘 상태를 이름표로 단다(필터: 오늘 상태 · 청소 · 체크인 · 아웃).
 * 오른쪽 유리 패널은 평소 「지금 일어나는 일」(오늘 청소 시작 · 완료 · 새 예약), 건물을 누르면 그 건물 상세(체크인 · 체크아웃 ·
 * 빈 방 · 객실 칸 · 청소 진행 · 오늘 일정 · 달력 보기)로 바뀐다. 화면이 새 데이터를 받으면(예약 웹훅 신호 · 다시 열기) 늘어난
 * 것만 그 건물 자리에서 한 번 움직인다 — 청소가 끝나면 초록 물결, 체크인 · 새 예약이 늘면 보라 빛기둥. 처음 그릴 땐 안 움직인다.
 * 문서: docs/product/05-admin-web-ia.md → 「오늘의 건물」.
 */
export function DashboardBuildingMap({ data, c, mapCopy, locale }: { data: MapData; c: Console; mapCopy: BuildingMapCopy; locale: string }) {
  const [filter, setFilter] = useState<Filter>("status");
  // 홈 아래쪽 카드라 열자마자 그리면 처음 장면이 안 보는 사이에 끝난다(2026-10-16 사용자 「모션이 너무 빠름」) —
  // 카드가 화면에 들어올 때 지도 · 제목 · 패널을 마운트하고, 그때마다 긴 장면(경계선 → 판이 눕고 → 건물이 솟음)을 보여 준다.
  const rootRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [motion, setMotion] = useState<"full" | "none">("full");
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMotion("none");
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        io.disconnect();
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [selected, setSelectedRaw] = useState<string | null>(null);
  // 처음 소식 줄은 지도 장면 뒤에 차례로, 건물 상세 ↔ 소식을 오갈 땐 바로.
  const [swapped, setSwapped] = useState(false);
  const setSelected = (id: string | null) => {
    setSwapped(true);
    setSelectedRaw(id);
  };

  const byProperty = useMemo(() => new Map(data.buildings.map((b) => [b.property, b])), [data.buildings]);
  const mapBuildings = useMemo<MapBuilding[]>(
    () =>
      data.buildings.flatMap((b) => {
        const loc = getPropertyLocation(b.property);
        return loc
          ? [{ id: b.property, label: loc.mapLabel ?? b.label, rooms: b.rooms.length, empty: b.empty, lat: loc.lat, lng: loc.lng, floors: loc.floors, size: loc.size ?? [1, 1], area: loc.area, adjoin: loc.adjoin }]
          : [];
      }),
    [data.buildings],
  );
  const shortName = (property: string) => getPropertyLocation(property)?.mapLabel ?? byProperty.get(property)?.label ?? property;

  // ── 늘어난 것만 한 번 움직인다(처음 그릴 땐 안 움직임). 이전 값과 비교는 렌더 중에(React 권장: 바뀐 props 로 상태 고치기).
  const [prev, setPrev] = useState(data);
  const [pulses, setPulses] = useState<Record<string, MapPulse>>({});
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  if (prev !== data) {
    const before = new Map(prev.buildings.map((b) => [b.property, b]));
    const next = { ...pulses };
    for (const b of data.buildings) {
      const old = before.get(b.property);
      if (!old) continue;
      const n = (next[b.property]?.n ?? 0) + 1;
      if (b.cleanDone > old.cleanDone) next[b.property] = { kind: "clean", n };
      else if (b.checkIns > old.checkIns) next[b.property] = { kind: "in", n };
    }
    const seen = new Set(prev.feed.map((f) => f.id));
    for (const f of data.feed) {
      if (f.kind === "booking" && !seen.has(f.id) && next[f.property]?.kind !== "clean") {
        next[f.property] = { kind: "in", n: (next[f.property]?.n ?? 0) + 1 };
      }
    }
    setPrev(data);
    setPulses(next);
    setFresh(new Set(data.feed.filter((f) => !seen.has(f.id)).map((f) => f.id)));
  }

  const badges = useMemo(() => {
    const out: Record<string, MapBadge | null> = {};
    for (const b of data.buildings) out[b.property] = badgeFor(b, filter, c, mapCopy);
    return out;
  }, [data.buildings, filter, c, mapCopy]);

  const totalRooms = data.buildings.reduce((a, b) => a + b.rooms.length, 0);
  const totalEmpty = data.buildings.reduce((a, b) => a + b.empty, 0);
  const [sumA, sumB] = c.dhMapSummary.replace("{n}", String(data.buildings.length)).replace("{rooms}", String(totalRooms)).split("{empty}");
  const sel = selected ? byProperty.get(selected) ?? null : null;

  // 지금 시각 — 소식의 「방금」 판단용. 서버 그림과 어긋나지 않게 칠한 뒤 · 데이터가 바뀔 때만 잡는다.
  const [nowAt, setNowAt] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowAt(Date.now());
  }, [data]);

  return (
    <div className="dhm" ref={rootRef}>
      {shown ? (
        <>
          <div className="dhm-map">
            <BuildingMap
              avoid={[HEAD_BOX]}
              badges={badges}
              blockScale={1.4}
              buildings={mapBuildings}
              copy={mapCopy}
              cta={false}
              focusZoom={1.5}
              insetRight={PANEL_W + PANEL_GAP * 2}
              insetTop={110}
              introMode={motion}
              nudge={NUDGE}
              onOpen={() => {}}
              onSelect={setSelected}
              pulses={pulses}
              selectedId={selected}
            />
          </div>

          <div className="dhm-hd">
            <span className="dhm-live">
              <i aria-hidden="true" />
              {c.dhRealtime}
            </span>
            <h3 className="dhm-sum">
              {sumA}
              <em>{totalEmpty}</em>
              {sumB}
            </h3>
            <div aria-label={c.dhMapFilterAria} className="dhm-flt" role="radiogroup">
              {(
                [
                  ["status", c.dhMapFilterStatus],
                  ["cleaning", c.dhMapFilterCleaning],
                  ["inout", c.dhMapFilterInOut],
                ] as const
              ).map(([key, label]) => (
                <button aria-checked={filter === key} className={filter === key ? "on" : undefined} key={key} onClick={() => setFilter(key)} role="radio" type="button">
                  {label}
                </button>
              ))}
            </div>
          </div>

          <aside className={`dhm-panel${swapped ? " is-swapped" : ""}`} style={{ width: PANEL_W, top: PANEL_GAP, right: PANEL_GAP, bottom: PANEL_GAP }}>
            {sel ? (
              <BuildingDetail b={sel} c={c} key={sel.property} name={shortName(sel.property)} onBack={() => setSelected(null)} />
            ) : (
              <Feed c={c} feed={data.feed} fresh={fresh} locale={locale} name={shortName} nowAt={nowAt} onPick={(p) => setSelected(p)} />
            )}
          </aside>
        </>
      ) : null}
    </div>
  );
}

function badgeFor(b: DashBuilding, filter: Filter, c: Console, m: BuildingMapCopy): MapBadge | null {
  const cleanLeft = b.cleanTotal - b.cleanDone;
  const clean: MapBadge | null = b.cleanTotal
    ? cleanLeft
      ? { text: c.dhMapCleanN.replace("{done}", String(b.cleanDone)).replace("{total}", String(b.cleanTotal)), tone: "clean" }
      : { text: c.dhMapCleanDone, tone: "clean" }
    : null;
  if (filter === "cleaning") return clean;
  if (filter === "inout") {
    return b.checkIns || b.checkOuts ? { text: c.dhMapInOutN.replace("{in}", String(b.checkIns)).replace("{out}", String(b.checkOuts)), tone: "in" } : null;
  }
  if (b.empty > 0) return { text: m.emptyN.replace("{n}", String(b.empty)), tone: "v" };
  if (b.checkIns > 0) return { text: c.dhMapInN.replace("{n}", String(b.checkIns)), tone: "in" };
  if (cleanLeft > 0) return clean;
  if (b.checkOuts > 0) return { text: c.dhMapOutN.replace("{n}", String(b.checkOuts)), tone: "out" };
  return { text: m.full };
}

const DOT: Record<DashFeedItem["kind"], string> = { cleanDone: "#2bb673", cleanStart: "#e8a13a", booking: "#7a52e6" };

function sourceName(source: string) {
  const s = source.toLowerCase();
  if (s.includes("booking")) return "Booking.com";
  if (s.includes("airbnb")) return "Airbnb";
  if (s.includes("expedia")) return "Expedia";
  return source;
}

function Feed({
  feed,
  c,
  locale,
  name,
  fresh,
  nowAt,
  onPick,
}: {
  feed: DashFeedItem[];
  c: Console;
  locale: string;
  name: (property: string) => string;
  fresh: Set<string>;
  nowAt: number;
  onPick: (property: string) => void;
}) {
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Tokyo" });
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const nights = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));
  return (
    <div className="dhm-pane">
      <div className="dhm-ph">
        <b>{c.dhMapFeedTitle}</b>
        <span className="dhm-live">
          <i aria-hidden="true" />
          {c.dhRealtime}
        </span>
      </div>
      {feed.length === 0 ? (
        <p className="dhm-empty">{c.dhMapFeedEmpty}</p>
      ) : (
        <ul className="dhm-feed">
          {feed.map((f, i) => {
            const place = [name(f.property), f.room && f.room !== f.property ? f.room : ""].filter(Boolean).join(" ");
            const title = (f.kind === "cleanDone" ? c.dhMapEvCleanDone : f.kind === "cleanStart" ? c.dhMapEvCleanStart : c.dhMapEvBooking).replace("{place}", place);
            const sub =
              f.kind === "booking" && f.checkIn && f.checkOut
                ? [`${md(f.checkIn)} → ${md(f.checkOut)}`, c.dhMapNights.replace("{n}", String(nights(f.checkIn, f.checkOut))), f.source ? sourceName(f.source) : ""].filter(Boolean).join(" · ")
                : f.who;
            const just = nowAt > 0 && nowAt - Date.parse(f.at) < 120_000;
            return (
              <li key={f.id} style={{ "--i": i } as CSSProperties}>
                <button className={`dhm-fd${fresh.has(f.id) ? " is-new" : ""}`} onClick={() => onPick(f.property)} type="button">
                  <i aria-hidden="true" style={{ background: DOT[f.kind] }} />
                  <span>
                    <b>{title}</b>
                    {sub ? <small>{sub}</small> : null}
                  </span>
                  <time dateTime={f.at}>{just ? c.dhMapEvNow : time.format(new Date(f.at))}</time>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Link className="dhm-foot" href="/admin/cleaning">
        {c.dhCleaningLink}
        <ChevronRight aria-hidden="true" />
      </Link>
    </div>
  );
}

function BuildingDetail({ b, c, name, onBack }: { b: DashBuilding; c: Console; name: string; onBack: () => void }) {
  const loc = getPropertyLocation(b.property);
  const roomName = (label: string) => (label === b.property ? name : label);
  const pct = b.cleanTotal ? (b.cleanDone / b.cleanTotal) * 100 : 0;
  const plan: Array<[string, string, string[]]> = [
    ["o", c.dhMapSchOut, b.outRooms],
    ["c", c.dhMapSchClean, b.cleanLeft],
    ["n", c.dhMapSchIn, b.inRooms],
  ];
  const planned = plan.filter(([, , rooms]) => rooms.length > 0);
  return (
    <div className="dhm-pane dhm-bd">
      <button className="dhm-back" onClick={onBack} type="button">
        <ChevronRight aria-hidden="true" />
        {c.dhMapBack}
      </button>
      <div className="dhm-bh">
        {loc ? <small>{c.dhMapFloors.replace("{n}", String(loc.floors))}</small> : null}
        <b>{b.label}</b>
      </div>
      <div className="dhm-bst">
        <span>
          <small>{c.dhMapStatIn}</small>
          <b>{b.checkIns}</b>
        </span>
        <span>
          <small>{c.dhMapStatOut}</small>
          <b>{b.checkOuts}</b>
        </span>
        <span className={b.empty > 0 ? "v" : undefined}>
          <small>{c.dhMapStatEmpty}</small>
          <b>{b.empty}</b>
        </span>
      </div>
      <div className="dhm-sec">
        <b>{c.dhMapRoomsN.replace("{n}", String(b.rooms.length))}</b>
        <span className="dhm-lg">
          <i className="stay" />
          {c.dhMapLegStay}
          <i className="in" />
          {c.dhMapLegIn}
          <i className="clean" />
          {c.dhMapLegClean}
          <i className="vacant" />
          {c.dhMapLegVacant}
        </span>
      </div>
      <div className="dhm-rms">
        {b.rooms.map((r, i) => (
          <span className={`dhm-rm ${r.state}`} key={r.label} style={{ "--i": i } as CSSProperties}>
            {roomName(r.label)}
          </span>
        ))}
      </div>
      {b.cleanTotal ? (
        <>
          <div className="dhm-sec">
            <b>{c.dhMapCleaning}</b>
            <span className="num">
              {b.cleanDone} / {b.cleanTotal}
            </span>
          </div>
          <div className="dhm-bar">
            <i style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
        </>
      ) : null}
      <div className="dhm-sec">
        <b>{c.dhMapSchedule}</b>
      </div>
      {planned.length ? (
        <ul className="dhm-tl">
          {planned.map(([tone, label, rooms]) => (
            <li key={tone}>
              <i className={tone} aria-hidden="true" />
              <span>{label}</span>
              <em className="num">{rooms.map(roomName).join(" · ")}</em>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dhm-empty">{c.dhMapSchNone}</p>
      )}
      <div className="dhm-act">
        <Link className="dhm-go" href={`/admin/calendar?property=${encodeURIComponent(b.property)}`}>
          {c.dhMapOpenCal}
          <ChevronRight aria-hidden="true" />
        </Link>
        <Link className="dhm-ln" href="/admin/cleaning">
          {c.dhCleaningLink}
          <ChevronRight aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
