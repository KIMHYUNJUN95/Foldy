import { notFound, redirect } from "next/navigation";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { MobileShell } from "@/components/shell/mobile-shell";
import { PersonShiftView } from "@/components/mobile/shift/person-shift-view";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { isMonthKey, monthOf } from "@/lib/cleaning-assign/day-state";
import { loadPersonShift } from "@/lib/cleaning-assign/person-shift";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { loadExpiredResidenceCardUserIds } from "@/lib/staff-documents/server";

/** 배정 · 신청이 바뀌면 새로고침 없이 다시 읽는다(`src/lib/cleaning-assign/live.ts`). */
const LIVE_KINDS = ["cleaning_assign"] as const;

/**
 * 사람별 시프트 달력 — 모바일(관리자). 사용자 상세의 「시프트」 줄에서 들어온다. 주소의 id 는 멤버십 id(사용자 상세와 같음).
 * 보는 권한은 배정 권한(`cleaning.assign`) — 배정 화면에서 보는 것과 같은 정보다. 현장 인원이 아니면 404.
 * docs/product/37-cleaning-shift-assignment.md 「4-6」
 */
export default async function MobileMemberShiftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ym?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const navBadgesPromise = getMobileNavBadges();
  const session = await getCurrentAppSession();
  if (!session) redirect(`/auth/login?next=${encodeURIComponent(`/mobile/users/${id}/shift`)}`);
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");
  if (!session.capabilities.includes("cleaning.assign")) redirect(`/mobile/users/${id}`);

  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const membership = await supabase.from("memberships").select("user_id").eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (!membership.data) notFound();

  const today = getCleaningOperatingDateKey();
  const ym = isMonthKey(query.ym) ? query.ym! : monthOf(today);
  const [data, expiredCardUserIds] = await Promise.all([
    loadPersonShift(supabase, organizationId, membership.data.user_id, ym, today, session.user.id),
    loadExpiredResidenceCardUserIds(organizationId),
  ]);
  if (!data) notFound();
  const locale = session.user.preferredLanguage;
  const copy = getCleaningAssignCopy(locale);
  const navBadges = await navBadgesPromise;

  return (
    <MobileShell activeItem="users" badges={navBadges} title={copy.psSection} wide>
      <Beds24LiveRefresh kinds={LIVE_KINDS} organizationId={organizationId} />
      <PersonShiftView data={data} copy={copy} locale={locale} today={today} basePath={`/mobile/users/${id}/shift`} cardExpired={expiredCardUserIds.includes(membership.data.user_id)} />
    </MobileShell>
  );
}
