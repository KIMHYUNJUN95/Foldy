"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { OrderRequestStatus as OrderStatus } from "@/lib/order-requests";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { tokyoToday } from "@/lib/tokyo-date";
import { haptic } from "@/lib/haptics";
import "@/components/requests/order-detail.css";
import { localizeBuildingName } from "@/lib/room-label-normalization";

/**
 * 주문 배송 캘린더 — 소모품 주문 배송을 큰 월 그리드로 보여주는 바텀시트.
 *
 * 요청 "비품주문 (order)" 탭의 캘린더 아이콘에서 연다. 항목은 직접
 * 각 주문의 `delivery_date`(하루) 또는 `delivery_start_date`..`delivery_end_date`(범위)에서 계산하므로,
 * 관리자가 배송일을 저장/수정하면 자동으로 반영된다 — 별도 저장소는 없다.
 * 공용 정식 BottomSheet 를 써서 아래에서 올라오고 드래그로 닫히며, 스크림
 * 페이드, body 잠금, Esc 를 지원한다 — 닫기 버튼 없음.
 */

export type DeliveryCalendarOrder = {
  id: string;
  buildingName: string;
  roomLabel: string;
  title: string;
  reporterName: string;
  status: OrderStatus;
  deliveryDate: string | null;
  deliveryStartDate: string | null;
  deliveryEndDate: string | null;
};

type Copy = {
  title: string;
  empty: string;
  dayEmpty: string;
  today: string;
  close: string;
  previousMonth: string;
  nextMonth: string;
  countTemplate: string;
  rangeLabel: string;
  monthCountTemplate: string;
  tomorrow: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

// 도쿄 "오늘" YYYY-MM-DD(클라이언트 전용 팝업이라 현재 Date 를 써도 됨).
// 하루가 주문의 배송 구간에 속하는지. 범위가 우선한다(delivery_date 는 시작일을 따라간다).
function dayMatches(order: DeliveryCalendarOrder, iso: string): boolean {
  if (order.deliveryStartDate && order.deliveryEndDate) {
    return iso >= order.deliveryStartDate && iso <= order.deliveryEndDate;
  }
  return order.deliveryDate === iso;
}

function formatDeliveryDate(value: string) {
  return `${+value.slice(5, 7)}/${+value.slice(8, 10)}`;
}

function nextDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function OrderDeliveryCalendar({
  orders,
  locale,
  buildingLabels,
  statusLabels,
  copy,
  onClose,
  onOpenOrder,
}: {
  orders: DeliveryCalendarOrder[];
  locale: Locale;
  buildingLabels: Record<string, string>;
  statusLabels: Record<OrderStatus, string>;
  copy: Copy;
  onClose: () => void;
  onOpenOrder: (id: string) => void;
}) {
  const today = useMemo(() => tokyoToday(), []);
  const [month, setMonth] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { y, m };
  });
  const [selected, setSelected] = useState<string | null>(today);

  // 배송일/구간이 실제로 있는 주문만 나타날 수 있다.
  const deliverable = useMemo(
    () => orders.filter((o) => o.deliveryDate || (o.deliveryStartDate && o.deliveryEndDate)),
    [orders],
  );

  const monthPrefix = `${month.y}-${pad(month.m)}`;
  const isCurrentMonth = monthPrefix === today.slice(0, 7);
  const first = new Date(Date.UTC(month.y, month.m - 1, 1)).getUTCDay();
  const daysIn = new Date(Date.UTC(month.y, month.m, 0)).getUTCDate();

  const monthLabel = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(Date.UTC(month.y, month.m - 1, 15)));

  const ordersOnDay = (iso: string) => deliverable.filter((o) => dayMatches(o, iso));

  const shiftMonth = (delta: number) => {
    setMonth((cur) => {
      const idx = (cur.m - 1) + delta;
      return { y: cur.y + Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 + 1 };
    });
    setSelected(null);
  };
  const goToday = () => {
    const [y, m] = today.split("-").map(Number);
    setMonth({ y, m });
    setSelected(today);
  };

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2025, 0, 5 + i))),
  );

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < first; i++) cells.push(<span key={`pad-${i}`} />);
  for (let d = 1; d <= daysIn; d++) {
    const iso = `${monthPrefix}-${pad(d)}`;
    const has = ordersOnDay(iso).length > 0;
    cells.push(
      <button
        aria-pressed={iso === selected}
        className={cn("odc-day", iso === selected && "is-sel", iso === today && "is-today", has && "has")}
        key={iso}
        onClick={() => {
          haptic("light");
          setSelected(iso);
        }}
        type="button"
      >
        {d}
      </button>,
    );
  }

  const selectedList = selected ? ordersOnDay(selected) : [];
  const selectedLabel = selected
    ? new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(
        new Date(`${selected}T00:00:00Z`),
      )
    : null;
  const rel = selected === today ? copy.today : selected === nextDay(today) ? copy.tomorrow : null;

  // 이번 달(보이는 달) 배송 건수 — 같은 주문이 기간으로 여러 날에 걸쳐도 한 번만 센다.
  const monthCount = deliverable.filter((o) => {
    const s0 = o.deliveryStartDate ?? o.deliveryDate ?? "";
    const e0 = o.deliveryEndDate ?? o.deliveryDate ?? "";
    return s0.slice(0, 7) <= monthPrefix && e0.slice(0, 7) >= monthPrefix;
  }).length;

  return (
    <BottomSheet
      ariaLabel={copy.title}
      className="max-h-[88dvh] flex flex-col"
      header={
        <div className="odc-h">
          <h3>{copy.title}</h3>
          <span>{copy.monthCountTemplate.replace("{n}", String(monthCount))}</span>
        </div>
      }
      onClose={onClose}
      zIndexClassName="z-[120]"
    >
      {() => (
        <div className="odc -mx-5 min-h-0 flex-1 overflow-y-auto px-5">
          {/* 화이트 리디자인(2026-10-14, 시안 OrderCalSheet-Phone): 달 이동 · 일요일 시작 달력(배송 있는 날 보라 점) → 고른 날 배송 줄. */}
          <div className="odc-nav">
            <button aria-label={copy.previousMonth} onClick={() => shiftMonth(-1)} type="button">
              <ChevronLeft aria-hidden="true" />
            </button>
            <b>{monthLabel}</b>
            <button aria-label={copy.nextMonth} onClick={() => shiftMonth(1)} type="button">
              <ChevronRight aria-hidden="true" />
            </button>
            {!isCurrentMonth ? (
              <button className="odc-today" onClick={goToday} type="button">
                {copy.today}
              </button>
            ) : null}
          </div>
          <div className="odc-g odc-wd">
            {weekdays.map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </div>
          <div className="odc-g">{cells}</div>

          {monthCount === 0 ? <p className="odc-empty">{copy.empty}</p> : null}

          {selected ? (
            <div className="odc-day-list">
              <div className="odc-dh">
                <b>{selectedLabel}</b>
                {rel ? <em>{rel}</em> : null}
                {selectedList.length > 0 ? (
                  <span>{copy.countTemplate.replace("{n}", String(selectedList.length))}</span>
                ) : null}
              </div>
              {selectedList.length === 0 ? (
                <p className="odc-empty">{copy.dayEmpty}</p>
              ) : (
                selectedList.map((o) => {
                  // 사전은 건물 키(`kabukicho`)로 찾는다 — 저장된 한국어 이름으로 바로 찾으면 늘 비어 한국어가 남았다(2026-10-22).
                  const building = localizeBuildingName(o.buildingName, buildingLabels);
                  const place = o.roomLabel && o.roomLabel !== "-" ? `${building} · ${o.roomLabel}` : building;
                  const isRange = Boolean(o.deliveryStartDate && o.deliveryEndDate && o.deliveryStartDate !== o.deliveryEndDate);
                  return (
                    <button className="odc-row" key={o.id} onClick={() => onOpenOrder(o.id)} type="button">
                      <span className="odc-row__b">
                        <b>{o.title}</b>
                        <span>
                          {place} · {o.reporterName}
                          {isRange
                            ? ` · ${formatDeliveryDate(o.deliveryStartDate!)} – ${formatDeliveryDate(o.deliveryEndDate!)}`
                            : ""}
                        </span>
                      </span>
                      <span className="odc-row__st">{statusLabels[o.status] ?? o.status}</span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      )}
    </BottomSheet>
  );
}
