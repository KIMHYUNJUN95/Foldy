import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";

// 설정 섹션의 탭(2026-10-15 화이트 리디자인 — 밑줄 탭, 시안 Settings-PC).
// `/admin/settings` 랜딩은 없어지고 이 탭이 설정의 첫 화면이다(랜딩은 권한에 맞는 탭으로 보낸다).
// 초대코드는 2026-07-13 에 `/admin/users/invites` 로 옮겨져 여기 탭이 아니다.
// 조직 설정은 플랫폼 개발자 전용이라 권한이 없으면 탭 자체를 노출하지 않는다.

export type SettingsTab = "organization" | "attendance" | "payroll";

type Settings = Dictionary["admin"]["settings"];

export function SettingsSubnav({
  active,
  settings,
  showOrganization,
  showPayroll = false,
  showAttendance = true,
  payrollLabel,
}: {
  active: SettingsTab;
  settings: Settings;
  /** 조직 설정 탭 노출 여부 — 플랫폼 개발자만 true. */
  showOrganization: boolean;
  /** 급여 탭 노출 여부 — `payroll.manage` 가 있는 사람. */
  showPayroll?: boolean;
  /** 출퇴근 현장 탭 노출 여부 — `attendance.settings` 가 있는 사람(급여만 가진 사람은 끈다). */
  showAttendance?: boolean;
  payrollLabel?: string;
}) {
  // 탭이 하나뿐이면 탭 줄 자체가 군더더기라 그리지 않는다.
  if (Number(showOrganization) + Number(showPayroll) + Number(showAttendance) < 2) return null;
  const w = settings.white;
  return (
    <nav className="stw-tabs" aria-label={settings.settingsTitle}>
      {showAttendance ? (
        <Link className={active === "attendance" ? "on" : undefined} href="/admin/settings/attendance" aria-current={active === "attendance" ? "page" : undefined}>
          {w.tabAttendance}
        </Link>
      ) : null}
      {showPayroll ? (
        <Link className={active === "payroll" ? "on" : undefined} href="/admin/settings/payroll" aria-current={active === "payroll" ? "page" : undefined}>
          {payrollLabel}
        </Link>
      ) : null}
      {showOrganization ? <Link className={active === "organization" ? "on" : undefined} href="/admin/settings/organization" aria-current={active === "organization" ? "page" : undefined}>
        {w.tabOrganization} <small>{w.devOnly}</small>
      </Link> : null}
    </nav>
  );
}
