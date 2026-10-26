import { redirect } from "next/navigation";
import { Ban, RotateCcw } from "lucide-react";
import {
  activateInviteCode,
  createInviteCode,
  deactivateInviteCode,
} from "@/app/admin/settings/actions";
import { InviteCopyButton } from "@/components/admin/users/invite-copy-button";
import { InviteDeleteButton } from "@/components/admin/users/invite-delete-button";
import { AdminShell } from "@/components/shell/admin-shell";
import { InviteCreateForm } from "@/components/admin/users/invite-create-form";
import { UsersSectionTabs } from "@/components/admin/users/users-section-tabs";
import "@/components/admin/users/users-white.css";
import { listManageableOrganizations, selectableInviteRoles } from "@/lib/invite-codes-server";
import { getDictionary } from "@/lib/i18n";
import {
  DEFAULT_INVITE_MAX_USES,
  defaultInviteExpiry,
  generateInviteCode,
} from "@/lib/invite-code-gen";
import { tokyoToday } from "@/lib/tokyo-date";
import { requireAdminSession } from "@/lib/admin-session";
import { actorCanOpenUserManagement } from "@/lib/user-management-access";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type InviteCodeRow = Database["public"]["Tables"]["invite_codes"]["Row"];


/** 렌더 밖에서 읽는 지금 시각 — 코드 상태(만료) 판정용. */
function nowMs() {
  return Date.now();
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminUsersInvitesPage({ searchParams }: PageProps) {
  const session = await requireAdminSession();
  // /admin/users 와 같은 게이트: developer, 또는 위임된 manage_users 를 가진 조직.
  if (!(await actorCanOpenUserManagement(session.user.id, session.user.role))) {
    redirect("/admin");
  }

  const params = (await searchParams) ?? {};
  const dictionary = getDictionary(session.user.preferredLanguage);
  const settings = dictionary.admin.settings;
  const tabs = dictionary.admin.users.console;

  // office_admin 은 초대 코드로 office_admin 이상을 부여할 수 없다(canAssignRole 의 수동
  // 역할 변경 단계와 같음) — 골랐다가 서버에서 거절되게 두지 않고 옵션을 숨긴다.
  const selectableDefaultRoles = selectableInviteRoles(session.user.role);

  const organizations = await listManageableOrganizations(session.user.id, session.user.role);
  const organizationIds = organizations.map((organization) => organization.id);
  const organizationNames = new Map(
    organizations.map((organization) => [organization.id, organization.name]),
  );

  const inviteQuery = getSupabaseServiceClient()
    .from("invite_codes")
    .select(
      "id, code, name, organization_id, default_role, expires_at, max_uses, used_count, is_active, created_by_user_id, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  const { data: inviteData } =
    organizationIds.length > 0
      ? await inviteQuery.in("organization_id", organizationIds)
      : { data: [] };
  const inviteCodes = (inviteData ?? []) as InviteCodeRow[];

  // 초대코드의 첫 랜덤값은 서버가 정한다 — 클라이언트가 첫 렌더에서 새로 뽑으면 SSR 결과와
  // 어긋나 하이드레이션이 깨진다. 이후 재생성은 사용자가 조직을 바꾸거나 ↻ 를 누를 때만 일어난다.
  const today = tokyoToday();
  const defaultCode = generateInviteCode(
    organizations[0]?.slug || organizations[0]?.name || "",
  );

  const created = firstParam(params.created) === "1";
  const deactivated = firstParam(params.deactivated) === "1";
  const activated = firstParam(params.activated) === "1";
  const deleted = firstParam(params.deleted) === "1";
  const errorKey = firstParam(params.error);

  const localeTag = session.user.preferredLanguage;
  const now = nowMs();
  const thisYear = today.slice(0, 4);
  // 올해가 아니면 연도까지 — 「1월 1일까지」가 내년인지 지난해인지 헷갈리지 않게.
  const dayText = (iso: string) =>
    new Intl.DateTimeFormat(localeTag, {
      timeZone: "Asia/Tokyo",
      ...(new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }).slice(0, 4) === thisYear ? {} : { year: "numeric" }),
      month: "long",
      day: "numeric",
    }).format(new Date(iso));
  // 코드 하나의 상태 — 쓸 수 있음 / 꺼 둠 / 다 씀 / 만료. 끝난 코드는 회색 줄로 내린다.
  const rows = inviteCodes.map((invite) => {
    const expired = Boolean(invite.expires_at) && new Date(invite.expires_at as string).getTime() <= now;
    const usedUp = invite.used_count >= invite.max_uses;
    const state = !invite.is_active ? "off" : usedUp ? "used" : expired ? "expired" : "live";
    const until =
      state === "off"
        ? tabs.wInvOff
        : state === "used"
          ? tabs.wInvUsedUp
          : state === "expired"
            ? tabs.wInvExpired.replace("{date}", dayText(invite.expires_at as string))
            : invite.expires_at
              ? tabs.wInvUntil.replace("{date}", dayText(invite.expires_at))
              : "—";
    return { invite, state, until };
  });
  const liveCount = rows.filter((row) => row.state === "live").length;
  // 탭 숫자 — 멤버 목록 탭과 같은 기준(이 조직의 멤버십 수).
  const { count: memberCount } =
    session.organization.id === "platform"
      ? { count: null }
      : await getSupabaseServiceClient()
          .from("memberships")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", session.organization.id);
  const flash = created
    ? settings.success.inviteCreated
    : deactivated
      ? settings.success.inviteDeactivated
      : activated
        ? settings.success.inviteActivated
        : deleted
          ? settings.success.inviteDeleted
          : null;

  return (
    <AdminShell activeItem="users" title={settings.inviteCodesTitle}>
      {/* 화이트 리디자인(2026-10-14, 시안 Invite-PC): 상자 없이 왼쪽 새 코드 폼 · 오른쪽 코드 표. */}
      <div className="usi">
        <UsersSectionTabs
          active="invites"
          labels={{ members: tabs.tabMembers, invites: tabs.tabInvites }}
          counts={{ members: memberCount ?? undefined, invites: liveCount }}
        />
        <div className="usi-grid">
          <section aria-labelledby="usi-new">
            <div className="usi-h">
              <b id="usi-new">{tabs.wInvNew}</b>
              <span>{tabs.wInvNewHint}</span>
            </div>
            {flash || errorKey ? (
              <p className={`usi-msg${errorKey ? " is-bad" : ""}`} role="status">
                {errorKey ? (settings.errors[errorKey] ?? settings.errors.save_failed) : flash}
              </p>
            ) : null}
            <InviteCreateForm
              action={createInviteCode}
              organizations={organizations.map((organization) => ({
                id: organization.id,
                name: organization.name,
                codeSource: organization.slug || organization.name,
              }))}
              roles={selectableDefaultRoles.map((role) => ({
                value: role,
                label: dictionary.roles[role],
              }))}
              today={today}
              defaultExpiresAt={defaultInviteExpiry(today)}
              defaultCode={defaultCode}
              defaultMaxUses={DEFAULT_INVITE_MAX_USES}
              localeTag={localeTag}
              copy={{
                organization: settings.organization,
                role: settings.inviteRole,
                advanced: tabs.wInvAdvanced,
                advancedClose: tabs.wInvAdvancedClose,
                regenerate: settings.inviteRegenerate,
                autoName: settings.inviteAutoName,
                nameLabel: tabs.wInvColName,
                codeLabel: tabs.wInvColCode,
                expiresLabel: settings.expiresAt,
                maxUsesLabel: settings.maxUses,
                submit: tabs.wInvCreate,
                datePlaceholder: tabs.datePlaceholder,
                datePrev: tabs.datePrev,
                dateNext: tabs.dateNext,
                dateToday: tabs.dateToday,
                days: tabs.wInvDays,
                times: tabs.wInvTimes,
              }}
            />
          </section>

          <section aria-labelledby="usi-codes">
            <div className="usi-h" style={{ flexDirection: "row", alignItems: "baseline", gap: 10, padding: "0 12px" }}>
              <b id="usi-codes">{tabs.wInvCodes}</b>
              <span className="num">
                {tabs.wInvSummary.replace("{a}", String(liveCount)).replace("{b}", String(rows.length - liveCount))}
              </span>
            </div>
            <div className="usi-th" aria-hidden="true">
              <span>{tabs.wInvColCode}</span>
              <span>{tabs.wInvColName}</span>
              <span>{tabs.wInvColRole}</span>
              <span>{tabs.wInvColUse}</span>
              <span>{tabs.wInvColUntil}</span>
              <span />
            </div>
            {rows.length === 0 ? <p className="usi-empty">{tabs.wInvEmpty}</p> : null}
            <div className="usi-rows">
              {rows.map(({ invite, state, until }) => (
                <div key={invite.id} className={`usi-tr${state === "live" ? "" : " is-dead"}`}>
                  <span className="usi-code">{invite.code}</span>
                  <span title={organizationNames.size > 1 ? organizationNames.get(invite.organization_id) : undefined}>{invite.name}</span>
                  <span>{dictionary.roles[invite.default_role]}</span>
                  <span className="usi-use">
                    <span className="usi-bar">
                      <i style={{ width: `${Math.min(100, Math.round((invite.used_count / Math.max(invite.max_uses, 1)) * 100))}%` }} />
                    </span>
                    <small className="num">
                      {invite.used_count} / {invite.max_uses}
                    </small>
                  </span>
                  <span className="num">{until}</span>
                  <span className="usi-acts">
                    {state === "live" ? (
                      <InviteCopyButton
                        code={invite.code}
                        labels={{ copy: tabs.wInvCopy, copied: tabs.wInvCopied, failed: tabs.wInvCopyFailed }}
                      />
                    ) : null}
                    {state === "live" || state === "off" ? (
                      <form action={invite.is_active ? deactivateInviteCode : activateInviteCode}>
                        <input name="inviteCodeId" type="hidden" value={invite.id} />
                        <input name="organizationId" type="hidden" value={invite.organization_id} />
                        <button
                          type="submit"
                          className="usi-ib"
                          aria-label={invite.is_active ? tabs.wInvTurnOff : tabs.wInvTurnOn}
                          title={invite.is_active ? tabs.wInvTurnOff : tabs.wInvTurnOn}
                        >
                          {invite.is_active ? <Ban aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                        </button>
                      </form>
                    ) : null}
                    <InviteDeleteButton
                      inviteCodeId={invite.id}
                      organizationId={invite.organization_id}
                      labels={{
                        aria: tabs.wInvDelete,
                        title: tabs.wInvDeleteTitle,
                        summary: `${invite.code} · ${invite.name}`,
                        body: tabs.wInvDeleteBody,
                        keep: tabs.wKeep,
                        confirm: tabs.deleteBtn,
                      }}
                    />
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </AdminShell>
  );
}
