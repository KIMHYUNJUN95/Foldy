"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Phone, Search, Users, X } from "lucide-react";
import "./directory.css";
import { useIsTablet } from "@/components/shell/split-list";
import { haptic } from "@/lib/haptics";
import { formatPhoneDisplay, phoneHref } from "@/lib/phone-format";

/**
 * 직원 목록 — 화이트 리디자인(2026-10-14, 시안 Dir-Phone · Dir-Fold · Dir-Tablet).
 * 역할 묶음(관리 · 사무실 / 현장 / 아르바이트 · 아르바이트 리더) + 묶음마다 인원수. 전화번호가 없는 사람과 나에게는 전화 버튼을 그리지 않는다
 * (회색으로 막힌 버튼은 고장으로 읽힌다). 폴드는 한 줄에 번호까지, 태블릿 가로는 목록 + 오른쪽 프로필 칸
 * (상세 주소가 없는 화면이라 `useIsTablet()` 으로 칸을 직접 그린다 — CLAUDE.md §3). docs/product/16-mobile-navigation.md
 */

export type DirectoryPerson = {
  membershipId: string;
  name: string;
  role: string;
  roleLabel: string;
  phone: string;
  joinedAt: string | null;
  isSelf: boolean;
};

export type DirectoryCopy = {
  title: string;
  searchPlaceholder: string;
  empty: string;
  call: string;
  noPhoneLong: string;
  groupLead: string;
  groupField: string;
  groupPart: string;
  groupOther: string;
  me: string;
  copyNumber: string;
  copied: string;
  copyFailed: string;
  labelPhone: string;
  labelRole: string;
  labelJoined: string;
  pickHint: string;
  clear: string;
  countUnit: string;
};

const GROUPS: { id: "lead" | "field" | "part" | "other"; roles: string[] }[] = [
  { id: "lead", roles: ["developer_super_admin", "owner", "senior_managing_director", "office_admin", "cs_staff"] },
  { id: "field", roles: ["field_manager"] },
  { id: "part", roles: ["staff", "part_time_staff"] },
];

export function DirectoryView({ people, orgName, locale, copy }: { people: DirectoryPerson[]; orgName: string; locale: string; copy: DirectoryCopy }) {
  const isTablet = useIsTablet();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const groupLabel = { lead: copy.groupLead, field: copy.groupField, part: copy.groupPart, other: copy.groupOther };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const match = (p: DirectoryPerson) =>
      !q || `${p.name} ${p.roleLabel}`.toLowerCase().includes(q) || (digits.length >= 2 && p.phone.replace(/\D/g, "").includes(digits));
    const known = new Set(GROUPS.flatMap((group) => group.roles));
    const all = [...GROUPS, { id: "other" as const, roles: [] as string[] }];
    return all
      .map((group) => ({
        id: group.id,
        people: people.filter((p) => (group.id === "other" ? !known.has(p.role) : group.roles.includes(p.role))).filter(match),
      }))
      .filter((group) => group.people.length > 0);
  }, [people, query]);

  const selected = isTablet ? people.find((p) => p.membershipId === selectedId) ?? null : null;
  const total = people.length;

  return (
    <div className={`drw${isTablet ? " is-tablet" : ""}`}>
      <div className="drw-list">
        <div className="drw-h">
          <h1>{copy.title}</h1>
          <span className="num">
            {orgName} · {copy.countUnit.replace("{n}", String(total))}
          </span>
        </div>
        <label className="drw-search">
          <Search aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} aria-label={copy.searchPlaceholder} autoComplete="off" spellCheck={false} />
          {query ? (
            <button type="button" aria-label={copy.clear} onClick={() => setQuery("")}>
              <X aria-hidden="true" />
            </button>
          ) : null}
        </label>

        {groups.length === 0 ? (
          <div className="drw-empty">
            <Users aria-hidden="true" />
            <span>{copy.empty}</span>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.id} className="drw-g" aria-label={groupLabel[group.id]}>
              <h2 className="drw-gl">
                {groupLabel[group.id]}
                <b className="num">{group.people.length}</b>
              </h2>
              {group.people.map((p) => {
                const on = selected?.membershipId === p.membershipId;
                const body = (
                  <>
                    <span className="drw-av" aria-hidden="true">
                      {p.name.slice(0, 1)}
                    </span>
                    <span className="drw-t">
                      <b>
                        {p.name}
                        {p.isSelf ? <span className="drw-me">{copy.me}</span> : null}
                      </b>
                      <span className="num">
                        <span className="drw-role">{p.roleLabel}</span>
                        <span className="drw-subph">{` · ${formatPhoneDisplay(p.phone) || copy.noPhoneLong}`}</span>
                      </span>
                    </span>
                    <span className={`drw-ph num${p.phone ? "" : " is-none"}`}>{formatPhoneDisplay(p.phone) || copy.noPhoneLong}</span>
                  </>
                );
                return (
                  <div key={p.membershipId} className={`drw-r${on ? " on" : ""}`}>
                    {isTablet ? (
                      <button type="button" className="drw-r__main" aria-pressed={on} onClick={() => setSelectedId(p.membershipId)}>
                        {body}
                      </button>
                    ) : (
                      <div className="drw-r__main">{body}</div>
                    )}
                    {p.phone && !p.isSelf ? (
                      <a
                        href={phoneHref(p.phone)}
                        // 누름 반응은 공용 규칙(globals.css 「누름 반응」) — 화면에서 따로 그리지 않는다(2026-10-26).
                        className="drw-call"
                        aria-label={`${copy.call} ${p.name}`}
                        onClick={() => haptic("light")}
                      >
                        <Phone aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="drw-call-gap" aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>

      {isTablet ? (
        <div className="drw-pane">
          {selected ? <Profile key={selected.membershipId} person={selected} copy={copy} locale={locale} /> : <p className="drw-hint">{copy.pickHint}</p>}
        </div>
      ) : null}
    </div>
  );
}

function Profile({ person, copy, locale }: { person: DirectoryPerson; copy: DirectoryCopy; locale: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const joined = person.joinedAt
    ? new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(new Date(person.joinedAt))
    : "—";

  async function copyNumber() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(person.phone);
      ok = true;
    } catch {
      ok = false;
    }
    haptic(ok ? "success" : "error");
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 1600);
  }

  return (
    <div className="drw-prof">
      <div className="drw-prof__h">
        <span className="drw-av is-lg" aria-hidden="true">
          {person.name.slice(0, 1)}
        </span>
        <div>
          <h2>
            {person.name}
            {person.isSelf ? <span className="drw-me">{copy.me}</span> : null}
          </h2>
          <span>{person.roleLabel}</span>
        </div>
      </div>
      {person.phone && !person.isSelf ? (
        <div className="drw-prof__btns">
          <a href={phoneHref(person.phone)} className="drw-btn is-pri" onClick={() => haptic("light")}>
            <Phone aria-hidden="true" />
            {copy.call}
          </a>
          <button type="button" className={`drw-btn${copyState === "copied" ? " is-done" : copyState === "failed" ? " is-bad" : ""}`} onClick={copyNumber} aria-live="polite">
            {copyState === "copied" ? <Check aria-hidden="true" strokeWidth={2.4} /> : <Copy aria-hidden="true" />}
            {copyState === "copied" ? copy.copied : copyState === "failed" ? copy.copyFailed : copy.copyNumber}
          </button>
        </div>
      ) : null}
      <dl className="drw-dl">
        <dt>{copy.labelPhone}</dt>
        <dd className="num">{formatPhoneDisplay(person.phone) || copy.noPhoneLong}</dd>
        <dt>{copy.labelRole}</dt>
        <dd>{person.roleLabel}</dd>
        <dt>{copy.labelJoined}</dt>
        <dd className="num">{joined}</dd>
      </dl>
    </div>
  );
}
