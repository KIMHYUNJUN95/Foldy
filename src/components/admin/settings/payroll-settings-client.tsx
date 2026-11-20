"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { saveOrgPayrollSettings, type OrgPayrollSettingsPatch } from "@/actions/payroll-settings";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import type { Locale } from "@/lib/i18n";
import { fillCopy, type PayrollSettingsCopy } from "@/lib/payroll-settings-i18n";
import { daysBetweenKeys, upcomingPaydaysFrom } from "@/lib/payroll-settings-rules";
import type { OrgPayrollSettings } from "@/lib/payroll-settings-server";
import {
  beginSave,
  dismissError,
  expireSaved,
  initSave,
  isValidPayDay,
  needsResave,
  pickedValueAfter,
  settleSaveResponse,
  shouldResavePayDay,
  touchSave,
  type SaveState,
} from "@/lib/settings-display";

// 설정 › 급여 — 시안 SettingsPay-PC → 2026-11-12 다듬기(PayNew) → 2026-11-20 unslop.
// 고르거나 칸을 벗어나면 바로 저장(그대로). 저장되면 **그 칸 옆**에 「✓ 저장됨」(서버가 확인한 뒤에만, 3초 뒤 사라짐),
// 오류는 **그 칸 아래** 한 줄 + `aria-describedby` · `aria-invalid` — 위쪽 알림 · 토스트는 없앴다(같은 말을 두 번 하지 않게).
// 저장 값 · 검증 규칙은 바꾸지 않았다.
// 지급일이 쉬는 날이면 늘 앞 평일로 옮긴다(2026-10-25 결정 — 「앞/뒤 평일」 고르기 없음).

type Member = { id: string; name: string };
/** 저장 · 오류를 붙일 칸. 결재는 단계마다, 고용보험 요율은 해마다 따로. */
type Field = "company" | "payDay" | "senmu" | "president" | `rate-${number}`;
type FieldValue = string | number | null;

/** 「✓ 저장됨」을 보여 두는 시간 — 칸마다 따로 지난 뒤 사라진다. */
const SAVED_MS = 3000;

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
  today,
  thisYear,
  locale,
}: {
  copy: PayrollSettingsCopy;
  initial: OrgPayrollSettings;
  members: Member[];
  /** 도쿄 오늘 `YYYY-MM-DD` — 다음 지급일 · 「N일 뒤」 기준. */
  today: string;
  thisYear: number;
  locale: Locale;
}) {
  const [companyName, setCompanyName] = useState(initial.companyName);
  const companyInput = useRef<HTMLInputElement>(null);

  const [payDayText, setPayDayText] = useState(String(initial.payDay));
  const [payDay, setPayDay] = useState(initial.payDay);
  const [payDayError, setPayDayError] = useState(false);
  const payDayInput = useRef<HTMLInputElement>(null);

  const [senmu, setSenmu] = useState(initial.senmuApproverId ?? "");
  const [president, setPresident] = useState(initial.presidentApproverId ?? "");
  const [approverError, setApproverError] = useState(false);

  const [rates, setRates] = useState<Record<string, number>>(initial.employmentInsuranceRates);
  const [editYear, setEditYear] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState(false);

  // 칸마다 저장 상태(서버 확인 값 · 요청 번호 · 「저장됨」 · 오류) — 판정은 settings-display.ts 의 순수 함수(2026-11-20).
  // 비동기 응답이 최신 상태를 읽어야 해서 ref 에 두고(처리용), 그릴 때는 같은 내용의 state 복사본(fieldView)을 읽는다.
  const [fieldView, setFieldView] = useState(
    () =>
      new Map<Field, SaveState<FieldValue>>([
        ["company", initSave<FieldValue>(initial.companyName)],
        ["payDay", initSave<FieldValue>(initial.payDay)],
        ["senmu", initSave<FieldValue>(initial.senmuApproverId ?? "")],
        ["president", initSave<FieldValue>(initial.presidentApproverId ?? "")],
      ]),
  );
  const fields = useRef(fieldView);
  const savedTimers = useRef(new Map<Field, ReturnType<typeof setTimeout>>());
  // 화면을 떠난 뒤 오는 응답이 새 3초 타이머를 만들지 않게.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const timers = savedTimers.current;
    return () => {
      mounted.current = false;
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  // 요율 칸은 처음 쓸 때 만든다 — 서버 확인 값은 처음 받은 표의 값.
  const fieldIn = (map: Map<Field, SaveState<FieldValue>>, field: Field): SaveState<FieldValue> =>
    map.get(field) ??
    initSave<FieldValue>(initial.employmentInsuranceRates[field.startsWith("rate-") ? field.slice(5) : ""] ?? null);
  /** 처리용(응답 · 타이머 안에서 최신 상태). */
  const fieldOf = (field: Field) => fieldIn(fields.current, field);
  /** 그리기용. */
  const viewOf = (field: Field) => fieldIn(fieldView, field);
  const putField = (field: Field, next: SaveState<FieldValue>) => {
    const map = new Map(fields.current);
    map.set(field, next);
    fields.current = map;
    setFieldView(map);
  };

  /** 저장 한 번 — 결과(최신 응답인지 · 더 새 요청이 기다리는지)와 갱신된 칸 상태를 돌려준다. */
  async function persist(field: Field, patch: OrgPayrollSettingsPatch, value: FieldValue) {
    const { state, ticket } = beginSave(fieldOf(field));
    putField(field, state);
    const res = await saveOrgPayrollSettings(patch);
    const settled = settleSaveResponse(
      fieldOf(field),
      ticket,
      res.ok
        ? { ok: true, value }
        : {
            ok: false,
            message:
              res.reason === "forbidden"
                ? copy.errorForbidden
                : res.reason === "same_approver"
                  ? copy.sameApproverError
                  : copy.errorSave,
          },
    );
    putField(field, settled.state);
    if (mounted.current && settled.state.savedSeq !== null && settled.latest) {
      const seq = settled.state.savedSeq;
      clearTimeout(savedTimers.current.get(field));
      savedTimers.current.set(
        field,
        setTimeout(() => putField(field, expireSaved(fieldOf(field), seq)), SAVED_MS),
      );
    }
    return { ok: res.ok, ...settled };
  }

  /** 그 칸을 다시 고치기 시작하면 「저장됨」 · 오류를 지우고, 기다리던 응답의 표시는 버린다(서버 확인 값은 그대로 받는다). */
  function touch(field: Field) {
    putField(field, touchSave(fieldOf(field)));
  }

  const isEditing = (el: HTMLInputElement | null) => el !== null && el === document.activeElement;

  async function commitCompany() {
    const next = (companyInput.current?.value ?? companyName).trim();
    if (next === fieldOf("company").confirmed) return;
    await persist("company", { companyName: next }, next);
    // 늦은 성공으로 서버 값이 화면과 달라졌으면(되돌린 뒤 벗어남 등) 화면 값을 다시 저장한다.
    const display = (companyInput.current?.value ?? next).trim();
    if (needsResave(fieldOf("company"), display, isEditing(companyInput.current))) void commitCompany();
  }

  async function commitPayDay() {
    const text = payDayInput.current?.value ?? payDayText;
    const n = Number(text);
    if (!isValidPayDay(n)) {
      setPayDayError(true);
      return;
    }
    setPayDayError(false);
    setPayDay(n);
    setPayDayText(String(n));
    if (n === fieldOf("payDay").confirmed) return;
    await persist("payDay", { payDay: n }, n);
    if (shouldResavePayDay(fieldOf("payDay"), payDayInput.current?.value ?? String(n), isEditing(payDayInput.current))) {
      void commitPayDay();
    }
  }

  async function pickApprover(which: "senmu" | "president", id: string) {
    const otherId = which === "senmu" ? president : senmu;
    if (id && id === otherId) {
      setApproverError(true);
      return;
    }
    setApproverError(false);
    const setShown = which === "senmu" ? setSenmu : setPresident;
    setShown(id);
    const settled = await persist(
      which,
      which === "senmu" ? { senmuApproverId: id || null } : { presidentApproverId: id || null },
      id,
    );
    // 실패(낡은 실패 포함) · 늦은 성공 뒤에는 더 새 요청이 없으면 화면을 서버가 확인한 값에 맞춘다.
    setShown((shown) => String(pickedValueAfter(settled.state, shown, settled.newerPending) ?? ""));
  }

  function startEdit(year: number) {
    setEditYear(year);
    setEditText(rates[String(year)] !== undefined ? formatRate(rates[String(year)]) : "");
    setEditError(false);
    // 규칙: 닫힌 줄에 남은 서버 오류는 「수정」으로 다시 열면 지운다(새로 고치기 시작).
    putField(`rate-${year}`, dismissError(fieldOf(`rate-${year}`)));
  }

  async function saveRate(year: number, permille: number | null) {
    if (permille !== null && !(Number.isFinite(permille) && permille >= 0 && permille < 100)) {
      setEditError(true);
      return;
    }
    const value = permille === null ? null : Math.round(permille * 100) / 100;
    const settled = await persist(`rate-${year}`, { employmentInsuranceRate: { year, permille } }, value);
    if (!settled.ok) return;
    // 서버에 들어간 값은 낡은 응답이어도 표에 반영한다.
    setRates((cur) => {
      const next = { ...cur };
      if (value === null) delete next[String(year)];
      else next[String(year)] = value;
      return next;
    });
    // 그해 편집 칸만 닫는다 — 그사이 다른 해를 열었거나 다시 고치고 있으면 그대로.
    if (settled.latest) setEditYear((cur) => (cur === year ? null : cur));
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

  // 칸 옆 「✓ 저장됨」 — 자리는 늘 두고(role=status) 저장이 확인된 칸에만 글자를 채운다.
  const savedMark = (field: Field, extra = "", alsoField?: Field) => (
    <span className={`stwp-saved${extra}`} role="status">
      {viewOf(field).savedSeq !== null || (alsoField !== undefined && viewOf(alsoField).savedSeq !== null) ? (
        <>
          <Check aria-hidden="true" />
          {copy.savedInline}
        </>
      ) : null}
    </span>
  );
  const companyError = viewOf("company").error;
  const payDayErrorText = payDayError ? copy.payDayRange : viewOf("payDay").error;
  const approverErrorText = approverError
    ? copy.sameApproverError
    : (viewOf("senmu").error ?? viewOf("president").error);
  const rateErrorText =
    editYear === null ? null : editError ? copy.insuranceRateInvalid : viewOf(`rate-${editYear}`).error;

  const paydays = useMemo(() => upcomingPaydaysFrom(today, payDay, 12), [today, payDay]);
  const [next, ...later] = paydays;
  const daysLeft = daysBetweenKeys(today, next.date);
  const nextWeekday = new Intl.DateTimeFormat(LOCALE_TAG[locale], { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${next.date}T00:00:00Z`),
  );
  const shiftReason = (p: (typeof paydays)[number]) =>
    p.shiftedBecause === "sun"
      ? fillCopy(copy.shiftedSun, { d: dayLabel(dayOf(p.nominal)) })
      : p.shiftedBecause === "sat"
        ? fillCopy(copy.shiftedSat, { d: dayLabel(dayOf(p.nominal)) })
        : p.shiftedBecause === "holiday" && p.holiday
          ? fillCopy(copy.shiftedHoliday, { d: dayLabel(dayOf(p.nominal)), holiday: copy.holidays[p.holiday] })
          : "";

  // 결재 단계 — 작은 회색 「1 · 전무」 위 · 드롭다운 아래. 드롭다운 이름(aria)은 기존 「전무 결재」 그대로.
  const approverStep = (which: "senmu" | "president", value: string, step: string, label: string) => (
    <div className="stwp-step">
      <span className="stwp-step__k stwp-jp" aria-hidden="true">
        {step}
      </span>
      <div className="stwp-dd">
        <AdmDropdown
          options={memberOptions}
          value={value}
          onChange={(id) => void pickApprover(which, id)}
          ariaLabel={label}
          ariaDescribedBy={approverErrorText ? "stwp-approver-err" : undefined}
          placeholder={copy.approverNone}
        />
      </div>
    </div>
  );

  return (
    <>
      <div className="stwp">
        <div className="stwp-main">
          <section className="stwp-sec">
            <h2>{copy.secPayslip}</h2>
            <div className="stwp-cowrap">
              <label className={`stw-nf stwp-co${companyError ? " is-bad" : ""}`}>
                <span>{copy.companyName}</span>
                <input
                  ref={companyInput}
                  className="stwp-jp"
                  value={companyName}
                  maxLength={80}
                  placeholder={copy.companyNamePlaceholder}
                  aria-invalid={Boolean(companyError)}
                  aria-describedby={companyError ? "stwp-company-err" : undefined}
                  onChange={(e) => {
                    setCompanyName(e.target.value);
                    touch("company");
                  }}
                  onBlur={() => void commitCompany()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              </label>
              {savedMark("company", " is-in")}
            </div>
            {companyError ? (
              <p className="stwp-note is-red" id="stwp-company-err" role="alert">
                {companyError}
              </p>
            ) : null}
            <p className="stwp-note">{copy.companyNameNote}</p>
          </section>

          <section className="stwp-sec">
            <h2>{copy.secPayday}</h2>
            <div className="stwp-pay">
              <span aria-hidden="true">{copy.payDayPrefix}</span>
              <label className="sr-only" htmlFor="stwp-payday">
                {copy.payDayLabel}
              </label>
              <input
                id="stwp-payday"
                ref={payDayInput}
                className={`stwp-day num${payDayErrorText ? " is-bad" : ""}`}
                inputMode="numeric"
                value={payDayText}
                aria-invalid={Boolean(payDayErrorText)}
                aria-describedby={payDayErrorText ? "stwp-payday-err" : undefined}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").slice(0, 2);
                  setPayDayText(next);
                  setPayDayError(false);
                  touch("payDay");
                }}
                onBlur={() => void commitPayDay()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              {copy.payDaySuffix ? <span aria-hidden="true">{copy.payDaySuffix}</span> : null}
              {savedMark("payDay")}
            </div>
            {payDayErrorText ? (
              <p className="stwp-note is-red" id="stwp-payday-err" role="alert">
                {payDayErrorText}
              </p>
            ) : null}
            <p className="stwp-note">{copy.holidayRule}</p>
          </section>

          <section className="stwp-sec">
            <h2>{copy.secApproval}</h2>
            <div className="stwp-steps">
              {approverStep("senmu", senmu, copy.approverStep1, copy.senmuApprover)}
              <ArrowRight className="stwp-steps__arrow" aria-hidden="true" />
              {approverStep("president", president, copy.approverStep2, copy.presidentApprover)}
              {savedMark("senmu", " is-step", "president")}
            </div>
            {approverErrorText ? (
              <p className="stwp-note is-red" id="stwp-approver-err" role="alert">
                {approverErrorText}
              </p>
            ) : null}
            <p className="stwp-note">{copy.approvalNote}</p>
          </section>

          <section className="stwp-sec">
            <h2 className="stwp-jp">{copy.secInsurance}</h2>
            <div className="stwp-rows">
              {years.map((year) => {
                const value = rates[String(year)];
                const editing = editYear === year;
                // 편집 중이면 입력 검사 오류까지, 닫힌 줄이면 그 해의 서버 오류만(늦게 온 실패도 그 줄에 보인다).
                const rowError = editing ? rateErrorText : viewOf(`rate-${year}`).error;
                const rowErrorId = `stwp-rate-err-${year}`;
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
                          className={`stwp-rate num${rowError ? " is-bad" : ""}`}
                          inputMode="decimal"
                          autoFocus
                          value={editText}
                          aria-invalid={Boolean(rowError)}
                          aria-describedby={rowError ? rowErrorId : undefined}
                          aria-label={fillCopy(copy.yearLabel, { y: year })}
                          onChange={(e) => {
                            setEditText(e.target.value);
                            setEditError(false);
                            touch(`rate-${year}`);
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
                          {savedMark(`rate-${year}`)}
                        </span>
                        <button
                          type="button"
                          className="stw-link stwp-act"
                          onClick={() => startEdit(year)}
                          aria-describedby={rowError ? rowErrorId : undefined}
                        >
                          {value === undefined ? copy.insuranceRateEnter : copy.edit}
                        </button>
                      </>
                    )}
                    {rowError ? (
                      <p className="stwp-note is-red stwp-rowerr" id={rowErrorId} role="alert">
                        {rowError}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="stwp-side" aria-label={copy.upcomingTitle}>
          <span className="stwp-next__k">{fillCopy(copy.nextPayHead, { m: fillCopy(copy.monthFor, { m: m(next.workYm) }) })}</span>
          <p className="stwp-next">
            <b className="num">{fillCopy(copy.payDateBig, { m: m(next.date.slice(0, 7)), d: dayOf(next.date) })}</b>
            <span>{nextWeekday}</span>
          </p>
          <span className="stwp-next__sub num">
            {daysLeft <= 0 ? copy.daysToday : daysLeft === 1 ? copy.daysTomorrow : fillCopy(copy.daysUntil, { n: daysLeft })}
            {shiftReason(next) ? ` · ${shiftReason(next)}` : ""}
          </span>
          <h3>{copy.laterTitle}</h3>
          <ol className="stwp-pd">
            {later.map((p) => (
              <li key={p.workYm}>
                <span className="stwp-pd__m">{fillCopy(copy.monthFor, { m: m(p.workYm) })}</span>
                <b className="num">
                  {fillCopy(copy.payDate, { m: m(p.date.slice(0, 7)), d: dayOf(p.date), w: weekdayOf(p.date) })}
                </b>
                <span className="stwp-pd__why">{shiftReason(p)}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </>
  );
}
