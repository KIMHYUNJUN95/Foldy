// 업무일지 예약 보내기(2026-10-20) — 모바일 시트(`report-sheet.tsx`)와 PC 업무일지 창(`admin-tasks-console.tsx`)이 같이 쓰는 시각 계산.
// 시각은 **오늘(도쿄)** 하루 안에서 고른다 — 빠른 선택 18:00 · 19:00 · 20:00 + 「직접」(시 · 15분 단위). 지난 시각은 막는다(서버도 1분 뒤부터만 받는다).
import { tokyoToday } from "@/lib/tokyo-date";

export const QUICK_TIMES = ["18:00", "19:00", "20:00"] as const;
export const MINUTES = ["00", "15", "30", "45"] as const;
/** 지금부터 이 분 뒤부터 고를 수 있다. */
export const LEAD_MIN = 2;

export function tokyoNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 예약 시각(ISO) → 도쿄 「HH:MM」. */
export function tokyoHHMM(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** 오늘(도쿄) 「HH:MM」 → 서버에 넘길 ISO. */
export const tokyoTodayIso = (hhmm: string) => `${tokyoToday()}T${hhmm}:00+09:00`;

/** 지금 기준으로 남은 「직접」 시(00~23) 목록. */
export function openHours(nowMin: number): string[] {
  return Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")).filter((h) =>
    MINUTES.some((m) => toMinutes(`${h}:${m}`) >= nowMin + LEAD_MIN),
  );
}
