"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { loadOpsSalesSummary, type OpsSalesSummaryResult } from "@/actions/ops-calendar";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import {
  combineSalesSummary,
  defaultSalesExcluded,
  type SalesChannel,
  type SalesMetrics,
  type SalesPropertyRow,
  type SalesRoomRow,
} from "@/lib/ops-sales-summary";
import { buildSalesYoy, type SalesYoy } from "@/lib/ops-sales-yoy";
import "./ops-calendar-tools-white.css";
import { useBuildingName } from "@/components/shared/building-names";

/**
 * 판매 캘린더 「매출 요약」 모달 — **보고 있는 창 × 고른 건물**(2026-09-30).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「매출 요약」
 * 식: src/lib/ops-sales-summary.ts (저쪽 건물 캘린더 그대로 — 34번 문서)
 *
 * 옆 패널이 아니라 **가운데 큰 모달**이다 — KPI · 채널 · 건물(객실 펼침)을 한눈에 봐야 하고, 격자를 고치는
 * 동작이 아니라 격자를 덮어도 된다. 셸 동작(Esc · 스크롤 잠금 · 포커스 복귀 · 포커스 가둠)은 콘솔 공용
 * `useAdminPanelA11y`. `<body>` 로 포털하되 `.adm` 로 감싸 콘솔 토큰을 그대로 받는다.
 *
 * ## 빨리 열린다
 *
 * 버튼에 마우스를 올리거나 포커스하면 **미리 부른다**(`prefetchSalesSummary`). 결과는 격자가 받은 서버
 * 데이터(`rows` 배열) 단위로 기억한다 — 같은 화면에서 다시 열면 바로 뜨고, 라이브 신호·쓰기 반영으로
 * 서버 데이터가 새로 오면(= 새 배열) 기억이 저절로 버려진다.
 */

export type SalesSummaryCopy = {
  localeTag: string;
  rcClose: string;
  ssTitle: string;
  ssDays: string;
  ssAllProperties: string;
  ssLoading: string;
  ssError: string;
  ssErrForbidden: string;
  ssRetry: string;
  ssGross: string;
  ssGrossNote: string;
  ssCommission: string;
  ssCommissionNote: string;
  ssNet: string;
  ssOccupancy: string;
  ssOccupancyNote: string;
  ssAdr: string;
  ssAdrNote: string;
  ssRevpar: string;
  ssRevparNote: string;
  ssVacant: string;
  ssNightsUnit: string;
  ssVacantNote: string;
  ssVacantHint: string;
  ssFutureVacant: string;
  ssFutureNone: string;
  ssChannels: string;
  ssChannelCol: string;
  ssRevenueCol: string;
  ssCommissionCol: string;
  ssNetCol: string;
  ssNightsCol: string;
  ssArrivalsCol: string;
  ssDirect: string;
  ssOther: string;
  ssTotal: string;
  ssProperties: string;
  ssPropertyCol: string;
  ssRoomsCol: string;
  ssOccupancyCol: string;
  ssVacantCol: string;
  ssOffCatalogHint: string;
  ssZeroNote: string;
  ssBasisTitle: string;
  ssBasisRevenue: string;
  ssBasisStatus: string;
  ssBasisOccupancy: string;
  ssBasisCommission: string;
  ssBasisLegacy: string;
  ssMixCol: string;
  ssYoyLabel: string;
  ssYoyNone: string;
  ssYoyNewRooms: string;
  ssYoyDiff: string;
  ssYoyComparable: string;
  ssYoyNotOpen: string;
  ssYoyNoSales: string;
  ssYoyWholeBuilding: string;
  ssSortDesc: string;
  ssSortAsc: string;
  ssSortReset: string;
  ssIncludeTitle: string;
  ssIncludeHint: string;
  ssExcludedTitle: string;
  ssExcludedNote: string;
  ssPropCount: string;
  ssConfirmedOnly: string;
  ssSortHint: string;
  ssRoomsOpen: string;
};

type Loaded = Extract<OpsSalesSummaryResult, { ok: true }>["summary"];
type State = { status: "loading" } | { status: "error"; forbidden: boolean } | { status: "ready"; summary: Loaded };

// ── 미리 부르기 · 기억 ──────────────────────────────────────────────────

type SalesArgs = { start: string; days: number; properties: readonly string[] };

/** 서버 데이터(격자 `rows` 배열) → 창·건물 키 → 진행 중이거나 끝난 요청. 배열이 바뀌면 통째로 버려진다. */
const salesCache = new WeakMap<object, Map<string, Promise<OpsSalesSummaryResult>>>();

function salesKey(args: SalesArgs): string {
  return `${args.start}|${args.days}|${args.properties.join("\u0001")}`;
}

/** 요청을 시작하거나(없으면) 이미 있는 것을 돌려준다. 실패한 결과는 기억하지 않는다. */
export function prefetchSalesSummary(scope: object, args: SalesArgs): Promise<OpsSalesSummaryResult> {
  let byKey = salesCache.get(scope);
  if (!byKey) {
    byKey = new Map();
    salesCache.set(scope, byKey);
  }
  const key = salesKey(args);
  const existing = byKey.get(key);
  if (existing) return existing;
  const request = loadOpsSalesSummary({ days: args.days, properties: [...args.properties], start: args.start }).then(
    (result) => {
      if (!result.ok) byKey.delete(key);
      return result;
    },
    (error: unknown) => {
      byKey.delete(key);
      throw error;
    },
  );
  byKey.set(key, request);
  return request;
}

// ── 표시 ────────────────────────────────────────────────────────────────

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export type Fmt = {
  yen: (value: number) => string;
  count: (value: number) => string;
  pct: (value: number) => string;
  nights: (value: number) => string;
};

const CLOSE_MS = 150;

/**
 * 합계에서 뺀 건물 — 기기(브라우저)에 기억한다(편의). 지금 요약에 없는 건물의 기억은 건드리지 않는다. 처음이면
 * 기본값(오쿠보A · 사노 — `defaultSalesExcluded`). 저장소가 막혀 있으면 기본값으로 그냥 연다.
 */
const EXCLUDED_KEY = "stayops.ops-sales-excluded";

function readExcluded(present: readonly string[]): Set<string> {
  let stored: string[] | null = null;
  try {
    const raw = window.localStorage.getItem(EXCLUDED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) stored = parsed.filter((item): item is string => typeof item === "string");
  } catch {
    stored = null;
  }
  if (!stored) return new Set(defaultSalesExcluded(present));
  const excluded = present.filter((name) => stored.includes(name));
  // 보고 있는 건물을 전부 뺀 상태는 만들지 않는다 — 볼 게 없다.
  return new Set(excluded.length === present.length ? [] : excluded);
}

function writeExcluded(present: readonly string[], excluded: ReadonlySet<string>) {
  try {
    const raw = window.localStorage.getItem(EXCLUDED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const previous = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    const kept = previous.filter((name) => !present.includes(name));
    window.localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...kept, ...excluded]));
  } catch {
    // 기억 못 해도 이번 화면은 그대로 된다.
  }
}

type SalesSummaryProps = {
  copy: SalesSummaryCopy;
  /** 보고 있는 창의 일수(30일 뷰 = 30, 월간 = 그 달 일수). */
  days: number;
  onClose: () => void;
  /** 고른 건물(탭 순서). 빈 목록 = 전체. */
  properties: string[];
  /** 기억 단위 — 격자가 받은 서버 데이터(`rows` 배열). 바뀌면 새로 부른다. */
  scope: object;
  /** 보고 있는 창의 첫날. */
  start: string;
};

/** 모달 · 모바일 시트가 함께 쓰는 상태 — 불러오기 · 다시 시도 · 숫자 표기 · 기간 라벨. */
function useSalesSummary({ copy, days, properties, scope, start }: Omit<SalesSummaryProps, "onClose">) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    // 새로 부르는 동안에도 **이전 숫자를 그대로 둔다**(라이브 새로고침) — 처음 열 때만 스켈레톤.
    prefetchSalesSummary(scope, { days, properties, start }).then(
      (result) => {
        if (!alive) return;
        setState(
          result.ok
            ? { status: "ready", summary: result.summary }
            : { forbidden: result.error === "forbidden", status: "error" },
        );
      },
      () => {
        if (alive) setState({ forbidden: false, status: "error" });
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt, days, properties, scope, start]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  };

  // ¥ 표기는 로캘과 무관하게 하나로(ko-KR · en-US 의 JPY 는 「JP¥」가 된다). 자릿수 구분만 로캘을 따른다.
  const numberFormat = new Intl.NumberFormat(copy.localeTag, { maximumFractionDigits: 0 });
  const fmt: Fmt = {
    count: (value) => numberFormat.format(value),
    nights: (value) => copy.ssNightsUnit.replace("{n}", numberFormat.format(value)),
    pct: (value) => `${value.toFixed(1)}%`,
    yen: (value) => {
      const rounded = Math.round(value);
      return `${rounded < 0 ? "−" : ""}¥${numberFormat.format(Math.abs(rounded))}`;
    },
  };

  const end = addDays(start, days - 1);
  // 「10/09 → 11/07」 — 해가 바뀌면 연도를 붙인다.
  const md = (date: string) => `${date.slice(5, 7)}/${date.slice(8, 10)}`;
  const period =
    end.slice(0, 4) === start.slice(0, 4) ? `${md(start)} → ${md(end)}` : `${start.slice(0, 4)}/${md(start)} → ${end.slice(0, 4)}/${md(end)}`;
  return { fmt, period, retry, state };
}

/**
 * 머리 + 본문 — 모달과 시트가 같은 마크업을 쓴다(닫기 X 는 모달에만, 시트는 손잡이 · 스크림으로 닫는다).
 * 화이트 리디자인(2026-10-16, 시안 SalesSummary-PC): 머리 「매출 요약」 + 「기간 · N일 · 건물 N곳 · 확정 예약만」.
 * 시트(폰)는 같은 내용을 세로로 쌓는다(2026-10-16 사용자 승인 — 예전 간단 시트 대신 PC 와 같은 내용).
 */
function SalesSummaryContent({
  closeButton,
  copy,
  days,
  properties,
  summary: { fmt, period, retry, state },
  titleId,
}: {
  closeButton?: React.ReactNode;
  copy: SalesSummaryCopy;
  days: number;
  properties: string[];
  summary: ReturnType<typeof useSalesSummary>;
  titleId: string;
}) {
  const bName = useBuildingName();
  const scopeText =
    properties.length === 0
      ? copy.ssAllProperties
      : properties.length === 1
        ? bName(properties[0])
        : copy.ssPropCount.replace("{n}", String(properties.length));
  return (
    <>
      <header className="stw-ss__head">
        <div className="stw-ss__headtxt">
          <h2 className="stw-ss__title" id={titleId}>
            {copy.ssTitle}
          </h2>
          <span className="stw-ss__sub" title={properties.length > 1 ? properties.map(bName).join(" · ") : undefined}>
            {[period, copy.ssDays.replace("{n}", String(days)), scopeText, copy.ssConfirmedOnly].join(" · ")}
          </span>
        </div>
        {closeButton}
      </header>

      <div className="stw-ss__body">
        {state.status === "loading" && <SummarySkeleton label={copy.ssLoading} />}
        {state.status === "error" && (
          <div className="stw-state" role="alert">
            <span>{state.forbidden ? copy.ssErrForbidden : copy.ssError}</span>
            {!state.forbidden && (
              <button className="stw-link" onClick={retry} type="button">
                {copy.ssRetry}
              </button>
            )}
          </div>
        )}
        {state.status === "ready" && <SummaryContent copy={copy} fmt={fmt} summary={state.summary} />}
      </div>
    </>
  );
}

export function OpsSalesSummaryModal({ copy, days, onClose, properties, scope, start }: SalesSummaryProps) {
  const [closing, setClosing] = useState(false);
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, CLOSE_MS);
  };
  const panelRef = useAdminPanelA11y<HTMLDivElement>(requestClose, { quietRestore: true, trapFocus: true });
  const titleId = useId();
  const summary = useSalesSummary({ copy, days, properties, scope, start });

  return createPortal(
    <div className={`adm stw-ssroot${closing ? " is-closing" : ""}`}>
      <div aria-hidden="true" className="stw-ssroot__scrim" onClick={requestClose} />
      <div aria-labelledby={titleId} aria-modal="true" className="stw-ss" ref={panelRef} role="dialog" tabIndex={-1}>
        <SalesSummaryContent
          closeButton={
            <button aria-label={copy.rcClose} className="stw-x" onClick={requestClose} type="button">
              <X aria-hidden="true" />
            </button>
          }
          copy={copy}
          days={days}
          properties={properties}
          summary={summary}
          titleId={titleId}
        />
      </div>
    </div>,
    document.body,
  );
}

/**
 * 모바일 판매 캘린더용 — 같은 내용을 **공용 하단 시트**(`BottomSheet`)에 담는다(2026-10-02 사용자 지시 「모든 하단
 * 팝업은 공용으로」). 가운데 모달 · 닫기 X 대신 손잡이 끌기 · 스크림 탭 · Esc 로 닫는다.
 */
export function OpsSalesSummarySheet({ copy, days, onClose, properties, scope, start }: SalesSummaryProps) {
  const titleId = useId();
  const summary = useSalesSummary({ copy, days, properties, scope, start });
  return (
    <BottomSheet ariaLabelledBy={titleId} className="flex max-h-[92dvh] flex-col" onClose={onClose}>
      <div className="adm stw-sswrap">
        <div className="stw-ss stw-ss--sheet">
          <SalesSummaryContent copy={copy} days={days} properties={properties} summary={summary} titleId={titleId} />
        </div>
      </div>
    </BottomSheet>
  );
}

/** 최종 배치와 같은 골격 — 뜨는 순간 자리가 바뀌지 않는다. */
function SummarySkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="stw-ss__skel">
      <span className="stw-sronly">{label}</span>
      <div className="stw-ss__kpis">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="stw-ss__kpi" key={index}>
            <span className="stw-bone w40" />
            <span className="stw-bone big" />
            <span className="stw-bone w60" />
          </div>
        ))}
      </div>
      <span className="stw-bone strip" />
      {Array.from({ length: 6 }, (_, index) => (
        <span className="stw-bone row" key={index} />
      ))}
    </div>
  );
}

const MIX_ORDER: readonly SalesChannel[] = ["airbnb", "booking", "direct", "other"];

/** 채널 비중 막대(건물 · 객실 줄) — 매출 기준, 위 채널 표와 같은 색. 전체는 글자 라벨로(색만으로 전하지 않는다). */
function ChannelMix({ label, mix }: { label: (channel: SalesChannel) => string; mix: Record<SalesChannel, number> }) {
  const total = MIX_ORDER.reduce((sum, channel) => sum + mix[channel], 0);
  if (total <= 0) return null;
  const parts = MIX_ORDER.filter((channel) => mix[channel] > 0).map((channel) => ({
    channel,
    pct: (mix[channel] / total) * 100,
  }));
  const text = parts.map((part) => `${label(part.channel)} ${Math.round(part.pct)}%`).join(" · ");
  return (
    <span className="stw-ss__mix">
      <span aria-hidden="true" className="stw-ss__mixbar">
        {parts.map((part) => (
          <i className={`is-${part.channel}`} key={part.channel} style={{ flexGrow: part.pct }} />
        ))}
      </span>
      <span className="stw-ss__mixtxt">{text}</span>
    </span>
  );
}

/** 건물 표에서 머리글로 정렬할 수 있는 칸(2026-10-05 사용자 요청). 「객실」 머리글 = 원래 순서. */
type SortKey = "occupancyPct" | "occupiedNights" | "vacantNights" | "adr" | "revenue";
type SortState = { key: SortKey; dir: "desc" | "asc" } | null;

/** 정렬 — 가동률 · 판매 박 · 빈방은 목록 밖 방(값 없음)을 늘 맨 뒤로. 같으면 원래 순서. */
function sortRows<T extends SalesMetrics & { inCatalog?: boolean }>(rows: readonly T[], sort: SortState): T[] {
  if (!sort) return [...rows];
  const sign = sort.dir === "desc" ? -1 : 1;
  const catalogOnly = sort.key === "occupancyPct" || sort.key === "occupiedNights" || sort.key === "vacantNights";
  return rows
    .map((row, index) => ({ index, row }))
    .sort((a, b) => {
      if (catalogOnly) {
        const offA = a.row.inCatalog === false ? 1 : 0;
        const offB = b.row.inCatalog === false ? 1 : 0;
        if (offA !== offB) return offA - offB;
      }
      return (a.row[sort.key] - b.row[sort.key]) * sign || a.index - b.index;
    })
    .map((entry) => entry.row);
}

const mixOfRows = (rows: readonly { channel: SalesChannel; revenue: number }[]): Record<SalesChannel, number> => {
  const mix: Record<SalesChannel, number> = { airbnb: 0, booking: 0, direct: 0, other: 0 };
  for (const row of rows) mix[row.channel] += row.revenue;
  return mix;
};

/** 증감 % — 오르면 초록 +, 내리면 빨강 −(부호 글자를 늘 같이). 비교 불가면 「전년 매출 없음」. */
function YoyPct({ copy, current, previous }: { copy: SalesSummaryCopy; current: number; previous: number }) {
  if (previous <= 0) return <span className="stw-ss__dim">{copy.ssYoyNone}</span>;
  const pct = ((current - previous) / previous) * 100;
  return (
    <span className={pct >= 0 ? "stw-ss__up" : "stw-ss__down"}>
      {pct >= 0 ? "+" : "−"}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

/** 전년 매출 없던 객실 — 건물마다 「운영 전 · 첫 손님」/「운영 중 · 그 기간 매출 없음」, 객실과 지금 매출(= 차이). */
function YoyPanel({ copy, fmt, panelId, yoy }: { copy: SalesSummaryCopy; fmt: Fmt; panelId: string; yoy: SalesYoy }) {
  const bName = useBuildingName();
  const signed = (value: number) => `${value >= 0 ? "+" : ""}${fmt.yen(value)}`;
  return (
    <section aria-label={copy.ssYoyLabel} className="stw-ss__yoypanel" id={panelId}>
      <ul>
        {yoy.newRooms.groups.map((group) => (
          <li key={group.propertyName}>
            <div className="stw-ss__yoyg">
              <b>{bName(group.propertyName)}</b>
              <span className="stw-ss__dim">
                {group.reason === "not_open" ? copy.ssYoyNotOpen.replace("{date}", group.firstStay ?? "—") : copy.ssYoyNoSales}
              </span>
              <span className="stw-ss__up">{signed(group.revenue)}</span>
            </div>
            <div className="stw-ss__yoyrooms">
              {group.wholeBuilding ? (
                <span>{copy.ssYoyWholeBuilding.replace("{n}", fmt.count(group.rooms.length))}</span>
              ) : (
                group.rooms.map((room) => (
                  <span key={room.key}>
                    {bName(room.label)} <em>{signed(room.revenue)}</em>
                  </span>
                ))
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SummaryContent({
  copy,
  fmt,
  initialOpen,
  summary,
}: {
  copy: SalesSummaryCopy;
  fmt: Fmt;
  /** 처음부터 펼쳐 둘 건물. 없으면 건물이 하나일 때만 펼친다. */
  initialOpen?: readonly string[];
  summary: Loaded;
}) {
  const bName = useBuildingName();
  /*
   * **합계에 넣을 건물**(2026-10-05 사용자 지시) — 오쿠보A · 사노는 기본으로 합계(총매출 · 가동률 · 채널)에서 빼고 아래에
   * 따로 보인다. 건물 표의 체크로 넣고 뺄 수 있다(2026-10-16 화이트 — 칩 줄 대신 표 안 체크). 숫자는 건물별 몫을 다시
   * 더해 낸다(`combineSalesSummary` — 서버 재요청 없음).
   */
  const propertyNames = useMemo(() => summary.byProperty.map((row) => row.propertyName), [summary]);
  const [excluded, setExcluded] = useState<Set<string>>(() => readExcluded(propertyNames));
  const toggleIncluded = (name: string) => {
    const next = new Set(excluded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    if (next.size === propertyNames.length) return; // 마지막 하나는 뺄 수 없다.
    setExcluded(next);
    writeExcluded(propertyNames, next);
  };
  const combined = useMemo(
    () => (excluded.size === 0 ? summary : combineSalesSummary(summary, (name) => !excluded.has(name))),
    [excluded, summary],
  );
  const yoy = useMemo(
    () => buildSalesYoy({ current: summary, included: (name) => !excluded.has(name), previous: summary.previous }),
    [excluded, summary],
  );
  /** 전년 동기 — 건물 · 객실마다(같은 1년 전 창의 객실 매출을 더한 값). */
  const previousBy = useMemo(() => {
    const byProperty = new Map<string, number>();
    const byRoom = new Map<string, number>();
    for (const room of summary.previous.rooms) {
      byProperty.set(room.propertyName, (byProperty.get(room.propertyName) ?? 0) + room.revenue);
      byRoom.set(room.key, (byRoom.get(room.key) ?? 0) + room.revenue);
    }
    return { byProperty, byRoom };
  }, [summary]);
  const [yoyOpen, setYoyOpen] = useState(false);
  const yoyPanelId = useId();
  const basisId = useId();
  const [basisOpen, setBasisOpen] = useState(false);

  const totals: SalesMetrics = combined.totals;
  const channelLabel = (channel: SalesChannel) =>
    channel === "airbnb" ? "Airbnb" : channel === "booking" ? "Booking.com" : channel === "direct" ? copy.ssDirect : copy.ssOther;
  // 「기타」는 값이 있을 때만 줄을 만든다(대개 0 — 2026-09 실측 0건).
  const channels = combined.byChannel.filter(
    (row) => row.channel !== "other" || row.revenue > 0 || row.arrivals > 0 || row.nights > 0,
  );
  const channelRevenue = channels.reduce((sum, row) => sum + row.revenue, 0);
  const share = (value: number) => (channelRevenue > 0 ? (value / channelRevenue) * 100 : 0);

  // 건물 한 곳만 보고 있으면 객실을 펼친 채로 연다 — 볼 것이 그것뿐이다.
  const [open, setOpen] = useState<Set<string>>(() =>
    initialOpen
      ? new Set(initialOpen)
      : summary.byProperty.length === 1
        ? new Set([summary.byProperty[0].propertyName])
        : new Set(),
  );
  const toggleOpen = (name: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  /*
   * **머리글로 정렬**(2026-10-05 사용자 요청) — 매출 · 가동률 · 판매 박 · 빈방 · ADR 을 누르면 높은순, 다시 누르면 낮은순.
   * 「객실」 머리글은 원래 순서(탭 · 캘린더 행 순서)로 되돌린다. 건물 줄과 펼친 객실 줄이 함께 정렬된다.
   */
  const [sort, setSort] = useState<SortState>(null);
  const sortBy = (key: SortKey) =>
    setSort((current) => (current?.key === key ? { dir: current.dir === "desc" ? "asc" : "desc", key } : { dir: "desc", key }));
  const sortHead = (key: SortKey, label: string) => {
    const active = sort?.key === key;
    const nextDir = active && sort.dir === "desc" ? "asc" : "desc";
    return (
      <th aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"} className="r" scope="col">
        <button
          className={`stw-ss__sort${active ? " on" : ""}`}
          onClick={() => sortBy(key)}
          title={nextDir === "desc" ? copy.ssSortDesc : copy.ssSortAsc}
          type="button"
        >
          {label}
          {active && <span aria-hidden="true">{sort.dir === "desc" ? " ↓" : " ↑"}</span>}
        </button>
      </th>
    );
  };

  const includedRows = sortRows(
    summary.byProperty.filter((row) => !excluded.has(row.propertyName)),
    sort,
  );
  const excludedRows = sortRows(
    summary.byProperty.filter((row) => excluded.has(row.propertyName)),
    sort,
  );
  const lastIncluded = includedRows.length === 1;

  /** 건물 · 객실 줄이 같이 쓰는 숫자 칸. 목록 밖 방은 가동률 · 판매 박 · 빈방을 「–」. */
  const metricCells = (row: SalesMetrics, previous: number, offCatalog = false) => (
    <>
      <td className="r" data-label={copy.ssRevenueCol}>
        {fmt.yen(row.revenue)}
      </td>
      <td className="r" data-label={copy.ssOccupancyCol}>
        {offCatalog ? "–" : fmt.pct(row.occupancyPct)}
      </td>
      <td className="r" data-label={copy.ssNightsCol}>
        {offCatalog ? "–" : fmt.count(row.occupiedNights)}
      </td>
      <td className="r" data-label={copy.ssVacantCol}>
        {offCatalog ? "–" : fmt.nights(row.vacantNights)}
      </td>
      <td className="r" data-label="ADR">
        {fmt.yen(row.adr)}
      </td>
      <td className="r" data-label={copy.ssYoyLabel}>
        <YoyPct copy={copy} current={row.revenue} previous={previous} />
      </td>
    </>
  );

  const propertyRow = (row: SalesPropertyRow, index: number, isExcluded: boolean) => {
    const expanded = open.has(row.propertyName);
    const locked = !isExcluded && lastIncluded;
    return (
      <tbody className={`stw-ss__grp${isExcluded ? " is-off" : ""}${expanded ? " is-open" : ""}`} key={row.propertyName}>
        <tr className="stw-ss__prow" style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
          <th className="stw-ss__name" scope="row">
            <button
              aria-pressed={!isExcluded}
              className="stw-ss__inc"
              disabled={locked}
              onClick={() => toggleIncluded(row.propertyName)}
              title={copy.ssIncludeHint}
              type="button"
            >
              <span aria-hidden="true" className={`stw-ck${isExcluded ? "" : " on"}`}>
                {!isExcluded && (
                  <svg viewBox="0 0 16 16">
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                )}
              </span>
              <span className="stw-ss__pname">{bName(row.propertyName)}</span>
            </button>
          </th>
          <td className="r" data-label={copy.ssRoomsCol}>
            {fmt.count(row.roomCount)}
          </td>
          {metricCells(row, previousBy.byProperty.get(row.propertyName) ?? 0)}
          <td className="r stw-ss__opencell">
            <button aria-expanded={expanded} className="stw-ss__open" onClick={() => toggleOpen(row.propertyName)} type="button">
              {copy.ssRoomsOpen}
              <ChevronDown aria-hidden="true" />
            </button>
          </td>
        </tr>
        {expanded && (
          <>
            <tr className="stw-ss__detail">
              <td colSpan={9}>
                <span>
                  {copy.ssCommissionCol} <b>{fmt.yen(row.commission)}</b>
                </span>
                <span>
                  {copy.ssNetCol} <b>{fmt.yen(row.net)}</b>
                </span>
                <span>
                  RevPAR <b>{fmt.yen(row.revpar)}</b>
                </span>
                <ChannelMix label={channelLabel} mix={mixOfRows(row.channels)} />
              </td>
            </tr>
            {sortRows(row.rooms, sort).map((room: SalesRoomRow) => (
              <tr className="stw-ss__rrow" key={room.key}>
                <th className="stw-ss__name" scope="row">
                  <span
                    className="stw-ss__rname"
                    title={room.inCatalog ? bName(room.label) : `${bName(room.label)} — ${copy.ssOffCatalogHint}`}
                  >
                    {bName(room.label)}
                    {!room.inCatalog && <span className="stw-ss__offcat">*</span>}
                  </span>
                  <ChannelMix label={channelLabel} mix={room.channelRevenue} />
                </th>
                <td className="r" />
                {metricCells(room, previousBy.byRoom.get(room.key) ?? 0, !room.inCatalog)}
                <td />
              </tr>
            ))}
          </>
        )}
      </tbody>
    );
  };

  const signed = (value: number) => `${value >= 0 ? "+" : "−"}${fmt.yen(Math.abs(value))}`;
  const yoyDiff = yoy.currentRevenue - yoy.previousRevenue;
  const excludedNames = summary.byProperty.filter((row) => excluded.has(row.propertyName)).map((row) => row.propertyName);

  const kpis: { label: string; value: string; note: string; hero?: boolean }[] = [
    {
      hero: true,
      label: copy.ssGross,
      note: copy.ssGrossNote.replace("{n}", fmt.count(combined.reservationCount)),
      value: fmt.yen(totals.revenue),
    },
    { label: copy.ssCommission, note: copy.ssCommissionNote, value: fmt.yen(totals.commission) },
    { label: copy.ssNet, note: "", value: fmt.yen(totals.net) },
    {
      label: copy.ssOccupancy,
      note: copy.ssOccupancyNote
        .replace("{sold}", fmt.count(totals.occupiedNights))
        .replace("{total}", fmt.count(totals.availableNights)),
      value: fmt.pct(totals.occupancyPct),
    },
    { label: copy.ssAdr, note: copy.ssAdrNote, value: fmt.yen(totals.adr) },
    { label: copy.ssRevpar, note: copy.ssRevparNote, value: fmt.yen(totals.revpar) },
  ];

  return (
    <div className="stw-ss__content">
      <div className="stw-ss__kpis">
        {kpis.map((kpi, index) => (
          <div className={`stw-ss__kpi${kpi.hero ? " is-hero" : ""}`} key={kpi.label} style={{ "--i": index } as React.CSSProperties}>
            <span className="l">{kpi.label}</span>
            <b className="v">{kpi.value}</b>
            {kpi.note && <span className="n">{kpi.note}</span>}
          </div>
        ))}
      </div>

      <div className="stw-ss__strip">
        <span title={copy.ssVacantHint}>
          {copy.ssVacant} <b>{fmt.nights(totals.vacantNights)}</b> <span className="stw-ss__dim">· {copy.ssVacantNote}</span>
        </span>
        <span>
          {combined.futureVacancy.days > 0 ? (
            <>
              {copy.ssFutureVacant.split("{n}")[0]}
              <b className="stw-ss__v">{fmt.count(combined.futureVacancy.vacantNights)}</b>
              {copy.ssFutureVacant.split("{n}")[1]}
            </>
          ) : (
            <span className="stw-ss__dim">{copy.ssFutureNone}</span>
          )}
        </span>
        <span className="stw-ss__yoy" title={shortRange(yoy.previousStart, yoy.previousEndExclusive)}>
          {copy.ssYoyLabel}{" "}
          {yoy.previousRevenue > 0 ? (
            <>
              <b>{fmt.yen(yoy.previousRevenue)}</b>{" "}
              <b className={yoyDiff >= 0 ? "stw-ss__up" : "stw-ss__down"}>{signed(yoyDiff)}</b>
              {yoy.changePct !== null && (
                <span className={yoyDiff >= 0 ? "stw-ss__up" : "stw-ss__down"}>
                  {" "}
                  ({yoy.changePct >= 0 ? "+" : "−"}
                  {Math.abs(yoy.changePct).toFixed(1)}%)
                </span>
              )}
            </>
          ) : (
            <span className="stw-ss__dim">{copy.ssYoyNone}</span>
          )}
        </span>
      </div>

      {(yoy.previousRevenue > 0 || yoy.newRooms.count > 0) && (
        <div className="stw-ss__yoyline">
          <span>
            {copy.ssYoyDiff
              .replace("{diff}", signed(yoyDiff))
              .replace("{a}", signed(yoy.comparable.current - yoy.comparable.previous))
              .replace("{b}", signed(yoy.newRooms.revenue))}
            {yoy.comparable.roomCount > 0 && (
              <>
                {" · "}
                {copy.ssYoyComparable.replace("{n}", fmt.count(yoy.comparable.roomCount))}{" "}
                {fmt.yen(yoy.comparable.previous)} → {fmt.yen(yoy.comparable.current)}
              </>
            )}
          </span>
          {yoy.newRooms.count > 0 && (
            <button
              aria-controls={yoyPanelId}
              aria-expanded={yoyOpen}
              className="stw-link"
              onClick={() => setYoyOpen((value) => !value)}
              type="button"
            >
              {copy.ssYoyNewRooms.replace("{n}", fmt.count(yoy.newRooms.count)).replace("{amount}", fmt.yen(yoy.newRooms.revenue))}
              <ChevronDown aria-hidden="true" className={yoyOpen ? "is-open" : undefined} />
            </button>
          )}
        </div>
      )}
      {yoyOpen && yoy.newRooms.count > 0 && <YoyPanel copy={copy} fmt={fmt} panelId={yoyPanelId} yoy={yoy} />}

      {/* ── 채널별 ── */}
      <section className="stw-ss__sec">
        <h3 className="stw-ss__h3">{copy.ssChannels}</h3>
        <table className="stw-ss__table stw-ss__ch">
          <thead>
            <tr>
              <th scope="col">{copy.ssChannelCol}</th>
              <th className="r" scope="col">{copy.ssRevenueCol}</th>
              <th className="r" scope="col">{copy.ssCommissionCol}</th>
              <th className="r" scope="col">{copy.ssNetCol}</th>
              <th className="r" scope="col">{copy.ssNightsCol}</th>
              <th className="r" scope="col">{copy.ssArrivalsCol}</th>
              <th className="r" scope="col">{copy.ssMixCol}</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((row, index) => (
              <tr key={row.channel} style={{ "--i": index } as React.CSSProperties}>
                <th className="stw-ss__name" scope="row">
                  <i aria-hidden="true" className={`stw-ss__sw is-${row.channel}`} />
                  {channelLabel(row.channel)}
                </th>
                <td className="r stw-ss__chrev" data-label={copy.ssRevenueCol}>
                  {fmt.yen(row.revenue)}
                </td>
                <td className="r" data-label={copy.ssCommissionCol}>
                  {row.channel === "airbnb" || row.channel === "booking" ? fmt.yen(row.commission) : "—"}
                </td>
                <td className="r" data-label={copy.ssNetCol}>
                  {fmt.yen(row.net)}
                </td>
                <td className="r" data-label={copy.ssNightsCol}>
                  {fmt.count(row.nights)}
                </td>
                <td className="r" data-label={copy.ssArrivalsCol}>
                  {fmt.count(row.arrivals)}
                </td>
                <td className="r stw-ss__sharecell" data-label={copy.ssMixCol}>
                  <span className="stw-ss__share">
                    <i aria-hidden="true">
                      <i className={`is-${row.channel}`} style={{ width: `${share(row.revenue)}%` }} />
                    </i>
                    {Math.round(share(row.revenue))}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{copy.ssTotal}</th>
              <td className="r stw-ss__chrev" data-label={copy.ssRevenueCol}>
                {fmt.yen(totals.revenue)}
              </td>
              <td className="r" data-label={copy.ssCommissionCol}>
                {fmt.yen(totals.commission)}
              </td>
              <td className="r" data-label={copy.ssNetCol}>
                {fmt.yen(totals.net)}
              </td>
              <td className="r" data-label={copy.ssNightsCol}>
                {fmt.count(channels.reduce((sum, row) => sum + row.nights, 0))}
              </td>
              <td className="r" data-label={copy.ssArrivalsCol}>
                {fmt.count(channels.reduce((sum, row) => sum + row.arrivals, 0))}
              </td>
              <td className="stw-ss__sharecell" />
            </tr>
          </tfoot>
        </table>
      </section>

      {/* ── 건물별 — 체크 = 합계에 넣기, 「객실」 = 그 건물의 객실 펼치기, 머리글 = 정렬. ── */}
      <section className="stw-ss__sec">
        <div className="stw-ss__sechead">
          <h3 className="stw-ss__h3">{copy.ssProperties}</h3>
          <span className="stw-ss__hint">
            {propertyNames.length > 1 ? `${copy.ssIncludeHint} · ${copy.ssSortHint}` : copy.ssSortHint}
          </span>
        </div>
        <table className="stw-ss__table stw-ss__props">
          <thead>
            <tr>
              <th scope="col">{copy.ssPropertyCol}</th>
              <th aria-sort={sort ? "none" : undefined} className="r" scope="col">
                <button className={`stw-ss__sort${sort ? "" : " on"}`} onClick={() => setSort(null)} title={copy.ssSortReset} type="button">
                  {copy.ssRoomsCol}
                </button>
              </th>
              {sortHead("revenue", copy.ssRevenueCol)}
              {sortHead("occupancyPct", copy.ssOccupancyCol)}
              {sortHead("occupiedNights", copy.ssNightsCol)}
              {sortHead("vacantNights", copy.ssVacantCol)}
              {sortHead("adr", "ADR")}
              <th className="r" scope="col">{copy.ssYoyLabel}</th>
              <th scope="col">
                <span className="stw-sronly">{copy.ssRoomsOpen}</span>
              </th>
            </tr>
          </thead>
          {includedRows.map((row, index) => propertyRow(row, index, false))}
          {excludedRows.map((row, index) => propertyRow(row, includedRows.length + index, true))}
        </table>
      </section>

      <div className="stw-ss__foot">
        <div className="stw-ss__footnotes">
          {excludedNames.length > 0 && (
            <span>
              {copy.ssExcludedTitle}: {excludedNames.map(bName).join(" · ")} — {copy.ssExcludedNote}
            </span>
          )}
          {combined.zeroPriceCount > 0 && <span>{copy.ssZeroNote.replace("{n}", fmt.count(combined.zeroPriceCount))}</span>}
        </div>
        <button
          aria-controls={basisId}
          aria-expanded={basisOpen}
          className="stw-link"
          onClick={() => setBasisOpen((value) => !value)}
          type="button"
        >
          {copy.ssBasisTitle}
        </button>
      </div>
      {basisOpen && (
        <div className="stw-ss__basis" id={basisId} role="note">
          <ul>
            <li>{copy.ssBasisRevenue}</li>
            <li>{copy.ssBasisStatus}</li>
            <li>{copy.ssBasisOccupancy}</li>
            <li>{copy.ssBasisCommission}</li>
          </ul>
          <p>{copy.ssBasisLegacy}</p>
        </div>
      )}
    </div>
  );
}

const shortRange = (start: string, endExclusive: string) => {
  const end = addDays(endExclusive, -1);
  return `${start} → ${end.slice(0, 4) === start.slice(0, 4) ? end.slice(5) : end}`;
};
