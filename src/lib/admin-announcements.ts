import "server-only";
import { memberCapabilities } from "@/lib/capabilities-server";

import type { AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { OrganizationRole } from "@/config/roles";
import type { Database } from "@/types/database";

type AnnouncementRow = Database["public"]["Tables"]["announcements"]["Row"];
type OrganizationRow = Pick<
  Database["public"]["Tables"]["organizations"]["Row"],
  "id" | "name"
>;
type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "name"
>;
type MembershipRow = Pick<
  Database["public"]["Tables"]["memberships"]["Row"],
  "organization_id" | "role" | "user_id"
>;

export type AdminAnnouncementVM = {
  id: string;
  organizationId: string;
  organizationName: string;
  title: string;
  content: string;
  body: string[];
  authorId: string;
  authorName: string;
  status: "draft" | "published" | "archived";
  isImportant: boolean;
  isPinned: boolean;
  popup: boolean;
  popupUntil: string | null;
  targetScope: "everyone" | "roles";
  targetRoles: OrganizationRole[];
  images: string[];
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // 파생 값
  targetTotal: number;
  readCount: number;
  unreadCount: number;
  popupDismissed: number;
  isPopupActive: boolean;
  canEdit: boolean;
  canOperate: boolean;
};

export type AdminAnnouncementRoleCount = {
  role: OrganizationRole;
  count: number;
};

export type AdminAnnouncementsData = {
  announcements: AdminAnnouncementVM[];
  organizations: OrganizationRow[];
  /** 역할별 활성 구성원 수, 조직 id 기준(대상 역할 칩용). */
  roleCountsByOrg: Record<string, AdminAnnouncementRoleCount[]>;
  /** 조직별 전체 활성 구성원 수("전체" 수신자 수용). */
  orgMemberTotal: Record<string, number>;
  me: { id: string; name: string; role: string };
  isPlatformAdmin: boolean;
  /**
   * 이 사용자가 공지를 만들 수 있는 조직 — 즉 서버 액션이
   * 실제로 insert 를 받아 주는 조직. 비어 있으면 작성창을
   * 아예 보여주지 않아야 한다.
   */
  creatableOrganizationIds: string[];
  loadError: boolean;
};

const announcementSelect =
  "id, organization_id, title, content, created_by_user_id, target_scope, target_roles, status, is_important, is_pinned, show_popup_on_app_open, popup_until, allow_comments, image_urls, published_at, archived_at, created_at, updated_at";

function splitBody(content: string): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return paragraphs.length > 0 ? paragraphs : [content.trim()].filter(Boolean);
}

function isPopupActive(row: AnnouncementRow, nowIso: string): boolean {
  if (row.status !== "published" || !row.show_popup_on_app_open) return false;
  return !row.popup_until || row.popup_until > nowIso;
}

/**
 * 현재 관리자가 볼 수 있는 모든 공지(쓰기 가능한 조직 전체)를 불러와, 작성자 / 조직 이름과
 * 파생된 도달 수 + 읽음 지표를 붙여 대시보드 콘솔에 준다. 읽기 전용이며,
 * 변경은 콘솔 서버 액션이 한다.
 */
export async function getAdminAnnouncements(
  session: AppSession,
): Promise<AdminAnnouncementsData> {
  const service = getSupabaseServiceClient();
  const me = {
    id: session.user.id,
    name: session.user.name ?? "",
    role: session.user.role,
  };
  const isPlatformAdmin = session.user.role === "developer_super_admin";

  const empty: AdminAnnouncementsData = {
    announcements: [],
    organizations: [],
    roleCountsByOrg: {},
    orgMemberTotal: {},
    me,
    isPlatformAdmin,
    creatableOrganizationIds: [],
    loadError: false,
  };

  try {
    // 1. 쓰기 가능한 조직 + 조직별 이 사용자의 역할을 구한다.
    let organizations: OrganizationRow[] = [];
    const membershipRoleByOrgId = new Map<string, OrganizationRole>();

    if (isPlatformAdmin) {
      const { data } = await service
        .from("organizations")
        .select("id, name")
        .order("created_at", { ascending: false });
      organizations = (data ?? []) as OrganizationRow[];
    } else {
      const { data: membershipData } = await service
        .from("memberships")
        .select("organization_id, role, user_id")
        .eq("user_id", me.id)
        .eq("status", "active");
      const memberships = (membershipData ?? []) as MembershipRow[];
      for (const membership of memberships) {
        membershipRoleByOrgId.set(
          membership.organization_id,
          membership.role as OrganizationRole,
        );
      }
      const orgIds = memberships.map((membership) => membership.organization_id);
      if (orgIds.length === 0) {
        return empty;
      }
      const { data } = await service
        .from("organizations")
        .select("id, name")
        .in("id", orgIds)
        .order("created_at", { ascending: false });
      organizations = (data ?? []) as OrganizationRow[];
    }

    // 조직마다 이 사람의 권한(역할 기본 + 개인 부여 · 차단, 2026-10-21). 예전엔 역할만 봤다.
    const capsByOrg = new Map<string, readonly string[]>(
      isPlatformAdmin
        ? []
        : await Promise.all(
            organizations.map(async (o) => [o.id, await memberCapabilities(o.id, me.id)] as const),
          ),
    );
    // 관리자 웹 · 공지 권한이 있는 조직만(2026-10-26) — 여러 조직에 속한 사람이 권한 없는 조직의
    // 공지 · 읽음 현황까지 보던 것을 막는다.
    if (!isPlatformAdmin) {
      organizations = organizations.filter((o) => {
        const caps = capsByOrg.get(o.id) ?? [];
        return (
          caps.includes("admin_web.access") ||
          caps.includes("announcement.create") ||
          caps.includes("announcement.manage")
        );
      });
    }
    const orgIds = organizations.map((organization) => organization.id);
    if (orgIds.length === 0) {
      return empty;
    }
    const orgNameById = new Map(organizations.map((o) => [o.id, o.name]));

    // 서버 액션의 `canCreateInOrganization` 게이트를 그대로 따라, 콘솔이
    // 제출 시 forbidden 을 맞기 전에 작성창을 숨길 수 있게 한다.
    const creatableOrganizationIds = isPlatformAdmin
      ? orgIds
      : orgIds.filter((org) => capsByOrg.get(org)?.includes("announcement.create") ?? false);

    // 2. 그 조직들의 공지.
    const { data: announcementData } = await service
      .from("announcements")
      .select(announcementSelect)
      .in("organization_id", orgIds)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    const rows = (announcementData ?? []) as AnnouncementRow[];
    const announcementIds = rows.map((row) => row.id);

    // 3. 조직 전체의 활성 멤버십 — 역할별 수 + 전체 합계.
    const { data: allMembershipData } = await service
      .from("memberships")
      .select("organization_id, role, user_id")
      .in("organization_id", orgIds)
      .eq("status", "active");
    const allMemberships = (allMembershipData ?? []) as MembershipRow[];
    const roleCountMap = new Map<string, Map<OrganizationRole, number>>();
    const orgMemberTotal: Record<string, number> = {};
    for (const membership of allMemberships) {
      const org = membership.organization_id;
      orgMemberTotal[org] = (orgMemberTotal[org] ?? 0) + 1;
      const perOrg = roleCountMap.get(org) ?? new Map<OrganizationRole, number>();
      const role = membership.role as OrganizationRole;
      perOrg.set(role, (perOrg.get(role) ?? 0) + 1);
      roleCountMap.set(org, perOrg);
    }
    const roleCountsByOrg: Record<string, AdminAnnouncementRoleCount[]> = {};
    for (const org of orgIds) {
      const perOrg = roleCountMap.get(org);
      roleCountsByOrg[org] = perOrg
        ? [...perOrg.entries()].map(([role, count]) => ({ role, count }))
        : [];
    }

    // 4. 작성자 이름.
    const authorIds = [...new Set(rows.map((row) => row.created_by_user_id))];
    const authorNames = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: profileData } = await service
        .from("profiles")
        .select("id, name")
        .in("id", authorIds);
      for (const profile of (profileData ?? []) as ProfileRow[]) {
        authorNames.set(profile.id, profile.name);
      }
    }

    // 5. 읽음 수 + 팝업 닫기(묶음 조회).
    const readCountById = new Map<string, number>();
    // 현재 대상 구성원(활성 + 대상 역할)이 읽은 것만 센다(2026-10-26) — 읽고 나서 퇴사 · 역할 변경 ·
    // 대상 축소가 된 사람이 «읽음» 분자에 남아 상세 화면(getAnnouncementReadSummary)과 어긋났다.
    const memberRoleByOrgUser = new Map<string, OrganizationRole>();
    for (const m of allMemberships) {
      memberRoleByOrgUser.set(`${m.organization_id}:${m.user_id}`, m.role as OrganizationRole);
    }
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const dismissCountById = new Map<string, number>();
    if (announcementIds.length > 0) {
      const [{ data: readData }, { data: dismissData }] = await Promise.all([
        service
          .from("announcement_reads")
          .select("announcement_id, user_id")
          .in("announcement_id", announcementIds),
        service
          .from("announcement_popup_dismissals")
          .select("announcement_id")
          .in("announcement_id", announcementIds),
      ]);
      for (const read of (readData ?? []) as { announcement_id: string; user_id: string }[]) {
        const ann = rowById.get(read.announcement_id);
        if (!ann) continue;
        const role = memberRoleByOrgUser.get(`${ann.organization_id}:${read.user_id}`);
        if (!role) continue;
        if (ann.target_scope === "roles" && !((ann.target_roles ?? []) as string[]).includes(role)) {
          continue;
        }
        readCountById.set(
          read.announcement_id,
          (readCountById.get(read.announcement_id) ?? 0) + 1,
        );
      }
      for (const dismiss of (dismissData ?? []) as {
        announcement_id: string;
      }[]) {
        dismissCountById.set(
          dismiss.announcement_id,
          (dismissCountById.get(dismiss.announcement_id) ?? 0) + 1,
        );
      }
    }

    const nowIso = new Date().toISOString();

    const announcements: AdminAnnouncementVM[] = rows.map((row) => {
      const targetRoles = (row.target_roles ?? []) as OrganizationRole[];
      const org = row.organization_id;
      const targetTotal =
        row.target_scope === "roles"
          ? targetRoles.reduce((sum, role) => {
              const perOrg = roleCountMap.get(org);
              return sum + (perOrg?.get(role) ?? 0);
            }, 0)
          : (orgMemberTotal[org] ?? 0);
      const readCount = Math.min(readCountById.get(row.id) ?? 0, targetTotal);
      const isAuthor = row.created_by_user_id === me.id;
      const caps = capsByOrg.get(org) ?? [];
      const canManage =
        isPlatformAdmin || caps.includes("announcement.manage") || (isAuthor && caps.includes("announcement.create"));

      return {
        id: row.id,
        organizationId: org,
        organizationName: orgNameById.get(org) ?? "",
        title: row.title,
        content: row.content,
        body: splitBody(row.content),
        authorId: row.created_by_user_id,
        authorName: authorNames.get(row.created_by_user_id) ?? "",
        status: row.status,
        isImportant: row.is_important,
        isPinned: row.is_pinned,
        popup: row.show_popup_on_app_open,
        popupUntil: row.popup_until,
        targetScope: row.target_scope,
        targetRoles,
        images: row.image_urls ?? [],
        publishedAt: row.published_at,
        archivedAt: row.archived_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        targetTotal,
        readCount,
        unreadCount:
          row.status === "published" || row.status === "archived"
            ? Math.max(0, targetTotal - readCount)
            : targetTotal,
        popupDismissed: dismissCountById.get(row.id) ?? 0,
        isPopupActive: isPopupActive(row, nowIso),
        canEdit: canManage,
        canOperate: canManage,
      };
    });

    return {
      announcements,
      organizations,
      roleCountsByOrg,
      orgMemberTotal,
      me,
      isPlatformAdmin,
      creatableOrganizationIds,
      loadError: false,
    };
  } catch {
    return { ...empty, loadError: true };
  }
}
