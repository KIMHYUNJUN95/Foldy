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
import { annDate, annDayKey, annDayLabel } from "@/lib/announcement-display";

// 날짜 표기 · 묶음 열쇠는 lib/announcement-display 하나로(2026-11-20) — 묶음 머리 「2026.11.14 (토)」 · 고정 줄 날짜 「2026.11.18」.

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
  const navBadgesPromise = getMobileNavBadges();
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
  const [dismissals, readIds] = await Promise.all([
    getPopupDismissals(
      session.user.id,
      popupCandidates.map((a) => a.id),
    ),
    getReadAnnouncementIds(session.user.id, announcements.map((a) => a.id)),
  ]);
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

  const navBadges = await navBadgesPromise;

  const locale = session.user.preferredLanguage;

  // 화이트 리디자인(2026-10-15): 고정 공지는 맨 위 「고정」 묶음(날짜를 meta 에), 나머지는 도쿄 게시일 묶음.
  const toRow = (ann: (typeof announcements)[number], withDate: boolean) => ({
    id: ann.id,
    title: ann.title,
    meta: [withDate ? annDate(ann.published_at) : null, targetLabel(ann.target_scope, ann.target_roles as string[], copy), ann.author_name || null]
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
    const key = annDayKey(ann.published_at) || "unknown";
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: annDayLabel(ann.published_at, locale), items: [] };
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
