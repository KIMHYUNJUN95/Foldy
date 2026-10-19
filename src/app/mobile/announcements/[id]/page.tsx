import { after } from "next/server";
import { notFound, redirect } from "next/navigation";
import { AnnouncementImageGrid } from "@/components/announcements/announcement-image-grid";
import "@/components/announcements/announcements-mobile.css";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getAnnouncementDictionary } from "@/lib/announcement-i18n";
import {
  ensureAnnouncementRead,
  getAnnouncementReadAt,
  getVisibleAnnouncementById,
} from "@/lib/announcements";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import type { OrganizationRole } from "@/config/roles";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

/** 「10월 8일 18:20」 — 도쿄 기준. */
function formatDateTime(value: string | null, locale: string): string {
  if (!value) return "";
  const tag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  return new Intl.DateTimeFormat(tag, {
    month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Tokyo",
  }).format(new Date(value));
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

export default async function MobileAnnouncementDetailPage({
  params,
}: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, routeParams] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=/mobile/announcements/${routeParams.id}`);
  }

  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }

  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const copy = getAnnouncementDictionary(session.user.preferredLanguage);
  const [announcement, existingReadAt] = await Promise.all([
    getVisibleAnnouncementById(session, routeParams.id),
    getAnnouncementReadAt(routeParams.id, session.user.id),
  ]);

  if (!announcement) {
    notFound();
  }

  // 읽음 기록은 응답을 보낸 뒤에 쓴다(`after`). 메뉴 배지는 그 전에 셌으므로, 이 공지가 안 읽음이었다면
  // 이 화면의 배지에서 하나 빼 — 열자마자 배지가 줄어드는 동작은 그대로다.
  const userId = session.user.id;
  if (!existingReadAt) {
    after(() => ensureAnnouncementRead(announcement, userId));
  }

  const rawNavBadges = await navBadgesPromise;
  const navBadges = existingReadAt
    ? rawNavBadges
    : { ...rawNavBadges, announcements: Math.max(0, (rawNavBadges.announcements ?? 0) - 1) };
  const locale = session.user.preferredLanguage;

  return (
    <MobileShell
      activeItem="announcements"
      badges={navBadges}
      title={copy.readAnnouncement}
    >
      {/* 화이트 리디자인(2026-10-15, 시안 NoticeDetail-Phone) — 상자 없는 한 장: 표시 → 제목 → 날짜 · 대상 · 작성자 → 본문 → 사진. */}
      <article className="ntw ntw-d">
        {announcement.is_pinned || announcement.is_important ? (
          <div className="ntw-d__tags">
            {announcement.is_pinned ? <span className="is-violet">{copy.white.pinned}</span> : null}
            {announcement.is_important ? <span className="is-red">{copy.white.important}</span> : null}
          </div>
        ) : null}
        <h1>{announcement.title}</h1>
        <p className="ntw-d__meta">
          {[
            formatDateTime(announcement.published_at, locale),
            targetLabel(announcement.target_scope, announcement.target_roles as string[], copy),
            announcement.author_name || null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="ntw-d__body">{announcement.content}</p>
        {announcement.image_urls.length > 0 ? (
          <div className="ntw-d__photos">
            <AnnouncementImageGrid
              closeLabel={copy.close}
              imageAltLabel={copy.imageAttachments}
              imageUrls={announcement.image_urls}
              variant="plain"
            />
            <span className="ntw-d__hint">{copy.white.mTapPhoto}</span>
          </div>
        ) : null}
      </article>
    </MobileShell>
  );
}
