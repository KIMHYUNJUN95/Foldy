import Link from "next/link";
import { getGuestMessageBackfillStatus } from "@/actions/guest-messages-backfill";
import { getGuestConversation, listGuestConversations } from "@/actions/guest-messages";
import { AutoMessagesManager } from "@/components/admin/messages/auto-messages-manager";
import { MessagesConsole } from "@/components/admin/messages/messages-console";
import { MessagesSettings } from "@/components/admin/messages/messages-settings";
import { SavedRepliesManager } from "@/components/admin/messages/saved-replies-manager";
import { AdminNoAccess } from "@/components/admin/shared/admin-no-access";
import { AdminShell } from "@/components/shell/admin-shell";
import { adminNavigation, getNavigationLabel } from "@/config/navigation";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { loadChannelOverview, loadStallNotice } from "@/lib/guest-messages/channel-overview-server";
import { INBOX_STATUS_FILTERS, UUID_RE, parseChannelFilter, type InboxStatusFilter } from "@/lib/guest-messages/inbox-model";
import { loadAutoPreviewBookings, loadAutoRuleSummaries, loadUpcomingAutoRuns } from "@/lib/guest-messages/auto-rules-server";
import { isGuestMessageSendEnabled } from "@/lib/guest-messages/outbox-runner";
import { creatableKinds } from "@/lib/guest-messages/task-link-model";
import { loadSavedReplies } from "@/lib/guest-messages/saved-replies-server";
import { loadResolvedSavedReply } from "@/lib/guest-messages/task-link-server";
import { PROPERTY_MAP_META } from "@/lib/property-map-links";
import { CANONICAL_TO_BUILDING_KEY, localizeBuildingName } from "@/lib/room-label-normalization";
import { getDictionary } from "@/lib/i18n";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import "@/components/guest-messages/guest-messages.css";

export const dynamic = "force-dynamic";
// 설정 탭 「과거 메시지 가져오기」 — 서버 액션의 `after()` 실행이 이 페이지 함수 시간 안에서 돈다(47 §4-0-2, 시간 예산 240초).
export const maxDuration = 300;

type Tab = "conversations" | "auto" | "replies" | "settings";

/**
 * 손님 메시지함(PC) — 탭: 대화 · 정해 둔 문구 · 설정(관리 권한만, 시안 R2Main · R2Settings). docs/product/47-guest-messaging.md §5-1 · §6
 * 탭 순서: 대화 · 자동 안내(5단계) · 정해 둔 문구 · 설정. 관리 권한이 없으면 탭 줄 없이 대화만.
 * 읽기 · 쓰기 권한은 서버 액션 · 액션 안 게이트가 다시 거른다 — 여기서는 볼 권한 없으면 「권한 없음」만.
 */
export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; building?: string; channel?: string; c?: string; tab?: string }>;
}) {
  const [session, params] = await Promise.all([requireAdminPageSession({ nextPath: "/admin/messages" }), searchParams]);
  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const copy = dict.guestMessages;
  const navItem = adminNavigation.find((item) => item.id === "messages");
  const title = navItem ? getNavigationLabel(navItem, locale) : copy.title;

  if (!session.capabilities.includes("guest_messages.view")) {
    return (
      <AdminShell activeItem="messages" title={title}>
        <AdminNoAccess title={dict.admin.shared.noAccessTitle} body={dict.admin.shared.noAccessBody} />
      </AdminShell>
    );
  }

  const canManage = session.capabilities.includes("guest_messages.manage");
  const tab: Tab = canManage && (params.tab === "auto" || params.tab === "replies" || params.tab === "settings") ? params.tab : "conversations";
  const tabs: Array<{ id: Tab; href: string; label: string }> = canManage
    ? [
        { id: "conversations", href: "/admin/messages", label: copy.tabConversations },
        { id: "auto", href: "/admin/messages?tab=auto", label: copy.tabAutoMessages },
        { id: "replies", href: "/admin/messages?tab=replies", label: copy.tabSavedReplies },
        { id: "settings", href: "/admin/messages?tab=settings", label: copy.tabSettings },
      ]
    : [];
  const db = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  let content: React.ReactNode;
  if (tab === "auto") {
    const logFail = (what: string) => (error: unknown) => {
      console.error(`[guest-messages] auto ${what} read failed`, error instanceof Error ? error.message : "unknown");
      return null;
    };
    const [rules, upcoming, previewBookings] = await Promise.all([
      loadAutoRuleSummaries(db, organizationId).catch(logFail("rules")),
      loadUpcomingAutoRuns(db, organizationId).catch(logFail("upcoming")),
      loadAutoPreviewBookings(db, organizationId).catch(logFail("preview bookings")),
    ]);
    const buildings = PROPERTY_MAP_META.map((meta) => ({
      key: CANONICAL_TO_BUILDING_KEY[meta.canonicalName],
      label: localizeBuildingName(meta.canonicalName, dict.cleaning.buildingLabels),
    })).filter((building): building is { key: string; label: string } => !!building.key);
    content = (
      <div className="gm-tabpage">
        <AutoMessagesManager
          copy={copy}
          locale={locale}
          rules={rules}
          upcoming={upcoming}
          previewBookings={previewBookings ?? []}
          buildings={buildings}
          sendEnabled={isGuestMessageSendEnabled()}
        />
      </div>
    );
  } else if (tab === "settings") {
    const [overview, backfill] = await Promise.all([
      loadChannelOverview(db, organizationId).catch((error) => {
        console.error("[guest-messages] overview read failed", error instanceof Error ? error.message : "unknown");
        return null;
      }),
      getGuestMessageBackfillStatus(),
    ]);
    content = (
      <div className="gm-tabpage">
        <MessagesSettings copy={copy} locale={locale} overview={overview} backfill={backfill.ok ? backfill.status : null} />
      </div>
    );
  } else if (tab === "replies") {
    const [replies, resolved] = await Promise.all([
      loadSavedReplies(db, organizationId).catch((error) => {
        console.error("[guest-messages] saved replies read failed", error instanceof Error ? error.message : "unknown");
        return null;
      }),
      loadResolvedSavedReply(db, organizationId).catch(() => null),
    ]);
    content = (
      <div className="gm-tabpage">
        <SavedRepliesManager copy={copy} locale={locale} replies={replies} resolvedId={resolved?.id ?? null} />
      </div>
    );
  } else {
    const status: InboxStatusFilter = (INBOX_STATUS_FILTERS as readonly string[]).includes(params.status ?? "")
      ? (params.status as InboxStatusFilter)
      : "awaiting";
    const building = typeof params.building === "string" && params.building.trim() ? params.building.trim().slice(0, 120) : null;
    const channel = parseChannelFilter(params.channel);
    const requested = typeof params.c === "string" && UUID_RE.test(params.c) ? params.c : null;

    // 고른 대화가 주소에 있으면 목록과 같이 읽는다(기다림 줄이기). 없으면 목록 첫 줄을 이어서 읽는다.
    const [list, requestedThread, stall] = await Promise.all([
      listGuestConversations({ status, building, channel }),
      requested ? getGuestConversation(requested) : Promise.resolve(null),
      canManage ? loadStallNotice(db, organizationId) : Promise.resolve(null),
    ]);
    const data = list.ok ? list : null;
    const selectedId = requested ?? data?.rows[0]?.id ?? null;
    const threadResult = requested ? requestedThread : selectedId ? await getGuestConversation(selectedId) : null;
    const initialThread = threadResult && threadResult.ok ? threadResult.thread : null;
    content = (
      <MessagesConsole
        key={`${status}|${building ?? ""}|${channel}`}
        copy={copy}
        shared={dict.admin.shared}
        locale={locale}
        data={data}
        status={status}
        building={building}
        channel={channel}
        selectedId={selectedId}
        initialThread={initialThread}
        canReply={session.capabilities.includes("guest_messages.reply")}
        canManage={canManage}
        stall={stall}
        taskKinds={creatableKinds(session.capabilities)}
        taskCategoryCopy={{ maintenance: dict.maintenance.form.categories, lostFound: dict.lostFound.categoryLabels }}
      />
    );
  }

  return (
    <AdminShell activeItem="messages" title={title}>
      <div className="gm-root gm-page">
        {tabs.length > 1 ? (
          <nav className="gm-tabs" aria-label={copy.tabsLabel}>
            {tabs.map((item) => (
              <Link key={item.id} href={item.href} className="gm-tab" aria-current={item.id === tab ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
        {content}
      </div>
    </AdminShell>
  );
}
