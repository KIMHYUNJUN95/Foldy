import { redirect } from "next/navigation";
import { AnnouncementPopup } from "@/components/announcements/announcement-popup";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getAnnouncementDictionary } from "@/lib/announcement-i18n";
import { getPopupDismissals, getReadAnnouncementIds, getVisibleAnnouncements } from "@/lib/announcements";
import { AnnouncementListMobile, type MobileNoticeGroup } from "@/components/announcements/announcement-list-mobile";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import type { OrganizationRole } from "@/config/roles";

function localeTag(locale: string): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

function toTokyoDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

/** 묶음 머리 — 「10월 6일 (월)」. */
function formatDayLabel(dateStr: string | null, locale: string): string {
  if (!dateStr) return "";
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo",
  }).format(new Date(dateStr));
}

/** 고정 묶음 meta 앞 날짜 — 「10월 8일」. */
function formatShortDay(dateStr: string | null, locale: string): string {
  if (!dateStr) return "";
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: "long", day: "numeric", timeZone: "Asia/Tokyo",
  }).format(new Date(dateStr));
}

function targetLabel(
  scope: string,
  roles: string[],
  copy: ReturnType<typeof getAnnouncementDictionary>
): string {
  if (scope === "everyone") return copy.white.everyone;
  if (roles.length === 0) return copy.targetScopes.roles;
  return roles.map((r) => copy.targetRoles[r as OrganizationRole] ?? r).join(" · ");
}

export default async function MobileAnnouncementsPage() {
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/mobile/announcements");
  }

  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }

  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const copy = getAnnouncementDictionary(session.user.preferredLanguage);
  const announcements = await getVisibleAnnouncements(session);
  const now = new Date();
  const popupCandidates = announcements.filter(
    (announcement) => announcement.show_popup_on_app_open,
  );
  const dismissals = await getPopupDismissals(
    session.user.id,
    popupCandidates.map((a) => a.id),
  );
  const popupAnnouncements = popupCandidates
    .filter(
      (announcement) =>
        !dismissals.has(announcement.id) &&
        (!announcement.popup_until || new Date(announcement.popup_until) > now),
    )
    .map((announcement) => ({
      content: announcement.content,
      id: announcement.id,
      imageUrls: announcement.image_urls,
      isImportant: announcement.is_important,
      organizationId: announcement.organization_id,
      publishedAt: announcement.published_at,
      title: announcement.title,
    }));

  const navBadges = await getMobileNavBadges();

  const locale = session.user.preferredLanguage;
  const readIds = await getReadAnnouncementIds(session.user.id, announcements.map((a) => a.id));

  // 화이트 리디자인(2026-10-15): 고정 공지는 맨 위 「고정」 묶음(날짜를 meta 에), 나머지는 도쿄 게시일 묶음.
  const toRow = (ann: (typeof announcements)[number], withDate: boolean) => ({
    id: ann.id,
    title: ann.title,
    meta: [withDate ? formatShortDay(ann.published_at, locale) : null, targetLabel(ann.target_scope, ann.target_roles as string[], copy), ann.author_name || null]
      .filter(Boolean)
      .join(" · "),
    important: ann.is_important,
    unread: !readIds.has(ann.id),
    hasImages: ann.image_urls.length > 0,
  });
  const groups: MobileNoticeGroup[] = [];
  const pinned = announcements.filter((ann) => ann.is_pinned);
  if (pinned.length > 0) groups.push({ key: "pinned", label: copy.white.mPinned, items: pinned.map((ann) => toRow(ann, true)) });
  for (const ann of announcements) {
    if (ann.is_pinned) continue;
    const key = toTokyoDate(ann.published_at) || "unknown";
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: formatDayLabel(ann.published_at, locale), items: [] };
      groups.push(group);
    }
    group.items.push(toRow(ann, false));
  }

  return (
    <MobileShell
      activeItem="announcements"
      badges={navBadges}
      title={copy.title}
      split
    >
      <SplitList detail="announcements">
        <AnnouncementPopup
          announcements={popupAnnouncements}
          detailHrefBase="/mobile/announcements"
          locale={locale}
        />

        <AnnouncementListMobile
          title={copy.title}
          groups={groups}
          copy={{
            important: copy.white.important,
            unreadN: copy.white.mUnreadN,
            allRead: copy.white.mAllRead,
            unreadSr: copy.white.mUnreadSr,
            hasPhoto: copy.white.mHasPhoto,
            empty: copy.white.mEmpty,
            emptyHint: copy.white.mEmptyHint,
          }}
        />
      </SplitList>
    </MobileShell>
  );
}
