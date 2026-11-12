import { redirect } from "next/navigation";
import { listGuestConversations } from "@/actions/guest-messages";
import { MobileInbox } from "@/components/guest-messages/mobile-messages";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import { INBOX_STATUS_FILTERS, parseChannelFilter, type InboxStatusFilter } from "@/lib/guest-messages/inbox-model";
import { getDictionary } from "@/lib/i18n";
import { loadStallNotice } from "@/lib/guest-messages/channel-overview-server";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * 손님 메시지(모바일) — 목록 → `/mobile/messages/[id]`. 태블릿 가로는 공용 `SplitList`(목록 | 대화 칸). docs/product/47-guest-messaging.md §5-2 · §5-4.
 * 볼 권한(`guest_messages.view`)이 없으면 홈으로. 데이터 권한은 서버 액션이 다시 거른다.
 */
export default async function MobileMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; building?: string; channel?: string }>;
}) {
  const [state, session, params] = await Promise.all([getOnboardingState(), getCurrentAppSession(), searchParams]);
  if (state.status === "unauthenticated") redirect(`/auth/login?next=${encodeURIComponent("/mobile/messages")}`);
  if (state.status !== "ready" || !session) redirect("/onboarding");
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");
  if (!session.capabilities.includes("guest_messages.view")) redirect("/mobile");

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const status: InboxStatusFilter = (INBOX_STATUS_FILTERS as readonly string[]).includes(params.status ?? "")
    ? (params.status as InboxStatusFilter)
    : "awaiting";
  const building = typeof params.building === "string" && params.building.trim() ? params.building.trim().slice(0, 120) : null;
  const channel = parseChannelFilter(params.channel);

  const canManage = session.capabilities.includes("guest_messages.manage");
  const [badges, list, stall] = await Promise.all([
    getMobileNavBadges(),
    listGuestConversations({ status, building, channel }),
    canManage ? loadStallNotice(getSupabaseServiceClient(), session.organization.id) : Promise.resolve(null),
  ]);

  return (
    <MobileShell activeItem="messages" badges={badges} title={dict.guestMessages.title} split>
      <SplitList detail="messages">
        <MobileInbox
          key={`${status}|${building ?? ""}|${channel}`}
          copy={dict.guestMessages}
          locale={locale}
          data={list.ok ? list : null}
          status={status}
          building={building}
          channel={channel}
          stall={stall}
        />
      </SplitList>
    </MobileShell>
  );
}
