"use client";

// Admin console — leave request creation modal (proxy or self). Markup mirrors the design handoff
// (design_handoff_annual_leave → agentForm in leave-views.js) 1:1 using the .adm-scoped handoff
// classes (.modal / .fld / .selwrap / .seg / .segb / .fpill / .fdays / .fpv). Day-count /
// bereavement / half-day rules match the mobile leave-form; the balance preview reads the selected
// applicant's live remaining balance. See docs/product/26-annual-leave-workflow.md.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Info, Sun, TriangleAlert, X } from "lucide-react";
import { createAdminLeaveRequestAction } from "@/app/admin/attendance/leave/actions";
import { loadApplicantLeaveSummary } from "@/app/admin/attendance/leave/detail-actions";
import { AdminDatePicker } from "@/components/admin/shared/admin-date-picker";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { adminLocaleTag } from "@/lib/admin-export-meta";
import { getDictionary } from "@/lib/i18n";
import type {
  LeaveApplicantOption,
  AdminLeaveRequestInput,
  ApplicantLeaveSummary,
} from "@/lib/annual-leave-admin-server";
import type { LeaveType, LeaveDurationUnit } from "@/lib/annual-leave-approvals-server";
import type { Dictionary, Locale } from "@/lib/i18n";
import { tokyoToday } from "@/lib/tokyo-date";

type Lc = Dictionary["admin"]["leaveConsole"];

const TYPES: LeaveType[] = ["paid", "annual", "special", "other"];
const BEREAVEMENT_DAYS = 3;

function typeLabel(type: LeaveType, lc: Lc): string {
  switch (type) {
    case "paid":
      return lc.typePaid;
    case "annual":
      return lc.typeAnnual;
    case "special":
      return lc.typeSpecial;
    default:
      return lc.typeOther;
  }
}

/** Which balance pool a leave type draws from. */
function poolOf(type: LeaveType): "base" | "bonus" | "none" {
  if (type === "paid") return "base";
  if (type === "special") return "bonus";
  return "none";
}

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function diffDaysInclusive(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
}

function calcDays(start: string, end: string, dur: LeaveDurationUnit): number {
  if (!start || !end || start > end) return 0;
  const n = diffDaysInclusive(start, end);
  return (dur === "am" || dur === "pm") && n === 1 ? 0.5 : n;
}

function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? "·";
}

function errLabel(reason: string | undefined, lc: Lc): string {
  switch (reason) {
    case "forbidden":
      return lc.formErrForbidden;
    case "target_not_found":
      return lc.formErrTargetNotFound;
    case "invalid_reason":
      return lc.formErrInvalidReason;
    case "invalid_dates":
      return lc.formErrInvalidDates;
    case "create_failed":
    default:
      return lc.formErrCreateFailed;
  }
}

export function LeaveRequestModal({
  mode,
  prefillDate,
  applicants,
  currentUserId,
  currentUserName,
  locale = "ko",
  lc,
  onClose,
  onCreated,
}: {
  mode: "proxy" | "self";
  /** Pre-filled start/end date (YYYY-MM-DD), e.g. when opened from a team-calendar day cell. */
  prefillDate?: string;
  applicants: LeaveApplicantOption[];
  currentUserId: string;
  currentUserName: string;
  locale?: Locale;
  lc: Lc;
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const router = useRouter();
  const today = tokyoToday();
  const initialDate = prefillDate ?? today;
  const localeTag = adminLocaleTag(locale);
  const dictionary = getDictionary(locale);
  const shared = dictionary.admin.shared;
  const datePickerLabels = {
    prevMonth: shared.datePrevMonth,
    nextMonth: shared.dateNextMonth,
    today: shared.dateToday,
  };

  const [targetUserId, setTargetUserId] = useState(mode === "self" ? currentUserId : "");
  const [leaveType, setLeaveType] = useState<LeaveType>("paid");
  const [durationUnit, setDurationUnit] = useState<LeaveDurationUnit>("full");
  const [startDate, setStartDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const [reason, setReason] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [summary, setSummary] = useState<ApplicantLeaveSummary | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useState(false);

  const isBereavement = leaveType === "annual";
  const half = (durationUnit === "am" || durationUnit === "pm") && !isBereavement;
  const days = useMemo(() => calcDays(startDate, endDate, durationUnit), [startDate, endDate, durationUnit]);

  // Entrance transition (scrim + modal scale-in) — add `.on` after mount.
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Live balance for the selected applicant (self loads its own on mount).
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = targetUserId ? await loadApplicantLeaveSummary(targetUserId) : null;
      if (alive) setSummary(res);
    })();
    return () => {
      alive = false;
    };
  }, [targetUserId]);

  function chooseType(type: LeaveType) {
    setLeaveType(type);
    if (type === "annual") {
      setDurationUnit("full");
      setEndDate(addDaysISO(startDate, BEREAVEMENT_DAYS - 1));
    }
  }

  function chooseStart(next: string) {
    setStartDate(next);
    if (leaveType === "annual") setEndDate(addDaysISO(next, BEREAVEMENT_DAYS - 1));
    else if (durationUnit === "am" || durationUnit === "pm") setEndDate(next);
    else if (next > endDate) setEndDate(next);
  }

  function chooseDuration(unit: LeaveDurationUnit) {
    setDurationUnit(unit);
    if (unit !== "full") setEndDate(startDate);
  }

  const valid = Boolean(targetUserId) && Boolean(startDate) && Boolean(endDate) && startDate <= endDate;

  function submit() {
    setSubmitErr(null);
    if (!valid) return;
    if (reason.trim().length === 0) {
      setSubmitErr(lc.formErrReason);
      return;
    }
    const input: AdminLeaveRequestInput = {
      targetUserId,
      leaveType,
      startDate,
      endDate,
      durationUnit,
      reason,
      emergencyContact,
    };
    startTransition(async () => {
      const res = await createAdminLeaveRequestAction(input);
      if (res.ok) {
        onCreated(lc.formDone);
        onClose();
        router.refresh();
      } else {
        setSubmitErr(errLabel(res.error, lc));
      }
    });
  }

  // Balance preview (mirrors handoff agentForm preview logic).
  const preview = useMemo(() => {
    const pool = poolOf(leaveType);
    if (!summary) {
      return { cls: "fpv--muted", icon: null as React.ReactNode, node: mode === "self" ? lc.previewMutedSelf : lc.previewMuted };
    }
    if (summary.ineligible && pool === "base") {
      return {
        cls: "fpv--warn",
        icon: <TriangleAlert />,
        node: lc.previewIneligible(summary.name, (summary.nextGrantDate ?? "").replace(/-/g, "/")),
      };
    }
    if (pool === "base" || pool === "bonus") {
      const before = pool === "base" ? summary.baseRemaining : summary.bonusRemaining;
      const after = before - days;
      const short = after < 0;
      return {
        cls: short ? "fpv--warn" : "",
        icon: short ? <TriangleAlert /> : <Info />,
        node: (
          <span>
            {pool === "base" ? lc.previewPoolPaid : lc.previewPoolSpecial} <b>{lc.daysUnit(before)}</b> →{" "}
            <b>{lc.daysUnit(after)}</b> (−{lc.daysUnit(days)}){short ? lc.previewShortfall : ""}
          </span>
        ),
      };
    }
    // none pool (annual = company-granted, other = unpaid)
    return {
      cls: "",
      icon: <Info />,
      node:
        leaveType === "annual"
          ? lc.previewNoDeductCompany(typeLabel(leaveType, lc))
          : lc.previewNoDeduct(typeLabel(leaveType, lc)),
    };
  }, [summary, leaveType, days, mode, lc]);

  const kicker = mode === "proxy" ? lc.modalKickerProxy : lc.modalKickerSelf;
  const title = mode === "proxy" ? lc.modalTitleProxy : lc.modalTitleSelf;
  const footNote = mode === "proxy" ? lc.footNoteProxy : lc.footNoteSelf;

  return (
    <>
      <div
        className={`modal-scrim${shown ? " on" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div className={`modal${shown ? " on" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__h">
          <div>
            <div className="modal__kicker">{kicker}</div>
            <div className="modal__t">{title}</div>
          </div>
          <button type="button" className="panel__x" onClick={onClose} aria-label={dictionary.common.close} disabled={pending}>
            <span className="ic">
              <X />
            </span>
          </button>
        </div>

        <div className="modal__body">
          {mode === "proxy" ? (
            <div className="fld">
              <span className="fld__l">
                {lc.formTarget} <b className="req">*</b>
              </span>
              {/* 브라우저 기본 <select> 대신 공용 드롭다운(검색) — 콘솔의 다른 고르기와 같은 모양(2026-10-13 제보). */}
              <AdmDropdown
                options={[{ value: "", label: lc.formTargetSelect }, ...applicants.map((a) => ({ value: a.id, label: a.name }))]}
                value={targetUserId}
                onChange={setTargetUserId}
                ariaLabel={lc.formTarget}
                placeholder={lc.formTargetSelect}
                searchable={applicants.length > 8}
                wide
              />
            </div>
          ) : null}

          {summary ? (
            <div className="fpill">
              <span className="avatar" style={{ background: "var(--adm-primary)", color: "#fff" }}>
                {initialOf(mode === "self" ? currentUserName || summary.name : summary.name)}
              </span>
              <div>
                <div className="fpill__nm">{summary.name || currentUserName}</div>
                <div className="fpill__s">
                  {summary.role ? `${summary.role} · ` : ""}
                  {summary.hireDate ? `${lc.fpillHirePrefix} ${summary.hireDate.replace(/-/g, "/")}` : ""}
                </div>
              </div>
              <div className="fpill__bal">
                <b>{summary.ineligible ? "—" : summary.baseRemaining}</b>
                <span>{lc.fpillBal}</span>
              </div>
            </div>
          ) : null}

          <div className="fld">
            <span className="fld__l">
              {lc.formType} <b className="req">*</b>
            </span>
            <div className="seg seg--wrap">
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`segb${leaveType === t ? " on" : ""}`}
                  onClick={() => chooseType(t)}
                >
                  {typeLabel(t, lc)}
                </button>
              ))}
            </div>
          </div>

          <div className="fld2">
            <label className="fld">
              <span className="fld__l">
                {lc.formStart} <b className="req">*</b>
              </span>
              <AdminDatePicker
                value={startDate}
                onChange={chooseStart}
                localeTag={localeTag}
                ariaLabel={lc.formStart}
                labels={datePickerLabels}
              />
            </label>
            <label className="fld">
              <span className="fld__l">
                {lc.formEnd} <b className="req">*</b>
              </span>
              {/* Bereavement + half-day derive the end date from the start date — read-only, not editable. */}
              <AdminDatePicker
                value={endDate}
                onChange={setEndDate}
                min={startDate}
                disabled={isBereavement || half}
                localeTag={localeTag}
                ariaLabel={lc.formEnd}
                labels={datePickerLabels}
              />
            </label>
          </div>

          <div className="fld">
            <span className="fld__l">{lc.formDuration}</span>
            <div className="seg">
              {(
                [
                  ["full", lc.formDurationFull],
                  ["am", lc.formDurationAm],
                  ["pm", lc.formDurationPm],
                ] as const
              ).map(([unit, label]) => (
                <button
                  key={unit}
                  type="button"
                  className={`segb${durationUnit === unit ? " on" : ""}`}
                  onClick={() => chooseDuration(unit)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="fdays">
            <span className="ic">
              <Sun />
            </span>
            {lc.formDaysLabel} <b>{lc.daysUnit(days)}</b>
            {durationUnit !== "full" && !isBereavement
              ? ` · ${durationUnit === "am" ? lc.formDurationAm : lc.formDurationPm}`
              : ""}
          </div>

          <label className="fld">
            <span className="fld__l">{lc.formReason}</span>
            <textarea
              className="ltext"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={lc.formReasonPh}
            />
          </label>

          <label className="fld">
            <span className="fld__l">{lc.formEmergency}</span>
            <input
              type="text"
              value={emergencyContact}
              onChange={(e) => setEmergencyContact(e.target.value)}
              placeholder={lc.formEmergencyPh}
            />
          </label>

          <div className={`fpv ${preview.cls}`}>
            {preview.icon ? <span className="ic">{preview.icon}</span> : null}
            {preview.node}
          </div>

          {submitErr ? (
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--danger)" }}>{submitErr}</div>
          ) : null}
        </div>

        <div className="modal__foot">
          <span className="modal__foot-note">
            <span className="ic">
              <Info />
            </span>
            {footNote}
          </span>
          <div style={{ display: "flex", gap: 9 }}>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={pending}>
              {lc.formCancel}
            </button>
            <button
              type="button"
              className={`btn btn--pri${valid ? "" : " is-disabled"}`}
              onClick={submit}
              disabled={pending || !valid}
            >
              <span className="ic">
                <Check />
              </span>
              {pending ? lc.formSubmitting : lc.formSubmit}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
