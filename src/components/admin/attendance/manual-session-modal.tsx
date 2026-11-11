"use client";

// Admin · 근태 · 수동 근무 세션 입력.
// 현장 직원이 현장 밖에서 일하거나 출근/퇴근을 깜빡하는 일이 있어, 급여 관리자가 세션을
// 직접 입력한다: 직원 · 날짜 · 출근 · 선택 퇴근 · 자유 입력 근무 장소 · 사유. service-role
// `createManualAttendanceSession` 에 연결(attendanceCan, 마감된 달은 막음).
// 장소는 자유 텍스트(등록된 사이트 불필요)이며 사용자별 급여 내보내기에 반영된다.

import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarClock, CircleAlert } from "lucide-react";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import { createManualAttendanceSession } from "@/app/admin/attendance/actions";
import { AdminDatePicker } from "../shared/admin-date-picker";
import { AdminTimePicker } from "../shared/admin-time-picker";
import { AdmDropdown } from "../shared/adm-dropdown";
import { isManualDraftDirty, pickerPopoverOpen } from "@/components/admin/attendance/manual-session-draft";

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
  defaultDate: string; // 오늘 (도쿄)
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
  // 친 내용이 있으면 Esc · 바깥 누르기로 바로 닫지 않고 한 번 묻는다(2026-11-11). 「취소」 단추는 분명한 뜻이라 묻지 않는다.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = isManualDraftDirty({ userId, date, clockIn, clockOut, location, reason }, defaultDate);
  const requestClose = () => {
    if (pending) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // 날짜 · 시각 고르기 창이 열려 있으면 Esc 는 그 창만 닫는다(공용 피커는 preventDefault 를 하지 않음).
      if (pickerPopoverOpen(cardRef.current)) return;
      requestCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
      case "future_date":
        return c.manualErrFutureDate;
      case "too_long":
        return c.manualErrTooLong;
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
      // 그 날짜의 세션 없는 정정 요청을 서버가 같이 닫았으면 알려 준다.
      const closed = res.correctionsClosed;
      const parts = [c.manualCreated];
      if (closed?.approved) parts.push(c.corrClosedApproved.replace("{n}", String(closed.approved)));
      if (closed?.rejected) parts.push(c.corrClosedRejected.replace("{n}", String(closed.rejected)));
      onDone(parts.join(" "));
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={c.manualTitle}
      className="msmodal__scrim"
      onClick={requestClose}
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
                // 오늘(도쿄)까지만 — 아직 일하지 않은 날은 서버도 거절한다(2026-11-11).
                max={defaultDate}
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

        {confirmDiscard ? (
          <div className="msmodal__foot" role="alertdialog" aria-label={c.manualDiscardBody} style={{ flexWrap: "wrap" }}>
            {/* ja · en 문구가 길면 문구가 한 줄을 차지하고 단추는 아래로 — 자르지 않는다. */}
            <span style={{ flex: "1 1 180px", fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{c.manualDiscardBody}</span>
            <button type="button" className="btn btn--subtle" onClick={() => setConfirmDiscard(false)} autoFocus>
              {c.manualDiscardKeep}
            </button>
            <button type="button" className="btn btn--danger-ghost" onClick={onClose}>
              {c.manualDiscardOk}
            </button>
          </div>
        ) : (
          <div className="msmodal__foot">
            <button type="button" className="btn btn--subtle" onClick={onClose} disabled={pending}>
              {c.dialogCancel}
            </button>
            <button type="button" className="btn btn--pri" onClick={submit} disabled={pending}>
              {c.manualSave}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
