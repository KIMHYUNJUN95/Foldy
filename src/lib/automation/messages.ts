/**
 * 자동화 Slack 메시지 — 숫자 계산과 문장 만들기. **순수하다**(DB · 시계 없음 → 테스트 · 미리보기가 같은 함수를 쓴다).
 *
 * 도메인 계약: docs/product/36-automation-control.md 「저쪽 설계 — 읽어낸 내용」 · 「메시지 언어」
 *
 * 규칙은 저쪽(STAY ARI Manager)을 **그대로** 재현한다(2026-09-30 결정 ①). 출처:
 * - 일일 운영 리포트: `functions/modules/slackReports.js` `buildAndSendSlackDailyReport` (:179-441)
 * - 청소 · 셋팅 명단: 같은 파일 `buildAndSendSlackCleaningReport` (:756-986)
 * - 취소 · 당일예약 알림: `cancelAlert.js` `formatCancelAlertMessage` · `sameDayBookingAlert.js` `formatSameDayMessage`
 *
 * 바꾼 것(36번 문서): 문구는 받는 곳마다 고른 언어(ko/ja/en)로, 건물 이름은 우리 건물 정보에서, 담당자는 대시보드
 * 수기 입력만(Hotelsmart 수집 안 함), 「당일 취소」 제목은 실제 동작대로 「취소」.
 *
 * 표시 형식(2026-10-07 저쪽 메시지와 대조 후 사용자 결정 — 36번 「표시 형식」): 건물 순서 · 오쿠보 · 사노 이름은
 * 저쪽대로(`automationBuildingLabel`), 스테이아리 방은 숫자만, 알림 금액은 0원도 `¥0`, 플랫폼 `Booking`.
 */

import type { HealthAlert } from "@/lib/automation/health";
import type { Dictionary } from "@/lib/i18n";
import { legacyReservationAmount } from "@/lib/ops-sales-summary";
import { tokyoDateOf, ymdShift } from "@/lib/tokyo-date";
import type { AutomationLocale, DailyReportChannel } from "@/lib/automation/jobs";
import {
  bookDateOf,
  bookingIdOf,
  bookingInstantOf,
  cancelInstantOf,
  exactReferer,
  guestCountsOf,
  originalAmountOf,
  platformLabel,
  type AutomationReservation,
} from "@/lib/automation/reservation-fields";

export type MessageCopy = Dictionary["automationMessages"];

export const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [key, value]) => out.split(`{${key}}`).join(String(value)), template);

/**
 * 자동화 메시지의 건물 이름 — 저쪽 메시지 이름을 살리는 건물만 사전(`automationMessages.buildings`)에서 덮고,
 * 나머지는 `fallback`(우리 건물 정보 · 공용 건물 이름). 청소 명단 제목은 「오쿠보A」(2026-11-09 동 표시 뺌), 일일 리포트는 「오쿠보A동」 ·
 * 「사노시」 — 저쪽이 두 메시지에서 다르게 썼고 현장이 그 이름에 익숙하다(2026-10-07 사용자 결정).
 */
const AUTOMATION_BUILDING_KEY: Record<string, "okubo_a" | "okubo_b" | "okubo_c" | "sano"> = {
  오쿠보A: "okubo_a",
  오쿠보B: "okubo_b",
  오쿠보C: "okubo_c",
  사노: "sano",
};

export function automationBuildingLabel(
  copy: MessageCopy,
  kind: "cleaning" | "daily",
  canonicalName: string,
  fallback: (canonicalName: string) => string,
): string {
  const key = AUTOMATION_BUILDING_KEY[canonicalName];
  const names: Partial<Record<string, string>> = copy.buildings[kind];
  return (key && names[key]) || fallback(canonicalName);
}

/** 알림의 플랫폼 이름 — Beds24 원본 그대로, 단 `Booking.com` 은 `Booking`(2026-10-07 사용자 결정). */
export function alertPlatformLabel(platform: string): string {
  return /^booking\.com$/i.test(platform.trim()) ? "Booking" : platform;
}

export function formatYen(value: number): string {
  return `¥${Math.round(value).toLocaleString("en-US")}`;
}

function count(copy: MessageCopy, n: number): string {
  return fill(copy.countFormat, { n });
}

function monthLabel(copy: MessageCopy, month: number, locale: AutomationLocale): string {
  const short = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2000, month - 1, 1)));
  return fill(copy.monthFormat, { m: month, mon: locale === "en" ? short : String(month) });
}

/** 입실월(1~12) → 건수. 저쪽처럼 **월 숫자 순**으로 늘어놓는다(1월이 10월보다 앞 — 그대로 재현). */
type MonthCounts = Map<number, number>;

function bump(map: MonthCounts, checkIn: string) {
  const month = Number(checkIn.slice(5, 7));
  if (!Number.isFinite(month) || month < 1) return;
  map.set(month, (map.get(month) ?? 0) + 1);
}


/**
 * 날짜 + 요일(도쿄 달력 날짜 그대로) — 「10/7(수)」 · 「10/7(水)」 · 「Wed 10/7」. 올해가 아니면 연도를 붙인다(2027/3/5(금)).
 * 폰 Slack 에서 「2026-10-07」 보다 짧고, 요일이 있어 현장이 바로 안다(2026-10-07 가독성 개선).
 */
export function dayLabel(copy: MessageCopy, date: string, today?: string | null): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || "-";
  const [y, m, d] = date.split("-").map(Number);
  const weekday = copy.weekdays.split(",")[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  const sameYear = !today || today.slice(0, 4) === date.slice(0, 4);
  const md = fill(sameYear ? copy.mdFormat : copy.ymdFormat, { d, m, y });
  return fill(copy.dayFormat, { md, wd: weekday });
}

/** 입실월 목록(짧게) — 「4월 1건, 10월 3건」. */
function monthBrief(copy: MessageCopy, locale: AutomationLocale, map: MonthCounts): string {
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, n]) => `${monthLabel(copy, month, locale)} ${count(copy, n)}`)
    .join(copy.listSeparator);
}

// ── 일일 운영 리포트 ─────────────────────────────────────────────────────

export type DailyBuildingStats = {
  propertyName: string;
  newCount: number;
  cancelCount: number;
  revenue: number;
  /** 취소된 예약의 원래 금액 합(요금 내역으로 되살림 — `originalAmountOf`). */
  cancelRevenue: number;
  /** 원래 금액을 알 수 없는 취소 수. */
  cancelUnknown: number;
  newMonths: MonthCounts;
  cancelMonths: MonthCounts;
};

export type DailyDetail = { propertyName: string; roomLabel: string; guestName: string; amount: number };

export type DailyStats = {
  reportDate: string;
  totalNew: number;
  totalCancel: number;
  revenue: number;
  /** 어제 취소된 예약의 원래 금액 합 · 금액을 모르는 취소 수 — 「얼마가 빠져나갔나」(2026-10-07 사용자 요구). */
  cancelRevenue: number;
  cancelUnknown: number;
  mtdNew: number;
  newByChannel: Record<DailyReportChannel, number>;
  cancelByChannel: Record<DailyReportChannel, number>;
  newMonths: MonthCounts;
  cancelMonths: MonthCounts;
  mtdMonths: MonthCounts;
  buildings: DailyBuildingStats[];
  newDetails: DailyDetail[];
  cancelDetails: DailyDetail[];
};

/** 저쪽 `referer` 원문 → 채널. 정확히 같을 때만. */
function channelOf(raw: AutomationReservation["raw"]): DailyReportChannel | null {
  const referer = exactReferer(raw);
  if (referer === "Airbnb") return "airbnb";
  if (referer === "Booking.com") return "booking";
  return null;
}

function isConfirmed(reservation: AutomationReservation): boolean {
  if (reservation.status === "cancelled") return false;
  const raw = String(reservation.raw.status ?? "").toLowerCase();
  if (raw === "") return reservation.status === "confirmed";
  return raw === "1" || raw === "2" || raw === "new" || raw === "confirmed";
}

/**
 * 어제(`reportDate`) 숫자. `reservations` 에는 이번 달 예약일 · 어제 취소 후보가 섞여 들어온다 — 여기서 거른다.
 *
 * - 신규: 채널 Airbnb · Booking.com(설정) · 확정 · 예약일 = 어제 · 금액 > 0 · 제외 건물 아님.
 * - 취소: 같은 채널 · 취소 상태 · 도쿄 기준 취소일 = 어제 · 입실일이 어제 ±6개월 안(저쪽 :258-262).
 * - 당월 누적: 예약일 1일~어제 · 확정 · 금액 > 0.
 */
export function computeDailyStats(input: {
  reservations: AutomationReservation[];
  reportDate: string;
  /** 리포트에 늘어놓을 건물(운영 순서) — 0건이어도 줄이 나온다(저쪽처럼). */
  buildingOrder: readonly string[];
  /** 예약 건물 이름 → 운영 표준 이름. */
  canonicalProperty: (propertyName: string) => string;
  excludedProperties: readonly string[];
  channels: readonly DailyReportChannel[];
}): DailyStats {
  const { reportDate } = input;
  const monthStart = `${reportDate.slice(0, 7)}-01`;
  const excluded = new Set(input.excludedProperties);
  const allowed = new Set(input.channels);
  const lowerArrival = ymdShift(reportDate, -183);
  const upperArrival = ymdShift(reportDate, 183);

  const buildings = new Map<string, DailyBuildingStats>();
  for (const name of input.buildingOrder) {
    if (excluded.has(name)) continue;
    buildings.set(name, {
      cancelCount: 0,
      cancelMonths: new Map(),
      cancelRevenue: 0,
      cancelUnknown: 0,
      newCount: 0,
      newMonths: new Map(),
      propertyName: name,
      revenue: 0,
    });
  }

  const stats: DailyStats = {
    buildings: [],
    cancelByChannel: { airbnb: 0, booking: 0 },
    cancelDetails: [],
    cancelMonths: new Map(),
    cancelRevenue: 0,
    cancelUnknown: 0,
    mtdMonths: new Map(),
    mtdNew: 0,
    newByChannel: { airbnb: 0, booking: 0 },
    newDetails: [],
    newMonths: new Map(),
    reportDate,
    revenue: 0,
    totalCancel: 0,
    totalNew: 0,
  };

  const seen = new Set<string>();
  for (const reservation of input.reservations) {
    if (seen.has(reservation.id)) continue;
    seen.add(reservation.id);
    const propertyName = input.canonicalProperty(reservation.propertyName);
    if (excluded.has(propertyName)) continue;
    const channel = channelOf(reservation.raw);
    if (!channel || !allowed.has(channel)) continue;
    const amount = legacyReservationAmount(reservation.raw);
    const bookDate = bookDateOf(reservation.raw);
    const building = buildings.get(propertyName);

    if (isConfirmed(reservation) && amount > 0 && bookDate && bookDate >= monthStart && bookDate <= reportDate) {
      stats.mtdNew += 1;
      bump(stats.mtdMonths, reservation.checkIn);
      if (bookDate === reportDate) {
        stats.totalNew += 1;
        stats.revenue += amount;
        stats.newByChannel[channel] += 1;
        bump(stats.newMonths, reservation.checkIn);
        stats.newDetails.push({ amount, guestName: reservation.guestName, propertyName, roomLabel: reservation.roomLabel });
        if (building) {
          building.newCount += 1;
          building.revenue += amount;
          bump(building.newMonths, reservation.checkIn);
        }
      }
      continue;
    }

    if (reservation.status === "cancelled") {
      const instant = cancelInstantOf(reservation.raw, true);
      if (!instant || tokyoDateOf(instant) !== reportDate) continue;
      if (reservation.checkIn && (reservation.checkIn <= lowerArrival || reservation.checkIn >= upperArrival)) continue;
      stats.totalCancel += 1;
      stats.cancelByChannel[channel] += 1;
      bump(stats.cancelMonths, reservation.checkIn);
      const original = originalAmountOf(reservation.raw, amount, reservation.lastKnownAmount);
      if (original === null) stats.cancelUnknown += 1;
      else stats.cancelRevenue += original;
      stats.cancelDetails.push({ amount: original ?? 0, guestName: reservation.guestName, propertyName, roomLabel: reservation.roomLabel });
      if (building) {
        building.cancelCount += 1;
        if (original === null) building.cancelUnknown += 1;
        else building.cancelRevenue += original;
        bump(building.cancelMonths, reservation.checkIn);
      }
    }
  }

  stats.buildings = [...buildings.values()];
  return stats;
}

/** 재전송 비교에 쓰는 숫자 4개(저쪽 `slack_report_snapshots`). */
export type DailySnapshot = { totalNew: number; totalCancel: number; revenue: number; mtdNew: number };

export function dailySnapshotOf(stats: DailyStats): DailySnapshot {
  return { mtdNew: stats.mtdNew, revenue: Math.round(stats.revenue), totalCancel: stats.totalCancel, totalNew: stats.totalNew };
}

/**
 * 변동 재전송을 할 만큼 바뀌었나 — **어제 숫자(신규 · 취소 · 매출)만** 본다. 당월 누적은 이번 달 예약이 오늘 취소될 때마다
 * 바뀌어(하루 0 ~ 11건, 2026-09-29 ~ 10-06 실측) 거의 매일 재전송이 나가므로 기준에서 뺐다(2026-10-07 사용자 결정).
 * 다른 이유로 재전송할 때 당월 누적 변동은 「변동」 줄에 같이 나온다.
 */
export function sameSnapshot(a: DailySnapshot, b: DailySnapshot): boolean {
  return a.totalNew === b.totalNew && a.totalCancel === b.totalCancel && a.revenue === b.revenue;
}

export function buildDailyReportMessage(input: {
  stats: DailyStats;
  copy: MessageCopy;
  locale: AutomationLocale;
  propertyLabel: (canonicalName: string) => string;
  /** 변동 재전송이면 직전에 보낸 숫자. */
  previous?: DailySnapshot | null;
}): string {
  const { stats, copy, locale } = input;
  const d = copy.daily;
  const c = (n: number) => count(copy, n);
  // 폰 Slack 에서 한 줄이 넘치지 않게 — 요약은 건수 / 매출을 나누고, 건물은 「이름 + 매출」 아래에 예약 · 취소 줄(2026-10-07).
  const lines: string[] = [
    fill(d.title, { date: dayLabel(copy, stats.reportDate) }),
    "",
    d.sectionTotal,
    fill(d.totalsCounts, { cancel: c(stats.totalCancel), new: c(stats.totalNew) }),
    fill(d.totalsRevenue, { revenue: formatYen(stats.revenue) }),
    // 취소된 예약의 원래 금액 — 매출 바로 아래 한 줄(폰에서 한 줄에 몰지 않는다).
    ...(stats.totalCancel > 0
      ? [
          fill(d.totalsCancelRevenue, { amount: formatYen(stats.cancelRevenue) }) +
            (stats.cancelUnknown > 0 ? fill(d.cancelUnknown, { n: stats.cancelUnknown }) : ""),
        ]
      : []),
    fill(d.newChannels, { airbnb: c(stats.newByChannel.airbnb), booking: c(stats.newByChannel.booking) }),
    fill(d.cancelChannels, { airbnb: c(stats.cancelByChannel.airbnb), booking: c(stats.cancelByChannel.booking) }),
    fill(d.newMonths, { list: monthBrief(copy, locale, stats.newMonths) || copy.emptyValue }),
    fill(d.cancelMonths, { list: monthBrief(copy, locale, stats.cancelMonths) || copy.emptyValue }),
    "",
    d.sectionBuildings,
  ];
  const quiet: string[] = [];
  for (const building of stats.buildings) {
    const name = input.propertyLabel(building.propertyName);
    if (building.newCount === 0 && building.cancelCount === 0 && building.revenue <= 0) {
      quiet.push(name);
      continue;
    }
    const newMonths = monthBrief(copy, locale, building.newMonths);
    const cancelMonths = monthBrief(copy, locale, building.cancelMonths);
    lines.push(fill(d.buildingHead, { name, revenue: building.revenue > 0 ? `*${formatYen(building.revenue)}*` : "" }).trimEnd());
    lines.push(fill(d.buildingNew, { months: newMonths ? ` · ${newMonths}` : "", n: c(building.newCount) }));
    if (building.cancelCount > 0) {
      const lost =
        (building.cancelRevenue > 0 ? ` · *${formatYen(building.cancelRevenue)}*` : "") +
        (building.cancelUnknown > 0 ? fill(d.cancelUnknown, { n: building.cancelUnknown }) : "");
      lines.push(fill(d.buildingCancel, { months: cancelMonths ? ` · ${cancelMonths}` : "", n: c(building.cancelCount) }) + lost);
    }
  }
  if (quiet.length > 0) lines.push(fill(d.buildingsQuiet, { list: quiet.join(copy.listSeparator) }));
  lines.push(
    "",
    d.sectionMtd,
    fill(d.mtdTotal, { count: c(stats.mtdNew) }),
    fill(d.mtdMonths, { list: monthBrief(copy, locale, stats.mtdMonths) || copy.emptyValue }),
  );

  if (input.previous) {
    const now = dailySnapshotOf(stats);
    const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
    const parts: string[] = [];
    if (now.totalNew !== input.previous.totalNew) parts.push(fill(d.changeNew, { delta: sign(now.totalNew - input.previous.totalNew) }));
    if (now.totalCancel !== input.previous.totalCancel) parts.push(fill(d.changeCancel, { delta: sign(now.totalCancel - input.previous.totalCancel) }));
    if (now.revenue !== input.previous.revenue) {
      const delta = now.revenue - input.previous.revenue;
      parts.push(fill(d.changeRevenue, { delta: `${delta > 0 ? "+" : "-"}${formatYen(Math.abs(delta))}` }));
    }
    if (now.mtdNew !== input.previous.mtdNew) parts.push(fill(d.changeMtd, { delta: sign(now.mtdNew - input.previous.mtdNew) }));
    if (parts.length > 0) lines.push("", fill(d.changes, { list: parts.join(" | ") }));

    const MAX_DETAIL = 10;
    const detail = (item: DailyDetail, cancelled: boolean) =>
      `${input.propertyLabel(item.propertyName)} ${item.roomLabel || "-"} | ${(item.guestName || "-").slice(0, 12)}${
        cancelled ? ` ${d.cancelledTag}` : ` | *${formatYen(item.amount)}*`
      }`;
    lines.push("", d.sectionDetail);
    if (stats.newDetails.length > 0) {
      lines.push(fill(d.detailNew, { count: c(stats.newDetails.length) }), ...stats.newDetails.slice(0, MAX_DETAIL).map((item) => detail(item, false)));
      if (stats.newDetails.length > MAX_DETAIL) lines.push(fill(d.detailMore, { count: c(stats.newDetails.length - MAX_DETAIL) }));
    } else {
      lines.push(d.detailNoNew);
    }
    lines.push("");
    if (stats.cancelDetails.length > 0) {
      lines.push(fill(d.detailCancel, { count: c(stats.cancelDetails.length) }), ...stats.cancelDetails.slice(0, MAX_DETAIL).map((item) => detail(item, true)));
      if (stats.cancelDetails.length > MAX_DETAIL) lines.push(fill(d.detailMore, { count: c(stats.cancelDetails.length - MAX_DETAIL) }));
    } else {
      lines.push(d.detailNoCancel);
    }
  }
  return lines.join("\n");
}

// ── 청소 · 셋팅 명단 ─────────────────────────────────────────────────────

export type CleaningListRoom = {
  roomKey: string;
  propertyName: string;
  /** 방 표시 코드(AA201 · K302 · T4 …). */
  code: string;
  /** `extra` = 사람이 담당자 탭에서 직접 더한 청소 방(Hotelsmart 대신 — 연박 청소 등). */
  kind: "turnover" | "no_checkin" | "setting" | "extra";
  guestName: string | null;
  pax: number | null;
  /** `extra` 의 메모(「연박 청소」). 없으면 「추가 청소」. */
  note?: string | null;
};

/** 오늘 청소 · 셋팅에 걸리는 예약 중 필수 정보(건물 · 객실 · 날짜 · 예약 번호)가 빠진 것 — 명단 끝에 경고로 붙는다. */
export type CleaningDataIssue = { code: string; bookingId: string };

export type CleaningListModel = {
  targetDate: string;
  cleaning: CleaningListRoom[];
  setting: CleaningListRoom[];
  dataIssues?: CleaningDataIssue[];
};

function roomLine(copy: MessageCopy, room: CleaningListRoom, names: ReadonlyMap<string, string>): string {
  const label =
    room.kind === "extra"
      ? room.note?.trim() || copy.cleaning.extraDefault
      : room.kind === "no_checkin"
      ? room.pax !== null
        ? `${copy.cleaning.noCheckIn} (${room.pax})`
        : copy.cleaning.noCheckIn
      : `${room.guestName || "-"}${room.pax !== null ? ` (${room.pax})` : ""}`;
  const assignee = names.get(room.roomKey)?.trim();
  return `*${room.code}* | ${label}${assignee ? ` | ${assignee}` : ""}`;
}

function grouped(
  copy: MessageCopy,
  rooms: CleaningListRoom[],
  names: ReadonlyMap<string, string>,
  buildingOrder: readonly string[],
  propertyLabel: (name: string) => string,
): string[] {
  const groups = new Map<string, CleaningListRoom[]>();
  for (const room of rooms) {
    const list = groups.get(room.propertyName) ?? [];
    list.push(room);
    groups.set(room.propertyName, list);
  }
  const order = [...buildingOrder, ...[...groups.keys()].filter((name) => !buildingOrder.includes(name)).sort()];
  const out: string[] = [];
  for (const name of order) {
    const list = groups.get(name);
    if (!list || list.length === 0) continue;
    if (out.length > 0) out.push("");
    // 건물 이름은 굵게(2026-10-08 사용자 요구) — 폰에서 건물 묶음이 바로 눈에 띄게.
    out.push(`*${propertyLabel(name)}*`);
    for (const room of [...list].sort((a, b) => a.code.localeCompare(b.code, "ko", { numeric: true }))) {
      out.push(roomLine(copy, room, names));
    }
  }
  return out;
}

/**
 * 청소 · 셋팅 명단. 담당자 이름은 **넣은 객실만** 붙는다(없으면 아무것도 안 붙음 — 저쪽의 「담당자 미배정」 없음).
 * `correction` 이면 머리말 「정정본」.
 */
export function buildCleaningListMessage(input: {
  model: CleaningListModel;
  names: ReadonlyMap<string, string>;
  copy: MessageCopy;
  buildingOrder: readonly string[];
  propertyLabel: (canonicalName: string) => string;
  correction?: boolean;
}): string {
  const { copy, model } = input;
  const cleaning = grouped(copy, model.cleaning, input.names, input.buildingOrder, input.propertyLabel);
  const setting = grouped(copy, model.setting, input.names, input.buildingOrder, input.propertyLabel);
  const lines: string[] = [];
  if (input.correction) lines.push(copy.cleaning.correction, copy.cleaning.correctionNote, "");
  lines.push(fill(copy.cleaning.date, { date: model.targetDate }), "");
  lines.push(...(cleaning.length > 0 ? cleaning : [copy.cleaning.none]));
  lines.push("", "*------------------------------------------------*", "", copy.cleaning.settingTitle, "");
  lines.push(...(setting.length > 0 ? setting : [copy.cleaning.none]));
  // 필수 정보가 빠진 예약 — 명단은 막지 않고 끝에 경고(2026-10-07 결정: 아침 명단이 통째로 안 나가는 쪽이 더 위험).
  const issues = model.dataIssues ?? [];
  if (issues.length > 0) {
    const MAX = 8;
    const list = issues.slice(0, MAX).map((item) => `${item.code || "?"}(${item.bookingId || "?"})`);
    if (issues.length > MAX) list.push(fill(copy.cleaning.dataIssueMore, { n: issues.length - MAX }));
    lines.push("", fill(copy.cleaning.dataIssue, { list: list.join(" · "), n: issues.length }));
  }
  return lines.join("\n");
}

/**
 * 정정본 판단용 명단 지문 — **현장 일이 바뀌는 것만** 본다: 방 · 청소/셋팅/체크인 X 구분 · 인원(셋팅 비품 수) · 추가 방 메모.
 * 게스트 이름(철자 수정 등)과 담당자 이름은 넣지 않는다 — 이름 수정은 정정본을 자동으로 만들지 않는다(2026-10-07 결정,
 * 담당자 이름은 「정정본 보내기」 버튼).
 */
export function cleaningStructureKey(model: CleaningListModel): string {
  const line = (room: CleaningListRoom) => `${room.roomKey}|${room.kind}|${room.pax ?? ""}|${room.note ?? ""}`;
  return [model.targetDate, ...model.cleaning.map(line).sort(), "#", ...model.setting.map(line).sort()].join("\n");
}

// ── 취소 · 당일예약 알림 ─────────────────────────────────────────────────

/**
 * 취소 · 당일예약 알림 = **Slack 카드**(Block Kit — 2026-10-07 사용자 결정, 이 두 채널만).
 *
 * 폰 Slack 앱에서 제목 · 2열 칸(숙박 · 금액 · 인원 · 채널) · 작은 회색 줄 · 링크로 나뉘어 보인다. 잠금화면 알림은 카드를 못 그리므로
 * `notify`(한 줄 — 무슨 일 · 방 · 날짜 · 금액)가 뜬다. 「Foldy 에서 열기」는 버튼이 아니라 **굵은 링크 줄** — URL 버튼도 Slack 이
 * 앱에 클릭 신호를 보내 응답을 기다리는데, 우리 Slack 앱은 그 주소(Interactivity)가 없어 경고가 뜰 수 있다.
 */
export type AlertCard = {
  /** Slack `text` — 잠금화면 · 배너 알림 한 줄(카드를 못 그리는 곳). */
  notify: string;
  /** 제목 — 무슨 일 · **건물만**(객실은 아래 줄, 2026-10-08 사용자 요구). */
  header: string;
  /**
   * 본문 줄 — 한 줄에 칸 1 ~ 2개. Slack 폰 앱은 `section.fields` 를 2열이 아니라 **세로 1열로 쌓아** 목록처럼 보였다
   * (2026-10-08 iPhone 캡처). 그래서 칸 대신 줄로 — 항목마다 한 줄, 묶음(방 · 채널 / 숙박 / 금액 · 인원) 사이는 빈 줄.
   */
  rows: Array<Array<{ label: string; value: string }>>;
  /** 작은 회색 줄 — 게스트 · 예약 번호 · 취소 시각. */
  context: string;
  link: { url: string; label: string } | null;
};

type AlertInput = {
  kind: "cancel" | "same_day";
  reservation: AutomationReservation;
  copy: MessageCopy;
  propertyLabel: string;
  /** 방 코드(청소 명단과 같은 AA302 · K802 · T4 · 308). 오쿠보처럼 건물 = 방이면 빈 문자열 → 객실 칸을 뺀다. */
  roomLabel: string;
  /** 예약 바로가기(`/go/reservation/<id>` — 권한을 보고 판매 캘린더로 보내거나 「권한 없음」). 없으면 링크를 뺀다. */
  openUrl: string | null;
  /** 오늘(도쿄) — 「오늘」 표시 · 연도 생략 판단. 없으면 연도를 늘 생략. */
  today?: string | null;
};

function weekdayOf(copy: MessageCopy, date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return copy.weekdays.split(",")[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

/** 숙박 칸 — 같은 달이면 끝날의 월을 뺀다(「11/20(금) → 24(화)」 — 폰 2열 칸에서 덜 꺾이게). */
function stayRange(copy: MessageCopy, checkIn: string, checkOut: string, today: string | null): string {
  if (!checkIn || !checkOut) return `${checkIn ? dayLabel(copy, checkIn, today) : "-"} → ${checkOut ? dayLabel(copy, checkOut, today) : "-"}`;
  const sameMonth = checkIn.slice(0, 7) === checkOut.slice(0, 7);
  const end = sameMonth
    ? fill(copy.dayFormat, { md: Number(checkOut.slice(8, 10)), wd: weekdayOf(copy, checkOut) })
    : dayLabel(copy, checkOut, today);
  return `${dayLabel(copy, checkIn, today)} → ${end}`;
}

/** 알림 한 줄의 날짜 — 「11/20~24」 · 「11/30~12/2」. */
function stayBrief(checkIn: string, checkOut: string): string {
  if (!checkIn || !checkOut) return "";
  const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  return checkIn.slice(0, 7) === checkOut.slice(0, 7) ? `${md(checkIn)}~${Number(checkOut.slice(8, 10))}` : `${md(checkIn)}~${md(checkOut)}`;
}

/** Slack mrkdwn 에서 게스트 이름 등 바깥 글자가 문법으로 읽히지 않게. */
function escapeMrkdwn(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildReservationAlertCard(input: AlertInput): AlertCard {
  const { copy, reservation } = input;
  const a = copy.alert;
  const today = input.today ?? null;
  const nights =
    reservation.checkIn && reservation.checkOut
      ? Math.max(0, Math.round((Date.parse(`${reservation.checkOut}T00:00:00Z`) - Date.parse(`${reservation.checkIn}T00:00:00Z`)) / 86_400_000))
      : 0;
  const guests = guestCountsOf(reservation.raw);
  const guestText =
    guests.total > 0
      ? guests.children > 0
        ? fill(a.guestsWithChildren, { c: guests.children, n: guests.total })
        : fill(a.guestsTotal, { n: guests.total })
      : null;
  const cancel = input.kind === "cancel";
  const current = legacyReservationAmount(reservation.raw);
  // 취소는 Beds24 가 금액을 0 으로 비운다 — DB 가 기억한 금액 · 요금 내역으로 되살린다(「얼마가 빠졌나」).
  const amount = cancel ? originalAmountOf(reservation.raw, current, reservation.lastKnownAmount) : current;
  const amountText = amount === null ? a.amountUnknown : formatYen(amount);
  const stay = `${reservation.checkIn && reservation.checkIn === today ? `${a.today} ` : ""}${stayRange(copy, reservation.checkIn, reservation.checkOut, today)}`;
  const header = fill(cancel ? a.cancelHeader : a.sameDayHeader, { property: input.propertyLabel }).trim();
  const room = input.roomLabel.trim();
  const contextParts = [reservation.guestName || "-", fill(a.bookingId, { id: bookingIdOf(reservation.raw, reservation.id) })];
  if (cancel) {
    const instant = cancelInstantOf(reservation.raw, true);
    if (instant) {
      const { date, time } = tokyoDateTimeParts(instant);
      contextParts.push(fill(a.cancelledAt, { time: `${dayLabel(copy, date, today)} ${time}` }));
    }
  }
  const channel = { label: a.fieldChannel, value: alertPlatformLabel(platformLabel(reservation.raw)) };
  const amountCell = { label: cancel ? a.fieldCancelAmount : a.fieldAmount, value: amountText };
  return {
    context: contextParts.join(" · "),
    header,
    link: input.openUrl ? { label: a.open, url: input.openUrl } : null,
    // 잠금화면 한 줄은 어느 방인지 알 수 있게 건물 + 방 코드를 그대로 둔다.
    notify: [`${header}${room ? ` ${room}` : ""}`, stayBrief(reservation.checkIn, reservation.checkOut), amountText].filter(Boolean).join(" · "),
    rows: [
      room ? [{ label: a.fieldRoom, value: room }, channel] : [channel],
      [{ label: a.fieldStay, value: `${stay} · ${fill(a.nights, { n: nights })}` }],
      guestText ? [amountCell, { label: a.fieldGuests, value: guestText }] : [amountCell],
    ],
  };
}

/** 묶음 하나 = 항목마다 한 줄(2026-10-08 사용자 결정 — 「묶음별로 빈 줄」). 묶음 사이는 빈 줄로 가른다. */
function rowLine(row: Array<{ label: string; value: string }>, escape: (value: string) => string, bold: boolean): string {
  return row.map((cell) => (bold ? `*${escape(cell.label)}* ${escape(cell.value)}` : `${cell.label} ${cell.value}`)).join("\n");
}

/** 카드 → Slack Block Kit. 제목(header) · 2열 칸(section fields) · 회색 줄(context) · 링크 줄. */
export function alertCardBlocks(card: AlertCard): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [
    { text: { emoji: true, text: card.header.slice(0, 150), type: "plain_text" }, type: "header" },
    { text: { text: card.rows.map((row) => rowLine(row, escapeMrkdwn, true)).join("\n\n"), type: "mrkdwn" }, type: "section" },
    { elements: [{ text: escapeMrkdwn(card.context), type: "mrkdwn" }], type: "context" },
  ];
  if (card.link) blocks.push({ text: { text: `*<${card.link.url}|${escapeMrkdwn(card.link.label)} ›>*`, type: "mrkdwn" }, type: "section" });
  return blocks;
}

/** 카드의 글 모양 — 실행 기록 「원문」 · 복사 · 카드를 못 그리는 곳에서 쓴다. */
export function alertCardText(card: AlertCard): string {
  return [
    card.header,
    "",
    card.rows.map((row) => rowLine(row, (value) => value, false)).join("\n\n"),
    "",
    card.context,
    ...(card.link ? [`${card.link.label}: ${card.link.url}`] : []),
  ].join("\n");
}

/** 글 모양 알림(예전 이름 유지 — 카드와 같은 내용). */
export function buildReservationAlertMessage(input: AlertInput): string {
  return alertCardText(buildReservationAlertCard(input));
}

function tokyoDateTimeParts(iso: string): { date: string; time: string } {
  const label = tokyoDateTimeLabel(iso);
  return { date: label.slice(0, 10), time: label.slice(11, 16) };
}

/** "YYYY-MM-DD HH:mm" (도쿄). */
export function tokyoDateTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 10)} ${shifted.toISOString().slice(11, 16)}`;
}

/** 당일예약 알림 대상인가(저쪽 :1844-1849) — 신규 · 확정 · 예약일 = 입실일 = 오늘 · 금액 > 0 · 채널 무관. */
export function isSameDayBooking(reservation: AutomationReservation, today: string): boolean {
  if (!isConfirmed(reservation)) return false;
  if (reservation.checkIn !== today) return false;
  if (bookDateOf(reservation.raw) !== today) return false;
  return legacyReservationAmount(reservation.raw) > 0;
}

/** 당일예약 알림 대상인가 + **켠 뒤에 들어온 예약**인가. 예약 시각을 모르면 켠 뒤 것으로 볼 수 없으니 보내지 않는다. */
export function isSameDayBookingSince(reservation: AutomationReservation, today: string, sinceIso: string | null): boolean {
  if (!isSameDayBooking(reservation, today)) return false;
  if (!sinceIso) return true;
  const booked = bookingInstantOf(reservation.raw);
  return booked !== null && Date.parse(booked) >= Date.parse(sinceIso);
}

/** 취소 알림 대상인가 — 취소 상태이고 취소 시각이 `since` 이후(켜기 전 취소는 보내지 않는다). */
export function isFreshCancellation(reservation: AutomationReservation, sinceIso: string): boolean {
  if (reservation.status !== "cancelled") return false;
  const instant = cancelInstantOf(reservation.raw, true);
  if (!instant) return false;
  const at = Date.parse(instant);
  return Number.isFinite(at) && at >= Date.parse(sinceIso);
}

// ── 시스템 경보(2026-10-08) ───────────────────────────────────────────────

/**
 * 시스템 경보 문장 — 제목 한 줄 + 사람이 바로 할 일. 기술 키(`job=…`)가 아니라 무엇이 문제고 어디를 볼지를 쓴다.
 * 문구 줄은 사전에서 「|」 로 나눈다(빈 줄은 뺀다 — 오류 메시지가 없을 때 등).
 */
export function buildHealthAlertText(copy: MessageCopy, alert: HealthAlert, today: string | null): string {
  const h = copy.health;
  const at = (iso: string | null) => {
    if (!iso) return "-";
    const label = tokyoDateTimeLabel(iso);
    return `${dayLabel(copy, label.slice(0, 10), today)} ${label.slice(11, 16)}`;
  };
  const pick = (): { title: string; lines: string } => {
    switch (alert.kind) {
      case "webhook_silent":
        return { lines: fill(h.webhookSilentLines, { time: at(alert.lastAt) }), title: fill(h.webhookSilent, { hours: alert.hours }) };
      case "reconcile_stale":
        return { lines: fill(h.reconcileStaleLines, { time: at(alert.lastAt) }), title: fill(h.reconcileStale, { hours: alert.hours ?? "-" }) };
      case "reconcile_failed":
        return { lines: fill(h.reconcileFailedLines, { error: alert.error, time: at(alert.at) }), title: h.reconcileFailed };
      case "price_failed":
        return {
          lines: fill(h.priceFailedLines, { by: alert.requestedBy, error: alert.error, n: alert.failedRooms, time: at(alert.at) }),
          title: h.priceFailed,
        };
      case "price_stuck":
        return { lines: fill(h.priceStuckLines, { status: alert.status, time: at(alert.at) }), title: fill(h.priceStuck, { minutes: alert.minutes }) };
      case "reviews_stale":
        return { lines: fill(h.reviewsStaleLines, { time: at(alert.lastAt) }), title: fill(h.reviewsStale, { days: alert.days }) };
    }
  };
  const { title, lines } = pick();
  return [fill(h.title, { title }), ...lines.split("|").map((line) => line.trim()).filter(Boolean)].join("\n");
}

/** 자동화 실패 알림 — 기술 키(`job=…`) 대신 무엇이 안 됐고 무엇을 하면 되는지(2026-10-08). */
export type AutomationFailure =
  | { kind: "send_failed"; jobKey: AutomationJobKeyLike; date: string | null; sent: number; failed: number }
  | { kind: "gate_stale"; jobKey: AutomationJobKeyLike; date: string; lastSyncAt: string | null }
  | { kind: "error"; jobKey: AutomationJobKeyLike; error: string }
  | { kind: "data_issue"; date: string; issues: CleaningDataIssue[] };

type AutomationJobKeyLike = "daily_report" | "cleaning_list" | "cancel_alert" | "same_day_alert" | "failure_alert";

export function buildFailureAlertText(copy: MessageCopy, failure: AutomationFailure, today: string | null): string {
  const f = copy.failure;
  const at = (iso: string | null) => {
    if (!iso) return "-";
    const label = tokyoDateTimeLabel(iso);
    return `${dayLabel(copy, label.slice(0, 10), today)} ${label.slice(11, 16)}`;
  };
  const job = (key: AutomationJobKeyLike) => f.jobNames[key] ?? key;
  let title: string;
  let lines: string;
  switch (failure.kind) {
    case "send_failed":
      title = fill(f.sendFailed, { job: job(failure.jobKey) });
      lines = fill(f.sendFailedLines, {
        date: failure.date ? fill(f.datePrefix, { date: dayLabel(copy, failure.date, today) }) : "",
        failed: failure.failed,
        sent: failure.sent,
      });
      break;
    case "gate_stale":
      title = fill(f.gateStale, { job: job(failure.jobKey) });
      lines = fill(f.gateStaleLines, { date: dayLabel(copy, failure.date, today), time: at(failure.lastSyncAt) });
      break;
    case "error":
      title = fill(f.error, { job: job(failure.jobKey) });
      lines = fill(f.errorLines, { error: failure.error.slice(0, 300) });
      break;
    case "data_issue":
      title = fill(f.dataIssue, { n: failure.issues.length });
      lines = fill(f.dataIssueLines, {
        date: dayLabel(copy, failure.date, today),
        list: failure.issues
          .slice(0, 10)
          .map((item) => `${item.code || "?"}(${item.bookingId || "?"})`)
          .join(copy.listSeparator),
      });
      break;
  }
  return [fill(f.title, { title }), ...lines.split("|").map((line) => line.trim()).filter(Boolean)].join("\n");
}
