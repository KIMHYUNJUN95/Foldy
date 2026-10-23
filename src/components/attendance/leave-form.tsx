"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import "./leave.css";
import { AIc, AttIcon } from "./att-icons";
import { LeaveDatePicker } from "./leave-date-picker";
import { tokyoToday } from "@/lib/annual-leave";
import { submitLeaveRequestAction } from "@/app/mobile/attendance/leave/actions";
import type { LeaveRequestView } from "@/lib/annual-leave-requests-server";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

// L2 · 신청서 작성 — 종이 신청서를 그대로 옮긴 폼. 종류 선택 · 휴가 단위(종일/오전·오후 반차)는
// 폼 안에서 바로 전환된다(섹션 T · H). 휴가 기간 필드를 탭하면 날짜 범위 캘린더 바텀시트(섹션 D)가
// 올라온다. 실제 연/월 이동 캘린더 + submitLeaveRequestAction으로 실제 제출/임시저장된다
// (annual_leave_requests 테이블, migration 202607060002). 승인/문서출력은 아직 이후 단계.
// `draft`가 있으면 임시저장 이어쓰기 — 그 draft row를 그대로 update한다(status draft 상태에서만).

type LeaveCopy = Dictionary["leave"];
type LeaveType = "annual" | "paid" | "special" | "other";
type Duration = "full" | "am" | "pm";

const TYPES: LeaveType[] = ["paid", "annual", "special", "other"];
const BEREAVEMENT_DAYS = 3;

function typeLabel(t: LeaveType, c: LeaveCopy): string {
  return t === "annual" ? c.typeAnnual : t === "paid" ? c.typePaid : t === "special" ? c.typeSpecial : c.typeOther;
}

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function diffDaysISO(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  return Math.round((endMs - startMs) / 86400000) + 1;
}

export function LeaveForm({
  locale,
  userName,
  draft,
  remaining = null,
}: {
  locale: string;
  userName: string;
  draft?: LeaveRequestView | null;
  /** 지금 남은 유급 연차 — 태블릿 오른쪽 「신청 후 남는 연차」 미리보기용. */
  remaining?: number | null;
}) {
  const c: LeaveCopy = getDictionary(locale).leave;
  const router = useRouter();
  const today = tokyoToday();
  const [selType, setSelType] = useState<LeaveType>(draft?.leaveType ?? "annual");
  const [dur, setDur] = useState<Duration>(draft?.durationUnit ?? "full");
  const [reason, setReason] = useState(draft?.reason ?? "");
  const [emergency, setEmergency] = useState(draft?.emergencyContact ?? "");
  const [startDate, setStartDate] = useState(draft?.startDate ?? today);
  const [endDate, setEndDate] = useState(draft?.endDate ?? addDaysISO(today, BEREAVEMENT_DAYS - 1));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reasonErr, setReasonErr] = useState(false);
  const [emergencyErr, setEmergencyErr] = useState(false);
  const [submitErr, setSubmitErr] = useState(false);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);

  const isBereavement = selType === "annual";
  const isUnpaid = selType === "other";
  const half = dur !== "full" && !isBereavement;
  const rangeDays = diffDaysISO(startDate, endDate);

  async function submit(asDraft: boolean) {
    const hasReason = reason.trim().length > 0;
    const hasEmergency = emergency.trim().length > 0;
    setReasonErr(!hasReason);
    setEmergencyErr(!hasEmergency);
    setSubmitErr(false);
    if (!asDraft && (!hasReason || !hasEmergency)) return;

    setBusy(asDraft ? "draft" : "submit");
    const result = await submitLeaveRequestAction({
      requestId: draft?.id,
      leaveType: selType,
      startDate,
      endDate,
      durationUnit: half ? dur : "full",
      reason,
      emergencyContact: emergency,
      asDraft,
    });
    setBusy(null);

    if (!result.ok) {
      haptic("error");
      setSubmitErr(true);
      return;
    }
    haptic("success");
    router.push(asDraft ? "/mobile/attendance/leave" : `/mobile/attendance/leave/done?id=${result.id}`);
  }

  const useDays = isBereavement ? BEREAVEMENT_DAYS : half ? 0.5 : rangeDays;
  const fmtDay = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR", {
      // en 은 「Sun, October 25」가 반 칸에서 두 줄이 돼 짧은 달 이름(「Sun, Oct 25」). ko · ja 는 그대로.
      month: locale === "en" ? "short" : "long",
      day: "numeric",
      weekday: "short",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));

  // 화이트 리디자인(2026-10-13, 시안 AttLeaveNewM-Phone · Fold · Tablet): 신청일 · 신청자 회색 칸 → 제목 아래 한 줄,
  // 기간 · 사유 · 비상 연락처는 테두리 이름표 칸, 종류 · 단위는 칩, 버튼은 맨 아래 제자리. 태블릿 가로 오른쪽은 신청 후 남는 연차.
  return (
    <div className="lv lvw lvw--form">
      <div className="lvw-left">
        <div className="lvw-title">
          <h1>{c.formTitleShort}</h1>
          <span>{c.formSub.replace("{name}", userName).replace("{date}", today.slice(5).replace("-", "/"))}</span>
        </div>

        <div className="lvw-duo">
          <div className="lnf">
            <span className="lnf__l">{half ? c.fDate : c.fStart}</span>
            <button type="button" className="lnf__in" onClick={() => setPickerOpen(true)}>
              <span>{fmtDay(startDate)}</span>
              <AIc>{AttIcon.calendar}</AIc>
            </button>
          </div>
          {half ? null : (
            <div className="lnf">
              <span className="lnf__l">{c.fEnd}</span>
              <button type="button" className="lnf__in" onClick={() => setPickerOpen(true)}>
                <span>{fmtDay(endDate)}</span>
                <AIc>{AttIcon.calendar}</AIc>
              </button>
            </div>
          )}
        </div>

        <div className="lvw-q">{c.fType}</div>
        <div className="lvw-chips">
          {TYPES.map((ty) => (
            <button
              key={ty}
              type="button"
              aria-pressed={ty === selType}
              className={`lvw-chip${ty === selType ? " on" : ""}`}
              onClick={() => {
                setSelType(ty);
                if (ty === "annual") {
                  setDur("full");
                  setEndDate(addDaysISO(startDate, BEREAVEMENT_DAYS - 1));
                }
              }}
            >
              {typeLabel(ty, c)}
            </button>
          ))}
        </div>

        {isBereavement ? null : (
          <>
            <div className="lvw-q">{c.fUnit}</div>
            <div className="lvw-chips">
              {([["full", c.dFull], ["am", c.dAm], ["pm", c.dPm]] as const).map(([d, label]) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={dur === d}
                  className={`lvw-chip${dur === d ? " on" : ""}`}
                  onClick={() => {
                    setDur(d);
                    if (d !== "full") setEndDate(startDate);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="lvw-days">
          <span>{c.fDaysLabel}</span>
          <b>{isBereavement ? c.fBereaveDays : half ? c.fHalf : c.fDays(rangeDays)}</b>
        </div>

        <div className="lnf">
          <label className="lnf__l" htmlFor="lvw-reason">
            {c.fReason}
          </label>
          <textarea
            id="lvw-reason"
            className={`lnf__in lnf__ta${reasonErr ? " err" : ""}`}
            placeholder={c.fReasonPh}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <span className="lnf__count">{reason.length} / 300</span>
        </div>
        {reasonErr ? <p className="lvw-err">{c.fReasonErr}</p> : null}

        <div className="lnf">
          <label className="lnf__l" htmlFor="lvw-emg">
            {c.fEmg}
          </label>
          <input
            id="lvw-emg"
            className={`lnf__in mono${emergencyErr ? " err" : ""}`}
            inputMode="tel"
            placeholder={c.fEmgPh}
            value={emergency}
            onChange={(e) => setEmergency(e.target.value)}
          />
        </div>
        {emergencyErr ? <p className="lvw-err">{c.fEmgErr}</p> : null}

        {isBereavement ? <p className="lvw-hint">{c.fBereaveHint}</p> : null}
        {isUnpaid ? <p className="lvw-hint">{c.fOtherUnpaidHint}</p> : null}
        {submitErr ? <p className="lvw-err">{c.exSetupSaveErr}</p> : null}

        <div className="lvw-acts">
          <button type="button" className="lvw-btn lvw-btn--ghost" disabled={busy !== null} onClick={() => submit(true)}>
            {c.save}
          </button>
          <button type="button" className="lvw-btn" disabled={busy !== null} onClick={() => submit(false)}>
            {c.submit}
          </button>
        </div>
      </div>

      {remaining !== null ? (
        <div className="lvw-right lvw-preview">
          <div className="lvw-sec">
            <b>{selType === "paid" ? c.afterTitle : c.nowRemain}</b>
          </div>
          <div className="lvw-after">
            <b>
              {selType === "paid" ? Math.max(0, remaining - useDays) : remaining}
              <small>{c.unitD}</small>
            </b>
            <span>
              {selType === "paid"
                ? c.afterCalc.replace("{now}", String(remaining)).replace("{use}", String(useDays))
                : c.afterNoDeduct}
            </span>
          </div>
        </div>
      ) : null}

      {/* D · 날짜 범위 캘린더 (바텀시트) */}
      {pickerOpen ? (
        <LeaveDatePicker
          locale={locale}
          copy={c}
          startDate={startDate}
          endDate={endDate}
          singleDay={half}
          fixedRangeDays={isBereavement ? BEREAVEMENT_DAYS : undefined}
          onApply={(s, e) => {
            setStartDate(s);
            setEndDate(e);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
