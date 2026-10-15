import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Plus, TriangleAlert } from "lucide-react";
import { createOrganization, updateOrganization } from "@/app/admin/settings/actions";
import { AdminShell } from "@/components/shell/admin-shell";
import { OrgDeleteButton } from "@/components/admin/settings/org-delete-button";
import { SettingsSubnav } from "@/components/admin/settings/settings-subnav";
import "@/components/admin/settings/settings-white.css";
import { getDictionary } from "@/lib/i18n";
import { requireAdminSession } from "@/lib/admin-session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type OrganizationRow = Database["public"]["Tables"]["organizations"]["Row"];
type OrganizationStatus = Database["public"]["Enums"]["organization_status"];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** 만든 날 — 도쿄 기준 YYYY.MM.DD. */
function tokyoDot(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(iso))
    .replaceAll("-", ".");
}

// Admin · 조직 설정 — 마스터·디테일 (2026-07-31 리디자인 → 2026-10-15 화이트 리디자인,
// 시안 SettingsOrg-PC · SettingsOrgNew-PC). 표(조직 · 멤버 · 만든 날) + 오른쪽 패널(이름 저장 · 삭제),
// 「+ 새 조직」(`?org=new`)은 같은 패널 자리에 만들기 폼을 연다. 슬러그는 만든 뒤 바꾸지 않는다.
// 좌측에 조직 목록, 우측에 선택한 조직의 편집/삭제와 신규 생성. 출퇴근 QR 화면과 같은 구조라
// 설정 섹션 안에서 조작 방식이 바뀌지 않는다. 플랫폼 개발자 전용 화면이다.
export default async function AdminOrganizationSettingsPage({ searchParams }: PageProps) {
  const session = await requireAdminSession();
  if (session.user.role !== "developer_super_admin") {
    redirect("/admin/settings?error=forbidden");
  }

  const params = (await searchParams) ?? {};
  const dictionary = getDictionary(session.user.preferredLanguage);
  const settings = dictionary.admin.settings;
  const statusLabels = settings.organizationStatusLabels as Record<OrganizationStatus, string>;

  const service = getSupabaseServiceClient();
  const [{ data }, { data: memberRows }] = await Promise.all([
    service
      .from("organizations")
      .select("id, name, slug, status, created_at, updated_at")
      .order("created_at", { ascending: false }),
    service.from("memberships").select("organization_id"),
  ]);
  const organizations = (data ?? []) as OrganizationRow[];

  const memberCounts = new Map<string, number>();
  for (const row of (memberRows ?? []) as { organization_id: string }[]) {
    memberCounts.set(row.organization_id, (memberCounts.get(row.organization_id) ?? 0) + 1);
  }

  const selectedOrgId = firstParam(params.org) ?? "";
  const creating = selectedOrgId === "new";
  const selected =
    organizations.find((org) => org.id === selectedOrgId) ??
    (selectedOrgId ? null : organizations[0] ?? null);
  const w = settings.white;
  const selectedMembers = selected ? (memberCounts.get(selected.id) ?? 0) : 0;

  const created = firstParam(params.created) === "1";
  const updated = firstParam(params.updated) === "1";
  const deleted = firstParam(params.deleted) === "1";
  const errorKey = firstParam(params.error);
  const flashMessage = created
    ? settings.success.organizationCreated
    : updated
      ? settings.success.organizationUpdated
      : deleted
        ? settings.success.organizationDeleted
        : errorKey
          ? (settings.errors[errorKey] ?? settings.errors.save_failed)
          : "";

  return (
    <AdminShell activeItem="settings" title={settings.organizationTitle}>
      <div className="stw">
        <SettingsSubnav active="organization" settings={settings} showOrganization />

        {flashMessage ? (
          <p className={`stw-flash ${errorKey ? "is-red" : "is-green"}`} role="status">
            {errorKey ? <TriangleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}
            {flashMessage}
          </p>
        ) : null}

        <div className="stw-split">
          {/* ── 목록 ── */}
          <div className="stw-orgs">
            <div className="stw-bar">
              <span className="stw-sum">{w.orgsSummary.replace("{n}", String(organizations.length))}</span>
              <span className="stw-bar__r">
                <Link className="stw-chip is-pri" href="/admin/settings/organization?org=new">
                  <Plus aria-hidden="true" />
                  {w.newOrg}
                </Link>
              </span>
            </div>

            {organizations.length === 0 ? (
              <div className="stw-empty">{settings.emptyOrganizations}</div>
            ) : (
              <>
                <div className="stw-th" aria-hidden="true">
                  <span>{w.colOrg}</span>
                  <span className="r">{w.colMembers}</span>
                  <span className="r">{w.colCreated}</span>
                </div>
                <div className="stw-rows">
                  {organizations.map((org) => (
                    <Link
                      className={`stw-tr${selected?.id === org.id && !creating ? " on" : ""}`}
                      href={`/admin/settings/organization?org=${org.id}`}
                      key={org.id}
                      aria-current={selected?.id === org.id && !creating ? "true" : undefined}
                    >
                      <span className="stw-who">
                        <span className="stw-av" aria-hidden="true">
                          {Array.from(org.name)[0] ?? "·"}
                        </span>
                        <span className="stw-who__t">
                          <b>{org.name}</b>
                          <span>
                            {org.slug}
                            {org.status === "active" ? "" : ` · ${statusLabels[org.status] ?? org.status}`}
                          </span>
                        </span>
                      </span>
                      <span className="r num">{w.membersN.replace("{n}", String(memberCounts.get(org.id) ?? 0))}</span>
                      <span className="r num">{tokyoDot(org.created_at)}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── 패널 ── */}
          {creating ? (
            <aside className="stw-panel" key="new" aria-label={w.createOrgTitle}>
              <div className="stw-hd">
                <div className="stw-meta">
                  <span>{w.newOrg}</span>
                </div>
                <h2>{w.createOrgTitle}</h2>
              </div>
              <form action={createOrganization} className="stw-form is-top">
                <label className="stw-nf">
                  <span>{settings.organizationName}</span>
                  <input name="name" required autoComplete="off" autoFocus />
                </label>
                <div className="stw-f">
                  <label className="stw-nf">
                    <span>{w.slug}</span>
                    <input className="mono" name="slug" autoComplete="off" spellCheck={false} />
                  </label>
                  <span className="stw-hint">{w.slugHint}</span>
                </div>
                <label className="stw-check">
                  <input defaultChecked name="addOwner" type="checkbox" />
                  <span className="stw-check__box" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  </span>
                  {w.ownerMe}
                </label>
                <button className="stw-btn is-pri" type="submit">
                  {w.createOrgTitle}
                </button>
              </form>
            </aside>
          ) : selected ? (
            <aside className="stw-panel" key={selected.id} aria-label={selected.name}>
              <div className="stw-hd">
                <div className="stw-meta">
                  <span>{w.orgSection}</span>
                  {selected.status === "active" ? null : <span>{statusLabels[selected.status] ?? selected.status}</span>}
                </div>
                <h2>{selected.name}</h2>
                <span className="num">{w.createdOn.replace("{date}", tokyoDot(selected.created_at))}</span>
              </div>
              <form
                action={updateOrganization}
                className="stw-form is-top"
                // 조직이 바뀌면 폼을 다시 마운트한다 — 근태 현장 폼과 같은 이유(엉뚱한 조직 덮어쓰기 방지).
                key={selected.id}
                id="stw-org-form"
              >
                <input name="organizationId" type="hidden" value={selected.id} />
                <label className="stw-nf">
                  <span>{settings.organizationName}</span>
                  <input defaultValue={selected.name} name="name" required autoComplete="off" />
                </label>
              </form>
              <dl className="stw-dl">
                <dt>{w.slug}</dt>
                <dd className="mono">{selected.slug}</dd>
                <dt>{w.colMembers}</dt>
                <dd className="num">{w.membersN.replace("{n}", String(selectedMembers))}</dd>
              </dl>
              <div className="stw-f">
                <div className="stw-foot">
                  {selectedMembers === 0 ? (
                    <OrgDeleteButton
                      labels={{
                        delete: w.deleteOrg,
                        title: w.deleteOrgTitle,
                        confirm: settings.orgDeleteConfirm,
                        keep: w.keep,
                        ok: w.deleteOk,
                      }}
                      organizationId={selected.id}
                    />
                  ) : null}
                  <button className="stw-btn is-pri" form="stw-org-form" type="submit">
                    {w.saveChanges}
                  </button>
                </div>
                {selectedMembers === 0 ? null : <span className="stw-hint">{w.orgNotEmptyHint}</span>}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </AdminShell>
  );
}
