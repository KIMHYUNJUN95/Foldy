import Link from "next/link";
import "./admin-console.css";
import "./dashboard-home.css";
import { CleaningLiveCard } from "./cleaning-live-card";
import { AdminMonthPicker, type AdminMonthPickerLabels } from "@/components/admin/shared/admin-month-picker";
import type { AdminDashboardData, QueueKind } from "@/lib/admin-dashboard";
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
  check: (
    <svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
};

const QUEUE_ICON: Record<QueueKind, React.ReactNode> = { maintenance: I.wrench, lost: I.found, order: I.cart };

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}

function relDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" }).format(new Date(iso));
}

const yen = (value: number) => `¥${Math.round(value).toLocaleString("ja-JP")}`;
const pct = (value: number) => `${Math.round(value)}%`;

/** 축 눈금 — 가장 큰 막대보다 크고 보기 좋은 값(정확한 엔 표기, 줄이지 않는다). */
function niceMax(value: number): number {
  if (value <= 0) return 10000;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 3, 5, 10]) if (m * step >= value) return m * step;
  return 10 * step;
}

function monthLabel(key: string, localeTag: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(localeTag, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export type DashboardOpsBlock = {
  summary: DashboardOpsSummary;
  monthPickerLabels: AdminMonthPickerLabels;
};

/**
 * 관리자 대시보드 홈(화이트 리디자인 2026-10-09, 시안 두 장 그대로 — 사용자 결정).
 * - 운영 관리자: 숫자 줄 → 매출 · 가동률(달 고르기) → 최근 6개월
 * - 그 밖: 숫자 줄 → 즉시 처리해야 하는 큐(진행 중 청소 · 즉시 처리 큐) → 오늘 할 일 · 예약 현황
 * 「이상 근태 · 정정 요청」 · 「중요 공지」 구역은 두 시안 모두에 없어 뺐다(근태 · 공지 화면에 있다).
 */
export function DashboardHome({
  data,
  c,
  locale,
  ops,
}: {
  data: AdminDashboardData;
  c: Console;
  locale: string;
  ops?: DashboardOpsBlock | null;
}) {
  const mCount = data.queue.filter((q) => q.kind === "maintenance").length;
  const lCount = data.queue.filter((q) => q.kind === "lost").length;
  const oCount = data.queue.filter((q) => q.kind === "order").length;
  const occPct = data.ops.totalRooms > 0 ? Math.round((data.ops.occupiedRooms / data.ops.totalRooms) * 100) : 0;

  const kpis: { href: string; label: string; value: number; unit?: string; detail?: string }[] = [
    { href: "/admin/calendar", label: c.opsOccupied, value: data.ops.occupiedRooms, unit: ` / ${data.ops.totalRooms}${c.unitRooms}`, detail: c.occupancyRate(occPct) },
    { href: "/admin/calendar", label: c.opsCheckIn, value: data.ops.checkIns },
    { href: "/admin/calendar", label: c.opsCheckOut, value: data.ops.checkOuts },
    { href: "/admin/cleaning", label: c.opsCleaning, value: data.ops.cleaningInProgress, unit: c.unitRooms },
    {
      href: "/admin/maintenance",
      label: c.opsRequests,
      value: data.ops.openRequests,
      unit: c.unitCount,
      detail: `${c.kindMaintenance} ${mCount} · ${c.kindLost} ${lCount} · ${c.kindOrder} ${oCount}`,
    },
  ];

  return (
    <div className="dh">
      <div className="dh-kpis">
        {kpis.map((k) => (
          <Link className="dh-kpi" href={k.href} key={k.label}>
            <span className="dh-kpi__k">{k.label}</span>
            <span className="dh-kpi__v">
              {k.value}
              {k.unit ? <small>{k.unit}</small> : null}
            </span>
            {k.detail ? <span className="dh-kpi__d">{k.detail}</span> : null}
          </Link>
        ))}
      </div>

      {ops ? <OpsBlock c={c} locale={locale} ops={ops} /> : <QueueBlock c={c} data={data} locale={locale} />}
    </div>
  );
}

function OpsBlock({ ops, c, locale }: { ops: DashboardOpsBlock; c: Console; locale: string }) {
  const s = ops.summary;
  const max = niceMax(Math.max(...s.daily.map((d) => d.revenue), 1));
  const showLabel = (day: number) => [1, 5, 10, 15, 20, 25, s.daily.length].includes(day);
  const prevDiff = Math.round(s.occupancyPct) - Math.round(s.previousOccupancyPct);
  const r = 44;
  const circ = 2 * Math.PI * r;
  const mMax = niceMax(Math.max(...s.months.map((m) => m.revenue), 1));
  const thisMonth = s.today.slice(0, 7);
  const linePoints = s.months.map((m, i) => ({ x: 40 + i * 80, y: 120 - (Math.min(m.occupancyPct, 100) / 100) * 100, v: m.occupancyPct }));
  const peak = linePoints.reduce((best, p) => (p.v > best.v ? p : best), linePoints[0]);

  return (
    <>
      <div className="dh-sec">
        <b>{c.dhOpsTitle}</b>
        <span className="dh-cc">{c.dhOpsNote}</span>
        <div className="dh-sec__end">
          <AdminMonthPicker basePath="/admin" labels={ops.monthPickerLabels} localeTag={locale} ym={s.month} />
        </div>
      </div>
      <div className="dh-grid">
        <div className="dh-rev">
          <div className="dh-rev__top">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="dh-ct">{c.dhRevenue}</span>
              <span className="dh-rev__v">{yen(s.revenue)}</span>
              {s.actualThroughDay ? (
                <span className="dh-rev__note">
                  {c.dhActualNote.replace("{day}", String(s.actualThroughDay)).replace("{amount}", yen(s.actualToDate))}
                  {s.changePct !== null ? <b>{`${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(1)}%`}</b> : <b>—</b>}
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
                {s.daily.map((d) => (
                  <div
                    className={`dh-bar${d.actual ? " is-actual" : ""}${d.today ? " is-today" : ""}`}
                    key={d.day}
                    style={{ height: `${Math.max(0, (d.revenue / max) * 100)}%` }}
                    title={c.dhDayTip.replace("{day}", String(d.day)).replace("{amount}", yen(d.revenue))}
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
            <svg aria-label={c.dhOccDesc.replace("{pct}", String(Math.round(s.occupancyPct)))} height="104" role="img" viewBox="0 0 104 104" width="104">
              <circle cx="52" cy="52" fill="none" r={r} stroke="#EFEFF3" strokeWidth="10" />
              <circle
                cx="52"
                cy="52"
                fill="none"
                r={r}
                stroke="#7A52E6"
                strokeDasharray={`${(Math.min(s.occupancyPct, 100) / 100) * circ} ${circ}`}
                strokeLinecap="round"
                strokeWidth="10"
                transform="rotate(-90 52 52)"
              />
              <text fill="#16141F" fontSize="22" fontWeight="700" textAnchor="middle" x="52" y="59">{pct(s.occupancyPct)}</text>
            </svg>
            <p>
              {c.dhOccMonth.replace("{avail}", s.availableNights.toLocaleString("ja-JP")).replace("{occ}", s.occupiedNights.toLocaleString("ja-JP"))}
              <br />
              {c.dhOccPrev} <b>{pct(s.previousOccupancyPct)}</b> → <b>{`${prevDiff >= 0 ? "+" : ""}${prevDiff}%p`}</b>
            </p>
          </div>
          <div className="dh-bld">
            {s.buildings.map((b) => (
              <div className="dh-bld__row" key={b.name}>
                <span className="dh-bld__n" title={b.name}>{b.name}</span>
                <span className="dh-meter"><i style={{ width: `${Math.min(b.pct, 100)}%` }} /></span>
                <span className="dh-bld__v">{pct(b.pct)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dh-months">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="dh-ct">{c.dhMonthsTitle}</span>
            {s.months.some((m) => m.month === thisMonth) ? (
              <span className="dh-cc">{c.dhMonthsNote.replace("{month}", monthLabel(thisMonth, locale))}</span>
            ) : null}
          </div>
          <div className="dh-months__grid">
            <div className="dh-months__col">
              <span className="dh-months__k">{c.dhMonthRevenue}</span>
              <div className="dh-mbars">
                {s.months.map((m) => (
                  <div className="dh-mbar" key={m.month}>
                    <span>{yen(m.revenue)}</span>
                    <i className={m.month === thisMonth ? "is-current" : undefined} style={{ height: `${(m.revenue / mMax) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="dh-mlbl">{s.months.map((m) => <span key={m.month}>{monthLabel(m.month, locale)}</span>)}</div>
            </div>
            <div className="dh-months__col">
              <span className="dh-months__k">{c.dhMonthOcc}</span>
              <svg
                aria-label={c.dhMonthsDesc.replace("{list}", s.months.map((m) => pct(m.occupancyPct)).join(", "))}
                height="150"
                preserveAspectRatio="none"
                role="img"
                viewBox="0 0 480 130"
                width="100%"
              >
                <line stroke="#E6E6EB" x1="0" x2="480" y1="129.5" y2="129.5" />
                <line stroke="#F1F1F4" x1="0" x2="480" y1="70" y2="70" />
                <polyline fill="none" points={linePoints.map((p) => `${p.x},${p.y}`).join(" ")} stroke="#7A52E6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                <g fill="#7A52E6" stroke="#FFFFFF" strokeWidth="2">
                  {linePoints.map((p) => <circle cx={p.x} cy={p.y} key={p.x} r="4.5" />)}
                </g>
                {linePoints.length > 0 ? (
                  <>
                    <text fill="#6B6878" fontSize="11" textAnchor="middle" x={peak.x} y={peak.y - 10}>{pct(peak.v)}</text>
                    {peak !== linePoints[linePoints.length - 1] ? (
                      <text fill="#16141F" fontSize="11" fontWeight="600" textAnchor="middle" x={linePoints[linePoints.length - 1].x} y={linePoints[linePoints.length - 1].y - 10}>
                        {pct(linePoints[linePoints.length - 1].v)}
                      </text>
                    ) : null}
                  </>
                ) : null}
              </svg>
              <div className="dh-mlbl">{s.months.map((m) => <span key={m.month}>{monthLabel(m.month, locale)}</span>)}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function QueueBlock({ data, c, locale }: { data: AdminDashboardData; c: Console; locale: string }) {
  return (
    <>
      <div className="dh-sec">
        <b>{c.sectQueueTitle}</b>
        <span className="dh-cc">{data.queue.length + data.cleaning.length}</span>
      </div>
      <div className="dh-grid">
        <CleaningLiveCard cleaning={data.cleaning} locale={locale} />
        <div className="dh-col5">
          <div className="dh-ch">
            <span className="dh-ct">{c.queueTitle}</span>
            <span className="dh-cc">{data.queue.length}{c.unitCount}</span>
          </div>
          {data.queue.length === 0 ? (
            <div className="dh-empty">{c.queueEmpty}</div>
          ) : (
            data.queue.slice(0, 5).map((q) => {
              const href = q.kind === "maintenance" ? "/admin/maintenance" : q.kind === "lost" ? "/admin/lost-found" : "/admin/orders";
              const kindLabel = q.kind === "maintenance" ? c.kindMaintenance : q.kind === "lost" ? c.kindLost : c.kindOrder;
              return (
                <Link className="dh-row" href={href} key={`${q.kind}-${q.id}`}>
                  <span className="dh-qic"><Ic>{QUEUE_ICON[q.kind]}</Ic></span>
                  <div className="dh-rb">
                    <div className="dh-rt">{q.title}</div>
                    <div className="dh-rs">{kindLabel}{q.location ? ` · ${q.location}` : ""}</div>
                  </div>
                  {q.urgent ? <span className="dh-urgent">{c.urgentTag}</span> : null}
                  <span className="dh-cc">{relDay(q.createdAt, locale)}</span>
                </Link>
              );
            })
          )}
        </div>
      </div>

      <div className="dh-sec dh-sec--line">
        <b>{c.sectTodayTitle}</b>
      </div>
      <div className="dh-grid">
        <div className="dh-col5 dh-left">
          <div className="dh-ch">
            <span className="dh-ct">{c.todoTitle}</span>
            <span className="dh-cc" style={{ marginLeft: "auto" }}>{data.todos.filter((t) => t.done).length} / {data.todos.length}</span>
          </div>
          {data.todos.length === 0 ? (
            <div className="dh-empty">{c.todoEmpty}</div>
          ) : (
            data.todos.map((t) => (
              <div className={`dh-todo${t.done ? " is-done" : ""}`} key={t.id}>
                <span className="dh-todo__box">{t.done ? <Ic>{I.check}</Ic> : null}</span>
                <span>{t.title}</span>
              </div>
            ))
          )}
        </div>
        <div className="dh-col7 dh-right">
          <div className="dh-ch">
            <span className="dh-ct">{c.resvTitle}</span>
            <Link className="dh-link" href="/admin/calendar" style={{ marginLeft: "auto" }}>{c.dhAllLink} →</Link>
          </div>
          {data.reservations.checkIns.length === 0 && data.reservations.checkOuts.length === 0 ? (
            <div className="dh-empty">{c.resvEmpty}</div>
          ) : (
            [
              ...data.reservations.checkIns.map((r) => ({ r, kind: c.resvCheckIn, key: `in-${r.id}` })),
              ...data.reservations.checkOuts.map((r) => ({ r, kind: c.resvCheckOut, key: `out-${r.id}` })),
            ].map(({ r, kind, key }) => (
              <div className="dh-row" key={key} style={{ cursor: "default" }}>
                <span className="dh-room">{r.roomLabel}</span>
                <div className="dh-rb">
                  <div className="dh-rt" style={{ fontWeight: 500 }}>{r.guestName}</div>
                  <div className="dh-rs">{r.propertyName}{r.source ? ` · ${r.source}` : ""}</div>
                </div>
                <span className="dh-kind">{kind}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
