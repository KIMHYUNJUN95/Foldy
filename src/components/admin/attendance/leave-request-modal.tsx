"use client";

// 관리자 콘솔 — 휴가 신청 생성 모달 (대리 또는 본인). 마크업은 디자인 핸드오프를 그대로 따르며
// (design_handoff_annual_leave → leave-views.js 의 agentForm) 1:1, .adm 범위의 핸드오프
// 클래스(.modal / .fld / .selwrap / .seg / .segb / .fpill / .fdays / .fpv)를 쓴다. 일수 /
// 경조사 / 반차 규칙은 모바일 휴가 폼과 같고, 잔여 미리보기는 선택된
// 신청자의 실시간 잔여를 읽는다. docs/product/26-annual-leave-workflow.md 참고.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { effectiveExcludedDates, leaveRangeDates, pruneExcludedDates, toggleExcludedDate } from "@/lib/annual-leave";
import { adminLeaveFormErrorText } from "@/lib/annual-leave-copy";

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

/** 휴가 종류가 어느 잔여 풀에서 차감되는지. */
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

function roleLabelOf(role: string | null, dictionary: Dictionary): string {
  if (!role) return "";
  const map = dictionary.roles as Record<string, string>;
  return map[role] ?? "";
}

function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? "·";
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
  /** 미리 채우는 시작/종료일 (YYYY-MM-DD), 예: 팀 캘린더 날짜 칸에서 열 때. */
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
  /** 안 A(2026-11-11) — 원래 휴무로 뺀 날. 종일 · 경조 아닌 종류에서만. */
  const [excluded, setExcluded] = useState<readonly string[]>([]);
  const [keepOneHint, setKeepOneHint] = useState(false);

  const isBereavement = leaveType === "annual";
  const half = (durationUnit === "am" || durationUnit === "pm") && !isBereavement;
  const allowExclude = !isBereavement && !half;
  const rangeList = useMemo(
    () => (allowExclude ? leaveRangeDates(startDate, endDate) : []),
    [allowExclude, startDate, endDate],
  );
  // 보여 주기 · 보내기 · 일수가 모두 이 값 하나를 쓴다(2026-11-11) — 단위 · 종류가 바뀌어 기간이 줄어도 어긋난 날이 남지 않게.
  const activeExcluded = effectiveExcludedDates(excluded, allowExclude, startDate, endDate);
  const days = useMemo(
    () => Math.max(0, calcDays(startDate, endDate, durationUnit) - activeExcluded.length),
    [startDate, endDate, durationUnit, activeExcluded.length],
  );
  // 입력 중이면 Esc · 바깥 누르기 · 닫기 단추가 바로 닫지 않고 확인한다(2026-11-11).
  const dirty = reason.trim().length > 0 || emergencyContact.trim().length > 0 || excluded.length > 0;
  // 확인은 브라우저 창이 아니라 모달 아래 줄에서(근무 직접 입력 모달과 같다, 2026-11-11).
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  function requestClose() {
    if (pending) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  function toggleOffDay(date: string) {
    const next = toggleExcludedDate(activeExcluded, date, startDate, endDate);
    if (next === activeExcluded) {
      setKeepOneHint(true);
      return;
    }
    setKeepOneHint(false);
    setExcluded(next);
  }

  function setRange(nextStart: string, nextEnd: string) {
    setExcluded((prev) => pruneExcludedDates(prev, nextStart, nextEnd));
    setKeepOneHint(false);
  }

  // 진입 전환 (스크림 + 모달 스케일 인) — 마운트 뒤에 `.on` 을 붙인다.
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // 날짜 창이 열리면 창 안에서 보이게 스크롤한다 — 모달 몸통이 스크롤 칸이라 아래쪽이 잘렸다(2026-11-11). 공용 피커는 그대로.
  useEffect(() => {
    const root = modalRef.current;
    if (!root) return;
    const observer = new MutationObserver(() => {
      const pop = root.querySelector(".adp__pop");
      if (pop) pop.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // 날짜 창이 열려 있으면 Esc 는 그 창만 닫는다(공용 피커가 처리) — 모달은 그대로.
      if (modalRef.current?.querySelector(".adp__pop")) return;
      requestCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 선택된 신청자의 실시간 잔여 (본인이면 마운트 때 직접 불러온다).
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
      setExcluded([]);
    }
  }

  function chooseStart(next: string) {
    setStartDate(next);
    let nextEnd = endDate;
    if (leaveType === "annual") nextEnd = addDaysISO(next, BEREAVEMENT_DAYS - 1);
    else if (durationUnit === "am" || durationUnit === "pm") nextEnd = next;
    else if (next > endDate) nextEnd = next;
    setEndDate(nextEnd);
    setRange(next, nextEnd);
  }

  function chooseEnd(next: string) {
    setEndDate(next);
    setRange(startDate, next);
  }

  function chooseDuration(unit: LeaveDurationUnit) {
    setDurationUnit(unit);
    if (unit !== "full") {
      setEndDate(startDate);
      setExcluded([]);
    }
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
      excludedDates: [...activeExcluded],
    };
    startTransition(async () => {
      try {
        const res = await createAdminLeaveRequestAction(input);
        if (res.ok) {
          onCreated(lc.formDone);
          onClose();
          router.refresh();
        } else {
          setSubmitErr(adminLeaveFormErrorText(res.error, lc));
        }
      } catch {
        setSubmitErr(adminLeaveFormErrorText("network", lc));
      }
    });
  }

  // 잔여 미리보기 (핸드오프 agentForm 미리보기 로직과 같다).
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
    // 풀 없음 (연차 = 회사 부여, 기타 = 무급)
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
        onClick={requestClose}
        aria-hidden="true"
      />
      <div ref={modalRef} className={`modal${shown ? " on" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__h">
          <div>
            <div className="modal__kicker">{kicker}</div>
            <div className="modal__t">{title}</div>
          </div>
          <button type="button" className="panel__x" onClick={requestClose} aria-label={dictionary.common.close} disabled={pending}>
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
                  {roleLabelOf(summary.role, dictionary) ? `${roleLabelOf(summary.role, dictionary)} · ` : ""}
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
            <div className="seg seg--wrap seg--fld">
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
              {/* 경조사와 반차는 종료일을 시작일에서 정하므로 — 읽기 전용이며 편집할 수 없다. */}
              <AdminDatePicker
                value={endDate}
                onChange={chooseEnd}
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
            <div className="seg seg--fld">
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

          {allowExclude && rangeList.length > 1 ? (
            <div className="fld">
              <span className="fld__l">{lc.formOffDays}</span>
              <span className="fld__hint">{lc.formOffDaysHint}</span>
              <div className="seg seg--wrap lv-offdays">
                {rangeList.map((d) => {
                  const off = activeExcluded.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={off}
                      className={`segb lv-offday ${off ? "is-off" : "on"}`}
                      onClick={() => toggleOffDay(d)}
                    >
                      <span className="lv-offday__d">
                        {new Intl.DateTimeFormat(localeTag, {
                          month: "numeric",
                          day: "numeric",
                          weekday: "short",
                          timeZone: "UTC",
                        }).format(new Date(`${d}T00:00:00Z`))}
                      </span>
                      {off ? <small className="lv-offday__tag">{lc.formOffDayTag}</small> : null}
                    </button>
                  );
                })}
              </div>
              {keepOneHint ? (
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--danger)" }}>{lc.formOffDayKeepOne}</span>
              ) : null}
            </div>
          ) : null}

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

        {confirmDiscard ? (
          <div className="modal__foot" role="alertdialog" aria-label={lc.formDiscardConfirm} style={{ flexWrap: "wrap" }}>
            {/* ja · en 문구가 길면 문구가 한 줄을 차지하고 단추는 아래로 — 자르지 않는다. */}
            <span style={{ flex: "1 1 180px", fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{lc.formDiscardConfirm}</span>
            <div style={{ display: "flex", gap: 9 }}>
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmDiscard(false)} autoFocus>
                {lc.formDiscardKeep}
              </button>
              <button type="button" className="btn btn--danger-ghost" onClick={onClose}>
                {lc.formDiscardOk}
              </button>
            </div>
          </div>
        ) : (
        <div className="modal__foot">
          <span className="modal__foot-note">
            <span className="ic">
              <Info />
            </span>
            {footNote}
          </span>
          <div style={{ display: "flex", gap: 9 }}>
            <button type="button" className="btn btn--ghost" onClick={requestClose} disabled={pending}>
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
        )}
      </div>
    </>
  );
}
