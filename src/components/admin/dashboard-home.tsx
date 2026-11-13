import Link from "next/link";
import { Lock } from "lucide-react";
import "./admin-console.css";
import "./dashboard-home.css";
import { CleaningLiveCard } from "./cleaning-live-card";
import { DashboardTodos } from "./dashboard-todos";
import { DashboardBuildingMap, type MapCardCopy } from "./dashboard-building-map";
import type { BuildingMapCopy } from "@/components/calendar/building-map/building-map";
import { getPropertyLocation } from "@/lib/property-locations";
import { groupByBuilding, pairByRoom, type RoomTurnRow } from "@/lib/home-reservation-groups";
import { normalizeReservationSource } from "@/lib/beds24/source-normalization";
import type { HomeReservationRow } from "@/lib/home";
import { localizeBuildingName, localizeRoomPlaceLabel } from "@/lib/room-label-normalization";
import { LiveWash } from "@/components/shared/live-wash";
import { RollNumber } from "@/components/shared/roll-number";
import { AdminMonthPicker, type AdminMonthPickerLabels } from "@/components/admin/shared/admin-month-picker";
import type { AdminDashboardData, QueueKind } from "@/lib/admin-dashboard";
import { niceMax, splitMonthRevenue } from "@/lib/chart-scale";
import { formatRequestDate } from "@/lib/dashboard-format";
import type { Dictionary } from "@/lib/i18n";
import type { DashboardOpsSummary } from "@/lib/ops-revenue-server";

type Console = Dictionary["admin"]["console"];

const I = {
  wrench: (
    <svg viewBox="0 0 24 24" fill="none"><path d="M14.5 6.5a3.5 3.5 0 00-4.6 4.3l-5.1 5.1a1.6 1.6 0 002.3 2.3l5.1-5.1a3.5 3.5 0 004.3-4.6l-2 2-1.8-1.8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
  ),
  found: (
    <svg viewBox="0 0 24 24" fill="none"><path d="M6 7h12l1 14H5zM9 7a3 3 0 016 0" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
  ),
  cart: (
    <svg viewBox="0 0 24 24" fill="none"><path d="M3 4h2l2.4 11.2a2 2 0 002 1.6h7.7a2 2 0 002-1.5L21 8H6.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
};

const QUEUE_HREF: Record<QueueKind, string> = { maintenance: "/admin/maintenance", lost: "/admin/lost-found", order: "/admin/orders" };
const QUEUE_ICON: Record<QueueKind, React.ReactNode> = { maintenance: I.wrench, lost: I.found, order: I.cart };

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}

const yen = (value: number) => `¥${Math.round(value).toLocaleString("ja-JP")}`;
const pct = (value: number) => `${Math.round(value)}%`;

function monthLabel(key: string, localeTag: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(localeTag, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** 지도 카드에 넘길 문구만 — 콘솔 사전엔 함수 값(`occupancyRate`)이 있어 통째로 클라이언트에 못 넘긴다. */
function pickMapCardCopy(c: Console): MapCardCopy {
  return Object.fromEntries(
    Object.entries(c).filter(([k, v]) => typeof v === "string" && (k.startsWith("dhMap") || k === "dhRealtime" || k === "dhCleaningLink")),
  ) as MapCardCopy;
}

export type DashboardOpsBlock = {
  summary: DashboardOpsSummary;
  monthPickerLabels: AdminMonthPickerLabels;
};

/**
 * 관리자 대시보드 홈(화이트 리디자인 2026-10-09, 시안 두 장 그대로 — 사용자 결정).
 * - 운영 관리자: 숫자 줄 → 매출 · 가동률(달 고르기) → 최근 6개월
 * - 그 밖: 숫자 줄 → 지금 처리할 일(왼쪽 진행 중 청소 + 오늘 할 일 · 오른쪽 요청) → 오늘 체크인 · 체크아웃
 * 2026-11-13 다듬기(시안 KWU2drTT…): 제목은 도쿄 오늘 날짜, 숫자 줄 문구 · 단위 정리, 최근 6개월은 막대 하나(이번 달만 실적 + 예약 확정 쌓기).
 * 「이상 근태 · 정정 요청」 · 「중요 공지」 구역은 두 시안 모두에 없어 뺐다(근태 · 공지 화면에 있다).
 * 「오늘의 건물」 지도 카드(2026-10-16, 시안 Motion-D-MapDash-PC)는 매출 · 가동률(없으면 숫자 줄) 바로 아래, 큐 위에 더했다 —
 * 위의 구역은 하나도 빼지 않는다(사용자 결정).
 */
export function DashboardHome({
  data,
  c,
  locale,
  ops,
  mapCopy,
  buildingLabels,
}: {
  data: AdminDashboardData;
  c: Console;
  locale: string;
  ops?: DashboardOpsBlock | null;
  mapCopy?: BuildingMapCopy;
  /** 예약 현황을 건물별로 묶을 때 보는 사람 언어의 건물 이름(`dictionary.cleaning.buildingLabels`). */
  buildingLabels: Record<string, string>;
}) {
  const mCount = data.queue.filter((q) => q.kind === "maintenance").length;
  const lCount = data.queue.filter((q) => q.kind === "lost").length;
  const oCount = data.queue.filter((q) => q.kind === "order").length;
  // 같은 방의 체크아웃 · 체크인은 한 줄(2026-10-28, 시안 18tu6H…) — 건물별 묶음 · 운영 순서 · 객실 번호순은 그대로.
  const turnRows = pairByRoom(data.reservations.checkIns, data.reservations.checkOuts);
  const turnovers = turnRows.filter((x) => x.checkIn && x.checkOut).length;
  const occPct = data.ops.totalRooms > 0 ? Math.round((data.ops.occupiedRooms / data.ops.totalRooms) * 100) : 0;

  // 단위(실 · 건)는 숫자에 붙이지 않는다 — 라벨이 말해 주고, 영어에선 「33rooms」 처럼 붙어 보였다. 0 이어도 아래 줄 자리는 비워 둔다.
  const kpis: { href: string; label: string; value: number; total?: number; detail?: string }[] = [
    { href: "/admin/calendar", label: c.opsOccupied, value: data.ops.occupiedRooms, total: data.ops.totalRooms, detail: c.occupancyRate(occPct) },
    { href: "/admin/calendar", label: c.opsCheckIn, value: data.ops.checkIns, detail: turnovers > 0 ? `${c.resvTurnover} ${turnovers}` : undefined },
    { href: "/admin/calendar", label: c.opsCheckOut, value: data.ops.checkOuts },
    { href: "/admin/cleaning", label: c.opsCleaning, value: data.ops.cleaningInProgress },
    {
      href: "/admin/maintenance",
      label: c.opsRequests,
      value: data.ops.openRequests,
      detail: `${c.kindMaintenanceShort} ${mCount} · ${c.kindLostShort} ${lCount} · ${c.kindOrderShort} ${oCount}`,
    },
  ];

  // 지도에 세울 건물(좌표가 있는 건물)이 하나도 없으면 카드를 뺀다.
  const showMap = Boolean(mapCopy && data.buildingMap?.buildings.some((b) => getPropertyLocation(b.property)));

  return (
    <div className="dh">
      <div className="dh-kpis">
        {kpis.map((k, i) => (
          <Link className="dh-kpi" href={k.href} key={k.label}>
            <span className="dh-kpi__k">{k.label}</span>
            <span className="dh-kpi__v">
              <RollNumber delay={150 + i * 70} delta text={String(k.value)} />
              {k.total !== undefined ? <small>/ {k.total}</small> : null}
            </span>
            <span className="dh-kpi__d">{k.detail}</span>
          </Link>
        ))}
      </div>

      {/* 운영 관리자는 매출 · 가동률 아래에 큐 · 할 일 · 예약까지 전부, 그 밖의 관리자는 매출 · 가동률 없이 큐부터. */}
      {ops ? <OpsBlock buildingLabels={buildingLabels} c={c} locale={locale} ops={ops} /> : null}
      {showMap && data.buildingMap && mapCopy ? (
        <>
          <div className={ops ? "dh-sec dh-sec--line" : "dh-sec"}>
            <b>{c.dhMapTitle}</b>
            <span className="dh-cc">{c.dhMapNote}</span>
          </div>
          <div className="dh-grid">
            <DashboardBuildingMap c={pickMapCardCopy(c)} data={data.buildingMap} locale={locale} mapCopy={mapCopy} />
          </div>
        </>
      ) : null}
      <QueueBlock buildingLabels={buildingLabels} c={c} data={data} divided={Boolean(ops) || showMap} locale={locale} turnRows={turnRows} turnovers={turnovers} />
    </div>
  );
}

function OpsBlock({ ops, c, locale, buildingLabels }: { ops: DashboardOpsBlock; c: Console; locale: string; buildingLabels: Record<string, string> }) {
  const s = ops.summary;
  const max = niceMax(Math.max(...s.daily.map((d) => d.revenue), 1));
  const showLabel = (day: number) => [1, 5, 10, 15, 20, 25, s.daily.length].includes(day);
  const prevDiff = Math.round(s.occupancyPct) - Math.round(s.previousOccupancyPct);
  const r = 44;
  const circ = 2 * Math.PI * r;
  // 6개월 막대엔 눈금이 없고 금액을 막대 위에 쓰므로 보기 좋은 눈금(niceMax)으로 올리지 않는다 — 가장 큰 달이 칸의 86%
  // (위 금액 글자 자리만 남김)까지 차게. 눈금으로 올리면 위쪽이 비어 막대가 짧아 보였다(2026-11-13 사용자 지적).
  const mMax = Math.max(...s.months.map((m) => m.revenue), 1) / 0.86;
  const thisMonth = s.today.slice(0, 7);
  // 이번 달만 실적(아래)과 예약 확정(위)을 쌓는다 — 고른 달과 상관없이. 지난 달은 전부 실적, 앞 달은 전부 예약 확정.
  const thisMonthActual = s.month === thisMonth ? s.actualToDate : s.thisMonthActual;
  const monthBars = s.months.map((m) => ({ ...m, ...splitMonthRevenue(m.month, m.revenue, thisMonth, thisMonthActual) }));
  return (
    <>
      <div className="dh-sec">
        <b>{c.dhOpsTitle}</b>
        <span aria-label={c.dhOpsNote} className="dh-lock" role="img" title={c.dhOpsNote}><Lock aria-hidden="true" size={14} /></span>
        <div className="dh-sec__end">
          <AdminMonthPicker basePath="/admin" labels={ops.monthPickerLabels} localeTag={locale} ym={s.month} />
        </div>
      </div>
      <div className="dh-grid">
        <div className="dh-rev">
          <div className="dh-rev__top">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="dh-ct">{c.dhRevenue}</span>
              <span className="dh-rev__v"><RollNumber delay={200} text={yen(s.revenue)} /></span>
              {s.actualThroughDay ? (
                <span className="dh-rev__note">
                  {c.dhActualNote.replace("{day}", String(s.actualThroughDay)).replace("{amount}", yen(s.actualToDate))}
                  {s.changePct !== null ? (
                    <b className="dh-trend">
                      <span aria-hidden="true" className={s.changePct >= 0 ? "dh-trend__up" : "dh-trend__down"}>{s.changePct >= 0 ? "▲" : "▼"}</span>{" "}
                      {`${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(1)}%`}
                    </b>
                  ) : (
                    <b>—</b>
                  )}
                </span>
              ) : null}
            </div>
            <div className="dh-legend">
              <span><i style={{ background: "#7a52e6" }} />{c.dhLegendActual}</span>
              <span><i style={{ background: "#cdbbfb" }} />{c.dhLegendBooked}</span>
            </div>
            <Link className="dh-link" href="/admin/ops/revenue">{c.dhRevenueLink} →</Link>
          </div>
          <div className="dh-chart">
            <div className="dh-axis"><span>{yen(max)}</span><span>{yen(max / 2)}</span><span>¥0</span></div>
            <div className="dh-plot">
              <div className="dh-plot__lines"><span /><span /><span /></div>
              <div className="dh-bars">
                {s.daily.map((d, i) => (
                  <div
                    className={`dh-bar${d.actual ? " is-actual" : ""}${d.today ? " is-today" : ""}`}
                    data-tip={c.dhDayTip.replace("{day}", String(d.day)).replace("{amount}", yen(d.revenue))}
                    key={d.day}
                    style={{ height: `${Math.max(0, (d.revenue / max) * 100)}%`, "--i": i } as React.CSSProperties}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="dh-xlabels">
            <span style={{ width: 72, flex: "none" }} />
            <div>
              {s.daily.map((d) => (
                <span className={d.today ? "is-today" : undefined} key={d.day}>
                  {d.today ? c.dhToday : showLabel(d.day) ? d.day : ""}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="dh-occ">
          <div style={{ display: "flex", alignItems: "center" }}>
            <span className="dh-ct">{c.dhOccupancy}</span>
            <Link className="dh-link" href="/admin/ops/occupancy" style={{ marginLeft: "auto" }}>{c.dhOccupancyLink} →</Link>
          </div>
          <div className="dh-occ__ring">
            <span className="dh-occ__dial">
            <svg aria-label={c.dhOccDesc.replace("{pct}", String(Math.round(s.occupancyPct)))} height="104" role="img" viewBox="0 0 104 104" width="104">
              <circle cx="52" cy="52" fill="none" r={r} stroke="#EDE7FC" strokeWidth="10" />
              <circle
                cx="52"
                cy="52"
                fill="none"
                r={r}
                stroke="#7A52E6"
                className="dh-occ__arc"
                strokeDasharray={`${(Math.min(s.occupancyPct, 100) / 100) * circ} ${circ}`}
                strokeLinecap="round"
                strokeWidth="10"
                style={{ "--len": (Math.min(s.occupancyPct, 100) / 100) * circ, "--circ": circ } as React.CSSProperties}
                transform="rotate(-90 52 52)"
              />
              {s.occupancyPct > 0 ? (
                <g className="dh-occ__cap" style={{ "--deg": `${(Math.min(s.occupancyPct, 100) / 100) * 360}deg` } as React.CSSProperties}>
                  <circle cx="52" cy="8" fill="#fff" r="3" />
                </g>
              ) : null}
            </svg>
            <span aria-hidden="true" className="dh-occ__pct"><RollNumber delay={250} text={pct(s.occupancyPct)} /></span>
            </span>
            <p>
              {c.dhOccMonth.replace("{avail}", s.availableNights.toLocaleString("ja-JP")).replace("{occ}", s.occupiedNights.toLocaleString("ja-JP"))}
              <br />
              {c.dhOccPrev} <b>{pct(s.previousOccupancyPct)}</b> → <b>{`${prevDiff >= 0 ? "+" : "-"}${c.dhPointDiff.replace("{n}", String(Math.abs(prevDiff)))}`}</b>
            </p>
          </div>
          <div className="dh-bld">
            {s.buildings.map((b, i) => (
              <div className="dh-bld__row" key={b.name}>
                <span className="dh-bld__n" title={localizeBuildingName(b.name, buildingLabels)}>{localizeBuildingName(b.name, buildingLabels)}</span>
                <span className="dh-meter"><i style={{ width: `${Math.min(b.pct, 100)}%`, "--i": i } as React.CSSProperties} /></span>
                <span className="dh-bld__v">{pct(b.pct)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dh-months">
          <div className="dh-mhead">
            <span className="dh-ct">{c.dhMonthsTitle}</span>
            {s.months.some((m) => m.month === thisMonth) ? (
              <span className="dh-cc">
                {c.dhMonthsNote.replace("{month}", monthLabel(thisMonth, locale)).replace("{day}", String(Number(s.today.slice(8, 10))))}
              </span>
            ) : null}
          </div>
          <div aria-label={s.months.map((m) => c.dhMonthDesc.replace("{month}", monthLabel(m.month, locale)).replace("{amount}", yen(m.revenue)).replace("{pct}", String(Math.round(m.occupancyPct)))).join(", ")} className="dh-mcols" role="img">
            {monthBars.map((m, i) => (
              <div className={`dh-mcol${m.month === thisMonth ? " is-current" : ""}`} key={m.month} style={{ "--i": i } as React.CSSProperties}>
                <div className="dh-mcol__plot">
                  <span className="dh-mcol__v">{yen(m.revenue)}</span>
                  <div className="dh-mcol__bar" style={{ height: `${(m.revenue / mMax) * 100}%` }}>
                    {m.booked > 0 ? <i className="is-booked" style={{ flexGrow: m.booked }} /> : null}
                    {m.actual > 0 ? <i className="is-actual" style={{ flexGrow: m.actual }} /> : null}
                  </div>
                </div>
                <span className="dh-mcol__m">{monthLabel(m.month, locale)}</span>
                <span className="dh-mcol__o">{c.dhMonthOccN.replace("{pct}", String(Math.round(m.occupancyPct)))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** 예약 출처 → 채널 점 색(리디자인 규칙: Airbnb 코랄 · Booking 남색 · 직접 회색 · 그 밖 옅은 회색). */
function channelOf(source: string): "airbnb" | "booking" | "direct" | "other" {
  const normalized = normalizeReservationSource(source);
  if (normalized === "Airbnb") return "airbnb";
  if (normalized === "Booking.com") return "booking";
  if (normalized === "Direct" || normalized === "beds24") return "direct";
  return "other";
}

function GuestCell({ row }: { row: HomeReservationRow | null }) {
  if (!row) return <span className="dh-turn__none" aria-hidden="true">—</span>;
  return (
    <span className="dh-turn__guest" title={row.source ? `${row.guestName} · ${row.source}` : row.guestName}>
      <i aria-hidden="true" className={`dh-ch-dot dh-ch-dot--${channelOf(row.source)}`} />
      <span className="dh-turn__name">{row.guestName}</span>
    </span>
  );
}

function QueueBlock({
  data,
  c,
  locale,
  divided,
  buildingLabels,
  turnRows,
  turnovers,
}: {
  data: AdminDashboardData;
  c: Console;
  locale: string;
  divided: boolean;
  buildingLabels: Record<string, string>;
  turnRows: RoomTurnRow<HomeReservationRow>[];
  turnovers: number;
}) {
  const resvGroups = groupByBuilding(turnRows, (x) => x.propertyName, (x) => x.roomLabel, buildingLabels);
  const now = new Date();
  const hiddenRequests = Math.max(0, data.queue.length - 5);

  return (
    <>
      <div className={divided ? "dh-sec dh-sec--line" : "dh-sec"}>
        <b>{c.sectQueueTitle}</b>
      </div>
      <div className="dh-grid">
        <CleaningLiveCard cleaning={data.cleaning} locale={locale}>
          {/* 오늘 할 일은 진행 중 청소 아래 왼쪽 칸(2026-11-13) — 오른쪽은 요청만. 누르면 바로 완료. */}
          <DashboardTodos
            copy={{
              todoDoneToast: c.todoDoneToast,
              todoEmpty: c.todoEmpty,
              todoFailed: c.todoFailed,
              todoReopenToast: c.todoReopenToast,
              todoTitle: c.todoTitle,
              todoToggleLabel: c.todoToggleLabel,
              todoUndo: c.todoUndo,
            }}
            todos={data.todos}
          />
        </CleaningLiveCard>
        <div className="dh-col5">
          <div className="dh-ch">
            <span className="dh-ct">{c.queueTitle}</span>
            <span className="dh-cc">{data.queue.length}</span>
          </div>
          {data.queue.length === 0 ? (
            <div className="dh-empty">{c.queueEmpty}</div>
          ) : (
            <LiveWash sig={data.queue.slice(0, 5).map((q) => `${q.kind}-${q.id}`).join(",")}>
            {data.queue.slice(0, 5).map((q) => {
              const href = QUEUE_HREF[q.kind];
              const kindLabel = q.kind === "maintenance" ? c.kindMaintenance : q.kind === "lost" ? c.kindLost : c.kindOrder;
              return (
                <Link className="dh-row" data-live={`${q.kind}-${q.id}`} href={href} key={`${q.kind}-${q.id}`}>
                  <span className="dh-qic"><Ic>{QUEUE_ICON[q.kind]}</Ic></span>
                  <div className="dh-rb">
                    <div className="dh-rt">{q.title}</div>
                    <div className="dh-rs">{kindLabel}{q.location ? ` · ${q.location}` : ""}</div>
                  </div>
                  {q.urgent ? <span className="dh-urgent">{c.urgentTag}</span> : null}
                  <span className="dh-cc">{formatRequestDate(q.createdAt, now, { today: c.dhDateToday, yesterday: c.dhDateYesterday })}</span>
                </Link>
              );
            })}
            </LiveWash>
          )}

          {hiddenRequests > 0 ? (
            <Link className="dh-more" href={QUEUE_HREF[data.queue[5].kind]}>{c.dhMoreN.replace("{n}", String(hiddenRequests))}</Link>
          ) : null}
        </div>
      </div>

      <div className="dh-sec dh-sec--line">
        <b>{c.sectTodayTitle}</b>
        <span className="dh-cc">
          {c.resvCheckIn} {data.reservations.checkIns.length} · {c.resvCheckOut} {data.reservations.checkOuts.length} · {c.resvTurnover} {turnovers}
        </span>
        <div className="dh-sec__end dh-sec__end--row">
          {resvGroups.length > 0 ? (
            <div className="dh-ch-legend">
              <span><i aria-hidden="true" className="dh-ch-dot dh-ch-dot--airbnb" />Airbnb</span>
              <span><i aria-hidden="true" className="dh-ch-dot dh-ch-dot--booking" />Booking.com</span>
              <span><i aria-hidden="true" className="dh-ch-dot dh-ch-dot--direct" />{c.resvDirect}</span>
            </div>
          ) : null}
          <Link className="dh-link" href="/admin/calendar">{c.dhAllLink} →</Link>
        </div>
      </div>
      {resvGroups.length === 0 ? (
        <div className="dh-empty">{c.resvEmpty}</div>
      ) : (
        <>
          {/* 건물 묶음을 신문처럼 여러 단으로(넓으면 3단, 1280 이면 2단) — 하루 치가 스크롤 없이 한 화면에. 단을 넘나드는 줄이
              생겨 `move`(위에서 끼어드는 움직임)는 쓰지 않고 새 줄 물들기만. */}
          <LiveWash sig={turnRows.map((x) => x.key).join(",")}>
            <div className="dh-turns">
              {resvGroups.map((g) => {
                const ins = g.items.filter((x) => x.checkIn).length;
                const outs = g.items.filter((x) => x.checkOut).length;
                return (
                  <section className="dh-turn" key={g.key}>
                    <div className="dh-turn__h">
                      <h3 className="dh-turn__t">{g.label}</h3>
                      <span className="dh-cc">{c.resvCheckIn} {ins} · {c.resvCheckOut} {outs}</span>
                    </div>
                    <div className="dh-turn__cols" aria-hidden="true">
                      <span>{c.resvRoom}</span>
                      <span>{c.resvCheckOut}</span>
                      <span>{c.resvCheckIn}</span>
                    </div>
                    {g.items.map((x) => (
                      <div className="dh-turn__row" data-live={x.key} key={x.key}>
                        {/* 방이 하나뿐인 건물(오쿠보 등)은 객실 표시가 비어 온다 — 건물 이름을 대신 쓴다. */}
                        <span className="dh-turn__room">{x.roomLabel ? localizeRoomPlaceLabel(x.roomLabel, buildingLabels) : g.label}</span>
                        <span className="dh-turn__out">
                          {x.checkOut ? <span className="sr-only">{c.resvCheckOut} </span> : null}
                          <GuestCell row={x.checkOut} />
                        </span>
                        <span className="dh-turn__in">
                          {x.checkIn ? <span className="sr-only">{c.resvCheckIn} </span> : null}
                          <GuestCell row={x.checkIn} />
                        </span>
                      </div>
                    ))}
                  </section>
                );
              })}
            </div>
          </LiveWash>
        </>
      )}
    </>
  );
}
