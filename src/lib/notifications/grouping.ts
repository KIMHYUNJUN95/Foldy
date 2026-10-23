/**
 * 알림 화면 · PC 종 팝오버의 줄 모양(화이트 리디자인 2026-10-15) — 순수 함수만. i18n 을 읽지 않으므로 클라이언트에서
 * 써도 사전이 번들에 딸려 오지 않는다. 글자(짧은 제목 · 대상 · 시각)는 서버에서 `brief.ts` 가 만들어 넘긴다.
 *
 * 문서: docs/product/14-notification-design.md 「알림 화면 — 화이트 리디자인」
 */

/** 종류 탭. 「전체」는 탭에만 있다(알림 하나는 늘 아래 넷 중 하나). */
export type NotificationCategory = "work" | "notice" | "board" | "attendance";

export const NOTIFICATION_TABS = ["all", "work", "notice", "board", "attendance"] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];

export type NotificationIconKey =
  | "flag"
  | "clock"
  | "user"
  | "check"
  | "comment"
  | "box"
  | "megaphone"
  | "at"
  | "bug"
  | "bulb"
  | "folder"
  | "bell";

/** 줄 하나에 필요한 것 — 직렬화 가능한 문자열만(서버 → 클라이언트). */
export type NotificationView = {
  id: string;
  href: string;
  unread: boolean;
  category: NotificationCategory;
  icon: NotificationIconKey;
  /** 무엇이 일어났나 — 「마감이 지났어요」. */
  title: string;
  /** 어느 것 · 누가 — 「‘작업 이름’」 · 「김현준 님 · ‘…’」. */
  object: string;
  /** 짧은 시각 — 「오전 8:02」 · 「어제 18:20」 · 「10/13」. */
  time: string;
  /** 어디서 — 「투두이스트」. */
  source: string;
  /** 도쿄 날짜(YYYY-MM-DD). 묶음 · 구간의 기준. */
  dayKey: string;
  /** 같은 종류인가를 가르는 열쇠(종류 + 사건). 같은 날 · 같은 열쇠가 이어지면 한 줄로 묶는다. */
  groupKey: string;
};

export type NotificationGroup = {
  /** 묶음의 대표 줄 = 가장 최근 것. */
  head: NotificationView;
  /** 펼치면 나오는 나머지(최근 순). */
  rest: NotificationView[];
  ids: string[];
  unread: boolean;
};

export type NotificationSection = "today" | "week" | "earlier";

/** 알림 종류(enum 문자열) → 종류 탭. 모르는 종류는 「업무」로(「전체」에는 늘 보인다). */
export function categoryForType(type: string): NotificationCategory {
  if (type === "announcement_activity") return "notice";
  if (type === "board_activity") return "board";
  if (type === "attendance_activity") return "attendance";
  // 재류카드 만료 — 취로 자격(일할 수 있는가)이라 근태 탭(2026-10-23, docs/product/14).
  if (type === "id_document_expiring") return "attendance";
  return "work";
}

/**
 * 같은 날 · 같은 종류가 **이어지면** 한 줄로 묶는다(최근 순 목록을 그대로 받는다). 사이에 다른 종류가 끼면 끊는다 —
 * 시간 순서를 흐트러뜨리지 않는다.
 */
export function groupNotificationViews(items: readonly NotificationView[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.head.dayKey === item.dayKey && last.head.groupKey === item.groupKey) {
      last.rest.push(item);
      last.ids.push(item.id);
      if (item.unread) last.unread = true;
      continue;
    }
    groups.push({ head: item, rest: [], ids: [item.id], unread: item.unread });
  }
  return groups;
}

/** 두 YYYY-MM-DD 사이의 날 수(b − a). */
function dayDiff(a: string, b: string): number {
  const toUtc = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** 오늘 · 이번 주(오늘을 뺀 최근 6일 — 오늘 포함 7일) · 이전. 도쿄 날짜끼리 비교한다. */
export function notificationSection(dayKey: string, todayKey: string): NotificationSection {
  const diff = dayDiff(dayKey, todayKey);
  if (diff <= 0) return "today";
  if (diff <= 6) return "week";
  return "earlier";
}

/** 묶음들을 구간별로 — 빈 구간은 빠진다. 순서는 오늘 → 이번 주 → 이전. */
export function sectionizeGroups(
  groups: readonly NotificationGroup[],
  todayKey: string,
): { section: NotificationSection; groups: NotificationGroup[] }[] {
  const order: NotificationSection[] = ["today", "week", "earlier"];
  const buckets = new Map<NotificationSection, NotificationGroup[]>();
  for (const group of groups) {
    const section = notificationSection(group.head.dayKey, todayKey);
    const list = buckets.get(section) ?? [];
    list.push(group);
    buckets.set(section, list);
  }
  return order.filter((section) => buckets.has(section)).map((section) => ({ section, groups: buckets.get(section)! }));
}

/** 탭에 맞는 알림만. */
export function filterByTab<T extends { category: NotificationCategory }>(items: readonly T[], tab: NotificationTab): T[] {
  return tab === "all" ? [...items] : items.filter((item) => item.category === tab);
}

/** 탭별 안 읽은 수. */
export function unreadByTab(items: readonly NotificationView[]): Record<NotificationTab, number> {
  const counts: Record<NotificationTab, number> = { all: 0, work: 0, notice: 0, board: 0, attendance: 0 };
  for (const item of items) {
    if (!item.unread) continue;
    counts.all += 1;
    counts[item.category] += 1;
  }
  return counts;
}
