import "server-only";

import type { AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { OrganizationRole, Role } from "@/config/roles";
import type { Database } from "@/types/database";

/**
 * Roles allowed to CREATE an announcement. Single source of truth — the server
 * actions in `src/app/admin/announcements/actions.ts` import this list to gate
 * `canCreateInOrganization`, and the console uses it to decide whether the
 * "새 공지" button is rendered at all. Keep the two in lockstep: a role that can
 * see the button but is rejected by the action produces a silent forbidden.
 *
 * NOTE: this list intentionally differs from the manage/edit gate
 * (`canManageAnnouncement`), which also accepts `senior_managing_director`.
 * Widening creation rights is a role-permission change and needs explicit
 * product approval — do not add roles here on your own.
 */
export const announcementCreatorRoles = [
  "developer_super_admin",
  "owner",
  "senior_managing_director",
  "office_admin",
  "cs_staff",
  "field_manager",
  "staff",
] as const satisfies readonly Role[];

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
  // Derived
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
  /** Active member counts per role, keyed by organization id (for target-role chips). */
  roleCountsByOrg: Record<string, AdminAnnouncementRoleCount[]>;
  /** Total active members per organization (for the "everyone" recipient count). */
  orgMemberTotal: Record<string, number>;
  me: { id: string; name: string; role: string };
  isPlatformAdmin: boolean;
  /**
   * Organizations this user may create an announcement in — i.e. the orgs where the
   * server action would actually accept the insert. Empty means the composer must not
   * be offered at all.
   */
  creatableOrganizationIds: string[];
  loadError: boolean;
};

const announcementSelect =
  "id, organization_id, title, content, created_by_user_id, target_scope, target_roles, status, is_important, is_pinned, show_popup_on_app_open, popup_until, allow_comments, image_urls, published_at, archived_at, created_at, updated_at";

const TOP_ADMIN_ROLES: readonly OrganizationRole[] = [
  "owner",
  "senior_managing_director",
  "office_admin",
];

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
 * Loads every announcement the current admin can see (across writable organizations),
 * enriched with author / organization names and derived reach + read metrics for the
 * dashboard console. Read-only; mutations go through the console server actions.
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
    // 1. Resolve writable organizations + this user's role per org.
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
        .eq("status", "active")
        .neq("role", "part_time_staff");
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

    const orgIds = organizations.map((organization) => organization.id);
    if (orgIds.length === 0) {
      return empty;
    }
    const orgNameById = new Map(organizations.map((o) => [o.id, o.name]));

    // Mirror of the server action's `canCreateInOrganization` gate, so the console can
    // hide the composer instead of letting the user hit a forbidden on submit.
    const creatableOrganizationIds = isPlatformAdmin
      ? orgIds
      : orgIds.filter((org) => {
          const role = membershipRoleByOrgId.get(org);
          return (
            role !== undefined &&
            (announcementCreatorRoles as readonly Role[]).includes(role)
          );
        });

    // 2. Announcements across those orgs.
    const { data: announcementData } = await service
      .from("announcements")
      .select(announcementSelect)
      .in("organization_id", orgIds)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    const rows = (announcementData ?? []) as AnnouncementRow[];
    const announcementIds = rows.map((row) => row.id);

    // 3. Active memberships across orgs — role counts + everyone totals.
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

    // 4. Author names.
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

    // 5. Read counts + popup dismissals (batched).
    const readCountById = new Map<string, number>();
    const dismissCountById = new Map<string, number>();
    if (announcementIds.length > 0) {
      const [{ data: readData }, { data: dismissData }] = await Promise.all([
        service
          .from("announcement_reads")
          .select("announcement_id")
          .in("announcement_id", announcementIds),
        service
          .from("announcement_popup_dismissals")
          .select("announcement_id")
          .in("announcement_id", announcementIds),
      ]);
      for (const read of (readData ?? []) as { announcement_id: string }[]) {
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
      const role = membershipRoleByOrgId.get(org);
      const canManage =
        isPlatformAdmin ||
        (role !== undefined &&
          role !== "part_time_staff" &&
          (TOP_ADMIN_ROLES.includes(role) || isAuthor));

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
