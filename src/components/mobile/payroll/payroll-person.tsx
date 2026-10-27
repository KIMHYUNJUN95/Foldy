"use client";

import { useId, useState } from "react";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { MemberBankBlock, type BankVariant } from "@/components/shared/payroll-bank/payroll-bank";
import { haptic } from "@/lib/haptics";
import type { PayrollBankCopy } from "@/lib/payroll-bank-i18n";
import { manualFromTotal, type PrepManual, type PrepRow } from "@/lib/payroll-prep";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import { WITHHOLDING_CLASSES, type WithholdingClass } from "@/lib/payroll-settings-rules";
import { initialOf, num, fmtTime } from "./payroll-format";
import { PayrollMoneyField } from "./payroll-money-field";
import { PdfButton, XlsButton } from "./payroll-files";
import type { PayrollToastState } from "./payroll-toast";
import { exportPayslipsReport, exportPayslipsWorkbook } from "@/actions/payroll-exports";

export type PayrollSaveInput = (row: PrepRow, patch: Partial<PrepManual>, field: string) => Promise<PrepManual | null>;

/** 한 사람 급여 — 폰 · 폴드는 하단 시트 안, 태블릿은 오른쪽 칸에 같은 내용을 그린다(시안 PrepSheet-Phone · Prep-Tablet). */
export function PayrollPerson({
  row,
  ym,
  copy,
  localeTag,
  taxYear,
  canManage,
  stale,
  withholdingLabels,
  saveInput,
  saveClass,
  readOnlyNote,
  bank,
  onSlipToast,
}: {
  row: PrepRow;
  ym: string;
  copy: PayrollPrepCopy;
  localeTag: string;
  taxYear: string;
  canManage: boolean;
  /** 저장 뒤 새로 읽는 중 — 계산 줄이 잠깐 옅어진다. */
  stale: boolean;
  withholdingLabels: Record<WithholdingClass, string>;
  saveInput: PayrollSaveInput;
  saveClass: (row: PrepRow, cls: WithholdingClass) => Promise<boolean>;
  /** 읽기 전용일 때 보일 말 — 결재가 시작돼 잠긴 달이면 「결재 중이라 숫자가 잠겨 있어요」(P5). 없으면 `copy.readOnly`. */
  readOnlyNote?: string;
  /** 급여 계좌 묶음 — `payroll.view` 가 있을 때만 넘어온다. */
  bank?: { copy: PayrollBankCopy; variant: BankVariant; onToast: (message: string) => void; onChange: () => void };
  /** 이 사람 명세서만 Excel · PDF(docs/product/39 §6-3). */
  onSlipToast?: (next: Omit<PayrollToastState, "id">) => void;
}) {
  // 저장 응답으로 입력 칸을 바로 맞추고, 서버에서 새 줄이 오면(새로 읽기 · 되돌리기) 그쪽을 따른다.
  const [local, setLocal] = useState<PrepManual | null>(null);
  const [seenRow, setSeenRow] = useState(row);
  if (seenRow !== row) {
    setSeenRow(row);
    setLocal(null);
  }
  const manual = local ?? row.manual;
  const [moreOpen, setMoreOpen] = useState(
    () =>
      row.manual.overtime !== 0 ||
      row.manual.weekend !== 0 ||
      row.manual.yearEndAdjustment !== 0 ||
      row.manual.withholdingOverride != null ||
      Boolean(row.manual.memo) ||
      row.overtime !== 0 ||
      row.weekend !== 0,
  );
  const [overrideOpen, setOverrideOpen] = useState(row.manual.withholdingOverride != null);
  const readOnly = !canManage;

  const field = async (patch: Partial<PrepManual>, label: string) => {
    const saved = await saveInput(row, patch, label);
    if (saved) setLocal(saved);
    return saved !== null;
  };

  const auto = {
    overtime: Math.round(row.auto.overtime),
    weekend: Math.round(row.auto.weekend),
    special: Math.round(row.auto.special),
  };
  const totalOf = (key: "overtime" | "weekend" | "special") => auto[key] + manual[key];
  const totalField = (key: "overtime" | "weekend" | "special", label: string) => (
    <PayrollMoneyField
      label={label}
      value={totalOf(key)}
      readOnly={readOnly}
      signLabel={copy.signToggle}
      hint={auto[key] > 0 ? fillCopy(copy.autoHint, { n: num(auto[key]) }) : undefined}
      onCommit={(next) => field({ [key]: manualFromTotal(next, row.auto[key]) }, label)}
    />
  );

  const methodName = (m: "transfer" | "cash") => (m === "cash" ? copy.cash : copy.transfer);
  const sub = row.withholdingClass ? fillCopy(copy.classLine, { cls: withholdingLabels[row.withholdingClass] }) : "";
  const methodDefault = row.paymentMethodDefault ?? null;
  const methodOverride = manual.paymentMethodOverride ?? null;
  const methodDiffers = methodOverride != null && methodDefault != null && methodOverride !== methodDefault;
  const pickMethod = (m: "transfer" | "cash") => {
    if (row.paymentMethod === m) return;
    haptic("light");
    void field({ paymentMethodOverride: m === methodDefault ? null : m }, copy.monthMethod);
  };

  const monthLabel = (month: string) =>
    new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${month}-15T00:00:00Z`));
  const adjMonths = Array.from({ length: 12 }, (_, i) => shiftMonthKey(ym, -(i + 1)));
  if (manual.prevAdjustmentYm && !adjMonths.includes(manual.prevAdjustmentYm)) adjMonths.push(manual.prevAdjustmentYm);
  const adjOn = manual.prevAdjustment !== 0;

  const kindOptions = [
    { key: "taxable" as const, label: copy.prevAdjustTaxable },
    { key: "commute" as const, label: copy.prevAdjustCommute },
  ];

  const hintOf = (issue: PrepRow["issues"][number]) =>
    issue === "withholding" ? copy.hintWithholding : issue === "katakana" ? copy.hintKatakana : issue === "not_finalized" ? copy.hintNotFinalized : null;

  return (
    <div className="mpp-p">
      <div className="mpp-p__top">
        <span className="mpp-av mpp-av--lg" aria-hidden="true">
          {initialOf(row.name)}
        </span>
        <div className="mpp-p__who">
          <b>{row.name}</b>
          {sub ? <span>{sub}</span> : null}
        </div>
        <div className="mpp-p__net">
          <span>{copy.net}</span>
          <b className={`num${stale ? " is-stale" : ""}`}>{row.net == null ? "—" : `¥${num(row.net)}`}</b>
        </div>
      </div>

      {onSlipToast ? (
        <div className="mpp-slip">
          <span className="mpp-slip__b">
            <b>{copy.slip}</b>
            <small>{copy.slipThis}</small>
          </span>
          <XlsButton
            label={copy.fileXls}
            run={() => exportPayslipsWorkbook(ym, [row.userId])}
            copy={copy}
            showToast={onSlipToast}
            className="mpp-file__btn mpp-file__btn--white"
          />
          <PdfButton
            label={copy.filePdf}
            run={() => exportPayslipsReport(ym, [row.userId])}
            copy={copy}
            showToast={onSlipToast}
            className="mpp-file__btn mpp-file__btn--pri"
          />
        </div>
      ) : null}

      <h3 className="mpp-h4">{copy.monthMethod}</h3>
      <div className="mpp-seg mpp-seg--method" role="radiogroup" aria-label={copy.monthMethod}>
        {(["transfer", "cash"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={row.paymentMethod === m} disabled={readOnly} onClick={() => pickMethod(m)}>
            {methodName(m)}
          </button>
        ))}
      </div>
      {methodDiffers && methodDefault && methodOverride ? (
        <div className="mpp-mdiff">
          <span>{fillCopy(copy.monthMethodDiffers, { base: methodName(methodDefault), method: methodName(methodOverride) })}</span>
          {!readOnly ? (
            <button type="button" className="mpp-lnk mpp-lnk--in" onClick={() => pickMethod(methodDefault)}>
              {copy.monthMethodReset}
            </button>
          ) : null}
        </div>
      ) : null}

      {readOnly ? <p className="mpp-p__ro">{readOnlyNote ?? copy.readOnly}</p> : null}

      {row.issues.length > 0 ? (
        <ul className="mpp-p__issues">
          {row.issues.map((issue) => (
            <li key={issue}>
              <span className="mpp-dot">{copy.issues[issue]}</span>
              {hintOf(issue) ? <small>{hintOf(issue)}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {row.issues.includes("withholding") && canManage ? (
        <div className="mpp-cls" role="radiogroup" aria-label={copy.withholding}>
          {WITHHOLDING_CLASSES.map((cls) => (
            <button
              key={cls}
              type="button"
              role="radio"
              aria-checked={row.withholdingClass === cls}
              onClick={() => {
                haptic("light");
                void saveClass(row, cls);
              }}
            >
              {withholdingLabels[cls]}
            </button>
          ))}
        </div>
      ) : null}

      <h3 className="mpp-h4">{fillCopy(copy.work, { time: fmtTime(copy, row.paidMinutes) })}</h3>
      {row.segments.map((s, i) => (
        <div className="mpp-line" key={`${s.rate}-${i}`}>
          <span>{fillCopy(copy.rateLine, { rate: num(s.rate), time: fmtTime(copy, s.paidMinutes) })}</span>
          <span>{num(s.pay)}</span>
        </div>
      ))}

      <h3 className="mpp-h4">{copy.secAdjust}</h3>
      <div className="mpp-g2">
        {totalField("special", copy.special)}
        <PayrollMoneyField
          label={copy.prevAdjust}
          value={manual.prevAdjustment}
          signed
          readOnly={readOnly}
          signLabel={copy.signToggle}
          onCommit={(next) => field({ prevAdjustment: next }, copy.prevAdjust)}
        />
      </div>
      {adjOn ? (
        <div className="mpp-g2 mpp-g2--adj">
          <div className="mpp-kind" role="radiogroup" aria-label={copy.prevAdjust}>
            {kindOptions.map((k) => (
              <button
                key={k.key}
                type="button"
                role="radio"
                disabled={readOnly}
                aria-checked={manual.prevAdjustmentKind === k.key}
                onClick={() => {
                  if (manual.prevAdjustmentKind === k.key) return;
                  haptic("light");
                  void field({ prevAdjustmentKind: k.key }, k.label);
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
          <span className="mpp-fl mpp-fl--sel">
            <label htmlFor={`adj-ym-${row.userId}`}>{copy.prevAdjustYm}</label>
            <select
              id={`adj-ym-${row.userId}`}
              disabled={readOnly}
              value={manual.prevAdjustmentYm ?? ""}
              onChange={(event) => {
                haptic("light");
                void field({ prevAdjustmentYm: event.target.value || null }, copy.prevAdjustYm);
              }}
            >
              <option value="">{copy.prevAdjustYmPlaceholder}</option>
              {adjMonths.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </span>
        </div>
      ) : null}

      <button type="button" className="mpp-lnk" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
        {moreOpen ? copy.less : copy.more}
      </button>

      {moreOpen ? (
        <div className="mpp-more">
          <div className="mpp-g2">
            {totalField("overtime", copy.overtime)}
            {totalField("weekend", copy.weekend)}
            <PayrollMoneyField
              label={copy.yearEnd}
              value={manual.yearEndAdjustment}
              signed
              readOnly={readOnly}
              signLabel={copy.signToggle}
              onCommit={(next) => field({ yearEndAdjustment: next }, copy.yearEnd)}
            />
          </div>

          {overrideOpen || manual.withholdingOverride != null ? (
            <div className="mpp-g2">
              <PayrollMoneyField
                label={copy.withholdingOverride}
                value={manual.withholdingOverride ?? row.withholding ?? 0}
                readOnly={readOnly}
                signLabel={copy.signToggle}
                hint={copy.withholdingManual}
                onCommit={(next) => field({ withholdingOverride: next }, copy.withholding)}
              />
              <PayrollTextField
                label={copy.overrideReason}
                placeholder={copy.overrideReasonPlaceholder}
                value={manual.withholdingOverrideReason ?? ""}
                readOnly={readOnly}
                onCommit={(next) => field({ withholdingOverrideReason: next || null }, copy.overrideReason)}
              />
              {!readOnly ? (
                <button
                  type="button"
                  className="mpp-lnk mpp-lnk--in"
                  onClick={() => {
                    haptic("light");
                    setOverrideOpen(false);
                    void field({ withholdingOverride: null, withholdingOverrideReason: null }, copy.withholding);
                  }}
                >
                  {copy.withholdingAuto}
                </button>
              ) : null}
            </div>
          ) : !readOnly ? (
            <button
              type="button"
              className="mpp-lnk mpp-lnk--in"
              onClick={() => {
                haptic("light");
                setOverrideOpen(true);
              }}
            >
              {copy.withholdingOverride}
            </button>
          ) : null}

          <div className="mpp-g1">
            <PayrollTextField
              label={copy.memo}
              value={manual.memo ?? ""}
              readOnly={readOnly}
              onCommit={(next) => field({ memo: next || null }, copy.memo)}
            />
          </div>
        </div>
      ) : null}

      <h3 className="mpp-h4">{copy.secResult}</h3>
      <div className={`mpp-res${stale ? " is-stale" : ""}`}>
        <div className="mpp-line">
          <span>
            {copy.gross}
            {row.commute > 0 ? <small>{fillCopy(copy.grossHint, { n: num(row.commute) })}</small> : null}
          </span>
          <span>{num(row.gross)}</span>
        </div>
        <div className="mpp-line">
          <span>
            {copy.withholding}
            <small>{row.withholdingOverridden ? copy.withholdingManual : fillCopy(copy.withholdingHint, { year: taxYear })}</small>
          </span>
          <span>{row.withholding == null ? "—" : num(row.withholding)}</span>
        </div>
        {row.employmentInsurance > 0 ? (
          <div className="mpp-line">
            <span>{copy.employmentInsurance}</span>
            <span>{num(row.employmentInsurance)}</span>
          </div>
        ) : null}
        <div className="mpp-tot">
          <span>
            {copy.net}
            {(row.roundUpYen ?? 0) > 0 ? <small>{fillCopy(copy.roundUp, { n: num(row.roundUpYen ?? 0) })}</small> : null}
          </span>
          <b>{row.net == null ? "—" : num(row.net)}</b>
        </div>
      </div>

      {bank ? (
        <MemberBankBlock key={row.userId} userId={row.userId} copy={bank.copy} localeTag={localeTag} variant={bank.variant} onToast={bank.onToast} onChange={bank.onChange} />
      ) : null}
    </div>
  );
}

/** 글 칸(사유 · 메모) — 포커스를 떠나면 바뀐 때만 저장. 위 왼쪽에 걸친 이름은 금액 칸과 같다. */
function PayrollTextField({
  label,
  value,
  placeholder,
  readOnly,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  readOnly: boolean;
  onCommit: (next: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(null);
  }
  const id = useId();
  return (
    <span className="mpp-fl mpp-fl--text">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        maxLength={200}
        readOnly={readOnly}
        placeholder={placeholder}
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const next = draft.trim();
          if (next === value.trim()) {
            setDraft(null);
            return;
          }
          void onCommit(next).then((ok) => {
            if (!ok) setDraft(null);
          });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </span>
  );
}
