// 주문·비품(Orders) 콘솔 — 순수 표시 헬퍼. 서버 VM(admin-orders.ts)을 받아 상태 맵·포매터·
// 배송 D-day·배송 캘린더 레인 패킹을 계산한다. 부수효과 없음(Asia/Tokyo 기준일은 VM.todayKey로
// 주입받아 Date.now()에 의존하지 않음). Claude Design orders-data.js 헬퍼를 TS로 이식.
// docs/product/10-order-request-workflow.md 참고.

import type { AdminOrderVM, OrderDeliv } from "@/lib/admin-orders";
import { dictionaries } from "@/lib/i18n";

export type OrdersLang = "ko" | "ja" | "en";

/** 콘솔 표시용 4상태(DB received → ordered로 매핑됨). */
export type OrderStatus = "requested" | "approved" | "ordered" | "closed";

/** 상태 → { pill 클래스 suffix, i18n 키, 아이콘 이름 } */
export const STATUS: Record<OrderStatus, { cls: OrderStatus; key: string; icon: string }> = {
  requested: { cls: "requested", key: "stRequested", icon: "inbox" },
  approved: { cls: "approved", key: "stApproved", icon: "checkcircle" },
  ordered: { cls: "ordered", key: "stOrdered", icon: "cart" },
  closed: { cls: "closed", key: "stClosed", icon: "ban" },
};

export const BOARD_ORDER: OrderStatus[] = ["requested", "approved", "ordered"];
export const LIST_STATUS: OrderStatus[] = ["requested", "approved", "ordered", "closed"];
export const ACTIVE: OrderStatus[] = ["requested", "approved", "ordered"];

export function isActiveStatus(s: OrderStatus): boolean {
  return ACTIVE.includes(s);
}

/* ---------------- 날짜 헬퍼 ---------------- */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
/** iso(y, m0, d) — m0은 0-based 월. */
export function iso(y: number, m0: number, d: number): string {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}
/** "YYYY-MM-DD" → 절대 일수(UTC epoch day). 순수 계산용. */
export function dateToNum(d: string): number {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd) / 86400000;
}
/** "YYYY-MM-DD HH:MM" → 절대 분(UTC 기준). 정렬 전용. */
export function parseTs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const [d, t] = ts.split(" ");
  const [y, m, dd] = d.split("-").map(Number);
  const [h, mm] = (t || "00:00").split(":").map(Number);
  return Date.UTC(y, m - 1, dd) / 60000 + h * 60 + mm;
}

/* ---------------- 배송 ---------------- */
export function delivStart(deliv: OrderDeliv | null): string | null {
  if (!deliv) return null;
  return deliv.mode === "range" ? deliv.start : deliv.date;
}
export function delivEnd(deliv: OrderDeliv | null): string | null {
  if (!deliv) return null;
  return deliv.mode === "range" ? deliv.end : deliv.date;
}
/** 배송 시작일까지 남은 일수(todayKey 기준). deliv 없으면 null. */
export function delivDaysLeft(deliv: OrderDeliv | null, todayKey: string): number | null {
  const d = delivStart(deliv);
  return d ? dateToNum(d) - dateToNum(todayKey) : null;
}
/** point/range 어느 하루가 날짜 d에 해당하는지. */
export function delivOnDate(deliv: OrderDeliv | null, d: string): boolean {
  if (!deliv) return false;
  if (deliv.mode === "point") return deliv.date === d;
  return d >= deliv.start && d <= deliv.end;
}

export type DelivBadge = { kind: "over" | "today" | "soon"; text: string } | null;
/**
 * ordered 배송 D-day 배지. c = console 사전(dToday/dOver 라벨), lang = 로케일.
 * "일 수" 단위는 사전(`admin.orders.console.dDayUnit`)에서 읽는다 — 예전에는 en이 아니면 무조건
 * 한국어 "일"을 붙여서 일본어 콘솔에 "3일 超過"가 찍혔다.
 */
export function delivBadge(
  deliv: OrderDeliv | null,
  todayKey: string,
  lang: OrdersLang,
  c: { dToday: string; dOver: string },
): DelivBadge {
  const d = delivDaysLeft(deliv, todayKey);
  if (d == null) return null;
  if (d < 0) {
    const unit = dictionaries[lang].admin.orders.console.dDayUnit;
    return { kind: "over", text: `${-d}${unit} ${c.dOver}` };
  }
  if (d === 0) return { kind: "today", text: c.dToday };
  return { kind: "soon", text: `D-${d}` };
}

/** 배송 정보 텍스트(point 단일일 / range "start ~ end" / 미정). */
export function delivText(
  deliv: OrderDeliv | null,
  lang: OrdersLang,
  c: { delivTBD: string; calRangeTo: string },
): string {
  if (!deliv) return c.delivTBD;
  if (deliv.mode === "range") return `${fmtDate(deliv.start, lang)} ${c.calRangeTo} ${fmtDate(deliv.end, lang)}`;
  return fmtDate(deliv.date, lang);
}

/** ordered이고 배송(point/range)이 이번 주(월~일, todayKey 포함)와 겹치는가. */
export function isDelivThisWeek(vm: AdminOrderVM, todayKey: string): boolean {
  if (vm.status !== "ordered" || !vm.deliv) return false;
  const w = weekWindow(todayKey);
  const s = dateToNum(delivStart(vm.deliv)!);
  const e = dateToNum(delivEnd(vm.deliv)!);
  return e >= w.from && s <= w.to;
}
/** "YYYY-MM-DD"가 todayKey와 같은 달(YYYY-MM)인가. */
export function inThisMonth(d: string | null | undefined, todayKey: string): boolean {
  return !!d && d.slice(0, 7) === todayKey.slice(0, 7);
}
/** todayKey를 포함하는 월~일 주간 창(절대 일수). */
export function weekWindow(todayKey: string): { from: number; to: number } {
  const todayNum = dateToNum(todayKey);
  const dt = new Date(todayNum * 86400000);
  const dow = (dt.getUTCDay() + 6) % 7; // 월=0
  const from = todayNum - dow;
  return { from, to: from + 6 };
}

/* ---------------- 포매터 ---------------- */
export function fmtDate(d: string, lang: OrdersLang): string {
  return new Intl.DateTimeFormat(lang, {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${d}T00:00:00+09:00`));
}
export function fmtDateTime(ts: string | null | undefined, lang: OrdersLang): string {
  if (!ts) return "—";
  const [d, t] = ts.split(" ");
  return `${fmtDate(d, lang)} ${t}`;
}
/** fmtMonth(y, m0, lang) — m0은 0-based 월. */
export function fmtMonth(y: number, m0: number, lang: OrdersLang): string {
  return new Intl.DateTimeFormat(lang, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m0, 1)));
}
const weekdayLabels = (lang: OrdersLang) =>
  Array.from({ length: 7 }, (_, day) =>
    new Intl.DateTimeFormat(lang, { weekday: "narrow", timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 7, 2 + day)),
    ),
  );

export const WD: Record<OrdersLang, string[]> = {
  ko: weekdayLabels("ko"),
  ja: weekdayLabels("ja"),
  en: weekdayLabels("en"),
};

/* ---------------- 보드 정렬 ---------------- */
/** 긴급(high) 우선, 그다음 오래된 요청 우선. */
export function sortForBoard(list: AdminOrderVM[]): AdminOrderVM[] {
  return list.slice().sort((a, b) => {
    const ua = a.urgency === "high";
    const ub = b.urgency === "high";
    if (ua !== ub) return ua ? -1 : 1;
    return (parseTs(a.reqAt) ?? 0) - (parseTs(b.reqAt) ?? 0);
  });
}

/* ---------------- 배송 캘린더(레인 배치) ---------------- */
export type CalEvent = { o: AdminOrderVM; s: number; e: number; urgent: boolean; lane: number };
export type CalEvents = { evs: CalEvent[]; lanes: number; dayMap: Record<string, AdminOrderVM[]> };

/**
 * ordered 주문의 배송을 그리디 인터벌 패킹으로 레인 배정한다(range가 여러 날에 걸쳐 한 레인 유지).
 * calProp: "all" 또는 buildingKey 필터.
 */
export function calEvents(orders: AdminOrderVM[], calProp: string): CalEvents {
  const evs: CalEvent[] = orders
    .filter((o) => o.status === "ordered" && o.deliv && (calProp === "all" || o.buildingKey === calProp))
    .map((o) => ({
      o,
      s: dateToNum(delivStart(o.deliv)!),
      e: dateToNum(delivEnd(o.deliv)!),
      urgent: o.urgency === "high",
      lane: 0,
    }))
    .sort((a, b) => a.s - b.s || (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.o.id.localeCompare(b.o.id));
  const laneEnd: number[] = [];
  evs.forEach((ev) => {
    let ln = laneEnd.findIndex((end) => end < ev.s);
    if (ln < 0) ln = laneEnd.length;
    laneEnd[ln] = ev.e;
    ev.lane = ln;
  });
  const dayMap: Record<string, AdminOrderVM[]> = {};
  evs.forEach((ev) => {
    for (let n = ev.s; n <= ev.e; n++) {
      const dt = new Date(n * 86400000);
      const k = iso(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
      (dayMap[k] = dayMap[k] || []).push(ev.o);
    }
  });
  return { evs, lanes: laneEnd.length, dayMap };
}

/** 간단 템플릿 치환: tpl("총 {n}건", {n: 3}) → "총 3건". */
export function tpl(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
