import type { getDictionary } from "@/lib/i18n";
import type { MemberHistoryItem } from "@/lib/user-audit";

/**
 * 멤버 「최근 변경」 한 줄 글 — 대시보드 패널과 모바일 상세가 같이 쓴다(2026-10-20 권한 정리 ④).
 * 기록(`audit_logs`)에는 코드값만 있고(역할 · 키 · 날짜) 글은 보는 사람 언어로 여기서 만든다.
 */
type Dict = ReturnType<typeof getDictionary>;

export type MemberHistoryLine = { id: string; text: string; meta: string };

export function formatMemberHistory(
  items: MemberHistoryItem[],
  {
    dict,
    locale,
    teams,
  }: { dict: Dict; locale: string; teams: { id: string; name: string; kind: string }[] },
): MemberHistoryLine[] {
  const c = dict.admin.users.console;
  const roleLabel = (role: unknown) => (dict.roles as Record<string, string>)[String(role)] ?? String(role ?? "—");
  const statusLabel = (status: unknown) => (status === "active" ? c.statusActive : c.statusInactive);
  const teamLabel = (id: unknown) => {
    const team = teams.find((t) => t.id === id);
    if (!team) return c.teamUnassigned;
    return team.kind === "field" ? c.teamFieldOption : team.kind === "office" ? c.teamOfficeOption : team.name;
  };
  const keyLabel = (key: unknown) => (c.keys as Record<string, { label: string } | undefined>)[String(key)]?.label ?? String(key ?? "—");
  const flagLabel: Record<string, string> = {
    "member.report_access": c.wReportFlag,
    "member.payroll_admin": c.payrollAdmin,
    "member.leave_approver": c.leaveApprover,
    "member.developer": c.devAssignLabel,
  };
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(
      new Date(iso),
    );
  const shortDay = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", month: "long", day: "numeric" }).format(new Date(iso));

  const lines: MemberHistoryLine[] = [];
  for (const item of items) {
    const m = item.meta;
    let text: string | null = null;
    switch (item.action) {
      case "member.role":
        text = c.histRole.replace("{from}", roleLabel(m.from)).replace("{to}", roleLabel(m.to));
        break;
      case "member.status":
        text = c.histStatus.replace("{from}", statusLabel(m.from)).replace("{to}", statusLabel(m.to));
        break;
      case "member.team":
        text = c.histTeam.replace("{from}", teamLabel(m.from)).replace("{to}", teamLabel(m.to));
        break;
      case "member.report_access":
      case "member.payroll_admin":
      case "member.leave_approver":
      case "member.developer":
        text = (m.to ? c.histOn : c.histOff).replace("{name}", flagLabel[item.action]);
        break;
      case "member.permission_grant": {
        const deny = m.effect === "deny";
        const expires = typeof m.expires === "string" && m.expires ? m.expires : null;
        text = (expires ? (deny ? c.histDeny : c.histGrant) : deny ? c.histDenyForever : c.histGrantForever)
          .replace("{name}", keyLabel(m.key))
          .replace("{date}", expires ? shortDay(expires) : "");
        break;
      }
      case "member.permission_revoke":
        text = c.histRevoke.replace("{name}", keyLabel(m.key));
        break;
      case "member.permissions_auto_revoke":
        text = c.histAutoRevoke.replace("{n}", String(Array.isArray(m.keys) ? m.keys.length : 0));
        break;
      default:
        text = null;
    }
    if (text) lines.push({ id: item.id, text, meta: c.histMeta.replace("{date}", day(item.at)).replace("{actor}", item.actorName) });
  }
  return lines;
}
