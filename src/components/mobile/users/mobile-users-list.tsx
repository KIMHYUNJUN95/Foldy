"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { organizationRoles } from "@/config/roles";
import { haptic } from "@/lib/haptics";
import { getDictionary, type Locale } from "@/lib/i18n";
import { idDocChip } from "@/lib/staff-documents/chip";
import type { DirectoryMemberVM } from "@/lib/user-management-data";
import { MobileUsersHead } from "./mobile-users-head";
import "./mobile-users.css";

/**
 * 모바일 사용자 관리 — 멤버 목록(2026-10-20, 시안 ① ~ ③ · ⑭).
 * 큰 제목 → 멤버 / 초대코드 탭 → 검색(이름 · 이메일 · 전화) → 「역할 · 소속 · 상태 ⌄」 하나(누르면 거르기 시트) → 활성 · 비활성 묶음.
 * 줄을 누르면 `/mobile/users/{membershipId}` — 태블릿 가로에서는 `SplitList` 가 오른쪽 칸에 연다. docs/product/17-user-profile-directory.md
 */

type Filter = { status: "" | "active" | "inactive"; team: "" | "field" | "office"; role: string };
const NO_FILTER: Filter = { status: "", team: "", role: "" };

const initialOf = (name: string) => name.replace(/\(.*\)/, "").trim().charAt(0) || "?";

function matches(m: DirectoryMemberVM, query: string, f: Filter) {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const hay = [m.name, m.email].join(" ").toLowerCase();
  const byQuery = !q || hay.includes(q) || (digits.length >= 2 && m.phone.replace(/\D/g, "").includes(digits));
  const byStatus = !f.status || (f.status === "active" ? m.status === "active" : m.status !== "active");
  return byQuery && byStatus && (!f.team || m.teamKind === f.team) && (!f.role || m.role === f.role);
}

export function MobileUsersList({
  members,
  inviteCount,
  locale,
}: {
  members: DirectoryMemberVM[];
  inviteCount: number | null;
  locale: Locale;
}) {
  const dict = getDictionary(locale);
  const u = dict.admin.users;
  const c = u.console;
  const roleLabel = (role: string) => (dict.roles as Record<string, string>)[role] ?? role;
  const teamLabel = (kind: string | null) => (kind === "field" ? c.teamFieldOption : kind === "office" ? c.teamOfficeOption : null);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [sheet, setSheet] = useState(false);
  const [docOnly, setDocOnly] = useState(false);
  // idDoc 은 서버가 `staff_documents.view` 가 있을 때만 채운다 — 권한 없는 화면엔 칩도 거르기 칸도 없다.
  const pendingDocs = useMemo(() => members.filter((m) => m.idDoc?.status === "pending").length, [members]);

  const shown = useMemo(
    () => members.filter((m) => matches(m, query, filter) && (!docOnly || m.idDoc?.status === "pending")),
    [members, query, filter, docOnly],
  );
  const active = shown.filter((m) => m.status === "active");
  const inactive = shown.filter((m) => m.status !== "active");
  const filterOn = Boolean(filter.status || filter.team || filter.role);
  const filterText = filterOn
    ? [
        filter.status === "active" ? c.statusActive : filter.status === "inactive" ? c.statusInactive : null,
        filter.team ? teamLabel(filter.team) : null,
        filter.role ? roleLabel(filter.role) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : c.mFilter;

  const row = (m: DirectoryMemberVM) => (
    <Link key={m.membershipId} href={`/mobile/users/${m.membershipId}`} className={`muw-row${m.status === "active" ? "" : " is-dim"}`}>
      <span className="muw-av" aria-hidden="true">
        {initialOf(m.name)}
      </span>
      <span className="muw-rb">
        <span className="muw-rt">
          {m.name || "—"}
          {m.isSelf ? <span className="me">{c.selfChip}</span> : null}
        </span>
        <span className="muw-rm">
          {[m.isDeveloper ? c.devRole : roleLabel(m.role), teamLabel(m.teamKind), m.status === "active" ? null : c.statusInactive]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {(() => {
        const chip = idDocChip(m.idDoc, c);
        return chip ? <span className={`muw-doc is-${chip.kind}`}>{chip.label}</span> : null;
      })()}
      <ChevronRight className="muw-chev" aria-hidden="true" />
    </Link>
  );

  return (
    <div className="muw">
      <MobileUsersHead active="members" locale={locale} memberCount={members.length} inviteCount={inviteCount} />

      <form className="muw-search" role="search" onSubmit={(event) => event.preventDefault()}>
        <Search aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={c.wSearch}
          aria-label={c.wSearch}
          autoComplete="off"
          enterKeyHint="search"
          type="search"
        />
        {query ? (
          <button type="button" className="muw-search__x" aria-label={c.wClear} onClick={() => setQuery("")}>
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </form>
      <div className="muw-bar">
        <button type="button" className={`muw-flt${filterOn ? " is-on" : ""}`} aria-haspopup="dialog" onClick={() => setSheet(true)}>
          {filterText}
          <ChevronDown aria-hidden="true" />
        </button>
        {pendingDocs > 0 || docOnly ? (
          <button
            type="button"
            className="muw-flag"
            aria-pressed={docOnly}
            aria-label={c.idDocFilterAria}
            onClick={() => {
              haptic("light");
              setDocOnly((on) => !on);
            }}
          >
            {c.idDocFilter.replace("{n}", String(pendingDocs))}
          </button>
        ) : null}
        <span className="muw-cnt num" aria-live="polite">
          {c.mCount.replace("{n}", String(shown.length))}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="muw-empty">
          <b>{query || filterOn || docOnly ? c.wEmpty : u.empty}</b>
          {query || filterOn || docOnly ? (
            <>
              <span>{c.mEmptyHint}</span>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setFilter(NO_FILTER);
                  setDocOnly(false);
                }}
              >
                {c.wClear}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <section aria-label={c.statusActive}>
              <h2 className="muw-gh">
                {c.statusActive}
                <b className="num">{active.length}</b>
              </h2>
              <div>{active.map(row)}</div>
            </section>
          ) : null}
          {inactive.length > 0 ? (
            <section aria-label={c.statusInactive}>
              <h2 className="muw-gh">
                {c.statusInactive}
                <b className="num">{inactive.length}</b>
              </h2>
              <div>{inactive.map(row)}</div>
            </section>
          ) : null}
        </>
      )}

      {sheet ? (
        <FilterSheet
          initial={filter}
          count={(f) => members.filter((m) => matches(m, query, f)).length}
          labels={{
            title: c.mFilterTitle,
            all: c.mAll,
            status: u.status,
            team: c.teamField,
            role: u.role,
            active: c.statusActive,
            inactive: c.statusInactive,
            field: c.teamFieldOption,
            office: c.teamOfficeOption,
            reset: c.mFilterReset,
            apply: c.mFilterApply,
          }}
          roleLabel={roleLabel}
          onApply={(f) => setFilter(f)}
          onClose={() => setSheet(false)}
        />
      ) : null}
    </div>
  );
}

function FilterSheet({
  initial,
  count,
  labels,
  roleLabel,
  onApply,
  onClose,
}: {
  initial: Filter;
  count: (f: Filter) => number;
  labels: Record<"title" | "all" | "status" | "team" | "role" | "active" | "inactive" | "field" | "office" | "reset" | "apply", string>;
  roleLabel: (role: string) => string;
  onApply: (f: Filter) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Filter>(initial);
  const chip = (on: boolean, label: string, pick: () => void) => (
    <button
      key={label}
      type="button"
      className="muw-chip"
      aria-pressed={on}
      onClick={() => {
        haptic("light");
        pick();
      }}
    >
      {label}
    </button>
  );
  const n = count(draft);
  return (
    <BottomSheet onClose={onClose} ariaLabel={labels.title}>
      {({ close }) => (
        <div className="muw-sh">
          <b>{labels.title}</b>
          <div className="muw-fg" role="group" aria-label={labels.status}>
            <span>{labels.status}</span>
            <div>
              {chip(draft.status === "", labels.all, () => setDraft({ ...draft, status: "" }))}
              {chip(draft.status === "active", labels.active, () => setDraft({ ...draft, status: "active" }))}
              {chip(draft.status === "inactive", labels.inactive, () => setDraft({ ...draft, status: "inactive" }))}
            </div>
          </div>
          <div className="muw-fg" role="group" aria-label={labels.team}>
            <span>{labels.team}</span>
            <div>
              {chip(draft.team === "", labels.all, () => setDraft({ ...draft, team: "" }))}
              {chip(draft.team === "field", labels.field, () => setDraft({ ...draft, team: "field" }))}
              {chip(draft.team === "office", labels.office, () => setDraft({ ...draft, team: "office" }))}
            </div>
          </div>
          <div className="muw-fg" role="group" aria-label={labels.role}>
            <span>{labels.role}</span>
            <div>
              {chip(draft.role === "", labels.all, () => setDraft({ ...draft, role: "" }))}
              {organizationRoles.map((role) => chip(draft.role === role, roleLabel(role), () => setDraft({ ...draft, role })))}
            </div>
          </div>
          <div className="muw-go">
            <button type="button" className="muw-btn is-soft" onClick={() => setDraft(NO_FILTER)}>
              {labels.reset}
            </button>
            <button
              type="button"
              className="muw-btn is-pri"
              onClick={() => {
                onApply(draft);
                close();
              }}
            >
              {labels.apply.replace("{n}", String(n))}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
