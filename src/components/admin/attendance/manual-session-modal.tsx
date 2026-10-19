"use client";

// Admin · Attendance · manual work-session entry.
// Field staff sometimes work off-site or forget to clock in/out, so a payroll admin enters the session by
// hand: staff · date · clock-in · optional clock-out · free-text work location · reason. Wired to the
// service-role `createManualAttendanceSession` (isAttendancePayrollAdmin, blocks a finalized month).
// Location is free text (no registered site required) and flows into per-user payroll exports.

import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarClock, CircleAlert } from "lucide-react";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import { createManualAttendanceSession } from "@/app/admin/attendance/actions";
import { AdminDatePicker } from "../shared/admin-date-picker";
import { AdminTimePicker } from "../shared/admin-time-picker";
import { AdmDropdown } from "../shared/adm-dropdown";

type Att = Dictionary["admin"]["attendanceConsole"];

export function ManualSessionModal({
  staff,
  defaultDate,
  locale,
  localeTag,
  onClose,
  onDone,
}: {
  staff: { userId: string; userName: string }[];
  defaultDate: string; // today (Tokyo)
  locale: Locale;
  localeTag: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const c: Att = getDictionary(locale).admin.attendanceConsole;
  const [pending, start] = useTransition();
  const cardRef = useRef<HTMLDivElement | null>(null);

  const [userId, setUserId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [location, setLocation] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function errText(reason: string): string {
    switch (reason) {
      case "forbidden":
        return c.manualErrForbidden;
      case "reason_required":
        return c.manualErrReason;
      case "target_invalid":
        return c.manualErrTarget;
      case "open_conflict":
        return c.manualErrOpenConflict;
      case "overlap":
        return c.actionOverlap;
      case "finalized_locked":
        return c.manualErrFinalized;
      default:
        return c.manualErrGeneric;
    }
  }

  function submit() {
    setErr(null);
    if (!userId) return setErr(c.manualErrTarget);
    if (!clockIn) return setErr(c.manualErrInvalid);
    if (!location.trim()) return setErr(c.manualErrLocation);
    if (!reason.trim()) return setErr(c.manualErrReason);
    start(async () => {
      const res = await createManualAttendanceSession({
        userId,
        operatingDate: date,
        clockInTime: clockIn,
        clockOutTime: clockOut ? clockOut : null,
        clockInSiteId: null,
        clockOutSiteId: null,
        manualLocation: location.trim(),
        reason: reason.trim(),
      });
      if (!res.ok) {
        setErr(errText(res.reason));
        return;
      }
      onDone(c.manualCreated);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={c.manualTitle}
      className="msmodal__scrim"
      onClick={onClose}
    >
      <div className="admodal msmodal" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <div className="msmodal__head">
          <span className="msmodal__ic">
            <span className="ic">
              <CalendarClock />
            </span>
          </span>
          <div>
            <div className="msmodal__title">{c.manualTitle}</div>
            <div className="msmodal__sub">{c.manualDesc}</div>
          </div>
        </div>

        <div className="msmodal__body">
          <div className="wreason">
            <div className="wfield__l">{c.manualFieldStaff}</div>
            <AdmDropdown
              value={userId}
              onChange={setUserId}
              options={staff.map((s) => ({ value: s.userId, label: s.userName }))}
              placeholder={c.manualStaffPlaceholder}
              ariaLabel={c.manualFieldStaff}
            />
          </div>

          <div className="msmodal__grid">
            <div className="wreason">
              <div className="wfield__l">{c.manualFieldDate}</div>
              <AdminDatePicker
                value={date}
                onChange={setDate}
                localeTag={localeTag}
                ariaLabel={c.manualFieldDate}
                labels={{
                  prevMonth: c.datePickerPrevMonth,
                  nextMonth: c.datePickerNextMonth,
                  today: c.datePickerToday,
                }}
              />
            </div>
            <div className="wreason">
              <div className="wfield__l">{c.manualFieldLocation}</div>
              <input
                type="text"
                value={location}
                placeholder={c.manualLocationPlaceholder}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          <div className="msmodal__grid">
            <div className="wreason">
              <div className="wfield__l">{c.manualFieldClockIn}</div>
              <AdminTimePicker value={clockIn} onChange={setClockIn} ariaLabel={c.manualFieldClockIn} />
            </div>
            <div className="wreason">
              <div className="wfield__l">{c.manualFieldClockOut}</div>
              <AdminTimePicker
                value={clockOut}
                onChange={setClockOut}
                ariaLabel={c.manualFieldClockOut}
              />
            </div>
          </div>

          <div className="wreason">
            <div className="wfield__l">{c.manualFieldReason}</div>
            <input
              type="text"
              value={reason}
              placeholder={c.dialogReasonPlaceholder}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="alw__note">
            <span className="ic">
              <CircleAlert />
            </span>
            <span>{c.manualHint}</span>
          </div>

          {err ? (
            <div className="errbar is-warn" style={{ margin: 0 }}>
              <span className="errbar__ic">
                <span className="ic">
                  <CircleAlert />
                </span>
              </span>
              <div>
                <div className="errbar__t">{err}</div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="msmodal__foot">
          <button type="button" className="btn btn--subtle" onClick={onClose} disabled={pending}>
            {c.dialogCancel}
          </button>
          <button type="button" className="btn btn--pri" onClick={submit} disabled={pending}>
            {c.manualSave}
          </button>
        </div>
      </div>
    </div>
  );
}
