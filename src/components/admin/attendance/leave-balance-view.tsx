"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Edit3, Info, TriangleAlert, X } from "lucide-react";
import { AdminDatePicker } from "@/components/admin/shared/admin-date-picker";
import { AdminExportButtons } from "@/components/admin/shared/admin-export-buttons";
import { adminLocaleTag } from "@/lib/admin-export-meta";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import type { AdminLeaveBalanceRow } from "@/lib/annual-leave-admin-server";
import {
  exportLeaveBalanceReport,
  exportLeaveBalanceWorkbook,
  saveEmployeeLeaveBaselineAction,
} from "@/app/admin/attendance/leave/actions";
import { useAdminPanelA11y } from "../shared/use-admin-panel-a11y";

type Lc = Dictionary["admin"]["leaveConsole"];

function roleLabel(role: string | null, dictionary: Dictionary): string {
  if (!role) return "—";
  const map = dictionary.roles as Record<string, string>;
  return map[role] ?? role;
}

function fmtMd(iso: string): string {
  return iso.slice(5).replace("-", "/");
}
function fmtYmd(iso: string): string {
  return iso.replace(/-/g, "/");
}

/** Grant schedule from hire date: 6/18/30/42/54/66/78 months → 10/11/12/14/16/18/20 days; +4 bonus at 48 months. */
function grantSchedule(hire: string): { dateYm: string; amt: number; kind: "base" | "bonus" }[] {
  const months = [6, 18, 30, 42, 54, 66, 78];
  const amts = [10, 11, 12, 14, 16, 18, 20];
  const [hy, hm, hd] = hire.split("-").map(Number);
  const grantYm = (mo: number) => {
    const dt = new Date(Date.UTC(hy, hm - 1 + mo, hd));
    return `${dt.getUTCFullYear()}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const events: { dateYm: string; amt: number; kind: "base" | "bonus" }[] = months.map((mo, i) => ({
    dateYm: grantYm(mo),
    amt: amts[i],
    kind: "base",
  }));
  events.push({ dateYm: grantYm(48), amt: 4, kind: "bonus" });
  events.sort((a, b) => (a.dateYm < b.dateYm ? -1 : 1));
  return events;
}

export function LeaveBalanceView({
  lc,
  shared,
  locale,
  employees,
  initialSelectedUserId,
  onToast,
}: {
  lc: Lc;
  shared: Dictionary["admin"]["shared"];
  locale: Locale;
  employees: AdminLeaveBalanceRow[];
  initialSelectedUserId?: string | null;
  onToast: (msg: string) => void;
}) {
  const dictionary = getDictionary(locale);
  const [selected, setSelected] = useState<string | null>(initialSelectedUserId ?? null);
  const selectedEmp = selected ? employees.find((e) => e.userId === selected) ?? null : null;

  return (
    <div>
      <div className="toolbar">
        <div style={{ display: "flex", alignItems: "center", fontSize: 12, color: "var(--adm-muted)", fontWeight: 600 }}>
          <span>{lc.balanceRegularCount(String(employees.length))}</span>
          <span className="sep" />
          <span>{lc.balanceHourlyExcludedNote}</span>
        </div>
        <span className="toolbar__spacer" />
        <AdminExportButtons
          onExportXls={() => exportLeaveBalanceWorkbook()}
          onExportPdf={() => exportLeaveBalanceReport()}
          disabled={employees.length === 0}
          onToast={onToast}
          labels={shared}
        />
      </div>

      {employees.length === 0 ? (
        <div className="card">
          <div className="state">
            <span className="state__ic empty">
              <span className="ic">
                <Info />
              </span>
            </span>
            <div className="state__t">{lc.balanceEmptyTitle}</div>
            <div className="state__s">{lc.balanceEmptyBody}</div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="qtbl">
            <thead>
              <tr>
                <th style={{ paddingLeft: 16 }}>{lc.balanceColStaff}</th>
                <th>{lc.balanceColHire}</th>
                <th>{lc.balanceColPaidRemaining}</th>
                <th>{lc.balanceColSpecialRemaining}</th>
                <th style={{ textAlign: "right" }}>{lc.balanceColUsedThisMonth}</th>
                <th>{lc.balanceColExpiring}</th>
                <th>{lc.balanceColNextGrant}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const baseRem = e.grant - e.usedBase;
                const pct = e.grant ? Math.round((baseRem / e.grant) * 100) : 0;
                return (
                  <tr
                    key={e.userId}
                    className={selected === e.userId ? "sel" : ""}
                    onClick={() => setSelected(e.userId)}
                  >
                    <td style={{ paddingLeft: 16 }}>
                      <div className="who">
                        <span className="avatar" style={{ background: e.bg, color: "#fff" }}>
                          {e.initial}
                        </span>
                        <div>
                          <div className="who__nm">{e.name}</div>
                          <div className="who__sub">{roleLabel(e.role, dictionary)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="dim-cell mono">{e.hireDate ?? "—"}</td>
                    <td>
                      {e.ineligible ? (
                        <span className="pill pill--muted">{lc.balanceIneligiblePill}</span>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span className={`pbar${baseRem <= 3 ? " warn" : ""}`} style={{ width: 64 }}>
                            <i style={{ width: `${pct}%` }} />
                          </span>
                          <span className="mono" style={{ fontWeight: 800 }}>
                            {baseRem}
                            <span style={{ color: "var(--faint)", fontWeight: 600 }}> / {e.grant}</span>
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="mono" style={{ fontWeight: 800 }}>
                      {e.bonus ? (
                        <>
                          {e.bonus - e.usedBonus}
                          <span style={{ color: "var(--faint)", fontWeight: 600 }}> / {e.bonus}</span>
                        </>
                      ) : (
                        <span className="dim-cell">—</span>
                      )}
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {lc.daysUnit(e.usedBase + e.usedBonus)}
                    </td>
                    <td>
                      {e.expiringDate && e.expiringAmount ? (
                        <span className="excl-flag">
                          <span className="ic">
                            <TriangleAlert />
                          </span>
                          {fmtMd(e.expiringDate)} {lc.daysUnit(e.expiringAmount)}
                        </span>
                      ) : (
                        <span className="dim-cell">—</span>
                      )}
                    </td>
                    <td className="dim-cell mono">
                      {e.nextGrantDate ? (
                        <>
                          {fmtMd(e.nextGrantDate)}{" "}
                          <span style={{ color: "var(--info)" }}>
                            +{e.nextGrantAmount}
                            {e.ineligible ? lc.balanceFirstGrantTag : ""}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="colchev">
                      <span className="ic">
                        <ChevronRight />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="locknote" style={{ marginTop: 13 }}>
        <span className="ic">
          <Info />
        </span>
        {lc.balanceFootnote}
      </div>

      {selectedEmp ? (
        <EmployeeDrawer
          emp={selectedEmp}
          lc={lc}
          shared={shared}
          closeLabel={dictionary.common.close}
          localeTag={adminLocaleTag(locale)}
          dictionary={dictionary}
          onClose={() => setSelected(null)}
          onToast={onToast}
        />
      ) : null}
    </div>
  );
}

function EmployeeDrawer({
  emp,
  lc,
  shared,
  closeLabel,
  localeTag,
  dictionary,
  onClose,
  onToast,
}: {
  emp: AdminLeaveBalanceRow;
  lc: Lc;
  shared: Dictionary["admin"]["shared"];
  closeLabel: string;
  localeTag: string;
  dictionary: Dictionary;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [hireInput, setHireInput] = useState(emp.hireDate ?? "");
  const [grantInput, setGrantInput] = useState(String(emp.grant));
  const [bonusInput, setBonusInput] = useState(String(emp.bonus));
  const [pending, startTransition] = useTransition();
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: editing });

  const baseRem = emp.grant - emp.usedBase;
  const bonusRem = emp.bonus - emp.usedBonus;
  const schedule = emp.hireDate ? grantSchedule(emp.hireDate) : [];
  const nowYmValue = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" })
    .format(new Date())
    .slice(0, 7)
    .replace("-", "/");

  function saveEdit() {
    startTransition(async () => {
      const res = await saveEmployeeLeaveBaselineAction({
        userId: emp.userId,
        hireDate: hireInput,
        grant: Number(grantInput),
        bonus: Number(bonusInput),
      });
      if (res.ok) {
        setEditing(false);
        onToast(lc.balanceEditSavedToast);
        router.refresh();
      } else {
        onToast(lc.balanceEditErrorToast);
      }
    });
  }

  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside ref={panelRef} className="panel on" role="dialog" aria-label={lc.balancePanelKicker} tabIndex={-1}>
        <div className="panel__h">
          <div className="panel__top">
            <span className="panel__kicker">{lc.balancePanelKicker}</span>
            <button type="button" className="panel__x" onClick={onClose} aria-label={closeLabel}>
              <span className="ic">
                <X />
              </span>
            </button>
          </div>
          <div className="panel__title" style={{ alignItems: "center", gap: 11 }}>
            <span className="avatar" style={{ background: emp.bg, color: "#fff" }}>
              {emp.initial}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-.02em" }}>{emp.name}</div>
              <div className="panel__sub" style={{ fontSize: 12 }}>
                {roleLabel(emp.role, dictionary)} · {lc.balanceHiredPrefix} {emp.hireDate ?? "—"}
              </div>
            </div>
            {!editing ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>
                <span className="ic">
                  <Edit3 />
                </span>
                {lc.balanceEditBtn}
              </button>
            ) : null}
          </div>
        </div>

        <div className="panel__body">
          {editing ? (
            <div className="editbox">
              <div className="editbox__h">
                <span className="ic">
                  <Edit3 />
                </span>
                {lc.balanceEditTitle}
              </div>
              <label className="fld">
                <span className="fld__l">{lc.balanceEditHireLabel}</span>
                <AdminDatePicker
                  value={hireInput}
                  onChange={setHireInput}
                  localeTag={localeTag}
                  ariaLabel={lc.balanceEditHireLabel}
                  labels={{
                    prevMonth: shared.datePrevMonth,
                    nextMonth: shared.dateNextMonth,
                    today: shared.dateToday,
                  }}
                />
              </label>
              <div className="fld2">
                <label className="fld">
                  <span className="fld__l">{lc.balanceEditGrantLabel}</span>
                  <input
                    type="number"
                    min={0}
                    max={40}
                    value={grantInput}
                    onChange={(ev) => setGrantInput(ev.target.value)}
                  />
                </label>
                <label className="fld">
                  <span className="fld__l">{lc.balanceEditBonusLabel}</span>
                  <input
                    type="number"
                    min={0}
                    max={8}
                    value={bonusInput}
                    onChange={(ev) => setBonusInput(ev.target.value)}
                  />
                </label>
              </div>
              <div className="editbox__note">
                <span className="ic">
                  <Info />
                </span>
                {lc.balanceEditNote}
              </div>
              <div className="permbtns" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ flex: 1 }}
                  onClick={() => setEditing(false)}
                  disabled={pending}
                >
                  {lc.dialogCancel}
                </button>
                <button
                  type="button"
                  className="btn btn--pri"
                  style={{ flex: 1 }}
                  onClick={saveEdit}
                  disabled={pending}
                >
                  {lc.balanceEditSaveBtn}
                </button>
              </div>
            </div>
          ) : null}

          <div className="balrow">
            <div className="balrow__cell">
              <div className="balrow__v" style={{ color: "var(--info)" }}>
                {emp.ineligible ? "—" : baseRem}
              </div>
              <div className="balrow__k">{lc.balanceCellPaid}</div>
            </div>
            <div className="minisep" />
            <div className="balrow__cell">
              <div className="balrow__v" style={{ color: "var(--warn)" }}>
                {emp.bonus ? bonusRem : "—"}
              </div>
              <div className="balrow__k">{lc.balanceCellSpecial}</div>
            </div>
            <div className="minisep" />
            <div className="balrow__cell">
              <div className="balrow__v">{emp.usedBase + emp.usedBonus}</div>
              <div className="balrow__k">{lc.balanceCellUsed}</div>
            </div>
          </div>

          {emp.ineligible ? (
            <div className="errbar is-warn" style={{ margin: "14px 0 0" }}>
              <span className="errbar__ic">
                <span className="ic">
                  <TriangleAlert />
                </span>
              </span>
              <div>
                <div className="errbar__t">{lc.balanceIneligibleTitle}</div>
                <div className="errbar__s">
                  {emp.nextGrantDate
                    ? lc.balanceIneligibleBody(fmtYmd(emp.nextGrantDate), String(emp.nextGrantAmount ?? ""))
                    : lc.balanceIneligibleNoHire}
                </div>
              </div>
            </div>
          ) : null}

          <div className="pblock" style={{ marginTop: 16 }}>
            <div className="pblock__t">{lc.balanceSummaryTitle}</div>
            <div className="kv">
              <span className="kv__k">{lc.balanceKvPaid}</span>
              <span className="kv__v mono">
                {baseRem} / {emp.grant}
                {lc.unitDays}
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{lc.balanceKvSpecial}</span>
              <span className="kv__v">
                {emp.bonus ? (
                  <span className="mono">
                    {bonusRem} / {emp.bonus}
                    {lc.unitDays}
                  </span>
                ) : (
                  <span className="dim-cell">{lc.balanceKvSpecialNone}</span>
                )}
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{lc.balanceKvNextGrant}</span>
              <span className="kv__v mono">
                {emp.nextGrantDate ? (
                  <>
                    {fmtYmd(emp.nextGrantDate)} · +{emp.nextGrantAmount}
                    {lc.unitDays}
                  </>
                ) : (
                  "—"
                )}
              </span>
            </div>
            {emp.expiringDate && emp.expiringAmount ? (
              <div className="kv">
                <span className="kv__k">{lc.balanceKvExpiring}</span>
                <span className="kv__v">
                  <span className="excl-flag">
                    <span className="ic">
                      <TriangleAlert />
                    </span>
                    {fmtYmd(emp.expiringDate)} · {lc.daysUnit(emp.expiringAmount)}
                  </span>
                </span>
              </div>
            ) : null}
          </div>

          {schedule.length > 0 ? (
            <div className="pblock">
              <div className="pblock__t">{lc.balanceScheduleTitle}</div>
              <div className="tl">
                {schedule.map((ev, i) => {
                  const past = ev.dateYm <= nowYmValue;
                  return (
                    <div className="tlrow" key={i}>
                      <span className={`tlrow__dot${past ? " done" : ""}`} />
                      <div className="tlrow__b">
                        <div className="tlrow__t">
                          {ev.kind === "bonus" ? lc.balanceScheduleBonusLabel : lc.balanceScheduleBaseLabel}{" "}
                          <b className="mono" style={{ color: ev.kind === "bonus" ? "var(--warn)" : "var(--info)" }}>
                            +{ev.amt}
                            {lc.unitDays}
                          </b>
                        </div>
                        <div className="tlrow__s">
                          {past ? lc.balanceScheduleDone : lc.balanceScheduleUpcoming} · {lc.balanceScheduleExpiryNote}
                        </div>
                      </div>
                      <div className="tlrow__time mono">{ev.dateYm}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="panel__foot">
          <button type="button" className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>
            {lc.balancePanelClose}
          </button>
          {/* Same canonical export pair as the toolbar, scoped to this one employee. */}
          <AdminExportButtons
            onExportXls={() => exportLeaveBalanceWorkbook(emp.userId)}
            onExportPdf={() => exportLeaveBalanceReport(emp.userId)}
            onToast={onToast}
            labels={shared}
          />
        </div>
      </aside>
    </>
  );
}
