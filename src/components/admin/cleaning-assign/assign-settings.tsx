"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Lock, X } from "lucide-react";
import { saveAssignRules, saveFixedStaff, saveRoomHeadcount, saveStaffProfile, type AssignFail } from "@/app/admin/cleaning-assign/actions";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminTimePicker } from "@/components/admin/shared/admin-time-picker";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { SettingsView } from "@/lib/cleaning-assign/data";
import { DEFAULT_ASSIGN_RULES, type AssignRule, type AssignRuleKey } from "@/lib/cleaning-assign/rules";
import { haptic } from "@/lib/haptics";
import { roleLabel, shortDate, timeValue, tokyoTime } from "./format";
import "./cleaning-assign.css";

/**
 * 청소 배정 설정 — 시안 「⑤ 배정 설정」. 제안 기준을 관리자가 직접 정한다(정해진 항목을 켜고 끄고 순서만 바꾸기 — 자유 규칙은 만들지 않는다).
 * 바꾸면 바로 저장되고 바꾼 기록(누가 · 언제)이 남는다. docs/product/37-cleaning-shift-assignment.md 「4-5」
 */

type Tab = "rules" | "fixed" | "people" | "rooms";

export function AssignSettingsView({
  view,
  copy,
  propertyLabels,
  initialTab,
}: {
  view: SettingsView;
  copy: CleaningAssignCopy;
  propertyLabels: Record<string, string>;
  initialTab: Tab;
}) {
  const router = useRouter();
  const { toast, showToast, dismiss } = useAdminToast();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>(initialTab);
  const label = (name: string) => propertyLabels[name] ?? name;

  function run(task: () => Promise<{ ok: true } | AssignFail>) {
    startTransition(async () => {
      const result = await task();
      if (result.ok) {
        haptic("success");
        showToast(copy.saved);
      } else {
        haptic("error");
        showToast(copy.failed);
      }
      router.refresh();
    });
  }

  const changed = view.settings.updatedAt
    ? fill(copy.lastChanged, { date: tokyoTime(view.settings.updatedAt, true), name: view.settings.updatedByName ?? "—" })
    : "";

  return (
    <div className="cas">
      <div className="cas-bar">
        <Link className="cas-btn is-ghost" href="/admin/cleaning-assign">
          {copy.settingsBack}
        </Link>
        <div className="cas-seg" role="tablist" aria-label={copy.settingsTitle}>
          {(
            [
              ["rules", copy.tabRules],
              ["fixed", copy.tabFixed],
              ["people", copy.tabPeople],
              ["rooms", copy.tabRooms],
            ] as const
          ).map(([key, text]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => setTab(key)} style={{ border: 0, font: "inherit", cursor: "pointer" }}>
              {text}
            </button>
          ))}
        </div>
        <span className="cas-sp" />
        {changed ? <span className="cas-hintline">{changed}</span> : null}
      </div>

      {tab === "rules" ? <RulesTab copy={copy} initial={view.settings.rules} busy={pending} onSave={(rules) => run(() => saveAssignRules({ rules }))} /> : null}
      {tab === "fixed" ? (
        <FixedTab copy={copy} view={view} label={label} busy={pending} onSave={(propertyName, entries) => run(() => saveFixedStaff({ entries, propertyName }))} />
      ) : null}
      {tab === "people" ? <PeopleTab copy={copy} view={view} label={label} busy={pending} run={run} /> : null}
      {tab === "rooms" ? <RoomsTab copy={copy} view={view} label={label} busy={pending} onSave={(roomKey, headcount) => run(() => saveRoomHeadcount({ headcount, roomKey }))} /> : null}
      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}

function ruleText(copy: CleaningAssignCopy, key: AssignRuleKey): { title: string; desc: string } {
  const map = copy as unknown as Record<string, string>;
  return { desc: map[`rule_${key}_desc`] ?? "", title: map[`rule_${key}`] ?? key };
}

function RulesTab({ copy, initial, busy, onSave }: { copy: CleaningAssignCopy; initial: AssignRule[]; busy: boolean; onSave: (rules: AssignRule[]) => void }) {
  const [rules, setRules] = useState<AssignRule[]>(initial);
  const [dragKey, setDragKey] = useState<AssignRuleKey | null>(null);
  const commit = (next: AssignRule[]) => {
    setRules(next);
    onSave(next);
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };
  return (
    <div className="cas-set">
      <section aria-label={copy.rulesTitle} style={{ display: "flex", flexDirection: "column" }}>
        <div className="cas-h">
          <h2>{copy.rulesTitle}</h2>
          <span>{copy.rulesSub}</span>
        </div>
        {rules.map((rule, index) => {
          const text = ruleText(copy, rule.key);
          return (
            <div
              key={rule.key}
              className={`cas-rule${dragKey === rule.key ? " is-drag" : ""}`}
              draggable
              onDragStart={() => setDragKey(rule.key)}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!dragKey || dragKey === rule.key) return;
                const from = rules.findIndex((r) => r.key === dragKey);
                const next = [...rules];
                const [item] = next.splice(from, 1);
                next.splice(index, 0, item);
                setDragKey(null);
                commit(next);
              }}
            >
              <span className="cas-rule__grip" aria-hidden="true">
                ⋮⋮
              </span>
              <span className="cas-rule__n">{index + 1}</span>
              <div className="cas-rule__main">
                <b className={rule.enabled ? "" : "is-off"}>{text.title}</b>
                <span>{text.desc}</span>
              </div>
              <button type="button" className="cas-icon" aria-label={copy.moveUp} disabled={busy || index === 0} onClick={() => move(index, -1)}>
                ↑
              </button>
              <button type="button" className="cas-icon" aria-label={copy.moveDown} disabled={busy || index === rules.length - 1} onClick={() => move(index, 1)}>
                ↓
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={rule.enabled}
                aria-label={text.title}
                className="cas-switch"
                disabled={busy}
                onClick={() => commit(rules.map((r) => (r.key === rule.key ? { ...r, enabled: !r.enabled } : r)))}
              />
            </div>
          );
        })}
        <div style={{ paddingTop: 14 }}>
          <button type="button" className="cas-btn is-gray" disabled={busy} onClick={() => commit(DEFAULT_ASSIGN_RULES.map((r) => ({ ...r })))}>
            {copy.resetRules}
          </button>
        </div>
      </section>
      <section aria-label={copy.alwaysTitle} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="cas-h">
          <h2>{copy.alwaysTitle}</h2>
        </div>
        <span className="cas-hintline" style={{ paddingBottom: 6 }}>
          {copy.alwaysSub}
        </span>
        {[copy.always1, copy.always2, copy.always3, copy.always4].map((text) => (
          <div key={text} className="cas-always">
            <Lock aria-hidden="true" />
            {text}
          </div>
        ))}
      </section>
    </div>
  );
}

function FixedTab({
  copy,
  view,
  label,
  busy,
  onSave,
}: {
  copy: CleaningAssignCopy;
  view: SettingsView;
  label: (name: string) => string;
  busy: boolean;
  onSave: (propertyName: string, entries: Array<{ userId: string; tier: number }>) => void;
}) {
  const [property, setProperty] = useState(view.properties[0] ?? "");
  const [overrides, setOverrides] = useState<Record<string, Array<{ userId: string; tier: number }>>>({});
  const [drag, setDrag] = useState<string | null>(null);
  const [extraTiers, setExtraTiers] = useState(0);
  const people = new Map(view.people.map((p) => [p.userId, p]));
  const entriesOf = (name: string) => overrides[name] ?? view.fixed.filter((row) => row.propertyName === name).map((row) => ({ tier: row.tier, userId: row.userId }));
  const entries = entriesOf(property);
  const maxTier = Math.max(3, ...entries.map((e) => e.tier)) + extraTiers;
  const commit = (next: Array<{ userId: string; tier: number }>) => {
    setOverrides({ ...overrides, [property]: next });
    onSave(property, next);
  };
  return (
    <div className="cas-fixed">
      <nav className="cas-blds" aria-label={copy.building}>
        {view.properties.map((name) => (
          <button
            key={name}
            type="button"
            className={name === property ? "on" : ""}
            onClick={() => {
              setProperty(name);
              setExtraTiers(0);
            }}
          >
            <span>{label(name)}</span>
            <small>{entriesOf(name).length || "—"}</small>
          </button>
        ))}
      </nav>
      <section aria-label={fill(copy.fixedTitle, { building: label(property) })} style={{ display: "flex", flexDirection: "column", maxWidth: 880 }}>
        <div className="cas-h">
          <h2>{fill(copy.fixedTitle, { building: label(property) })}</h2>
        </div>
        <span className="cas-hintline" style={{ paddingBottom: 6 }}>
          {copy.fixedSub}
        </span>
        {Array.from({ length: maxTier }, (_, i) => i + 1).map((tier) => {
          const tierText = fill(copy.tierLabel, { n: tier });
          const members = entries.filter((e) => e.tier === tier);
          return (
            <div
              key={tier}
              className={`cas-tier${drag ? " is-over" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!drag) return;
                commit([...entries.filter((e) => e.userId !== drag), { tier, userId: drag }]);
                setDrag(null);
              }}
            >
              <b>{tierText}</b>
              <div className="cas-tier__list">
                {members.map((entry) => {
                  const person = people.get(entry.userId);
                  return (
                    <div key={entry.userId} className="cas-tierp" draggable onDragStart={() => setDrag(entry.userId)} onDragEnd={() => setDrag(null)}>
                      <span className="cas-rule__grip" aria-hidden="true">
                        ⋮⋮
                      </span>
                      <b>{person?.name ?? "—"}</b>
                      <span>{person ? fill(copy.fixedMonth, { date: person.lastWorked ? shortDate(person.lastWorked) : "—", n: person.monthDays }) : ""}</span>
                      <AdmDropdown
                        size="sm"
                        value={String(tier)}
                        ariaLabel={tierText}
                        disabled={busy}
                        onChange={(value) => commit(entries.map((e) => (e.userId === entry.userId ? { ...e, tier: Number(value) } : e)))}
                        options={Array.from({ length: maxTier }, (_, j) => ({ label: fill(copy.tierLabel, { n: j + 1 }), value: String(j + 1) }))}
                      />
                      <button type="button" className="cas-icon" aria-label={fill(copy.removePerson, { name: person?.name ?? "" })} disabled={busy} onClick={() => commit(entries.filter((e) => e.userId !== entry.userId))}>
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
                <div style={{ maxWidth: 280 }}>
                  <AdmDropdown
                    size="sm"
                    value=""
                    searchable
                    placeholder={fill(copy.addToTier, { tier: tierText })}
                    ariaLabel={fill(copy.addToTier, { tier: tierText })}
                    disabled={busy}
                    onChange={(value) => value && commit([...entries.filter((e) => e.userId !== value), { tier, userId: value }])}
                    options={view.people.filter((p) => !entries.some((e) => e.userId === p.userId)).map((p) => ({ label: `${p.name} · ${roleLabel(p.role, copy)}`, value: p.userId }))}
                  />
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ paddingTop: 12 }}>
          <button type="button" className="cas-btn is-gray" disabled={maxTier >= 9} onClick={() => setExtraTiers(extraTiers + 1)}>
            {copy.addTier}
          </button>
        </div>
      </section>
    </div>
  );
}

function PeopleTab({
  copy,
  view,
  label,
  busy,
  run,
}: {
  copy: CleaningAssignCopy;
  view: SettingsView;
  label: (name: string) => string;
  busy: boolean;
  run: (task: () => Promise<{ ok: true } | AssignFail>) => void;
}) {
  const [query, setQuery] = useState("");
  const [memos, setMemos] = useState<Record<string, string>>({});
  const fixedBy = new Map<string, string[]>();
  for (const row of view.fixed) fixedBy.set(row.userId, [...(fixedBy.get(row.userId) ?? []), `${label(row.propertyName)} ${fill(copy.tierLabel, { n: row.tier })}`]);
  const list = view.people.filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (key: "priority" | "trainee" | "trainer", userId: string, value: boolean) => run(() => saveStaffProfile({ patch: { [key]: value }, userId }));
  return (
    <section aria-label={copy.tabPeople} style={{ display: "flex", flexDirection: "column" }}>
      <div className="cas-h">
        <h2>{fill(copy.peopleTitle, { n: view.people.length })}</h2>
        <span className="cas-sp" />
        <label className="cas-search" style={{ maxWidth: 220 }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchName} aria-label={copy.searchName} />
        </label>
      </div>
      <div className="cas-table" role="table" aria-label={copy.tabPeople}>
        <div className="cas-trow is-head" role="row">
          <span>{copy.colName}</span>
          <span>{copy.colRole}</span>
          <span>{copy.colStart}</span>
          <span>{copy.colPriority}</span>
          <span>{copy.colTrainee}</span>
          <span>{copy.colTrainer}</span>
          <span>{copy.colFixed}</span>
          <span>{copy.colMemo}</span>
        </div>
        {list.map((p) => (
          <div key={p.userId} className="cas-trow" role="row">
            <b>{p.name}</b>
            <span className="cas-dim">{roleLabel(p.role, copy)}</span>
            <AdminTimePicker value={timeValue(p.defaultStartMinutes)} ariaLabel={`${p.name} ${copy.colStart}`} onChange={(value) => run(() => saveStaffProfile({ patch: { defaultStartTime: value }, userId: p.userId }))} />
            <button type="button" role="switch" aria-checked={p.profile.priority} aria-label={`${p.name} ${copy.colPriority}`} className="cas-switch" disabled={busy} onClick={() => toggle("priority", p.userId, !p.profile.priority)} />
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button type="button" role="switch" aria-checked={p.profile.trainee} aria-label={`${p.name} ${copy.colTrainee}`} className="cas-switch" disabled={busy} onClick={() => toggle("trainee", p.userId, !p.profile.trainee)} />
              {p.profile.trainee ? <span className="cas-dim">{fill(copy.traineeNth, { n: p.traineeCount })}</span> : null}
            </span>
            <button type="button" role="switch" aria-checked={p.profile.trainer || p.role === "field_manager"} aria-label={`${p.name} ${copy.colTrainer}`} className="cas-switch" disabled={busy || p.role === "field_manager"} onClick={() => toggle("trainer", p.userId, !p.profile.trainer)} />
            <span className="cas-dim">{(fixedBy.get(p.userId) ?? []).join(" · ") || "—"}</span>
            <input
              className="cas-memo"
              value={memos[p.userId] ?? p.profile.memo ?? ""}
              placeholder={copy.memoPlaceholder}
              maxLength={200}
              aria-label={`${p.name} ${copy.colMemo}`}
              onChange={(event) => setMemos({ ...memos, [p.userId]: event.target.value })}
              onBlur={() => {
                const next = memos[p.userId];
                if (next === undefined || next === (p.profile.memo ?? "")) return;
                run(() => saveStaffProfile({ patch: { memo: next }, userId: p.userId }));
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function RoomsTab({
  copy,
  view,
  label,
  busy,
  onSave,
}: {
  copy: CleaningAssignCopy;
  view: SettingsView;
  label: (name: string) => string;
  busy: boolean;
  onSave: (roomKey: string, headcount: number) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const set = (roomKey: string, value: number) => {
    const next = Math.min(5, Math.max(1, value));
    setCounts({ ...counts, [roomKey]: next });
    onSave(roomKey, next);
  };
  const byBuilding = new Map<string, SettingsView["rooms"]>();
  for (const room of view.rooms) byBuilding.set(room.propertyName, [...(byBuilding.get(room.propertyName) ?? []), room]);
  return (
    <section aria-label={copy.roomsTitle} style={{ display: "flex", flexDirection: "column" }}>
      <div className="cas-h">
        <h2>{copy.roomsTitle}</h2>
      </div>
      <span className="cas-hintline" style={{ paddingBottom: 6 }}>
        {copy.roomsSub}
      </span>
      {[...byBuilding.entries()].map(([name, rooms]) => (
        <div key={name} className="cas-bld">
          <div className="cas-h">
            <h2>{label(name)}</h2>
          </div>
          <div className="cas-rooms-set">
            {rooms.map((room) => {
              const value = counts[room.roomKey] ?? room.headcount;
              return (
                <div key={room.roomKey} className="cas-roomset">
                  <b>{room.roomLabel === room.propertyName ? label(name) : room.roomLabel}</b>
                  <span className="cas-step">
                    <button type="button" aria-label="−" disabled={busy || value <= 1} onClick={() => set(room.roomKey, value - 1)}>
                      −
                    </button>
                    <span className={value > 1 ? "is-big" : ""}>{fill(copy.headcount, { n: value })}</span>
                    <button type="button" aria-label="+" disabled={busy || value >= 5} onClick={() => set(room.roomKey, value + 1)}>
                      +
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
