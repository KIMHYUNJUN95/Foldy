/**
 * 손님 메시지 → 업무 한 번에 — 순수 판정(6단계, 2026-11-13). docs/product/47-guest-messaging.md §6-4 · §5-7
 *
 * - 만들 수 있는 업무 종류: 각 기능의 **기존 권한 그대로**(새 권한 없음). 수리 · 점검 · 분실물 · 할 일은 조직 구성원이면 누구나
 *   (08 · 09 · 18 — 알바도 신고 · 등록 · 할 일을 만든다), 게스트 피드백은 `complaint.write`(25). 대화를 읽어야 하니 `guest_messages.view` 도.
 * - 미리 채움(손님 말 → 제목 · 내용), 업무 상태 → 대화의 시스템 줄, 끝난 업무 → 「해결됐어요」 초안을 띄울지.
 * 화면 · 서버 · 시험이 같이 쓴다(클라이언트에서도 import — 서버 전용 모듈을 끌어오지 않는다).
 */

import type { GuestChannelKey } from "@/lib/guest-messages/types";

export const LINK_TARGET_TYPES = ["maintenance", "lost_found", "task", "complaint"] as const;
export type LinkTargetType = (typeof LINK_TARGET_TYPES)[number];

export function isLinkTargetType(value: unknown): value is LinkTargetType {
  return typeof value === "string" && (LINK_TARGET_TYPES as readonly string[]).includes(value);
}

/** 이 사람이 메시지에서 만들 수 있는 업무 — 화면(버튼 · 시트)과 서버 가드가 같은 판정을 쓴다. */
export function creatableKinds(capabilities: readonly string[]): LinkTargetType[] {
  if (!capabilities.includes("guest_messages.view")) return [];
  const out: LinkTargetType[] = ["maintenance", "lost_found", "task"];
  if (capabilities.includes("complaint.write")) out.push("complaint");
  return out;
}

export function canCreateKind(capabilities: readonly string[], kind: LinkTargetType): boolean {
  return creatableKinds(capabilities).includes(kind);
}

// ── 미리 채움 ────────────────────────────────────────────────────────────────

export const PREFILL_LIMITS = { title: 80, body: 2000 } as const;

export type PrefillMessage = {
  /** 원문(손님이 쓴 글). */
  body: string;
  /** 보는 사람 언어 번역(있으면). */
  translated: string | null;
  /** 「오전 9:42」처럼 이미 그 언어로 만든 시각. */
  timeLabel: string;
};

export type PrefillLabels = {
  /** 「손님 말({time})」 — `{time}` 자리. */
  guestSaid: string;
  /** 「원문」 */
  original: string;
};

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
}

/**
 * 고른 손님 말 → 제목 · 내용. 제목 = 첫 말(번역이 있으면 번역)의 첫 줄, 내용 = 말마다 「손님 말(시각): 번역」 + 번역과 다르면 「원문: …」.
 * 길이는 잘라서(…) 기능의 칸을 넘지 않게. 직원이 저장 전에 고친다.
 */
export function buildTaskPrefill(messages: readonly PrefillMessage[], labels: PrefillLabels): { title: string; body: string } {
  const usable = messages.filter((m) => m.body.trim() || m.translated?.trim());
  if (usable.length === 0) return { title: "", body: "" };
  const first = usable[0];
  const firstText = (first.translated?.trim() || first.body.trim()).split(/\r?\n/).find((line) => line.trim()) ?? "";
  const parts = usable.map((m) => {
    const shown = m.translated?.trim() || m.body.trim();
    const head = `${labels.guestSaid.replace("{time}", m.timeLabel)}: ${shown}`;
    const original = m.body.trim();
    return m.translated?.trim() && original && original !== m.translated.trim() ? `${head}\n${labels.original}: ${original}` : head;
  });
  return {
    title: clip(firstText.trim(), PREFILL_LIMITS.title),
    body: clip(parts.join("\n\n"), PREFILL_LIMITS.body),
  };
}

/** 게스트 피드백의 플랫폼 — 대화 채널에서(Expedia · Agoda · Vrbo · 모름 = 기타). */
export function complaintPlatformFor(channel: GuestChannelKey | null): "airbnb" | "booking" | "direct" | "other" {
  if (channel === "airbnb" || channel === "booking" || channel === "direct") return channel;
  return "other";
}

/** 숙박 중인 손님(도쿄 날짜로 체크인 ≤ 오늘 < 체크아웃) — 수리 · 점검의 「급함」 처음 값. */
export function isStayingNow(checkIn: string | null, checkOut: string | null, todayYmd: string): boolean {
  return Boolean(checkIn && checkOut && checkIn <= todayYmd && todayYmd < checkOut);
}

// ── 업무 상태 → 대화 줄 ───────────────────────────────────────────────────────

/** 업무 표에서 읽은 한 줄(필요한 칸만). 없으면(지워짐) null. */
export type LinkTargetRow = {
  status: string | null;
  /** 끝난 시각 — 수리 completed_at · 분실물 handled_at · 할 일 completed_at · 피드백 resolved_at. */
  doneAt: string | null;
  /** 할 일 soft delete. */
  deletedAt?: string | null;
  title: string | null;
};

export type LinkState = {
  /** 사전 키 꼬리(`linkStatus.<type>.<status>`) — 모르는 값이면 "unknown". */
  status: string;
  done: boolean;
  doneAt: string | null;
  deleted: boolean;
};

const KNOWN_STATUSES: Record<LinkTargetType, readonly string[]> = {
  maintenance: ["open", "in_progress", "closed", "cancelled"],
  lost_found: ["registered", "stored", "disposal_scheduled", "disposed", "returned"],
  task: ["open", "in_progress", "completed", "cancelled"],
  complaint: ["open", "resolved"],
};

/** 「끝남」 — 손님에게 「해결됐어요」라고 할 수 있는 상태. 수리 무효 · 분실물 폐기 · 할 일 취소는 끝남이 아니다. */
const DONE_STATUS: Record<LinkTargetType, string> = {
  maintenance: "closed",
  lost_found: "returned",
  task: "completed",
  complaint: "resolved",
};

export function linkTargetState(type: LinkTargetType, row: LinkTargetRow | null): LinkState {
  if (!row || (type === "task" && row.deletedAt)) return { status: "deleted", done: false, doneAt: null, deleted: true };
  const status = row.status && KNOWN_STATUSES[type].includes(row.status) ? row.status : "unknown";
  const done = status === DONE_STATUS[type];
  return { status, done, doneAt: done ? row.doneAt : null, deleted: false };
}

/** 대화에 그리는 링크 한 줄(서버 → 화면). */
export type ThreadLinkView = {
  id: string;
  targetType: LinkTargetType;
  targetId: string;
  messageId: string | null;
  createdAt: string;
  /** 업무 제목 — 할 일은 그 사람이 참여자일 때만(할 일은 참여자만 보는 기록). */
  title: string | null;
  state: LinkState;
};

/**
 * 「해결됐어요」 초안을 띄울 링크 — 끝난 링크 중 가장 최근에 끝난 것, **그 뒤로 우리 답장(host)이 아직 없을 때만**.
 * 끝난 시각이 없으면(옛 행) 링크를 만든 시각 뒤 답장으로 본다. 보내기는 언제나 사람이 누른다.
 */
export function pickResolvedLink(
  links: readonly ThreadLinkView[],
  messages: ReadonlyArray<{ direction: string; sentAt: string }>,
): ThreadLinkView | null {
  const lastHost = messages.reduce<number>((max, m) => {
    if (m.direction !== "host") return max;
    const at = Date.parse(m.sentAt);
    return Number.isFinite(at) && at > max ? at : max;
  }, Number.NEGATIVE_INFINITY);
  let best: { link: ThreadLinkView; at: number } | null = null;
  for (const link of links) {
    if (!link.state.done) continue;
    const at = Date.parse(link.state.doneAt ?? link.createdAt);
    if (!Number.isFinite(at) || at <= lastHost) continue;
    if (!best || at > best.at) best = { link, at };
  }
  return best?.link ?? null;
}

// ── 주소 ──────────────────────────────────────────────────────────────────────

export type LinkSurface = "admin" | "mobile";

/**
 * 업무 상세 주소. PC: 수리 `?report=` · 분실물 `?item=` · 피드백 `?complaint=` · 할 일 `?task=` 로 콘솔 오른쪽 패널을 바로 연다.
 * 모바일은 각 기능의 상세 화면.
 */
export function linkTargetHref(type: LinkTargetType, id: string, surface: LinkSurface): string {
  const enc = encodeURIComponent(id);
  if (surface === "admin") {
    switch (type) {
      case "maintenance":
        return `/admin/maintenance?report=${enc}`;
      case "lost_found":
        return `/admin/lost-found?item=${enc}`;
      case "complaint":
        return `/admin/complaints?complaint=${enc}`;
      case "task":
        return `/admin/tasks?task=${enc}`;
    }
  }
  switch (type) {
    case "maintenance":
      return `/mobile/requests/maintenance/${enc}`;
    case "lost_found":
      return `/mobile/requests/lost-found/${enc}`;
    case "complaint":
      return `/mobile/complaints/${enc}`;
    case "task":
      return `/mobile/tasks/${enc}`;
  }
}

export function conversationHref(conversationId: string, surface: LinkSurface): string {
  const enc = encodeURIComponent(conversationId);
  return surface === "admin" ? `/admin/messages?c=${enc}` : `/mobile/messages/${enc}`;
}

/** 「해결됐어요」 답장 초안(서버 → 화면). 언어마다 글을 다 싣고, 화면이 지금 넣을 언어(`insertLanguageFor`)로 고른다. */
export type ResolvedDraft = {
  linkId: string;
  targetType: LinkTargetType;
  texts: { ko: string; ja: string; en: string };
  /** 정해 둔 문구(「해결됐어요」로 표시한 것)에서 왔나 — 아니면 앱 기본 문구. */
  fromSavedReply: boolean;
};
