"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { IdDocumentPanel } from "@/components/identity/id-document-panel";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, CircleHelp, Printer, Search, Trash2, X } from "lucide-react";
import "./users-white.css";
import { AdmDropdown, type AdmOption } from "../shared/adm-dropdown";
import { AdminDatePicker } from "../shared/admin-date-picker";
import { AdminToast, useAdminToast } from "../shared/admin-toast";
import { useAdminPanelA11y } from "../shared/use-admin-panel-a11y";
import { UsersSectionTabs } from "./users-section-tabs";
import { formatMemberHistory } from "./member-history";
import {
  assignDeveloper,
  deleteMember,
  grantPermissionOverrideAction,
  revokePermissionOverrideAction,
  setMemberRole,
  setMemberStatus,
  setMemberTeam,
} from "@/actions/users";
import { capabilityGroupOf, groupPermissionRows } from "@/config/capability-groups";
import { isOrgTopAdmin, officeAdminAssignableRoles, organizationRoles, type Role } from "@/config/roles";
import { getDictionary, type Locale } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { idDocChip } from "@/lib/staff-documents/chip";
import { MAX_PRINT_PEOPLE } from "@/lib/staff-documents/print";
import { tokyoToday } from "@/lib/tokyo-date";

/**
 * 사용자 콘솔 — 화이트 리디자인(2026-10-14, 시안 Users-PC · UsersGrant-PC · UsersDeact-PC).
 * 목록(이름+이메일 · 역할 · 소속 · 전화 · 상태 · 가입일) + 오른쪽 패널(연락처 · 역할/소속/상태 · 권한 한 목록).
 * 역할 · 소속은 고르는 즉시 저장, 비활성은 확인 창, 기한이 필요한 권한은 그 줄이 펼쳐져 기한을 고른다.
 * 서버 계약은 그대로(`src/actions/users.ts`). docs/product/23-user-management.md
 */

// 화면 데이터 모양은 서버 공용 로더와 같다(모바일 `/mobile/users` 도 같이 쓴다).
export type { DirectoryMemberVM, MemberPanelVM, PermRowVM } from "@/lib/user-management-data";
import type { DirectoryMemberVM, MemberPanelVM } from "@/lib/user-management-data";

type Dict = ReturnType<typeof getDictionary>;

const initialOf = (name: string) => name.replace(/\(.*\)/, "").trim().charAt(0) || "?";

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function errorText(code: string | undefined, dict: Dict): string {
  const c = dict.admin.users.console;
  switch (code) {
    case "forbidden":
      return c.errForbidden;
    case "self_update_blocked":
    case "self_grant_blocked":
      return dict.admin.users.errors.self_update_blocked;
    case "has_activity":
      return c.errHasActivity;
    case "has_id_documents":
      return c.errHasIdDocuments;
    case "protected_member":
      return c.errProtected;
    case "last_owner":
      return c.errLastOwner;
    case "min_one_approver":
      return c.errMinApprover;
    case "hourly_excluded":
      return c.errHourly;
    case "expiry_in_past":
    case "invalid_expiry":
      return c.errExpiry;
    default:
      return c.errSaveFailed;
  }
}

export function UsersConsole({
  members,
  panel,
  selectedId,
  locale,
  actorRole,
  inviteCount,
}: {
  members: DirectoryMemberVM[];
  panel: MemberPanelVM | null;
  selectedId: string | null;
  locale: Locale;
  actorRole: string;
  inviteCount: number | null;
}) {
  const router = useRouter();
  const dict = getDictionary(locale);
  const u = dict.admin.users;
  const c = u.console;
  const roleLabel = (role: string) => (dict.roles as Record<string, string>)[role] ?? role;
  const teamLabel = (kind: string | null) => (kind === "field" ? c.teamFieldOption : kind === "office" ? c.teamOfficeOption : "—");
  const { toast, showToast, dismiss } = useAdminToast();

  const [query, setQuery] = useState("");
  const [fRole, setFRole] = useState("");
  const [fTeam, setFTeam] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fDoc, setFDoc] = useState(false);
  // idDoc 은 서버가 `staff_documents.view` 가 있을 때만 채운다 — 권한 없는 화면엔 칩도 거르기 칸도 없다.
  const pendingDocs = useMemo(() => members.filter((m) => m.idDoc?.status === "pending").length, [members]);
  // 재류카드 A4 인쇄(R3) — 고르기 모드에서 줄을 누르면 고르고(서류 있는 사람만), 「N명 인쇄」가 새 탭으로 인쇄 화면을 연다.
  const printable = useMemo(() => members.some((m) => m.idDoc), [members]);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const togglePick = (userId: string) => {
    haptic("light");
    setPicked((list) =>
      list.includes(userId) ? list.filter((id) => id !== userId) : list.length >= MAX_PRINT_PEOPLE ? list : [...list, userId],
    );
  };
  const stopSelecting = () => {
    setSelecting(false);
    setPicked([]);
  };

  // 검색 · 거르기를 바꾸면 안 보이는 사람은 인쇄에서 뺀다(고른 줄이 화면에 다 보이게, 2026-10-23 점검) — 아래 filtered 다음에 계산.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return members.filter((m) => {
      const hay = [m.name, m.email].join(" ").toLowerCase();
      const matchesQuery = !q || hay.includes(q) || (digits.length >= 2 && m.phone.replace(/\D/g, "").includes(digits));
      const matchesRole = !fRole || m.role === fRole;
      const matchesTeam = !fTeam || m.teamKind === fTeam;
      const matchesStatus = !fStatus || (fStatus === "active" ? m.status === "active" : m.status !== "active");
      const matchesDoc = !fDoc || m.idDoc?.status === "pending";
      return matchesQuery && matchesRole && matchesTeam && matchesStatus && matchesDoc;
    });
  }, [members, query, fRole, fTeam, fStatus, fDoc]);
  const visibleIds = useMemo(() => new Set(filtered.map((m) => m.userId)), [filtered]);
  const pickedVisible = picked.filter((id) => visibleIds.has(id));

  const joined = (value: string | null) => (value ? value.slice(0, 10).replaceAll("-", ".") : "—");
  const open = (id: string) => router.push(`/admin/users?member=${id}`, { scroll: false });
  const close = () => router.push("/admin/users", { scroll: false });
  const filtersOn = Boolean(query || fRole || fTeam || fStatus || fDoc);

  return (
    <div className="usw">
      <div className="usw-bar">
        <UsersSectionTabs
          active="members"
          labels={{ members: c.tabMembers, invites: c.tabInvites }}
          counts={{ members: members.length, invites: inviteCount ?? undefined }}
        />
        <form className="usw-search" role="search" onSubmit={(event) => event.preventDefault()}>
          <Search size={14} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={c.wSearch}
            aria-label={c.wSearch}
            autoComplete="off"
            type="text"
          />
          {query ? (
            <button type="button" className="usw-search__x" aria-label={c.wClear} onClick={() => setQuery("")}>
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </form>
      </div>
      <div className="usw-filters">
        <AdmDropdown
          size="sm"
          ariaLabel={u.role}
          value={fRole}
          onChange={setFRole}
          options={[{ value: "", label: c.filterAllRoles }, ...organizationRoles.map((role) => ({ value: role, label: roleLabel(role) }))]}
        />
        <AdmDropdown
          size="sm"
          ariaLabel={c.teamField}
          value={fTeam}
          onChange={setFTeam}
          options={[
            { value: "", label: c.filterAllTeams },
            { value: "field", label: c.teamFieldOption },
            { value: "office", label: c.teamOfficeOption },
          ]}
        />
        <AdmDropdown
          size="sm"
          ariaLabel={u.status}
          value={fStatus}
          onChange={setFStatus}
          options={[
            { value: "", label: c.filterAllStatuses },
            { value: "active", label: c.statusActive },
            { value: "inactive", label: c.statusInactive },
          ]}
        />
        {pendingDocs > 0 || fDoc ? (
          <button type="button" className="usw-flag" aria-pressed={fDoc} aria-label={c.idDocFilterAria} onClick={() => setFDoc((on) => !on)}>
            {c.idDocFilter.replace("{n}", String(pendingDocs))}
          </button>
        ) : null}
        {printable && !selecting ? (
          <button type="button" className="usw-flag usw-printsel" onClick={() => setSelecting(true)}>
            <Printer size={14} aria-hidden="true" />
            {c.printSelect}
          </button>
        ) : null}
        {selecting ? (
          <div className="usw-printbar" role="group" aria-label={c.printSelect}>
            <span className="usw-printbar__hint">
              {picked.length >= MAX_PRINT_PEOPLE ? c.printMaxHint.replace("{n}", String(MAX_PRINT_PEOPLE)) : c.printSelectHint}
            </span>
            <button
              type="button"
              className="usw-link"
              onClick={() => {
                haptic("light");
                // 앞에서 고른 사람에 더한다(바꾸지 않음) — 상한은 아래 안내로 알린다.
                setPicked((list) =>
                  [...new Set([...list, ...filtered.filter((m) => m.idDoc).map((m) => m.userId)])].slice(0, MAX_PRINT_PEOPLE),
                );
              }}
            >
              {c.printSelectAll}
            </button>
            <button type="button" className="usw-btn" onClick={stopSelecting}>
              {c.printSelectCancel}
            </button>
            {pickedVisible.length > 0 ? (
              <a
                className="usw-btn is-pri"
                href={`/account/id-card/print?u=${pickedVisible.join(",")}`}
                rel="noopener"
                target="_blank"
              >
                <Printer size={14} aria-hidden="true" />
                {c.printSelected.replace("{n}", String(pickedVisible.length))}
              </a>
            ) : (
              <button type="button" className="usw-btn is-pri" disabled>
                <Printer size={14} aria-hidden="true" />
                {c.printSelected.replace("{n}", "0")}
              </button>
            )}
          </div>
        ) : null}
      </div>

      <div className="usw-th" aria-hidden="true">
        <span>{u.name}</span>
        <span>{u.role}</span>
        <span>{c.teamField}</span>
        <span>{c.wPhoneShort}</span>
        <span>{u.status}</span>
        <span className="r">{c.wJoined}</span>
      </div>
      {filtered.length === 0 ? (
        <div className="usw-empty">
          <b>{filtersOn ? c.wEmpty : u.empty}</b>
          {filtersOn ? (
            <button
              type="button"
              className="usw-link"
              onClick={() => {
                setQuery("");
                setFRole("");
                setFTeam("");
                setFStatus("");
                setFDoc(false);
              }}
            >
              {c.wClear}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="usw-rows">
          {filtered.map((m) => {
            const isPicked = selecting && picked.includes(m.userId);
            return (
            <button
              key={m.membershipId}
              type="button"
              className={`usw-tr${!selecting && m.membershipId === selectedId ? " on" : ""}${isPicked ? " is-picked" : ""}`}
              aria-current={!selecting && m.membershipId === selectedId ? "true" : undefined}
              aria-pressed={selecting ? isPicked : undefined}
              disabled={selecting && !m.idDoc}
              onClick={() => (selecting ? togglePick(m.userId) : open(m.membershipId))}
            >
              <span className="usw-who">
                {selecting ? (
                  <span className="usw-pick" aria-hidden="true" title={m.idDoc ? undefined : c.printNoDoc}>
                    {isPicked ? <Check size={13} strokeWidth={3} /> : null}
                  </span>
                ) : null}
                <span className="usw-av" aria-hidden="true">
                  {initialOf(m.name)}
                </span>
                <span className="usw-who__t">
                  <span className="usw-nm">
                    <b>
                      {m.name || "—"}
                      {m.isSelf ? <span className="usw-me">{c.selfChip}</span> : null}
                    </b>
                    {(() => {
                      const chip = idDocChip(m.idDoc, c);
                      return chip ? <span className={`usw-doc is-${chip.kind}`}>{chip.label}</span> : null;
                    })()}
                  </span>
                  <span>{m.email || "—"}</span>
                </span>
              </span>
              <span className="usw-c">{m.isDeveloper ? c.devRole : roleLabel(m.role)}</span>
              <span className="usw-c">{teamLabel(m.teamKind)}</span>
              <span className="usw-c num">{m.phone || "—"}</span>
              <span className={`usw-c${m.status === "active" ? "" : " is-dim"}`}>
                {m.status === "active" ? c.statusActive : c.statusInactive}
              </span>
              <span className="usw-c r num is-soft">{joined(m.joinedAt)}</span>
            </button>
            );
          })}
        </div>
      )}

      {panel ? (
        <MemberPanel
          key={panel.member.membershipId}
          panel={panel}
          dict={dict}
          locale={locale}
          actorRole={actorRole}
          onClose={close}
          onToast={showToast}
        />
      ) : null}
      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}

/** `forever` = 무기한(기한 없이 켬 · 끔, 2026-10-20 사용자 결정). */
type Picker = { key: string; effect: "grant" | "deny"; preset: "forever" | "week" | "month" | "month3" | "date"; date: string };

function MemberPanel({
  panel,
  dict,
  locale,
  actorRole,
  onClose,
  onToast,
}: {
  panel: MemberPanelVM;
  dict: Dict;
  locale: Locale;
  actorRole: string;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const router = useRouter();
  const u = dict.admin.users;
  const c = u.console;
  const m = panel.member;
  const roleLabel = (role: string) => (dict.roles as Record<string, string>)[role] ?? role;
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"deactivate" | "delete" | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  // 누른 즉시 바뀐 모습을 보여 주고, 서버가 새로 그리면 서버 값으로 돌아간다(패널 데이터가 바뀌면 비운다).
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  // 권한 묶음 펼침(처음엔 전부 접힘 — 2026-10-22 사용자) · 「켜진 것만 보기」.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [onlyOn, setOnlyOn] = useState(false);
  // 물음표로 펼친 권한 설명(한 번에 하나).
  const [helpOpen, setHelpOpen] = useState<string | null>(null);
  const [optRole, setOptRole] = useState<string | null>(null);
  const [optTeam, setOptTeam] = useState<string | null>(null);
  const [optStatus, setOptStatus] = useState<string | null>(null);
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: confirm !== null || pending });
  const today = tokyoToday();
  const readOnly = m.isSelf || panel.lock !== null;
  // 개발자 본인 줄 — 역할 · 상태 · 권한 · 삭제는 잠금 방지로 그대로 막지만(서버 self_update_blocked 등),
  // 서버가 허용하는 소속 팀은 바꿀 수 있게 연다(2026-10-23 「개발자는 전부 가능」).
  const selfTeamEditable = m.isSelf && panel.isDeveloperViewer && panel.lock === null;

  const dataKey = JSON.stringify([m.role, m.teamId, m.status, m.isDeveloper, panel.perms]);
  const lastKey = useRef(dataKey);
  useEffect(() => {
    if (lastKey.current === dataKey) return;
    lastKey.current = dataKey;
    setOptimistic({});
    setOptRole(null);
    setOptTeam(null);
    setOptStatus(null);
  }, [dataKey]);

  const role = optRole ?? m.role;
  const teamId = optTeam ?? m.teamId ?? "";
  const status = optStatus ?? (m.status === "active" ? "active" : "suspended");
  const team = panel.teams.find((t) => t.id === teamId);
  const teamText = team ? (team.kind === "field" ? c.teamFieldOption : team.kind === "office" ? c.teamOfficeOption : team.name) : null;

  const longDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(new Date(iso)) : "—";
  const shortDate = (key: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", month: "long", day: "numeric" }).format(new Date(`${key}T12:00:00+09:00`));

  function run(task: () => Promise<{ ok: boolean; error?: string }>, success: string, rollback?: () => void) {
    startTransition(async () => {
      const result = await task();
      if (result.ok) {
        haptic("success");
        onToast(success);
      } else {
        haptic("error");
        rollback?.();
        onToast(errorText(result.error, dict));
      }
    });
  }

  const roleOptions: AdmOption[] = (
    actorRole === "developer_super_admin" || isOrgTopAdmin(actorRole as Role) ? organizationRoles : officeAdminAssignableRoles
  ).map((value) => ({ value, label: roleLabel(value) }));
  if (!roleOptions.some((option) => option.value === role)) roleOptions.unshift({ value: role, label: roleLabel(role) });

  // ── 권한 줄 ──
  type Row = { id: string; label: string; on: boolean; src: string; bad?: boolean; disabled: boolean; onToggle: () => void };
  const rows: Row[] = [];
  const expiryText = (iso: string) => shortDate(new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }));
  const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.parse(`${today}T00:00:00+09:00`)) / 86_400_000) - 1;

  if (!readOnly) {
    for (const p of panel.perms) {
      const on = optimistic[p.key] ?? p.on;
      let src: string = c.wSrcOff;
      let bad = false;
      if (p.source === "role") src = p.canToggle ? c.wSrcRole.replace("{role}", roleLabel(m.role)) : c.wSrcLocked;
      if (p.source === "grant") {
        if (p.expires) {
          const left = daysLeft(p.expires);
          bad = left <= 7;
          src = (bad ? c.wSrcGrantSoon : c.wSrcGrantUntil).replace("{date}", expiryText(p.expires)).replace("{n}", String(Math.max(left, 0)));
        } else src = c.wSrcGrant;
      }
      if (p.source === "deny") {
        bad = true;
        src = p.expires ? c.wSrcDenyUntil.replace("{date}", expiryText(p.expires)) : c.wSrcDeny;
      }
      rows.push({
        id: p.key,
        label: p.label,
        on,
        src,
        bad,
        disabled: !p.canToggle || pending,
        onToggle: () => {
          const toastText = (p.on ? c.wToastOff : c.wToastOn).replace("{name}", p.label);
          if ((p.source === "grant" || p.source === "deny") && p.overrideId) {
            const overrideId = p.overrideId;
            setOptimistic((prev) => ({ ...prev, [p.key]: !p.on }));
            run(() => revokePermissionOverrideAction({ membershipId: m.membershipId, overrideId }), toastText, () =>
              setOptimistic((prev) => ({ ...prev, [p.key]: p.on })),
            );
            return;
          }
          const effect = p.source === "role" ? "deny" : "grant";
          if (p.needsExpiry) {
            setPicker((current) =>
              current?.key === p.key ? null : { key: p.key, effect, preset: "month", date: addDays(today, 30) },
            );
            return;
          }
          setOptimistic((prev) => ({ ...prev, [p.key]: !p.on }));
          run(
            () => grantPermissionOverrideAction({ membershipId: m.membershipId, permissionKey: p.key, effect, expiresAt: null, reason: "" }),
            toastText,
            () => setOptimistic((prev) => ({ ...prev, [p.key]: p.on })),
          );
        },
      });
    }
    if (panel.isDeveloperViewer) {
      const id = "developer";
      const on = optimistic[id] ?? m.isDeveloper;
      rows.push({
        id,
        label: c.devAssignLabel,
        on,
        src: c.wSrcDevOnly,
        disabled: pending,
        onToggle: () => {
          setOptimistic((prev) => ({ ...prev, [id]: !on }));
          run(() => assignDeveloper(m.membershipId, !on), (on ? c.wToastOff : c.wToastOn).replace("{name}", c.devAssignLabel), () =>
            setOptimistic((prev) => ({ ...prev, [id]: on })),
          );
        },
      });
    }
  }
  const teamControl =
    panel.teams.length > 0 ? (
      <>
        <span className="usw-set__k">{c.teamField}</span>
        <div className="usw-seg" role="radiogroup" aria-label={c.teamField}>
          {panel.teams.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={teamId === t.id}
              className={teamId === t.id ? "on" : ""}
              disabled={pending}
              onClick={() => {
                if (teamId === t.id) return;
                const before = optTeam;
                setOptTeam(t.id);
                run(() => setMemberTeam(m.membershipId, t.id), c.wToastTeam, () => setOptTeam(before));
              }}
            >
              {t.kind === "field" ? c.teamFieldOption : t.kind === "office" ? c.teamOfficeOption : t.name}
            </button>
          ))}
        </div>
      </>
    ) : null;
  const onCount = rows.filter((row) => row.on).length;
  const history = formatMemberHistory(panel.history, { dict, locale, teams: panel.teams });

  function submitPicker() {
    if (!picker) return;
    const p = panel.perms.find((perm) => perm.key === picker.key);
    if (!p) return;
    const label = p.label;
    const key = picker.key;
    const expiresAt = picker.preset === "forever" ? null : `${picker.date}T23:59:59+09:00`;
    setOptimistic((prev) => ({ ...prev, [key]: picker.effect === "grant" }));
    setPicker(null);
    run(
      () => grantPermissionOverrideAction({ membershipId: m.membershipId, permissionKey: key, effect: picker.effect, expiresAt, reason: "" }),
      (picker.effect === "grant" ? c.wToastOn : c.wToastOff).replace("{name}", label),
      () => setOptimistic((prev) => ({ ...prev, [key]: p.on })),
    );
  }

  const presets: { id: Picker["preset"]; label: string; days: number }[] = [
    { id: "week", label: c.wWeek, days: 7 },
    { id: "month", label: c.wMonth, days: 30 },
    { id: "month3", label: c.wMonth3, days: 90 },
  ];

  // 권한 줄 하나(2026-10-22 묶음으로 나눔 — 줄 모양은 그대로).
  const permRows = rows;
  const visiblePermRows = onlyOn ? rows.filter((row) => row.on || picker?.key === row.id) : rows;
  const renderPermRow = (row: (typeof rows)[number]) => {
                  const isOpen = picker?.key === row.id;
                  return (
                    <div key={row.id} className={`usw-pr${row.on ? "" : " off"}${isOpen ? " open" : ""}`}>
                      <div className="usw-pr__line">
                        <span className="usw-pr__t">
                          <b>
                            {row.label}
                            {c.permHelp[row.id] ? (
                              <button
                                type="button"
                                className={`usw-help${helpOpen === row.id ? " on" : ""}`}
                                aria-label={c.wPermHelpAria.replace("{name}", row.label)}
                                aria-expanded={helpOpen === row.id}
                                onClick={() => setHelpOpen((cur) => (cur === row.id ? null : row.id))}
                              >
                                <CircleHelp aria-hidden="true" />
                              </button>
                            ) : null}
                          </b>
                          <span className={row.bad ? "is-bad" : ""}>{isOpen ? (picker.effect === "grant" ? c.wAskGrant : c.wAskDeny) : row.src}</span>
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isOpen ? picker.effect === "grant" : row.on}
                          aria-label={row.label}
                          className={`usw-sw${(isOpen ? picker.effect === "grant" : row.on) ? " on" : ""}`}
                          disabled={row.disabled}
                          onClick={row.onToggle}
                        >
                          <i />
                        </button>
                      </div>
                      {helpOpen === row.id && c.permHelp[row.id] ? <p className="usw-help-t">{c.permHelp[row.id]}</p> : null}
                      {isOpen ? (
                        <div className="usw-xp">
                          <div className="usw-xp__q">
                            <button
                              type="button"
                              className={picker.preset === "forever" ? "on" : ""}
                              aria-pressed={picker.preset === "forever"}
                              onClick={() => setPicker({ ...picker, preset: "forever" })}
                            >
                              {c.wForever}
                            </button>
                            {presets.map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                className={picker.preset === preset.id ? "on" : ""}
                                aria-pressed={picker.preset === preset.id}
                                onClick={() => setPicker({ ...picker, preset: preset.id, date: addDays(today, preset.days) })}
                              >
                                {preset.label}
                              </button>
                            ))}
                            <AdminDatePicker
                              value={picker.date}
                              onChange={(value) => setPicker({ ...picker, preset: "date", date: value })}
                              min={addDays(today, 1)}
                              localeTag={locale}
                              ariaLabel={c.wPickDate}
                              display={picker.preset === "date" ? shortDate(picker.date) : c.wPickDate}
                              labels={{ prevMonth: c.datePrev, nextMonth: c.dateNext, today: c.dateToday }}
                            />
                          </div>
                          <div className="usw-xp__go">
                            <button type="button" className="usw-btn is-ghost" onClick={() => setPicker(null)}>
                              {c.cancel}
                            </button>
                            <button type="button" className="usw-btn is-pri" onClick={submitPicker} disabled={pending}>
                              {picker.preset === "forever"
                                ? picker.effect === "grant"
                                  ? c.wGrantForever
                                  : c.wDenyForever
                                : (picker.effect === "grant" ? c.wGrantUntil : c.wDenyUntil).replace("{date}", shortDate(picker.date))}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
};

  return (
    <>
      <div className="panel-scrim on" onClick={pending ? undefined : onClose} />
      <aside ref={panelRef} className="panel on usw-panel" role="dialog" aria-label={m.name || c.breadcrumb} tabIndex={-1}>
        <div className="usw-ph">
          <span className="usw-av is-lg" aria-hidden="true">
            {initialOf(m.name)}
          </span>
          <div className="usw-ph__main">
            <h2>
              {m.name || "—"}
              {m.isSelf ? <span className="usw-me">{c.selfChip}</span> : null}
            </h2>
            <span>{[m.isDeveloper ? c.devRole : roleLabel(role), teamText].filter(Boolean).join(" · ")}</span>
          </div>
          {!readOnly && !panel.lastOwner ? (
            <button type="button" className="usw-ic is-danger" aria-label={c.wDeleteAria} title={c.wDeleteAria} onClick={() => setConfirm("delete")}>
              <Trash2 aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className="usw-ic usw-ph__x" aria-label={c.wClose} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="panel__body usw-pb">
          <dl className="usw-kv">
            <dt>{u.email}</dt>
            <dd>{m.email || "—"}</dd>
            <dt>{c.wPhoneShort}</dt>
            <dd className="num">{m.phone ? <a href={`tel:${m.phone}`}>{m.phone}</a> : "—"}</dd>
            <dt>{c.wJoinedShort}</dt>
            <dd className="num">{longDate(m.joinedAt)}</dd>
            {m.identityRows.map((row) => (
              <Fragment key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value || "—"}</dd>
              </Fragment>
            ))}
          </dl>
          {/* 신분 서류(docs/product/41 R2) — 서버가 staff_documents.view 를 본 뒤에만 실어 보낸다. */}
          {panel.idDocument.canView ? <IdDocumentPanel canReview={panel.idDocument.canReview} doc={panel.idDocument.doc} locale={locale} printHref={panel.idDocument.printHref} /> : null}

          {readOnly ? (
            <>
              <p className="usw-note">{m.isSelf ? c.wSelfNote : panel.lock === "dev" ? c.wLockDevNote : c.wLockTopNote}</p>
              {selfTeamEditable && teamControl ? <div className="usw-set">{teamControl}</div> : null}
            </>
          ) : (
            <div className="usw-set">
              <span className="usw-set__k">{u.role}</span>
              <AdmDropdown
                options={roleOptions}
                value={role}
                ariaLabel={u.role}
                disabled={pending || panel.lastOwner}
                onChange={(value) => {
                  if (value === role) return;
                  const before = optRole;
                  setOptRole(value);
                  run(() => setMemberRole(m.membershipId, value), c.wToastRole, () => setOptRole(before));
                }}
              />
              {teamControl}
              <span className="usw-set__k">{u.status}</span>
              <div className="usw-seg" role="radiogroup" aria-label={u.status}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={status === "active"}
                  className={status === "active" ? "on" : ""}
                  disabled={pending}
                  onClick={() => {
                    if (status === "active") return;
                    setOptStatus("active");
                    run(() => setMemberStatus(m.membershipId, "active"), c.wToastStatus, () => setOptStatus(null));
                  }}
                >
                  {c.statusActive}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={status !== "active"}
                  className={status !== "active" ? "on" : ""}
                  disabled={pending || (panel.lastOwner && status === "active")}
                  onClick={() => {
                    if (status !== "active") return;
                    setConfirm("deactivate");
                  }}
                >
                  {c.statusInactive}
                </button>
              </div>
              {panel.lastOwner ? <p className="usw-note">{c.wLastOwnerNote}</p> : null}
            </div>
          )}

          {!readOnly ? (
            <section className="usw-perm" aria-label={c.permTitle}>
              <div className="usw-perm__h">
                <b>{c.permTitle}</b>
                {rows.length > 0 ? <span>{c.wPermCount.replace("{n}", String(onCount))}</span> : null}
                {rows.length > 0 ? (
                  <button type="button" className={`usw-only${onlyOn ? " on" : ""}`} aria-pressed={onlyOn} onClick={() => setOnlyOn((v) => !v)}>
                    {c.wPermOnlyOn}
                  </button>
                ) : null}
              </div>
              <p className="usw-note">{panel.canManagePermissions ? c.wPermHint : c.wPermOwnerOnly}</p>
                              {groupPermissionRows(visiblePermRows).map((group) => {
                  const groupRows = permRows.filter((row) => capabilityGroupOf(row.id) === group.id);
                  const groupOn = groupRows.filter((row) => row.on).length;
                  const pickerHere = Boolean(picker && group.rows.some((row) => row.id === picker.key));
                  const expanded = onlyOn || pickerHere || (openGroups[group.id] ?? false);
                  return (
                    <div key={group.id} className={`usw-pg${expanded ? " is-open" : ""}`}>
                      <button
                        type="button"
                        className="usw-pg__h"
                        aria-expanded={expanded}
                        disabled={onlyOn || pickerHere}
                        onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !expanded }))}
                      >
                        <ChevronRight aria-hidden="true" />
                        <b>{c.permGroups[group.id]}</b>
                        <span className="num">{c.wPermGroupCount.replace("{on}", String(groupOn)).replace("{total}", String(groupRows.length))}</span>
                      </button>
                      {expanded ? group.rows.map(renderPermRow) : null}
                    </div>
                  );
                })}

            </section>
          ) : null}

          <section className="usw-hist" aria-label={c.histTitle}>
            <b>{c.histTitle}</b>
            {history.length === 0 ? (
              <p className="usw-note">{c.histEmpty}</p>
            ) : (
              <ol>
                {history.map((line) => (
                  <li key={line.id}>
                    <span>{line.text}</span>
                    <span className="num">{line.meta}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>

      {confirm ? (
        <ConfirmModal
          kind={confirm}
          sharedAccount={confirm === "delete" ? panel.otherOrgs : panel.otherOrgsActive}
          summary={[m.name, m.isDeveloper ? c.devRole : roleLabel(role), m.email].filter(Boolean).join(" · ")}
          dict={dict}
          pending={pending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm === "deactivate") {
              setConfirm(null);
              setOptStatus("suspended");
              run(() => setMemberStatus(m.membershipId, "suspended"), c.wToastStatus, () => setOptStatus(null));
              return;
            }
            startTransition(async () => {
              const result = await deleteMember(m.membershipId);
              setConfirm(null);
              if (result.ok) {
                haptic("success");
                onToast(c.wToastDeleted);
                router.push("/admin/users", { scroll: false });
              } else {
                haptic("error");
                onToast(errorText(result.error, dict));
              }
            });
          }}
        />
      ) : null}
    </>
  );
}

function ConfirmModal({
  kind,
  sharedAccount,
  summary,
  dict,
  pending,
  onCancel,
  onConfirm,
}: {
  kind: "deactivate" | "delete";
  /** 다른 조직에서도 쓰는 로그인 계정이라 이 조직 멤버십만 바뀐다. */
  sharedAccount: boolean;
  summary: string;
  dict: Dict;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const c = dict.admin.users.console;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, pending]);
  const title = kind === "delete" ? c.wDeleteTitle : c.wDeactTitle;
  return (
    <>
      <div className="modal-scrim on usw-scrim" onClick={pending ? undefined : onCancel} />
      <div className="modal on usw-modal" role="dialog" aria-modal="true" aria-labelledby="usw-confirm-t">
        <div className="usw-modal__h">
          <h2 id="usw-confirm-t">{title}</h2>
          <span>{summary}</span>
        </div>
        <p className="usw-modal__b">{kind === "delete"
            ? sharedAccount
              ? c.wDeleteBodyShared
              : c.wDeleteBody
            : sharedAccount
              ? c.wDeactBodyShared
              : c.wDeactBody}</p>
        {kind === "delete" ? <p className="usw-modal__b is-warn">{c.wDeleteWarn}</p> : null}
        <div className="usw-modal__f">
          {/* 첫 초점은 「그대로 두기」 — Enter 한 번에 되돌릴 수 없는 일이 일어나지 않게. */}
          <button type="button" className="usw-btn is-gray" disabled={pending} onClick={onCancel} autoFocus>
            {c.wKeep}
          </button>
          <button type="button" className="usw-btn is-danger" disabled={pending} onClick={onConfirm}>
            {kind === "delete" ? c.deleteBtn : c.wDeactConfirm}
          </button>
        </div>
      </div>
    </>
  );
}
