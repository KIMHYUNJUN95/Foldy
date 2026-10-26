import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ImageIcon,
  Megaphone,
  Pin,
  ShieldAlert,
  Users,
} from "lucide-react";
import { AnnouncementCommentsSection } from "@/components/announcements/announcement-comments-section";
import { AnnouncementImageGrid } from "@/components/announcements/announcement-image-grid";
import { AnnouncementReadStatusPanel } from "@/components/announcements/announcement-read-status-panel";
import { AdminShell } from "@/components/shell/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { adminWebRoles } from "@/config/roles";
import { getAnnouncementDictionary } from "@/lib/announcement-i18n";
import {
  ensureAnnouncementRead,
  getAnnouncementComments,
  getAnnouncementReadSummary,
} from "@/lib/announcements";
import { requireAdminSession } from "@/lib/admin-session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type AnnouncementRow = Database["public"]["Tables"]["announcements"]["Row"];
type OrganizationRow = Pick<
  Database["public"]["Tables"]["organizations"]["Row"],
  "id" | "name"
>;
type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "name"
>;

function formatDate(value: string | null, locale: string) {
  if (!value) {
    return "";
  }

  // 공지 타임스탬프는 UTC 시점이지만 제품은 이를 도쿄
  // 운영 날짜로 읽는다(모바일은 목록을 도쿄 `published_at` 날짜로 묶음). 그래서
  // 관리자 상세도 같은 시간대로 고정해야 09:00 JST 이전에 하루가 어긋나지 않는다.
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Tokyo",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminAnnouncementDetailPage({
  params,
  searchParams,
}: PageProps) {
  const session = await requireAdminSession();
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const copy = getAnnouncementDictionary(session.user.preferredLanguage);
  const service = getSupabaseServiceClient();

  const { data: announcementData } = await service
    .from("announcements")
    .select(
      "id, organization_id, title, content, created_by_user_id, target_scope, target_roles, status, is_important, is_pinned, show_popup_on_app_open, popup_until, allow_comments, image_urls, published_at, archived_at, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  const announcement = announcementData as AnnouncementRow | null;

  if (!announcement) {
    notFound();
  }

  // 권한: developer_super_admin 은 모든 조직의 공지를 볼 수 있다.
  // 그 외 관리자는 해당 공지 조직의 활성 멤버십이 있어야 하며
  // 그 역할이 관리자 웹 접근이 가능한 역할(owner, office_admin, cs_staff)이어야 한다.
  // 다른 조직의 field_manager / staff / part_time_staff 멤버십은 접근 권한을 주지 않는다.
  if (session.user.role !== "developer_super_admin") {
    // adminWebRoles 에는 "developer_super_admin"(플랫폼 전용)이 포함되어 있어 걸러낸다.
    // 조직 멤버십에는 조직 역할만 담기기 때문이다.
    const orgAdminWebRoles = adminWebRoles.filter(
      (r) => r !== "developer_super_admin",
    );
    const { data: membershipCheck } = await service
      .from("memberships")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("organization_id", announcement.organization_id)
      .eq("status", "active")
      .in("role", orgAdminWebRoles)
      .maybeSingle();

    if (!membershipCheck) {
      notFound();
    }
  }

  const [organizationResult, authorResult, , comments] = await Promise.all([
    service
      .from("organizations")
      .select("id, name")
      .eq("id", announcement.organization_id)
      .maybeSingle(),
    service
      .from("profiles")
      .select("id, name")
      .eq("id", announcement.created_by_user_id)
      .maybeSingle(),
    ensureAnnouncementRead(announcement, session.user.id),
    getAnnouncementComments(announcement, session.user.id),
  ]);
  const readSummary = await getAnnouncementReadSummary(announcement);

  const organization = organizationResult.data as OrganizationRow | null;
  const author = authorResult.data as ProfileRow | null;
  const errorKey = firstParam(query.error);
  const errorMessage = errorKey
    ? (copy.errors[errorKey] ?? copy.errors.comment_failed)
    : null;
  const successMessage =
    firstParam(query.commentSaved) === "1"
      ? copy.commentSaved
      : firstParam(query.commentUpdated) === "1"
        ? copy.commentUpdated
        : firstParam(query.commentDeleted) === "1"
          ? copy.commentDeleted
          : null;

  return (
    <AdminShell activeItem="announcements" title={copy.readAnnouncement}>
      <Link
        className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        href="/admin/announcements"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {copy.backToAnnouncements}
      </Link>

      <Card className="mt-6 rounded-lg p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Megaphone className="size-5" aria-hidden="true" />
              </div>
              <Badge className="rounded-md">{copy.statuses[announcement.status]}</Badge>
              {announcement.is_important && (
                <Badge className="rounded-md border-destructive/20 bg-destructive/10 text-destructive">
                  <ShieldAlert className="mr-1 size-3" aria-hidden="true" />
                  {copy.important}
                </Badge>
              )}
              {announcement.is_pinned && (
                <Badge className="rounded-md">
                  <Pin className="mr-1 size-3" aria-hidden="true" />
                  {copy.pinned}
                </Badge>
              )}
              {announcement.image_urls.length > 0 && (
                <Badge className="rounded-md">
                  <ImageIcon className="mr-1 size-3" aria-hidden="true" />
                  {announcement.image_urls.length}
                </Badge>
              )}
            </div>
            <h2 className="mt-4 max-w-5xl break-words text-3xl font-black leading-tight text-foreground">
              {announcement.title}
            </h2>
          </div>
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <p className="text-xs font-black uppercase text-muted-foreground">
              {copy.organization}
            </p>
            <p className="mt-2 break-words text-sm font-semibold leading-6 text-foreground">
              {organization?.name ?? ""}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <p className="text-xs font-black uppercase text-muted-foreground">
              {copy.author}
            </p>
            <p className="mt-2 break-words text-sm font-semibold leading-6 text-foreground">
              {author?.name ?? ""}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <p className="flex items-center gap-1 text-xs font-black uppercase text-muted-foreground">
              <Users className="size-3" aria-hidden="true" />
              {copy.target}
            </p>
            <p className="mt-2 break-words text-sm font-semibold leading-6 text-foreground">
              {announcement.target_scope === "everyone"
                ? copy.targetScopes.everyone
                : announcement.target_roles
                    .map((role) => copy.targetRoles[role])
                    .join(", ")}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <p className="flex items-center gap-1 text-xs font-black uppercase text-muted-foreground">
              <CalendarDays className="size-3" aria-hidden="true" />
              {copy.publishedAt}
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {formatDate(
                announcement.published_at,
                session.user.preferredLanguage,
              )}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <p className="text-xs font-black uppercase text-muted-foreground">
              {copy.archivedAt}
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {formatDate(
                announcement.archived_at,
                session.user.preferredLanguage,
              )}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <p className="text-xs font-black uppercase text-muted-foreground">
              {copy.status}
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {copy.statuses[announcement.status]}
            </p>
          </div>
        </div>
      </Card>

      <Card className="mt-6 rounded-lg p-6 shadow-sm">
        <h2 className="text-xl font-black">{copy.content}</h2>
        <p className="mt-4 whitespace-pre-line break-words text-sm font-semibold leading-7 text-muted-foreground">
          {announcement.content}
        </p>
      </Card>

      {announcement.image_urls.length > 0 && (
        <Card className="mt-6 rounded-lg p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ImageIcon className="size-5" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-black">{copy.imageAttachments}</h2>
          </div>
          <AnnouncementImageGrid imageUrls={announcement.image_urls} closeLabel={copy.close} imageAltLabel={copy.imageAttachments} />
        </Card>
      )}

      <Card className="mt-6 rounded-lg p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="size-5" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-black">{copy.readSummary}</h2>
        </div>
        <AnnouncementReadStatusPanel
          locale={session.user.preferredLanguage}
          summary={readSummary}
        />
      </Card>

      <AnnouncementCommentsSection
        allowComments={
          announcement.allow_comments && announcement.status === "published"
        }
        announcementId={announcement.id}
        comments={comments}
        errorMessage={errorMessage}
        locale={session.user.preferredLanguage}
        returnTo={`/admin/announcements/${announcement.id}`}
        successMessage={successMessage}
      />
    </AdminShell>
  );
}
