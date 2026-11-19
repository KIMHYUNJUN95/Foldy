import { redirect } from "next/navigation";
import { MobileReplyCandidates } from "@/components/guest-messages/reply-candidates";
import { MobileShell } from "@/components/shell/mobile-shell";
import { loadSavedReplies } from "@/lib/guest-messages/saved-replies-server";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
// 「다시 찾기」 — 서버 액션의 `after()` 뽑기가 이 페이지 함수 시간 안에서 돈다(PC `/admin/messages` 와 같은 300초).
export const maxDuration = 300;

/**
 * 과거 답장 후보(모바일) — 폰: 목록 → 상세(`?id=` · `?b=`) · 폴드 이상: 목록 | 상세. docs/product/49-guest-message-ai-reply-assist.md §9-6.
 * 보는 권한은 `guest_messages.view` + (정해 둔 문구 관리 또는 건물 손님용 칸 고치기). 결정 · 저장 권한은 서버 액션이 다시 거른다.
 */
export default async function MobileReplyCandidatesPage() {
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);
  if (state.status === "unauthenticated") redirect(`/auth/login?next=${encodeURIComponent("/mobile/messages/candidates")}`);
  if (state.status !== "ready" || !session) redirect("/onboarding");
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");
  const caps = session.capabilities;
  if (!caps.includes("guest_messages.view") || !(caps.includes("guest_messages.manage") || caps.includes("property_info.edit"))) {
    redirect("/mobile/messages");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const [badges, replies] = await Promise.all([
    getMobileNavBadges(),
    caps.includes("guest_messages.manage")
      ? loadSavedReplies(getSupabaseServiceClient(), session.organization.id).catch(() => [])
      : Promise.resolve([]),
  ]);
  // 비슷한 정해 둔 문구 이름만(본문은 보내지 않는다).
  const similarTitles: Record<string, string> = {};
  for (const reply of replies) similarTitles[reply.id] = reply.title;

  return (
    <MobileShell activeItem="messages" badges={badges} title={dict.guestMessages.candTitleMobile} wide>
      <MobileReplyCandidates copy={dict.guestMessages} locale={locale} similarTitles={similarTitles} />
    </MobileShell>
  );
}
