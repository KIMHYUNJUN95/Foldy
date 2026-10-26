"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AdminMonthPicker, type AdminMonthPickerLabels } from "../../shared/admin-month-picker";
import { shiftMonthKey } from "../../shared/admin-month-key";
import { manualFromTotal, type PrepManual, type PrepRow } from "@/lib/payroll-prep";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { fillCopy, withholdingLabel, type PayrollSettingsCopy } from "@/lib/payroll-settings-i18n";
import { MemberBankBlock } from "@/components/shared/payroll-bank/payroll-bank";
import type { PayrollBankCopy } from "@/lib/payroll-bank-i18n";
import { formatPrepDay, formatPrepTime, prepInitial } from "./prep-format";
import "./payroll-prep.css";

export type PrepSave = (row: PrepRow, patch: Partial<PrepManual>, field: string) => Promise<boolean>;

function parseYen(text: string, allowNegative: boolean): number | null {
  const t = text.normalize("NFKC").replace(/[,\s]/g, "").replace("−", "-");
  if (t === "" || t === "-") return 0;
  if (!/^-?\d{1,8}$/.test(t)) return null;
  const n = Number(t);
  return !allowNegative && n < 0 ? null : n;
}

function MoneyField({
  id,
  label,
  value,
  onCommit,
  readOnly,
  hint,
  allowNegative = true,
  sign,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (n: number) => Promise<boolean>;
  readOnly: boolean;
  hint?: string;
  allowNegative?: boolean;
  sign?: { negative: boolean; label: string; onToggle: () => void };
}) {
  const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
  const [text, setText] = useState(fmt(value));

  async function commit() {
    const n = parseYen(text, allowNegative);
    if (n == null) return setText(fmt(value));
    setText(fmt(n));
    if (n === value) return;
    if (!(await onCommit(n))) setText(fmt(value));
  }

  return (
    <span className={`ppr-fl${sign ? " has-sign" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {sign ? (
        <button type="button" className="sign" aria-label={sign.label} onClick={sign.onToggle} disabled={readOnly}>
          {sign.negative ? "−" : "+"}
        </button>
      ) : null}
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={text}
        readOnly={readOnly}
        onFocus={(e) => {
          if (readOnly) return;
          setText(value === 0 ? "" : String(value));
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {hint ? <small>{hint}</small> : null}
    </span>
  );
}

function TextField({
  id,
  label,
  value,
  onCommit,
  readOnly,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onCommit: (v: string) => Promise<boolean>;
  readOnly: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  return (
    <span className="ppr-fl">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="txt"
        value={text}
        maxLength={200}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => setText(e.target.value)}
        onBlur={async () => {
          if (text.trim() === value.trim()) return;
          if (!(await onCommit(text))) setText(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </span>
  );
}

export function PayrollPrepPanel({
  row,
  ym,
  payYear,
  canManage,
  copy,
  settings,
  localeTag,
  monthLabels,
  bankCopy,
  canViewBank,
  onBankToast,
  onBankChange,
  onSave,
  onClose,
}: {
  row: PrepRow;
  ym: string;
  payYear: number;
  canManage: boolean;
  copy: PayrollPrepCopy;
  settings: PayrollSettingsCopy;
  localeTag: string;
  monthLabels: AdminMonthPickerLabels;
  bankCopy: PayrollBankCopy;
  canViewBank: boolean;
  onBankToast: (message: string) => void;
  onBankChange: () => void;
  onSave: PrepSave;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const m = row.manual;
  const ro = !canManage;
  const money = new Intl.NumberFormat(localeTag);
  const id = (k: string) => `ppr-${row.userId}-${k}`;
  const hasMore =
    row.overtime !== 0 || row.weekend !== 0 || m.yearEndAdjustment !== 0 || m.withholdingOverride != null || !!m.memo;
  const [more, setMore] = useState(hasMore);
  const [negative, setNegative] = useState(m.prevAdjustment < 0);
  const [pickingYm, setPickingYm] = useState(false);
  const [overriding, setOverriding] = useState(m.withholdingOverride != null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || document.querySelector(".amp__pop")) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = (patch: Partial<PrepManual>, field: string) => onSave(row, patch, field);
  const total = (key: "overtime" | "weekend" | "special", label: string) => (n: number) =>
    save({ [key]: manualFromTotal(n, row.auto[key]) }, label);

  const methodLabel = (x: "transfer" | "cash") => (x === "cash" ? copy.cash : copy.transfer);
  const methodDefault = row.paymentMethodDefault ?? null;
  const methodOverride = m.paymentMethodOverride ?? null;
  const chooseMethod = (next: "transfer" | "cash") => {
    if (next === row.paymentMethod) return;
    void save({ paymentMethodOverride: next === methodDefault ? null : next }, copy.monthMethod);
  };
  const sub = [
    row.withholdingClass ? fillCopy(copy.classLine, { cls: withholdingLabel(settings, row.withholdingClass) }) : null,
  ]
    .filter(Boolean)
    .join(", ");
  const autoHint = (n: number) => (n > 0 ? fillCopy(copy.autoHint, { n: money.format(Math.round(n)) }) : undefined);
  const defaultYm = shiftMonthKey(ym, -1);
  const adjAbs = Math.abs(m.prevAdjustment);

  return (
    <aside className="ppr-panel" aria-label={row.name} ref={ref} tabIndex={-1}>
      <div className="ppr-ph">
        <span className="ppr-av lg" aria-hidden="true">
          {prepInitial(row)}
        </span>
        <div className="ppr-ph__t">
          <b>{row.name}</b>
          <div>{sub}</div>
        </div>
        <button type="button" className="ppr-x44" aria-label={copy.close} onClick={onClose}>
          <X size={19} aria-hidden="true" />
        </button>
      </div>
      {ro ? <p className="ppr-ro">{copy.readOnly}</p> : null}

      <div className="ppr-mm">
        <div className="ppr-mm__r">
          <b>{copy.monthMethod}</b>
          <span className="ppr-pick" role="radiogroup" aria-label={copy.monthMethod}>
            {(["transfer", "cash"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={row.paymentMethod === k}
                disabled={ro}
                onClick={() => chooseMethod(k)}
              >
                {methodLabel(k)}
              </button>
            ))}
          </span>
        </div>
        {methodOverride && methodDefault && methodOverride !== methodDefault ? (
          <div className="ppr-mm__n">
            <span>
              {fillCopy(copy.monthMethodDiffers, { base: methodLabel(methodDefault), method: methodLabel(methodOverride) })}
            </span>
            <button
              type="button"
              className="ppr-lnk"
              disabled={ro}
              onClick={() => void save({ paymentMethodOverride: null }, copy.monthMethod)}
            >
              {copy.monthMethodReset}
            </button>
          </div>
        ) : null}
      </div>

      <h3 className="ppr-h4">{fillCopy(copy.work, { time: formatPrepTime(row.paidMinutes) })}</h3>
      <div>
        {row.segments.map((s, i) => (
          <div className="ppr-row" key={i}>
            <span>
              {fillCopy(copy.rateLine, { rate: money.format(s.rate), time: formatPrepTime(s.paidMinutes) })}
              {i > 0 && s.since ? <small>{fillCopy(copy.rateSince, { date: formatPrepDay(s.since, localeTag) })}</small> : null}
            </span>
            <span>{money.format(s.pay)}</span>
          </div>
        ))}
      </div>

      <h3 className="ppr-h4">{copy.secAdjust}</h3>
      <div className="ppr-g2">
        <MoneyField
          key={`special-${row.special}`}
          id={id("special")}
          label={copy.special}
          value={row.special}
          readOnly={ro}
          hint={autoHint(row.auto.special)}
          onCommit={total("special", copy.special)}
        />
        <MoneyField
          key={`adj-${m.prevAdjustment}-${negative}`}
          id={id("adj")}
          label={copy.prevAdjust}
          value={adjAbs}
          readOnly={ro}
          allowNegative={false}
          sign={{
            negative,
            label: copy.signToggle,
            onToggle: () => {
              const next = !negative;
              setNegative(next);
              if (adjAbs !== 0) void save({ prevAdjustment: next ? -adjAbs : adjAbs }, copy.prevAdjust);
            },
          }}
          onCommit={(n) => save({ prevAdjustment: negative ? -n : n }, copy.prevAdjust)}
        />
      </div>
      <div className="ppr-adjrow">
        <span className="ppr-pick" role="radiogroup" aria-label={copy.prevAdjust}>
          {(["taxable", "commute"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={m.prevAdjustmentKind === k}
              disabled={ro}
              onClick={() => m.prevAdjustmentKind !== k && void save({ prevAdjustmentKind: k }, copy.prevAdjust)}
            >
              {k === "taxable" ? copy.prevAdjustTaxable : copy.prevAdjustCommute}
            </button>
          ))}
        </span>
        <span>{copy.prevAdjustYm}</span>
        {m.prevAdjustmentYm || pickingYm ? (
          <AdminMonthPicker
            ym={m.prevAdjustmentYm ?? defaultYm}
            localeTag={localeTag}
            basePath=""
            labels={monthLabels}
            onSelect={(next) => {
              setPickingYm(false);
              void save({ prevAdjustmentYm: next }, copy.prevAdjustYm);
            }}
          />
        ) : (
          <button type="button" className="ppr-lnk" disabled={ro} onClick={() => setPickingYm(true)}>
            {copy.prevAdjustYmPlaceholder}
          </button>
        )}
      </div>

      {more ? (
        <>
          <div className="ppr-g2">
            <MoneyField
              key={`ot-${row.overtime}`}
              id={id("ot")}
              label={copy.overtime}
              value={row.overtime}
              readOnly={ro}
              hint={autoHint(row.auto.overtime)}
              onCommit={total("overtime", copy.overtime)}
            />
            <MoneyField
              key={`wk-${row.weekend}`}
              id={id("wk")}
              label={copy.weekend}
              value={row.weekend}
              readOnly={ro}
              hint={autoHint(row.auto.weekend)}
              onCommit={total("weekend", copy.weekend)}
            />
            <MoneyField
              key={`ye-${m.yearEndAdjustment}`}
              id={id("ye")}
              label={copy.yearEnd}
              value={m.yearEndAdjustment}
              readOnly={ro}
              onCommit={(n) => save({ yearEndAdjustment: n }, copy.yearEnd)}
            />
            {overriding ? (
              <MoneyField
                key={`wo-${m.withholdingOverride}`}
                id={id("wo")}
                label={copy.withholdingOverride}
                value={m.withholdingOverride ?? row.withholding ?? 0}
                readOnly={ro}
                allowNegative={false}
                onCommit={(n) => save({ withholdingOverride: n }, copy.withholding)}
              />
            ) : (
              <button type="button" className="ppr-lnk" disabled={ro} onClick={() => setOverriding(true)}>
                {copy.withholdingOverride}
              </button>
            )}
          </div>
          {overriding ? (
            <div className="ppr-g1">
              <TextField
                key={`wr-${m.withholdingOverrideReason ?? ""}`}
                id={id("wr")}
                label={copy.overrideReason}
                value={m.withholdingOverrideReason ?? ""}
                placeholder={copy.overrideReasonPlaceholder}
                readOnly={ro}
                onCommit={(v) => save({ withholdingOverrideReason: v.trim() || null }, copy.overrideReason)}
              />
              <button
                type="button"
                className="ppr-lnk"
                disabled={ro}
                onClick={async () => {
                  if (m.withholdingOverride != null || m.withholdingOverrideReason) {
                    await save({ withholdingOverride: null, withholdingOverrideReason: null }, copy.withholding);
                  }
                  setOverriding(false);
                }}
              >
                {copy.withholdingAuto}
              </button>
            </div>
          ) : null}
          <div className="ppr-g1">
            <TextField
              key={`memo-${m.memo ?? ""}`}
              id={id("memo")}
              label={copy.memo}
              value={m.memo ?? ""}
              readOnly={ro}
              onCommit={(v) => save({ memo: v.trim() || null }, copy.memo)}
            />
          </div>
          <button type="button" className="ppr-lnk" onClick={() => setMore(false)}>
            {copy.less}
          </button>
        </>
      ) : (
        <button type="button" className="ppr-lnk" onClick={() => setMore(true)}>
          {copy.more}
        </button>
      )}

      <div className="ppr-res">
        <div className="ppr-row">
          <span>
            {copy.gross}
            {row.commute > 0 ? <small>{fillCopy(copy.grossHint, { n: money.format(row.commute) })}</small> : null}
          </span>
          <span>{money.format(row.gross)}</span>
        </div>
        <div className="ppr-row">
          <span>
            {copy.withholding}
            <small>
              {row.withholdingOverridden ? copy.withholdingManual : fillCopy(copy.withholdingHint, { year: payYear })}
            </small>
          </span>
          <span>{row.withholding == null ? "—" : money.format(row.withholding)}</span>
        </div>
        {row.employmentInsurance > 0 ? (
          <div className="ppr-row">
            <span>{copy.employmentInsurance}</span>
            <span>{money.format(row.employmentInsurance)}</span>
          </div>
        ) : null}
        <div className="ppr-tot">
          <span>
            {copy.net}
            {(row.roundUpYen ?? 0) > 0 ? <small>{fillCopy(copy.roundUp, { n: money.format(row.roundUpYen ?? 0) })}</small> : null}
          </span>
          <b>{row.net == null ? "—" : fillCopy(copy.yen, { n: money.format(row.net) })}</b>
        </div>
      </div>

      {canViewBank ? (
        <MemberBankBlock
          key={row.userId}
          variant="panel"
          userId={row.userId}
          copy={bankCopy}
          localeTag={localeTag}
          onToast={onBankToast}
          onChange={onBankChange}
        />
      ) : null}
    </aside>
  );
}
