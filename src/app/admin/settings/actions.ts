"use server";

import { redirect } from "next/navigation";
import type { Role } from "@/config/roles";
import { createInviteCodeAs, deleteInviteCodeAs, setInviteCodeActiveAs } from "@/lib/invite-codes-server";
import { getCurrentAppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

type OrganizationRow = Database["public"]["Tables"]["organizations"]["Row"];
type MembershipInsert = Database["public"]["Tables"]["memberships"]["Insert"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getCurrentUserId() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

// 역할은 세션의 역할(현재 조직 기준, 플랫폼 관리자는 developer_super_admin)을 쓴다(2026-10-26).
// 예전엔 «아무 조직의 첫 멤버십» 역할을 읽어, 여러 조직 소속이면 어느 조직 역할인지 불분명했다.
async function getCurrentRole(userId: string): Promise<Role | null> {
  const session = await getCurrentAppSession();
  if (!session || session.user.id !== userId) return null;
  return session.user.role as Role;
}

export async function createOrganization(formData: FormData) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/auth/login?next=/admin/settings/organization");
  }

  const role = await getCurrentRole(userId);
  if (role !== "developer_super_admin") {
    redirect("/admin/settings/organization?error=forbidden");
  }

  const name = String(formData.get("name") ?? "").trim();
  const rawSlug = String(formData.get("slug") ?? "");
  const slug = normalizeSlug(rawSlug || name);
  const addOwner = formData.get("addOwner") === "on";

  if (!name || !slug) {
    redirect("/admin/settings/organization?error=invalid_organization");
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("organizations")
    .insert({ name, slug })
    .select("id, name, slug, status, created_at, updated_at")
    .single();

  if (error || !data) {
    redirect("/admin/settings/organization?error=save_failed");
  }

  const organization = data as OrganizationRow;

  if (addOwner) {
    const membership: MembershipInsert = {
      organization_id: organization.id,
      user_id: userId,
      role: "owner",
      status: "active",
      joined_at: new Date().toISOString(),
    };

    const { error: membershipError } = await service
      .from("memberships")
      .upsert(membership, { onConflict: "organization_id,user_id" });

    if (membershipError) {
      redirect("/admin/settings/organization?error=save_failed");
    }
  }

  redirect("/admin/settings/organization?created=1");
}

export async function updateOrganization(formData: FormData) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/auth/login?next=/admin/settings/organization");
  }

  const role = await getCurrentRole(userId);
  if (role !== "developer_super_admin") {
    redirect("/admin/settings/organization?error=forbidden");
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!organizationId || !UUID_RE.test(organizationId) || !name) {
    redirect("/admin/settings/organization?error=invalid_organization");
  }

  // 이름만 변경 — slug 는 링크/캐시에서 참조될 수 있어 고정한다(조직 설정 UI 참고).
  const { error } = await getSupabaseServiceClient()
    .from("organizations")
    .update({ name })
    .eq("id", organizationId);

  if (error) {
    redirect("/admin/settings/organization?error=save_failed");
  }

  redirect("/admin/settings/organization?updated=1");
}

export async function deleteOrganization(formData: FormData) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/auth/login?next=/admin/settings/organization");
  }

  const role = await getCurrentRole(userId);
  if (role !== "developer_super_admin") {
    redirect("/admin/settings/organization?error=forbidden");
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!organizationId || !UUID_RE.test(organizationId)) {
    redirect("/admin/settings/organization?error=invalid_organization");
  }

  const service = getSupabaseServiceClient();

  // 가드: 빈 조직(멤버 0명)만 삭제할 수 있다. 조직 단위 테이블은 모두
  // organization_id 를 ON DELETE CASCADE 로 참조하므로, 멤버가 있는 조직을 지우면
  // 모든 데이터(멤버, 근태, 청소, 예약 등)가 조용히 사라진다. 여기서 막는다.
  const { count, error: countError } = await service
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (countError) {
    redirect("/admin/settings/organization?error=save_failed");
  }
  if ((count ?? 0) > 0) {
    redirect("/admin/settings/organization?error=org_not_empty");
  }

  const { error } = await service
    .from("organizations")
    .delete()
    .eq("id", organizationId);

  if (error) {
    redirect("/admin/settings/organization?error=save_failed");
  }

  redirect("/admin/settings/organization?deleted=1");
}

/** 대시보드 폼 액션 — 본체는 `src/lib/invite-codes-server.ts`(모바일과 같음), 결과를 주소 쿼리로 넘긴다. */
async function inviteActorOrRedirect() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/auth/login?next=/admin/users/invites");
  const role = await getCurrentRole(userId);
  if (!role) redirect("/admin/users/invites?error=forbidden");
  return { userId, role };
}

export async function createInviteCode(formData: FormData) {
  const actor = await inviteActorOrRedirect();
  const result = await createInviteCodeAs(actor, {
    organizationId: String(formData.get("organizationId") ?? ""),
    defaultRole: String(formData.get("defaultRole") ?? ""),
    code: String(formData.get("code") ?? ""),
    name: String(formData.get("name") ?? ""),
    expiresAt: String(formData.get("expiresAt") ?? ""),
    maxUses: String(formData.get("maxUses") ?? ""),
  });
  redirect(result.ok ? "/admin/users/invites?created=1" : `/admin/users/invites?error=${result.error}`);
}

async function toggleInvite(formData: FormData, active: boolean) {
  const actor = await inviteActorOrRedirect();
  const result = await setInviteCodeActiveAs(actor, {
    inviteCodeId: String(formData.get("inviteCodeId") ?? ""),
    organizationId: String(formData.get("organizationId") ?? ""),
    active,
  });
  if (!result.ok) redirect(`/admin/users/invites?error=${result.error}`);
  redirect(active ? "/admin/users/invites?activated=1" : "/admin/users/invites?deactivated=1");
}

export async function deactivateInviteCode(formData: FormData) {
  await toggleInvite(formData, false);
}

export async function activateInviteCode(formData: FormData) {
  await toggleInvite(formData, true);
}

export async function deleteInviteCode(formData: FormData) {
  const actor = await inviteActorOrRedirect();
  const result = await deleteInviteCodeAs(actor, {
    inviteCodeId: String(formData.get("inviteCodeId") ?? ""),
    organizationId: String(formData.get("organizationId") ?? ""),
  });
  redirect(result.ok ? "/admin/users/invites?deleted=1" : `/admin/users/invites?error=${result.error}`);
}
