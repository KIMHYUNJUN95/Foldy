"use client";

import { useRef, useState } from "react";
import { ChevronRight, Info, Minus, Plus } from "lucide-react";
import { saveMemberPayrollSetting } from "@/actions/payroll-settings";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { bankSummary, MemberBankBlock } from "@/components/shared/payroll-bank/payroll-bank";
import { DatePickerSheet } from "@/components/shell/date-picker-sheet";
import { haptic } from "@/lib/haptics";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { MemberBank } from "@/lib/payroll-bank";
import type { PayrollBankCopy } from "@/lib/payroll-bank-i18n";
import { fillCopy, withholdingLabel, type PayrollSettingsCopy } from "@/lib/payroll-settings-i18n";
import type { MemberPayrollPanel } from "@/lib/payroll-settings-server";
import {
  MAX_DEPENDENTS,
  WITHHOLDING_CLASSES,
  payrollIssues,
  type MemberPayrollSetting,
  type PaymentMethod,
  type WithholdingClass,
} from "@/lib/payroll-settings-rules";
import { MobileUsersToast, type UsersToast } from "./mobile-users-toast";

type Patch = Partial<MemberPayrollSetting>;

const dotDate = (key: string) => key.replace(/-/g, ".");
const shortDate = (key: string) => key.slice(2).replace(/-/g, ".");

/** 모바일 멤버 상세 「급여 설정」 구역 — 고르면 바로 저장 + 되돌리기(docs/product/39 §3-A). 폭 대응은 mobile-users.css `.mpay-*`. */
export function MemberPayrollSection({
  panel,
  copy,
  bankCopy,
  locale,
  memberName,
  today,
}: {
  panel: MemberPayrollPanel;
  copy: PayrollSettingsCopy;
  bankCopy: PayrollBankCopy;
  locale: Locale;
  memberName: string;
  today: string;
}) {
  const { userId, employment, currentRate, currentFrom, view } = panel;
  const [setting, setSetting] = useState<MemberPayrollSetting>(view.setting);
  const [toast, setToast] = useState<UsersToast | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [bank, setBank] = useState<MemberBank | null>(panel.bank.summary);
  const [bankOpen, setBankOpen] = useState(false);
  // 저장이 겹치면 늦게 끝난 옛 응답이 화면을 덮지 않게, 마지막 요청만 서버 값을 반영한다.
  const seq = useRef(0);
  const c = getDictionary(locale).admin.users.console;

  const show = (next: Omit<UsersToast, "id">) => setToast((prev) => ({ ...next, id: (prev?.id ?? 0) + 1 }));

  const issues = payrollIssues({
    hourly: employment === "hourly",
    setting,
    nameKatakana: view.nameKatakana,
    hireDate: view.hireDate,
    today,
  });
  const needCount = issues.length;

  const send = async (patch: Patch, prev: Patch, undo: boolean, message: string) => {
    const mine = ++seq.current;
    const before = setting;
    setSetting((s) => ({ ...s, ...patch }));
    const res = await saveMemberPayrollSetting({ userId, patch }).catch(() => ({ ok: false as const, reason: "error" as const }));
    if (!res.ok) {
      if (mine === seq.current) setSetting(before);
      haptic("error");
      show({ kind: "bad", text: res.reason === "forbidden" ? copy.errorForbidden : copy.errorSave });
      return;
    }
    if (mine === seq.current) setSetting(res.setting);
    if (undo) show({ kind: "done", text: copy.toastUndone });
    else show({ kind: "undo", text: message, onUndo: () => void send(prev, patch, true, "") });
  };

  const change = (patch: Patch, field: string, value: string) => {
    const prev: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as (keyof Patch)[]) prev[key] = setting[key];
    haptic("light");
    void send(patch, prev as Patch, false, fillCopy(copy.toastSaved, { name: memberName, field, value }));
  };

  const methodLabel = (m: PaymentMethod) => (m === "cash" ? copy.cash : copy.transfer);
  const helpOf = (k: WithholdingClass) => (k === "kou" ? copy.kouHelp : k === "otsu" ? copy.otsuHelp : copy.heiHelp);
  const heiOver = issues.includes("hei_over");
  const heiNoHire = issues.includes("hei_no_hire_date");

  const header = (
    <>
      <h2 className="muw-sec">
        {copy.sectionTitle}
        {needCount > 0 ? <span className="mpay-miss">{fillCopy(copy.needsCheck, { n: needCount })}</span> : null}
      </h2>
      {employment === "salaried" ? null : <p className="muw-note">{copy.savesInstantly}</p>}
    </>
  );

  if (employment === "salaried") {
    return (
      <section className="mpay" aria-label={copy.sectionTitle}>
        {header}
        <p className="mpay-dim">{copy.salariedNote}</p>
      </section>
    );
  }

  return (
    <section className="mpay" aria-label={copy.sectionTitle}>
      {header}
      <div className="mpay-g">
        {currentRate !== null ? (
          <div className="mpay-kv">
            <span>{copy.hourlyRate}</span>
            <span className="mpay-val">
              {currentFrom ? <small>{fillCopy(copy.rateFrom, { date: shortDate(currentFrom) })}</small> : null}
              <b className="num">¥{currentRate.toLocaleString("en-US")}</b>
            </span>
          </div>
        ) : null}
        <div className="mpay-kv">
          <span>{copy.hireDate}</span>
          <span className={`mpay-val num${view.hireDate ? "" : " is-dim"}`}>{view.hireDate ? dotDate(view.hireDate) : copy.hireDateMissing}</span>
        </div>

        <div className="mpay-kv">
          <span>{copy.paymentMethod}</span>
          <div className="muw-seg" role="radiogroup" aria-label={copy.paymentMethod}>
            {(["cash", "transfer"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={setting.paymentMethod === m}
                onClick={() => {
                  if (setting.paymentMethod !== m) change({ paymentMethod: m }, copy.paymentMethod, methodLabel(m));
                }}
              >
                {methodLabel(m)}
              </button>
            ))}
          </div>
        </div>
        {!setting.paymentMethod ? (
          <p className="mpay-hint">
            <span className="mpay-miss">{copy.pickOne}</span>
          </p>
        ) : null}

        <div className="mpay-kv">
          <span>{copy.withholding}</span>
          <div className="muw-seg" role="radiogroup" aria-label={copy.withholding}>
            {WITHHOLDING_CLASSES.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={setting.withholdingClass === k}
                onClick={() => {
                  if (setting.withholdingClass !== k) change({ withholdingClass: k }, copy.withholding, withholdingLabel(copy, k));
                }}
              >
                {withholdingLabel(copy, k)}
              </button>
            ))}
          </div>
        </div>
        <p className="mpay-hint">
          {setting.withholdingClass ? (
            helpOf(setting.withholdingClass)
          ) : (
            <>
              <span className="mpay-miss">{copy.pickOne}</span>
              <br />
              {copy.allClassesHelp}
            </>
          )}
        </p>
        {heiOver || heiNoHire ? (
          <p className="mpay-err" role="alert">
            <Info aria-hidden="true" />
            <span>{heiOver && view.hireDate ? fillCopy(copy.heiOverError, { date: dotDate(view.hireDate) }) : copy.heiNoHireDateError}</span>
          </p>
        ) : null}

        {setting.withholdingClass === "kou" ? (
          <div className="mpay-kv">
            <span>{copy.dependents}</span>
            <div className="mpay-step">
              <button
                type="button"
                aria-label={copy.dependentsMinus}
                disabled={setting.dependents <= 0}
                onClick={() => change({ dependents: setting.dependents - 1 }, copy.dependents, String(setting.dependents - 1))}
              >
                <Minus aria-hidden="true" />
              </button>
              <b className="num" aria-live="polite">
                {setting.dependents}
              </b>
              <button
                type="button"
                aria-label={copy.dependentsPlus}
                disabled={setting.dependents >= MAX_DEPENDENTS}
                onClick={() => change({ dependents: setting.dependents + 1 }, copy.dependents, String(setting.dependents + 1))}
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        <div className="mpay-kv">
          <span>{copy.katakana}</span>
          {view.nameKatakana?.trim() ? (
            <span className="mpay-val mpay-jp">{view.nameKatakana}</span>
          ) : (
            <span className="mpay-val mpay-miss">{copy.katakanaMissing}</span>
          )}
        </div>

        <div className="mpay-kv">
          <span>{copy.employmentInsurance}</span>
          <button
            type="button"
            role="switch"
            aria-checked={setting.employmentInsurance}
            aria-label={copy.employmentInsurance}
            className="muw-sw"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              const next = !setting.employmentInsurance;
              change({ employmentInsurance: next }, copy.employmentInsurance, next ? copy.insuranceOn : copy.insuranceOff);
            }}
          >
            <i />
          </button>
        </div>
        {setting.employmentInsurance ? (
          <div className="mpay-kv">
            <span>{copy.insuranceSince}</span>
            <button type="button" className="mpay-pick" aria-haspopup="dialog" onClick={() => setDateOpen(true)}>
              <span className={`num${setting.employmentInsuranceSince ? "" : " is-dim"}`}>
                {setting.employmentInsuranceSince ? dotDate(setting.employmentInsuranceSince) : copy.insuranceSincePick}
              </span>
              <ChevronRight className="muw-chev" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {panel.bank.canView ? (
          <button type="button" className="mpay-kv mpay-bankrow" aria-haspopup="dialog" onClick={() => setBankOpen(true)}>
            <span>{bankCopy.title}</span>
            <span className={`mpay-val${bank ? " mpay-jp" : " is-dim"}`}>
              <span className="mpay-bankv">
                <span>{bankSummary(bank) ?? bankCopy.empty}</span>
                {bank?.pending ? <small className="mpay-bankpend">{bankCopy.pendingShort}</small> : null}
              </span>
            </span>
            <ChevronRight className="muw-chev" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {bankOpen ? (
        <BottomSheet ariaLabel={bankCopy.title} onClose={() => setBankOpen(false)}>
          <div className="mpay-banksheet">
            <MemberBankBlock
              userId={userId}
              copy={bankCopy}
              localeTag={locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US"}
              variant="sheet"
              onChange={setBank}
              onToast={(text) => show({ kind: "done", text })}
            />
          </div>
        </BottomSheet>
      ) : null}

      {dateOpen ? (
        <DatePickerSheet
          value={setting.employmentInsuranceSince ?? today}
          today={today}
          locale={locale}
          labels={{ title: copy.insuranceSince, prevMonth: c.datePrev, nextMonth: c.dateNext, today: c.dateToday }}
          onClose={() => setDateOpen(false)}
          onSelect={(date) => {
            setDateOpen(false);
            if (date !== setting.employmentInsuranceSince) change({ employmentInsuranceSince: date }, copy.insuranceSince, dotDate(date));
          }}
        />
      ) : null}
      {toast ? <MobileUsersToast key={toast.id} toast={toast} undoLabel={copy.undo} onDismiss={() => setToast(null)} /> : null}
    </section>
  );
}
