/**
 * 정해 둔 문구 — 검사 · 언어 고르기 · 변수 채우기. **순수 모듈**. docs/product/47-guest-messaging.md §6-3
 *
 * - 변수: {guest_name} {checkin_date} {checkout_date} {nights} {building} {room}. 대화에 값이 없으면 **그대로 둔다**
 *   (빈 칸으로 지우면 「님, 체크인은 에」 같은 깨진 문장이 몰래 나간다 — 화면이 남은 변수를 알려 준다).
 * - 날짜는 손님 언어 꼴(ko 「11월 20일」 · ja 「11月20日」 · en 「Nov 20」). 저장된 날짜(`YYYY-MM-DD`)를 그대로 읽는다(도쿄 날짜 — 시각 변환 없음).
 * - 본문 언어: 고른 언어 → 영어 → 없음(넣지 못함). 건물 정보와 같은 규칙(`pickLocalized`).
 */

import { pickLocalized, type GuestLang, type Localized } from "@/lib/guest-messages/guest-info-model";

export const SAVED_REPLY_VARIABLES = ["guest_name", "checkin_date", "checkout_date", "nights", "building", "room"] as const;
export type SavedReplyVariable = (typeof SAVED_REPLY_VARIABLES)[number];

export const SAVED_REPLY_LIMITS = { title: 80, body: 2000, count: 200 } as const;

export type SavedReplyInput = { title: string; bodies: Localized };

export function validateSavedReplyInput(
  raw: unknown,
): { ok: true; value: SavedReplyInput } | { ok: false; error: "invalid_input" | "too_long" | "empty" } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "invalid_input" };
  const record = raw as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const bodiesRaw = record.bodies;
  if (!bodiesRaw || typeof bodiesRaw !== "object" || Array.isArray(bodiesRaw)) return { ok: false, error: "invalid_input" };
  const bodies = { ko: "", ja: "", en: "" } as Localized;
  for (const lang of ["ko", "ja", "en"] as const) {
    const value = (bodiesRaw as Record<string, unknown>)[lang];
    if (value !== undefined && value !== null && typeof value !== "string") return { ok: false, error: "invalid_input" };
    bodies[lang] = typeof value === "string" ? value.trim() : "";
    if (Array.from(bodies[lang]).length > SAVED_REPLY_LIMITS.body) return { ok: false, error: "too_long" };
  }
  if (Array.from(title).length > SAVED_REPLY_LIMITS.title) return { ok: false, error: "too_long" };
  if (!title || !(bodies.ko || bodies.ja || bodies.en)) return { ok: false, error: "empty" };
  return { ok: true, value: { title, bodies } };
}

export type ReplyContext = {
  guestName: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  nights: number | null;
  /** 언어마다 건물 이름(손님 언어로 — 서버가 사전으로 채운다). */
  building: Localized | null;
  /** 언어마다 방 라벨(한 채 건물은 건물 이름이 방 라벨 — 서버가 사전으로 채운다). */
  room: Localized | null;
};

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatGuestDate(ymd: string | null, lang: GuestLang): string | null {
  const match = ymd ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null;
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (lang === "ko") return `${month}월 ${day}일`;
  if (lang === "ja") return `${month}月${day}日`;
  return `${EN_MONTHS[month - 1]} ${day}`;
}

const VARIABLE_RE = /\{([a-z_]+)\}/g;

/** 변수 채우기 — 모르는 변수 · 값 없는 변수는 그대로 두고 `missing` 에 남긴다. */
export function fillReplyVariables(body: string, context: ReplyContext, lang: GuestLang): { text: string; missing: SavedReplyVariable[] } {
  const missing = new Set<SavedReplyVariable>();
  const valueOf = (name: SavedReplyVariable): string | null => {
    switch (name) {
      case "guest_name":
        return context.guestName?.trim() || null;
      case "checkin_date":
        return formatGuestDate(context.checkInDate, lang);
      case "checkout_date":
        return formatGuestDate(context.checkOutDate, lang);
      case "nights":
        return context.nights && context.nights > 0 ? String(context.nights) : null;
      case "building":
        return context.building?.[lang]?.trim() || context.building?.en?.trim() || null;
      case "room":
        return context.room?.[lang]?.trim() || context.room?.en?.trim() || null;
    }
  };
  const text = body.replace(VARIABLE_RE, (token, name: string) => {
    if (!(SAVED_REPLY_VARIABLES as readonly string[]).includes(name)) return token;
    const value = valueOf(name as SavedReplyVariable);
    if (value === null) {
      missing.add(name as SavedReplyVariable);
      return token;
    }
    return value;
  });
  return { text, missing: [...missing] };
}

/** 문구 하나 → 그 언어로 넣을 글(없으면 null). */
export function savedReplyText(
  bodies: Localized,
  lang: GuestLang,
  context: ReplyContext,
): { text: string; lang: GuestLang; missing: SavedReplyVariable[] } | null {
  const picked = pickLocalized(bodies, lang);
  if (!picked) return null;
  const filled = fillReplyVariables(picked.text, context, picked.lang);
  return { text: filled.text, lang: picked.lang, missing: filled.missing };
}
