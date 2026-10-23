"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { IdDocumentPanel } from "@/components/identity/id-document-panel";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ChevronRight, CircleAlert, CircleHelp, Lock, Phone, Trash2 } from "lucide-react";
import {
  assignDeveloper,
  deleteMember,
  grantPermissionOverrideAction,
  revokePermissionOverrideAction,
  setMemberRole,
  setMemberStatus,
  setMemberTeam,
} from "@/app/admin/users/actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { DatePickerSheet } from "@/components/shell/date-picker-sheet";
import { capabilityGroupOf, groupPermissionRows } from "@/config/capability-groups";
import { isOrgTopAdmin, officeAdminAssignableRoles, organizationRoles, type Role } from "@/config/roles";
import { haptic } from "@/lib/haptics";
import { formatPhoneDisplay, phoneHref } from "@/lib/phone-format";
import { getDictionary, type Locale } from "@/lib/i18n";
import { tokyoToday } from "@/lib/tokyo-date";
import type { MemberPanelVM } from "@/lib/user-management-data";
import { formatMemberHistory } from "@/components/admin/users/member-history";
import { MobileUsersToast, type UsersToast } from "./mobile-users-toast";
import "./mobile-users.css";

/**
 * 모바일 사용자 관리 — 멤버 상세(2026-10-20, 시안 ④ ~ ⑩). 대시보드 오른쪽 패널(`users-console.tsx` 의 MemberPanel)과 **같은 서버 액션 ·
 * 같은 판정**이고 모양만 모바일이다:
 * - 연락처(전화는 누르면 걸기) → 역할 ›(역할 시트, 고르면 바로 저장 + 「되돌리기」) · 소속 · 상태(비활성은 확인 시트) → 권한 스위치.
 * - 권한 줄의 둘째 줄이 어디서 받았는지(역할 · 개인 부여 · 개인 차단)와 기한을 말한다. 기한을 묻는 권한은 그 줄이 펼쳐져
 *   무기한 · 1주 · 1개월 · 3개월 · 날짜(2026-10-20 무기한 추가).
 * - 바꿀 수 없는 계정(나 · 대표/전무 · 개발자)은 자물쇠 안내와 값만. 삭제는 이름 옆 빨간 휴지통 → 확인 시트.
 * docs/product/17-user-profile-directory.md 「모바일 사용자 관리」
 */

type Dict = ReturnType<typeof getDictionary>;
type Picker = { key: string; effect: "grant" | "deny"; preset: "forever" | "week" | "month" | "month3" | "date"; date: string };

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

export function MobileMemberDetail({
  panel,
  locale,
  actorRole,
  shiftSlot,
}: {
  panel: MemberPanelVM;
  locale: Locale;
  actorRole: string;
  /** 「시프트」 줄(배정 권한이 있을 때만 서버가 그려 넘긴다 — docs/product/37 「4-6」). */
  shiftSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const dict = getDictionary(locale);
  const u = dict.admin.users;
  const c = u.console;
  const m = panel.member;
  const roleLabel = (role: string) => (dict.roles as Record<string, string>)[role] ?? role;
  const [pending, startTransition] = useTransition();
  const [sheet, setSheet] = useState<"role" | "deactivate" | "delete" | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [toast, setToast] = useState<UsersToast | null>(null);
  // 누른 즉시 바뀐 모습을 보여 주고, 서버가 새로 그리면 서버 값으로 돌아간다(데이터가 바뀌면 비운다).
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  // 권한 묶음 펼침(처음엔 전부 접힘 — 2026-10-22 사용자) · 「켜진 것만 보기」.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [onlyOn, setOnlyOn] = useState(false);
  // 물음표로 펼친 권한 설명(한 번에 하나).
  const [helpOpen, setHelpOpen] = useState<string | null>(null);
  const [optRole, setOptRole] = useState<string | null>(null);
  const [optTeam, setOptTeam] = useState<string | null>(null);
  const [optStatus, setOptStatus] = useState<string | null>(null);
  const today = tokyoToday();
  const readOnly = m.isSelf || panel.lock !== null;

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
  const teamName = (t: { kind: string; name: string }) => (t.kind === "field" ? c.teamFieldOption : t.kind === "office" ? c.teamOfficeOption : t.name);

  const show = (next: Omit<UsersToast, "id">) => {
    setToast((prev) => ({ ...next, id: (prev?.id ?? 0) + 1 }));
  };

  const longDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(new Date(iso)) : "—";
  const shortDate = (key: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", month: "long", day: "numeric" }).format(new Date(`${key}T12:00:00+09:00`));

  function run(task: () => Promise<{ ok: boolean; error?: string }>, success: string, rollback?: () => void, undo?: () => void) {
    startTransition(async () => {
      const result = await task();
      if (result.ok) {
        haptic("success");
        show({ kind: undo ? "undo" : "done", text: success, onUndo: undo });
      } else {
        haptic("error");
        rollback?.();
        show({ kind: "bad", text: errorText(result.error, dict) });
      }
    });
  }

  const roleOptions = (actorRole === "developer_super_admin" || isOrgTopAdmin(actorRole as Role) ? organizationRoles : officeAdminAssignableRoles).map(
    (value) => value as string,
  );
  if (!roleOptions.includes(role)) roleOptions.unshift(role);

  function changeRole(next: string) {
    if (next === role) return;
    const before = role;
    setOptRole(next);
    run(
      () => setMemberRole(m.membershipId, next),
      c.mToastRole.replace("{role}", roleLabel(next)),
      () => setOptRole(null),
      () => {
        setOptRole(before);
        run(() => setMemberRole(m.membershipId, before), c.mUndone, () => setOptRole(next));
      },
    );
  }

  function changeStatus(next: "active" | "suspended") {
    const before = status;
    setOptStatus(next);
    run(
      () => setMemberStatus(m.membershipId, next),
      c.wToastStatus,
      () => setOptStatus(null),
      () => {
        setOptStatus(before);
        run(() => setMemberStatus(m.membershipId, before), c.mUndone, () => setOptStatus(next));
      },
    );
  }

  // ── 권한 줄 ── (대시보드 패널과 같은 규칙)
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
          haptic("light");
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
            setPicker((current) => (current?.key === p.key ? null : { key: p.key, effect, preset: "month", date: addDays(today, 30) }));
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
          haptic("light");
          setOptimistic((prev) => ({ ...prev, [id]: !on }));
          run(() => assignDeveloper(m.membershipId, !on), (on ? c.wToastOff : c.wToastOn).replace("{name}", c.devAssignLabel), () =>
            setOptimistic((prev) => ({ ...prev, [id]: on })),
          );
        },
      });
    }
  }
  const onCount = rows.filter((row) => row.on).length;
  const history = formatMemberHistory(panel.history, { dict, locale, teams: panel.teams });

  function submitPicker() {
    if (!picker) return;
    const p = panel.perms.find((perm) => perm.key === picker.key);
    if (!p) return;
    const key = picker.key;
    const expiresAt = picker.preset === "forever" ? null : `${picker.date}T23:59:59+09:00`;
    setOptimistic((prev) => ({ ...prev, [key]: picker.effect === "grant" }));
    setPicker(null);
    run(
      () => grantPermissionOverrideAction({ membershipId: m.membershipId, permissionKey: key, effect: picker.effect, expiresAt, reason: "" }),
      (picker.effect === "grant" ? c.wToastOn : c.wToastOff).replace("{name}", p.label),
      () => setOptimistic((prev) => ({ ...prev, [key]: p.on })),
    );
  }

  const presets: { id: Picker["preset"]; label: string; days: number }[] = [
    { id: "week", label: c.wWeek, days: 7 },
    { id: "month", label: c.wMonth, days: 30 },
    { id: "month3", label: c.wMonth3, days: 90 },
  ];
  const summary = [m.name, m.isDeveloper ? c.devRole : roleLabel(role), m.email].filter(Boolean);

  // 권한 줄 하나(2026-10-22 묶음으로 나눔 — 줄 모양은 그대로).
  const permRows = rows;
  const visiblePermRows = onlyOn ? rows.filter((row) => row.on || picker?.key === row.id) : rows;
  const renderPermRow = (row: (typeof rows)[number]) => {
                const isOpen = picker?.key === row.id;
                const checked = isOpen ? picker.effect === "grant" : row.on;
                const line = (
                  <div className={`muw-pr${row.on ? "" : " is-off"}`}>
                    <span className="muw-rb">
                      <span className="muw-rt">
                        {row.label}
                        {c.permHelp[row.id] ? (
                          <button
                            type="button"
                            className={`muw-help${helpOpen === row.id ? " on" : ""}`}
                            aria-label={c.wPermHelpAria.replace("{name}", row.label)}
                            aria-expanded={helpOpen === row.id}
                            onClick={() => setHelpOpen((cur) => (cur === row.id ? null : row.id))}
                          >
                            <CircleHelp aria-hidden="true" />
                          </button>
                        ) : null}
                      </span>
                      <span className={`muw-rm${row.bad && !isOpen ? " is-bad" : ""}`}>
                        {isOpen ? (picker.effect === "grant" ? c.wAskGrant : c.wAskDeny) : row.src}
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      aria-label={row.label}
                      className="muw-sw"
                      disabled={row.disabled}
                      onClick={row.onToggle}
                    >
                      <i />
                    </button>
                  </div>
                );
                const help = helpOpen === row.id && c.permHelp[row.id] ? <p className="muw-help-t">{c.permHelp[row.id]}</p> : null;
                if (!isOpen)
                  return (
                    <Fragment key={row.id}>
                      {line}
                      {help}
                    </Fragment>
                  );
                return (
                  <div key={row.id} className="muw-pw">
                    {line}
                    {help}
                    <div className="muw-qk" role="group" aria-label={c.wPickDate}>
                      <button
                        type="button"
                        aria-pressed={picker.preset === "forever"}
                        onClick={() => setPicker({ ...picker, preset: "forever" })}
                      >
                        {c.wForever}
                      </button>
                      {presets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          aria-pressed={picker.preset === preset.id}
                          onClick={() => setPicker({ ...picker, preset: preset.id, date: addDays(today, preset.days) })}
                        >
                          {preset.label}
                        </button>
                      ))}
                      <button type="button" aria-pressed={picker.preset === "date"} aria-haspopup="dialog" onClick={() => setDateOpen(true)}>
                        <CalendarDays aria-hidden="true" />
                        {picker.preset === "date" ? shortDate(picker.date) : c.wPickDate}
                      </button>
                    </div>
                    <div className="muw-go">
                      <button type="button" className="muw-btn is-white" onClick={() => setPicker(null)}>
                        {c.cancel}
                      </button>
                      <button type="button" className="muw-btn is-pri" onClick={submitPicker} disabled={pending}>
                        {picker.preset === "forever"
                          ? picker.effect === "grant"
                            ? c.wGrantForever
                            : c.wDenyForever
                          : (picker.effect === "grant" ? c.wGrantUntil : c.wDenyUntil).replace("{date}", shortDate(picker.date))}
                      </button>
                    </div>
                  </div>
                );
};

  return (
    <div className="muw muw-d">
      <div className="muw-dh">
        <span className="muw-av is-lg" aria-hidden="true">
          {initialOf(m.name)}
        </span>
        <div className="muw-dh__t">
          <h1>
            {m.name || "—"}
            {m.isSelf ? <span className="me">{c.selfChip}</span> : null}
          </h1>
          <span>{[m.isDeveloper ? c.devRole : roleLabel(role), team ? teamName(team) : null].filter(Boolean).join(" · ")}</span>
        </div>
        {!readOnly && !panel.lastOwner ? (
          <button type="button" className="muw-ic is-danger" aria-label={c.wDeleteAria} onClick={() => setSheet("delete")}>
            <Trash2 aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="muw-kvs">
        <div className="muw-kv">
          <span>{u.email}</span>
          <b>{m.email || "—"}</b>
        </div>
        <div className="muw-kv">
          <span>{c.wPhoneShort}</span>
          {m.phone ? (
            <a href={phoneHref(m.phone)} className="num" aria-label={`${c.mCall} ${formatPhoneDisplay(m.phone)}`}>
              {formatPhoneDisplay(m.phone)}
              <Phone aria-hidden="true" />
            </a>
          ) : (
            <b>—</b>
          )}
        </div>
        <div className="muw-kv">
          <span>{c.wJoinedShort}</span>
          <b className="num">{longDate(m.joinedAt)}</b>
        </div>
        {/* 국적 + 이름 세 가지(docs/product/41 §2) — 서버가 화면 언어로 만든 줄. */}
        {m.identityRows.map((row) => (
          <div className="muw-kv" key={row.label}>
            <span>{row.label}</span>
            <b>{row.value || "—"}</b>
          </div>
        ))}
        {/* 신분 서류(docs/product/41 R2) — 서버가 staff_documents.view 를 본 뒤에만 실어 보낸다. */}
        {panel.idDocument.canView ? <IdDocumentPanel doc={panel.idDocument.doc} locale={locale} /> : null}
      </div>
      {shiftSlot}

      {readOnly ? (
        <>
          <div className="muw-lock" role="note">
            <Lock aria-hidden="true" />
            <span>{m.isSelf ? c.wSelfNote : panel.lock === "dev" ? c.wLockDevNote : c.wLockTopNote}</span>
          </div>
          <h2 className="muw-sec">{c.mSettingsTitle}</h2>
          <div className="muw-kv">
            <span>{u.role}</span>
            <b>{m.isDeveloper ? c.devRole : roleLabel(m.role)}</b>
          </div>
          <div className="muw-kv">
            <span>{c.teamField}</span>
            <b>{team ? teamName(team) : c.teamUnassigned}</b>
          </div>
          <div className="muw-kv">
            <span>{u.status}</span>
            <b>{m.status === "active" ? c.statusActive : c.statusInactive}</b>
          </div>
        </>
      ) : (
        <>
          <h2 className="muw-sec">{c.mSettingsTitle}</h2>
          <div style={{ marginTop: 4 }}>
            <div className="muw-kv">
              <span>{u.role}</span>
              <button type="button" className="val" disabled={pending || panel.lastOwner} aria-haspopup="dialog" onClick={() => setSheet("role")}>
                {roleLabel(role)}
                {panel.lastOwner ? null : <ChevronRight className="muw-chev" aria-hidden="true" />}
              </button>
            </div>
            {panel.teams.length > 0 ? (
              <div className="muw-kv">
                <span>{c.teamField}</span>
                <div className="muw-seg" role="radiogroup" aria-label={c.teamField}>
                  {panel.teams.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={teamId === t.id}
                      disabled={pending}
                      onClick={() => {
                        if (teamId === t.id) return;
                        haptic("light");
                        const before = optTeam;
                        setOptTeam(t.id);
                        run(() => setMemberTeam(m.membershipId, t.id), c.wToastTeam, () => setOptTeam(before));
                      }}
                    >
                      {teamName(t)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="muw-kv">
              <span>{u.status}</span>
              <div className="muw-seg" role="radiogroup" aria-label={u.status}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={status === "active"}
                  disabled={pending}
                  onClick={() => {
                    if (status === "active") return;
                    haptic("light");
                    changeStatus("active");
                  }}
                >
                  {c.statusActive}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={status !== "active"}
                  disabled={pending || (panel.lastOwner && status === "active")}
                  onClick={() => {
                    if (status !== "active") return;
                    setSheet("deactivate");
                  }}
                >
                  {c.statusInactive}
                </button>
              </div>
            </div>
          </div>
          {panel.lastOwner ? <p className="muw-note">{c.wLastOwnerNote}</p> : null}

          <section aria-label={c.permTitle}>
            <h2 className="muw-sec">
              {c.permTitle}
              {rows.length > 0 ? <span className="num">{c.wPermCount.replace("{n}", String(onCount))}</span> : null}
              {rows.length > 0 ? (
                <button type="button" className={`muw-only${onlyOn ? " on" : ""}`} aria-pressed={onlyOn} onClick={() => setOnlyOn((v) => !v)}>
                  {c.wPermOnlyOn}
                </button>
              ) : null}
            </h2>
            <p className="muw-note">{panel.canManagePermissions ? c.wPermHint : c.wPermOwnerOnly}</p>
                          {groupPermissionRows(visiblePermRows).map((group) => {
                const groupRows = permRows.filter((row) => capabilityGroupOf(row.id) === group.id);
                const groupOn = groupRows.filter((row) => row.on).length;
                const pickerHere = Boolean(picker && group.rows.some((row) => row.id === picker.key));
                const expanded = onlyOn || pickerHere || (openGroups[group.id] ?? false);
                return (
                  <div key={group.id} className={`muw-pg${expanded ? " is-open" : ""}`}>
                    <button
                      type="button"
                      className="muw-pg__h"
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
        </>
      )}

      <section aria-label={c.histTitle}>
        <h2 className="muw-sec">{c.histTitle}</h2>
        {history.length === 0 ? (
          <p className="muw-note">{c.histEmpty}</p>
        ) : (
          <ol className="muw-hist">
            {history.map((line) => (
              <li key={line.id}>
                <span>{line.text}</span>
                <span className="num">{line.meta}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {dateOpen && picker ? (
        <DatePickerSheet
          value={picker.date}
          today={today}
          locale={locale}
          labels={{ title: c.wPickDate, prevMonth: c.datePrev, nextMonth: c.dateNext, today: c.dateToday }}
          onClose={() => setDateOpen(false)}
          onSelect={(date) => {
            // 기한은 내일부터 — 오늘 이전을 고르면 내일로 당긴다(서버도 지난 기한은 거절한다).
            const min = addDays(today, 1);
            setPicker((current) => (current ? { ...current, preset: "date", date: date < min ? min : date } : current));
          }}
        />
      ) : null}

      {sheet === "role" ? (
        <BottomSheet onClose={() => setSheet(null)} ariaLabel={c.mRoleSheetTitle.replace("{name}", m.name)}>
          {({ close }) => (
            <div className="muw-sh">
              <b>{c.mRoleSheetTitle.replace("{name}", m.name || "—")}</b>
              <p>{c.mRoleSheetHint}</p>
              <div className="muw-opts" role="radiogroup" aria-label={u.role}>
                {roleOptions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={value === role}
                    className="muw-opt"
                    onClick={() => {
                      haptic("light");
                      changeRole(value);
                      // 체크가 옮겨 가는 걸 보고 닫히게(160ms).
                      setTimeout(close, 160);
                    }}
                  >
                    {roleLabel(value)}
                    {value === role ? <Check aria-hidden="true" strokeWidth={2.4} /> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {sheet === "deactivate" || sheet === "delete" ? (
        <BottomSheet onClose={() => setSheet(null)} ariaLabel={sheet === "delete" ? c.wDeleteTitle : c.wDeactTitle}>
          {({ close }) => (
            <div className="muw-sh">
              <b>{sheet === "delete" ? c.wDeleteTitle : c.wDeactTitle}</b>
              <p>
                {sheet === "delete"
                  ? panel.otherOrgs
                    ? c.wDeleteBodyShared
                    : c.wDeleteBody
                  : panel.otherOrgsActive
                    ? c.wDeactBodyShared
                    : c.wDeactBody}
              </p>
              <div className="muw-sh__who">
                <span className="muw-av" aria-hidden="true">
                  {initialOf(m.name)}
                </span>
                <span className="muw-rb">
                  <span className="muw-rt">{summary[0] ?? "—"}</span>
                  <span className="muw-rm">{summary.slice(1).join(" · ")}</span>
                </span>
              </div>
              {sheet === "delete" ? (
                <span className="muw-sh__warn">
                  <CircleAlert aria-hidden="true" />
                  {c.wDeleteWarn}
                </span>
              ) : null}
              <button
                type="button"
                className={`muw-btn ${sheet === "delete" ? "is-red" : "is-ink"}`}
                style={{ marginTop: 6 }}
                disabled={pending}
                onClick={() => {
                  if (sheet === "deactivate") {
                    close();
                    changeStatus("suspended");
                    return;
                  }
                  startTransition(async () => {
                    const result = await deleteMember(m.membershipId);
                    if (result.ok) {
                      haptic("success");
                      close();
                      router.replace("/mobile/users");
                    } else {
                      haptic("error");
                      close();
                      show({ kind: "bad", text: errorText(result.error, dict) });
                    }
                  });
                }}
              >
                {sheet === "delete" ? c.deleteBtn : c.wDeactConfirm}
              </button>
              {/* 「그대로 두기」 — 되돌릴 수 없는 일이 한 번에 일어나지 않게 아래에 둔다(HIG: 취소는 스택 맨 아래). */}
              <button type="button" className="muw-btn is-ghost" disabled={pending} onClick={close}>
                {c.wKeep}
              </button>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {toast ? <MobileUsersToast key={toast.id} toast={toast} undoLabel={c.mUndo} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
