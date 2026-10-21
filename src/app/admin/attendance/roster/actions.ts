"use server";

import { hasAdminWebAccess } from "@/config/capabilities";
import { getAttendanceRoster } from "@/lib/attendance-roster";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

export type AdminRosterActionResult =
  | { ok: true; todayDate: string; rosterDay: Awaited<ReturnType<typeof getAttendanceRoster>> }
  | { ok: false; reason: "forbidden" | "invalid" | "error" };

function tokyoDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function clampRosterDate(input: string, todayDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  if (input > todayDate) return todayDate;

  const ninetyDaysAgo = new Date(`${todayDate}T00:00:00+09:00`);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const minDate = tokyoDateKey(ninetyDaysAgo);
  return input >= minDate ? input : todayDate;
}

export async function loadAdminAttendanceRoster(
  operatingDate: string,
  localeTag: string,
): Promise<AdminRosterActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  if (!hasAdminWebAccess(session)) return { ok: false, reason: "forbidden" };

  const todayDate = tokyoDateKey();
  const date = clampRosterDate(operatingDate, todayDate);
  if (!date) return { ok: false, reason: "invalid" };

  const rosterDay = await getAttendanceRoster(session.organization.id, date, localeTag);
  return { ok: true, todayDate, rosterDay };
}
