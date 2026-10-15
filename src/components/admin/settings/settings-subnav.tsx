import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";

// 설정 섹션의 탭(2026-10-15 화이트 리디자인 — 밑줄 탭, 시안 Settings-PC).
// `/admin/settings` 랜딩은 없어지고 이 탭이 설정의 첫 화면이다(랜딩은 권한에 맞는 탭으로 보낸다).
// 초대코드는 2026-07-13 에 `/admin/users/invites` 로 옮겨져 여기 탭이 아니다.
// 조직 설정은 플랫폼 개발자 전용이라 권한이 없으면 탭 자체를 노출하지 않는다.

export type SettingsTab = "organization" | "attendance";

type Settings = Dictionary["admin"]["settings"];

export function SettingsSubnav({
  active,
  settings,
  showOrganization,
}: {
  active: SettingsTab;
  settings: Settings;
  /** 조직 설정 탭 노출 여부 — 플랫폼 개발자만 true. */
  showOrganization: boolean;
}) {
  if (!showOrganization) return null;
  const w = settings.white;
  return (
    <nav className="stw-tabs" aria-label={settings.settingsTitle}>
      <Link className={active === "attendance" ? "on" : undefined} href="/admin/settings/attendance" aria-current={active === "attendance" ? "page" : undefined}>
        {w.tabAttendance}
      </Link>
      <Link className={active === "organization" ? "on" : undefined} href="/admin/settings/organization" aria-current={active === "organization" ? "page" : undefined}>
        {w.tabOrganization} <small>{w.devOnly}</small>
      </Link>
    </nav>
  );
}
