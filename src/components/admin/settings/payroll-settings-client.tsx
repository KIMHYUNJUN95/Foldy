"use client";

import { useMemo, useRef, useState } from "react";
import { saveOrgPayrollSettings, type OrgPayrollSettingsPatch } from "@/actions/payroll-settings";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import type { Locale } from "@/lib/i18n";
import { fillCopy, type PayrollSettingsCopy } from "@/lib/payroll-settings-i18n";
import { upcomingPaydays } from "@/lib/payroll-settings-rules";
import type { OrgPayrollSettings } from "@/lib/payroll-settings-server";

// 설정 › 급여 — 시안 SettingsPay-PC. 고르거나 칸을 벗어나면 바로 저장(조용히), 성공은 작은 토스트.
// 지급일이 쉬는 날이면 늘 앞 평일로 옮긴다(2026-10-25 결정 — 「앞/뒤 평일」 고르기 없음).

type Member = { id: string; name: string };

const LOCALE_TAG: Record<Locale, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };

function ordinal(n: number) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
}

function formatRate(n: number) {
  return String(Math.round(n * 100) / 100);
}

export function PayrollSettingsClient({
  copy,
  initial,
  members,
  fromWorkYm,
  thisYear,
  locale,
}: {
  copy: PayrollSettingsCopy;
  initial: OrgPayrollSettings;
  members: Member[];
  fromWorkYm: string;
  thisYear: number;
  locale: Locale;
}) {
  const { toast, showToast, dismiss } = useAdminToast();
  const [error, setError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState(initial.companyName);
  const savedCompany = useRef(initial.companyName);

  const [payDayText, setPayDayText] = useState(String(initial.payDay));
  const [payDay, setPayDay] = useState(initial.payDay);
  const [payDayError, setPayDayError] = useState(false);
  const savedPayDay = useRef(initial.payDay);

  const [senmu, setSenmu] = useState(initial.senmuApproverId ?? "");
  const [president, setPresident] = useState(initial.presidentApproverId ?? "");
  const [approverError, setApproverError] = useState(false);

  const [rates, setRates] = useState<Record<string, number>>(initial.employmentInsuranceRates);
  const [editYear, setEditYear] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState(false);

  async function persist(patch: OrgPayrollSettingsPatch): Promise<boolean> {
    setError(null);
    const res = await saveOrgPayrollSettings(patch);
    if (res.ok) {
      showToast(copy.saved);
      return true;
    }
    if (res.reason === "forbidden") setError(copy.errorForbidden);
    else if (res.reason === "same_approver") setError(copy.sameApproverError);
    else setError(copy.errorSave);
    return false;
  }

  async function commitCompany() {
    const next = companyName.trim();
    if (next === savedCompany.current) return;
    if (await persist({ companyName: next })) savedCompany.current = next;
  }

  async function commitPayDay() {
    const n = Number(payDayText);
    if (!Number.isInteger(n) || n < 1 || n > 28) {
      setPayDayError(true);
      return;
    }
    setPayDayError(false);
    setPayDay(n);
    setPayDayText(String(n));
    if (n === savedPayDay.current) return;
    if (await persist({ payDay: n })) savedPayDay.current = n;
  }

  async function pickApprover(which: "senmu" | "president", id: string) {
    const otherId = which === "senmu" ? president : senmu;
    if (id && id === otherId) {
      setApproverError(true);
      return;
    }
    setApproverError(false);
    const prev = which === "senmu" ? senmu : president;
    (which === "senmu" ? setSenmu : setPresident)(id);
    const ok = await persist(which === "senmu" ? { senmuApproverId: id || null } : { presidentApproverId: id || null });
    if (!ok) (which === "senmu" ? setSenmu : setPresident)(prev);
  }

  function startEdit(year: number) {
    setEditYear(year);
    setEditText(rates[String(year)] !== undefined ? formatRate(rates[String(year)]) : "");
    setEditError(false);
  }

  async function saveRate(year: number, permille: number | null) {
    if (permille !== null && !(Number.isFinite(permille) && permille >= 0 && permille < 100)) {
      setEditError(true);
      return;
    }
    if (await persist({ employmentInsuranceRate: { year, permille } })) {
      setRates((cur) => {
        const next = { ...cur };
        if (permille === null) delete next[String(year)];
        else next[String(year)] = Math.round(permille * 100) / 100;
        return next;
      });
      setEditYear(null);
    }
  }

  const years = useMemo(() => {
    const set = new Set<number>([thisYear - 1, thisYear]);
    for (const y of Object.keys(rates)) set.add(Number(y));
    return [...set].sort((a, b) => a - b);
  }, [rates, thisYear]);

  const memberOptions = useMemo(
    () => [{ value: "", label: copy.approverNone }, ...members.map((m) => ({ value: m.id, label: m.name }))],
    [members, copy.approverNone],
  );

  const weekdays = copy.weekdaysShort.split(",");
  const monthName = (ym: string, short: boolean) => {
    const [y, m] = ym.split("-").map(Number);
    return short
      ? new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)))
      : String(m);
  };
  const m = (ym: string) => monthName(ym, locale === "en");
  const dayOf = (ymd: string) => Number(ymd.slice(8, 10));
  const weekdayOf = (ymd: string) => weekdays[new Date(`${ymd}T00:00:00Z`).getUTCDay()] ?? "";
  const dayLabel = (d: number) => (locale === "en" ? ordinal(d) : String(d));

  const paydays = useMemo(() => upcomingPaydays(fromWorkYm, payDay, 12), [fromWorkYm, payDay]);

  const approverPick = (which: "senmu" | "president", value: string, label: string) => (
    <div className="stwp-row">
      <span className="stwp-k jp">{label}</span>
      <div className="stwp-v stwp-dd">
        <AdmDropdown
          options={memberOptions}
          value={value}
          onChange={(id) => void pickApprover(which, id)}
          ariaLabel={label}
          placeholder={copy.approverNone}
        />
      </div>
    </div>
  );

  return (
    <>
      {error ? (
        <p className="stw-flash is-red" role="alert">
          {error}
        </p>
      ) : null}
      <div className="stwp">
        <div className="stwp-main">
          <section className="stwp-sec">
            <h2>{copy.secPayslip}</h2>
            <label className="stw-nf">
              <span>{copy.companyName}</span>
              <input
                className="stwp-jp"
                value={companyName}
                maxLength={80}
                placeholder={copy.companyNamePlaceholder}
                onChange={(e) => setCompanyName(e.target.value)}
                onBlur={() => void commitCompany()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
            <p className="stwp-note">{copy.companyNameNote}</p>
          </section>

          <section className="stwp-sec">
            <h2>{copy.secPayday}</h2>
            <div className="stwp-rows">
              <div className="stwp-row">
                <label className="stwp-k" htmlFor="stwp-payday">
                  {copy.payDayLabel}
                </label>
                <span className="stwp-v">
                  <input
                    id="stwp-payday"
                    className={`stwp-day num${payDayError ? " is-bad" : ""}`}
                    inputMode="numeric"
                    value={payDayText}
                    aria-invalid={payDayError}
                    onChange={(e) => setPayDayText(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    onBlur={() => void commitPayDay()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                  {copy.payDayUnit ? <span>{copy.payDayUnit}</span> : null}
                </span>
              </div>
            </div>
            {payDayError ? <p className="stwp-note is-red">{copy.payDayRange}</p> : null}
            <p className="stwp-note">{copy.holidayRule}</p>
          </section>

          <section className="stwp-sec">
            <h2>{copy.secApproval}</h2>
            <div className="stwp-rows">
              {approverPick("senmu", senmu, copy.senmuApprover)}
              {approverPick("president", president, copy.presidentApprover)}
            </div>
            {approverError ? <p className="stwp-note is-red">{copy.sameApproverError}</p> : null}
            <p className="stwp-note">{copy.approvalNote}</p>
          </section>

          <section className="stwp-sec">
            <h2 className="jp">{copy.secInsurance}</h2>
            <div className="stwp-rows">
              {years.map((year) => {
                const value = rates[String(year)];
                const editing = editYear === year;
                return (
                  <div className="stwp-yr" key={year}>
                    <span className="num">{fillCopy(copy.yearLabel, { y: year })}</span>
                    {editing ? (
                      <form
                        className="stwp-edit"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const text = editText.trim().replace(",", ".");
                          void saveRate(year, text === "" ? NaN : Number(text));
                        }}
                      >
                        {locale !== "en" ? <span>{copy.insuranceRatePrefix}</span> : null}
                        <input
                          className={`stwp-rate num${editError ? " is-bad" : ""}`}
                          inputMode="decimal"
                          autoFocus
                          value={editText}
                          aria-invalid={editError}
                          aria-label={fillCopy(copy.yearLabel, { y: year })}
                          onChange={(e) => {
                            setEditText(e.target.value);
                            setEditError(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditYear(null);
                          }}
                        />
                        {locale === "en" ? <span>{copy.insuranceRatePrefix}</span> : null}
                        <button type="submit" className="stw-link">
                          {copy.save}
                        </button>
                        <button type="button" className="stw-link is-soft" onClick={() => setEditYear(null)}>
                          {copy.cancel}
                        </button>
                        {value !== undefined ? (
                          <button type="button" className="stw-link is-red" onClick={() => void saveRate(year, null)}>
                            {copy.insuranceRateRemove}
                          </button>
                        ) : null}
                      </form>
                    ) : (
                      <>
                        <span className={value === undefined ? "stwp-dim" : "num"}>
                          {value === undefined ? copy.insuranceRateMissing : fillCopy(copy.insuranceRateValue, { n: formatRate(value) })}
                        </span>
                        <button type="button" className="stw-link stwp-act" onClick={() => startEdit(year)}>
                          {value === undefined ? copy.insuranceRateEnter : copy.edit}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {editError ? <p className="stwp-note is-red">{copy.insuranceRateInvalid}</p> : null}
          </section>
        </div>

        <aside className="stwp-side">
          <h2>{copy.upcomingTitle}</h2>
          <p className="stwp-note">{copy.upcomingNote}</p>
          <ol className="stwp-pd">
            {paydays.map((p, i) => {
              const why =
                p.shiftedBecause === "sun"
                  ? fillCopy(copy.shiftedSun, { d: dayLabel(dayOf(p.nominal)) })
                  : p.shiftedBecause === "sat"
                    ? fillCopy(copy.shiftedSat, { d: dayLabel(dayOf(p.nominal)) })
                    : p.shiftedBecause === "holiday" && p.holiday
                      ? fillCopy(copy.shiftedHoliday, { d: dayLabel(dayOf(p.nominal)), holiday: copy.holidays[p.holiday] })
                      : "";
              return (
                <li key={p.workYm} className={`${i === 0 ? "is-next" : ""}${p.shiftedBecause ? " is-moved" : ""}`}>
                  <span className="stwp-pd__m">{fillCopy(copy.monthFor, { m: m(p.workYm) })}</span>
                  <b className="num">
                    {fillCopy(copy.payDate, { m: m(p.date.slice(0, 7)), d: dayOf(p.date), w: weekdayOf(p.date) })}
                  </b>
                  <span className="stwp-pd__why">{i === 0 && !why ? copy.nextPay : why}</span>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </>
  );
}
