import { MobileInvites, type MobileInviteRow } from "@/components/mobile/users/mobile-invites";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { DEFAULT_INVITE_MAX_USES, defaultInviteExpiry, generateInviteCode } from "@/lib/invite-code-gen";
import { listManageableOrganizations, selectableInviteRoles } from "@/lib/invite-codes-server";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { tokyoToday } from "@/lib/tokyo-date";
import type { Database } from "@/types/database";
import { requireMobileUserManagement } from "../gate";

type InviteCodeRow = Database["public"]["Tables"]["invite_codes"]["Row"];

/** 렌더 밖에서 읽는 지금 시각 — 코드 상태(만료) 판정용. */
function nowMs() {
  return Date.now();
}

/**
 * 모바일 사용자 관리 — 초대코드(2026-10-20, 시안 ⑪ ~ ⑬). 대시보드 「멤버 초대」와 같은 데이터 · 같은 서버 본체.
 * 태블릿 가로도 한 단(만들기 위 · 목록 아래) — 상세 주소가 없는 화면이라 2분할하지 않는다.
 */
export default async function MobileInvitesPage() {
  const navBadgesPromise = getMobileNavBadges();
  const session = await requireMobileUserManagement("/mobile/users/invites");
  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const c = dict.admin.users.console;
  const service = getSupabaseServiceClient();

  const organizations = await listManageableOrganizations(session.user.id, session.user.role);
  const organizationIds = organizations.map((organization) => organization.id);
  const [{ data: inviteData }, memberCountResult, navBadges] = await Promise.all([
    organizationIds.length > 0
      ? service
          .from("invite_codes")
          .select("id, code, name, organization_id, default_role, expires_at, max_uses, used_count, is_active, created_at")
          .in("organization_id", organizationIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    session.organization.id === "platform"
      ? Promise.resolve({ count: null })
      : service.from("memberships").select("id", { count: "exact", head: true }).eq("organization_id", session.organization.id),
    navBadgesPromise,
  ]);
  const invites = (inviteData ?? []) as InviteCodeRow[];

  const today = tokyoToday();
  const now = nowMs();
  const thisYear = today.slice(0, 4);
  const dayText = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: "Asia/Tokyo",
      ...(new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }).slice(0, 4) === thisYear ? {} : { year: "numeric" }),
      month: "short", // ko · ja 는 long 과 같은 글자, 영어만 «Nov 22»(목록 보조 줄이 잘리지 않게)
      day: "numeric",
    }).format(new Date(iso));
  const rows: MobileInviteRow[] = invites.map((invite) => {
    const expired = Boolean(invite.expires_at) && new Date(invite.expires_at as string).getTime() <= now;
    const usedUp = invite.used_count >= invite.max_uses;
    const state = !invite.is_active ? "off" : usedUp ? "used" : expired ? "expired" : "live";
    const until =
      state === "off"
        ? c.wInvOff
        : state === "used"
          ? c.wInvUsedUp
          : state === "expired"
            ? c.wInvExpired.replace("{date}", dayText(invite.expires_at as string))
            : invite.expires_at
              ? c.wInvUntil.replace("{date}", dayText(invite.expires_at))
              : "—";
    return {
      id: invite.id,
      code: invite.code,
      organizationId: invite.organization_id,
      role: invite.default_role,
      used: invite.used_count,
      max: invite.max_uses,
      state,
      until,
      createdAt: invite.created_at,
    };
  });

  return (
    <MobileShell activeItem="users" badges={navBadges} title={dict.admin.users.title}>
      <MobileInvites
        rows={rows}
        organizations={organizations.map((organization) => ({
          id: organization.id,
          name: organization.name,
          codeSource: organization.slug || organization.name,
        }))}
        roles={selectableInviteRoles(session.user.role)}
        today={today}
        // 초대코드의 첫 랜덤값은 서버가 정한다 — 클라이언트 첫 렌더에서 뽑으면 SSR 결과와 어긋난다.
        defaultCode={generateInviteCode(organizations[0]?.slug || organizations[0]?.name || "")}
        defaultExpiresAt={defaultInviteExpiry(today)}
        defaultMaxUses={DEFAULT_INVITE_MAX_USES}
        memberCount={memberCountResult.count ?? null}
        locale={locale}
      />
    </MobileShell>
  );
}
