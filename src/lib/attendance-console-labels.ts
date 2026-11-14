// 근태 콘솔 표기 — 인증 방식 · 역할 · 날짜(2026-11-13). 화면마다 코드값 · 서로 다른 날짜 모양이 새지 않게 한 곳에 둔다.

type MethodCopy = { methodGpsQr: string; methodGpsWifi: string; methodManual: string; methodFallback: string };

/** 인증 방식 코드 → 읽는 이름. 모르는 값은 코드를 그대로 보이지 않고 기본 라벨로. */
export function attendanceMethodLabel(method: string | null | undefined, c: MethodCopy): string {
  switch (method) {
    case "gps_qr":
    case "qr":
    case "qr_gps":
      return c.methodGpsQr;
    case "gps_wifi":
      return c.methodGpsWifi;
    case "manual":
      return c.methodManual;
    default:
      return c.methodFallback;
  }
}

/** 역할 코드 → 사전 이름. 비어 있으면 「—」, 사전에 없는 값은 코드 그대로(새 역할이 생겨도 빈칸이 되지 않게). */
export function attendanceRoleLabel(role: string | null | undefined, roles: Record<string, string>): string {
  if (!role) return "—";
  return roles[role] ?? role;
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return hit ? { y: Number(hit[1]), m: Number(hit[2]), d: Number(hit[3]) } : null;
}

/** 「2026. 4. 1」(ko) · 「2026/4/1」(ja) · 「Apr 1, 2026」(en). */
export function formatAdminDate(ymd: string, localeTag: string): string {
  const p = parseYmd(ymd);
  if (!p) return ymd;
  if (localeTag.startsWith("ko")) return `${p.y}. ${p.m}. ${p.d}`;
  const date = new Date(Date.UTC(p.y, p.m - 1, p.d));
  if (localeTag.startsWith("ja")) return `${p.y}/${p.m}/${p.d}`;
  return new Intl.DateTimeFormat(localeTag, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(date);
}

function md(ymd: string): string {
  const p = parseYmd(ymd);
  return p ? `${String(p.m).padStart(2, "0")}/${String(p.d).padStart(2, "0")}` : ymd;
}

/** 연차 기간 — 하루면 한 날짜, 아니면 「11/24 – 11/25」(en dash). */
export function formatLeaveRange(start: string, end: string): string {
  if (!end || start === end) return md(start);
  return `${md(start)} – ${md(end)}`;
}
