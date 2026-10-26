"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "./leave.css";
import { AIc, AttIcon } from "./att-icons";
import { HireDatePicker } from "./hire-date-picker";
import { setAnnualLeaveBaselineAction } from "@/app/mobile/attendance/leave/actions";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";

// 섹션 S · 예외 상태 — 신청을 막고 이유·시점을 분명히 보여주는 전체 화면.
//   missing: 입사일 미등록 — 본인이 입사일 + 현재 남은 연차를 직접 입력해 등록.
//   waiting: 6개월 미만(아직 사용 대상 아님, 첫 부여 시점 안내)
// missing 화면의 저장은 setAnnualLeaveBaselineAction(서버 액션, profiles.hire_date +
// annual_leave_baselines 테이블에 기록)을 호출한다. 실제 신청/승인 백엔드는 아직 범위 밖.

type LeaveCopy = Dictionary["leave"];

const WAIT_MOCK = { hireDate: "2026-04-20", availableFrom: "2026-10-20" };

export function LeaveException({ locale, variant }: { locale: string; variant: "missing" | "waiting" }) {
  const c: LeaveCopy = getDictionary(locale).leave;
  const router = useRouter();
  const [hireDate, setHireDate] = useState("");
  const [baseline, setBaseline] = useState("");
  const [hireErr, setHireErr] = useState(false);
  const [baselineErr, setBaselineErr] = useState(false);
  /** null = 오류 없음. "hourly" 는 파트타임 제외(정책)라 재시도해도 안 되므로 문구를 구분한다. */
  const [saveErr, setSaveErr] = useState<null | "generic" | "hourly" | "already">(null);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function submit() {
    const amount = Number(baseline);
    const hasHire = hireDate.trim().length > 0;
    const hasBaseline = baseline.trim().length > 0 && Number.isFinite(amount) && amount >= 0;
    setHireErr(!hasHire);
    setBaselineErr(!hasBaseline);
    setSaveErr(null);
    if (!hasHire || !hasBaseline) return;

    setSaving(true);
    const result = await setAnnualLeaveBaselineAction({ hireDate, baseAmount: amount });
    setSaving(false);
    if (!result.ok) {
      haptic("error");
      setSaveErr(
        result.error === "hourly_excluded" ? "hourly" : result.error === "already_set" ? "already" : "generic",
      );
      return;
    }
    haptic("success");
    router.push("/mobile/attendance/leave");
  }

  return (
    <div className="lv" style={{ padding: 0 }}>
      <div className="pagehead" style={{ padding: "4px 2px 0" }}>
        <span className="pagehead__crumb">{c.crumb}</span>
        <span className="pagehead__t">{c.appTitle}</span>
      </div>

      {variant === "missing" ? (
        <div className="exwrap">
          <div className="exwrap__ic ic-danger">{AttIcon.warn}</div>
          <p className="exwrap__ey">{c.exMissEy}</p>
          <h3 className="exwrap__t">{c.exMissT}</h3>
          <p className="exwrap__s">{c.exMissS}</p>

          <div className="exwrap__note" style={{ textAlign: "left" }}>
            <div className="field" style={{ marginBottom: 14 }}>
              <div className="field__l">
                {c.exSetupHire}
                <span className="req">*</span>
              </div>
              <button
                type="button"
                className={`finput mono${hireErr ? " err" : ""}`}
                onClick={() => setPickerOpen(true)}
              >
                {hireDate || <span className="finput__ph">{c.pickDate}</span>}
                <span className="tail">
                  <AIc>{AttIcon.calendar}</AIc>
                </span>
              </button>
              {hireErr ? <div className="ferr">{c.exSetupHireErr}</div> : null}
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <div className="field__l">
                {c.exSetupBaseline}
                <span className="req">*</span>
              </div>
              <div className={`finput${baselineErr ? " err" : ""}`}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  placeholder="0"
                  value={baseline}
                  onChange={(e) => setBaseline(e.target.value)}
                />
                <span className="tail">{c.unitD}</span>
              </div>
              <div className="fhint">{c.exSetupBaselineHelp}</div>
              {baselineErr ? <div className="ferr">{c.exSetupBaselineErr}</div> : null}
            </div>
            {saveErr ? (
              <div className="ferr">
                {saveErr === "hourly"
                  ? c.exSetupHourlyErr
                  : saveErr === "already"
                    ? c.exSetupAlreadySet
                    : c.exSetupSaveErr}
              </div>
            ) : null}
          </div>

          <div className="exwrap__cta">
            <button type="button" className="exbtn exbtn--pri" disabled={saving} onClick={submit}>
              <AIc>{AttIcon.check}</AIc>
              {c.exMissCta}
            </button>
            <Link className="exbtn exbtn--ghost" href="/mobile/attendance">
              {c.exMissAlt}
            </Link>
          </div>
        </div>
      ) : (
        <div className="exwrap">
          <div className="exwrap__ic ic-info">{AttIcon.clock}</div>
          <p className="exwrap__ey">{c.exWaitEy}</p>
          <h3 className="exwrap__t">{c.exWaitT}</h3>
          <p className="exwrap__s">{c.exWaitS}</p>
          <div className="exwrap__note">
            <div className="exrow">
              <span className="exrow__k">{c.exWaitRow1}</span>
              <span className="exrow__v mono">{WAIT_MOCK.hireDate}</span>
            </div>
            <div className="exrow">
              <span className="exrow__k">{c.exWaitRow2}</span>
              <span className="exrow__v mono pri">{WAIT_MOCK.availableFrom}</span>
            </div>
            <div className="exrow">
              <span className="exrow__k">{c.exWaitRow3}</span>
              <span className="exrow__v">{c.exWaitRow3v}</span>
            </div>
          </div>
          <div className="exwrap__cta">
            <button type="button" className="exbtn exbtn--pri">
              <AIc>{AttIcon.shield}</AIc>
              {c.exWaitCta}
            </button>
            <Link className="exbtn exbtn--ghost" href="/mobile/attendance">
              {c.exWaitAlt}
            </Link>
          </div>
        </div>
      )}

      {pickerOpen ? (
        <HireDatePicker
          locale={locale}
          value={hireDate}
          onApply={(date) => {
            setHireDate(date);
            setHireErr(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
