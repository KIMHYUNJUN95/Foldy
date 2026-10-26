"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Copy } from "lucide-react";
import { confirmMemberBank, getMemberBank, saveMemberBank, type MemberBankDetail } from "@/actions/payroll-bank";
import { haptic } from "@/lib/haptics";
import {
  BANK_ACCOUNT_TYPES,
  isYuchoBank,
  maskedNumber,
  parseBankInput,
  usableAccount,
  type BankAccount,
  type BankAccountType,
  type BankChange,
  type BankField,
  type MemberBank,
} from "@/lib/payroll-bank";
import { bankTypeLabel, type PayrollBankCopy } from "@/lib/payroll-bank-i18n";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import "./payroll-bank.css";

/**
 * 급여 계좌 공용 화면 조각(시안 6PcLUew4… — 통장 한 줄 · 확인 전 알림 · 바뀐 기록 · 다섯 칸 입력).
 * `variant`: "panel" = PC 패널 · 태블릿 칸(작은 버튼), "sheet" = 폰 하단 시트(큰 버튼, 세로로 쌓음). docs/product/39 §3-A
 */

export type BankVariant = "panel" | "sheet";

const TOKYO = "Asia/Tokyo";

export function formatBankDay(iso: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, { month: "long", day: "numeric", timeZone: TOKYO }).format(new Date(iso));
}

function historyDay(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TOKYO })
    .format(new Date(iso))
    .split("-");
  const thisYear = new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: TOKYO }).format(new Date());
  return parts[0] === thisYear ? `${parts[1]}.${parts[2]}` : `${parts[0]}.${parts[1]}.${parts[2]}`;
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 권한 없음 — 아래 false
  }
  return false;
}

/** 통장 한 줄 — 은행 지점 / 종류 번호 + 복사 / 명의. */
export function BankBook({
  account,
  copy,
  onCopied,
}: {
  account: BankAccount;
  copy: PayrollBankCopy;
  onCopied?: (ok: boolean) => void;
}) {
  return (
    <div className="pbk-book">
      <div className="pbk-book__b pbk-jp">
        {account.bankName} {account.branchName}
      </div>
      <div className="pbk-book__n">
        <span>
          {bankTypeLabel(copy, account.accountType)} {account.accountNumber}
        </span>
        <button
          type="button"
          className="pbk-copy"
          aria-label={copy.copy}
          onClick={async () => {
            const ok = await copyText(account.accountNumber);
            haptic(ok ? "light" : "error");
            onCopied?.(ok);
          }}
        >
          <Copy aria-hidden="true" />
        </button>
      </div>
      <div className="pbk-book__h pbk-jp">{account.holderKana}</div>
    </div>
  );
}

export function BankHistoryList({ history, copy }: { history: readonly BankChange[]; copy: PayrollBankCopy }) {
  if (history.length === 0) return null;
  return (
    <>
      <div className="pbk-hist__t">{copy.historyTitle}</div>
      <ul className="pbk-hist">
        {history.map((h, i) => {
          const who = h.bySelf ? copy.hSelf : (h.changedByName ?? "—");
          const what =
            h.kind === "confirmed"
              ? copy.hConfirmed
              : h.kind === "created" || !h.prevBankName || !h.prevLast4
                ? copy.hCreated
                : fillCopy(copy.hUpdated, { bank: h.prevBankName, last4: `•••${h.prevLast4}` });
          return (
            <li key={i}>
              <time dateTime={h.at}>{historyDay(h.at)}</time>
              <span>
                {who} · <span className="pbk-jp">{what}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function errorOf(copy: PayrollBankCopy, field: BankField): string {
  switch (field) {
    case "bankName":
      return copy.errBankName;
    case "branchName":
      return copy.errBranchName;
    case "accountType":
      return copy.errAccountType;
    case "accountNumber":
      return copy.errAccountNumber;
    default:
      return copy.errHolderKana;
  }
}

export type BankSubmit = (account: BankAccount) => Promise<{ ok: true } | { ok: false; field?: BankField; message?: string }>;

/** 다섯 칸 입력 — 저장 전에 화면에서 한 번 거르고, 서버가 같은 규칙으로 다시 거른다. */
export function BankForm({
  initial,
  copy,
  hint,
  variant,
  onSubmit,
  onCancel,
}: {
  initial: BankAccount | null;
  copy: PayrollBankCopy;
  hint: string;
  variant: BankVariant;
  onSubmit: BankSubmit;
  onCancel?: () => void;
}) {
  const uid = useId();
  const [bankName, setBankName] = useState(initial?.bankName ?? "");
  const [branchName, setBranchName] = useState(initial?.branchName ?? "");
  const [accountType, setAccountType] = useState<BankAccountType>(initial?.accountType ?? "ordinary");
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? "");
  const [holderKana, setHolderKana] = useState(initial?.holderKana ?? "");
  const [bad, setBad] = useState<BankField | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = (k: string) => `${uid}-${k}`;
  const yucho = isYuchoBank(bankName);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = parseBankInput({ bankName, branchName, accountType, accountNumber, holderKana });
    if (!parsed.ok) {
      setBad(parsed.field);
      haptic("error");
      document.getElementById(id(parsed.field))?.focus();
      return;
    }
    setBad(null);
    setFailed(null);
    setBusy(true);
    const res = await onSubmit(parsed.account);
    setBusy(false);
    if (!res.ok) {
      if (res.field) setBad(res.field);
      setFailed(res.field ? null : (res.message ?? copy.errSave));
      haptic("error");
    }
  }

  const field = (
    key: Exclude<BankField, "accountType">,
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { help?: string; numeric?: boolean; jp?: boolean; auto?: string } = {},
  ) => (
    <span className="pbk-fl">
      <label htmlFor={id(key)}>{label}</label>
      <input
        id={id(key)}
        className={`${opts.numeric ? "num" : ""}${opts.jp ? " pbk-jp" : ""}`}
        value={value}
        inputMode={opts.numeric ? "numeric" : undefined}
        autoComplete={opts.auto ?? "off"}
        maxLength={opts.numeric ? 9 : 80}
        aria-invalid={bad === key ? "true" : undefined}
        aria-describedby={bad === key || opts.help ? id(`${key}-h`) : undefined}
        onChange={(e) => {
          set(e.target.value);
          if (bad === key) setBad(null);
        }}
      />
      {bad === key ? (
        <small id={id(`${key}-h`)} className="err" role="alert">
          {errorOf(copy, key)}
        </small>
      ) : opts.help ? (
        <small id={id(`${key}-h`)}>{opts.help}</small>
      ) : null}
    </span>
  );

  const typeSeg = (
    <span className="pbk-seg" role="radiogroup" aria-label={copy.accountType}>
      {BANK_ACCOUNT_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={accountType === t}
          onClick={() => {
            if (accountType !== t) haptic("light");
            setAccountType(t);
          }}
        >
          {bankTypeLabel(copy, t)}
        </button>
      ))}
    </span>
  );

  return (
    <form className="pbk-form" onSubmit={submit} noValidate>
      <p className="pbk-form__hint">{hint}</p>
      {variant === "panel" ? (
        <div className="pbk-g2">
          {field("bankName", copy.bankName, bankName, setBankName, { jp: true, help: yucho ? copy.yuchoHint : undefined })}
          {field("branchName", copy.branchName, branchName, setBranchName, { jp: true })}
        </div>
      ) : (
        <>
          {field("bankName", copy.bankName, bankName, setBankName, { jp: true, help: yucho ? copy.yuchoHint : undefined })}
          {field("branchName", copy.branchName, branchName, setBranchName, { jp: true })}
        </>
      )}
      <div className="pbk-type">
        {typeSeg}
        {field("accountNumber", copy.accountNumber, accountNumber, setAccountNumber, {
          numeric: true,
          help: copy.accountNumberHint,
        })}
      </div>
      {field("holderKana", copy.holderKana, holderKana, setHolderKana, { jp: true, help: copy.holderHint })}
      {failed ? (
        <p className="pbk-err" role="alert">
          {failed}
        </p>
      ) : null}
      <div className="pbk-actions">
        {onCancel && variant === "panel" ? (
          <button type="button" className="pbk-btn pbk-btn--2" onClick={onCancel}>
            {copy.cancel}
          </button>
        ) : null}
        <button type="submit" className="pbk-btn" disabled={busy}>
          {copy.save}
        </button>
      </div>
    </form>
  );
}

/** 확인 전 알림 — 관리자 쪽(확인함 버튼) / 본인 쪽(확인 중 한 줄). */
export function BankPendingNote({
  bank,
  copy,
  localeTag,
  onConfirm,
  busy,
}: {
  bank: MemberBank;
  copy: PayrollBankCopy;
  localeTag: string;
  onConfirm?: () => void;
  busy?: boolean;
}) {
  if (!bank.pending) return null;
  const date = formatBankDay(bank.updatedAt, localeTag);
  const prev = bank.confirmed;
  return (
    <div className="pbk-note">
      <span className="pbk-note__t">
        <b>{fillCopy(prev ? copy.pendingAdmin : copy.pendingFirst, { date })}</b>
        <span>
          {prev
            ? fillCopy(copy.pendingAdminSub, { prev: `${prev.bankName} ${maskedNumber(prev.accountNumber)}` })
            : copy.pendingFirstSub}
        </span>
      </span>
      {onConfirm ? (
        <button type="button" className="pbk-btn" disabled={busy} onClick={onConfirm}>
          {copy.confirm}
        </button>
      ) : null}
    </div>
  );
}

/**
 * 관리자가 한 사람 계좌를 보는 묶음 — 머리(급여 계좌 · 바꾸기) · 확인 전 알림 · 통장 · 바뀐 기록 · 바꾸기 폼.
 * `initial` 이 없으면 열 때 읽는다. `onToast` 로 결과를 알리고, `onChange` 로 바뀐 계좌를 부모에 돌려준다(목록 표시 갱신).
 */
export function MemberBankBlock({
  userId,
  copy,
  localeTag,
  variant,
  initial,
  onToast,
  onChange,
  hideTitle,
}: {
  userId: string;
  copy: PayrollBankCopy;
  localeTag: string;
  variant: BankVariant;
  initial?: MemberBankDetail | null;
  onToast?: (message: string) => void;
  onChange?: (bank: MemberBank | null) => void;
  /** 시트 머리에 이미 「급여 계좌」가 있으면 숨김. */
  hideTitle?: boolean;
}) {
  const [detail, setDetail] = useState<MemberBankDetail | null>(initial ?? null);
  const [state, setState] = useState<"loading" | "ready" | "failed">(initial ? "ready" : "loading");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seenUser, setSeenUser] = useState(userId);
  if (seenUser !== userId) {
    setSeenUser(userId);
    setDetail(initial ?? null);
    setState(initial ? "ready" : "loading");
    setEditing(false);
  }

  useEffect(() => {
    if (initial) return;
    let alive = true;
    void getMemberBank({ userId }).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setDetail(res);
        setState("ready");
      } else setState("failed");
    });
    return () => {
      alive = false;
    };
  }, [userId, initial]);

  const apply = (next: MemberBankDetail) => {
    setDetail(next);
    onChange?.(next.bank);
  };

  if (state === "loading") return <div className={`pbk pbk--${variant}`}><p className="pbk-empty">{copy.loading}</p></div>;
  if (state === "failed" || !detail) {
    return (
      <div className={`pbk pbk--${variant}`}>
        <p className="pbk-empty">{copy.loadFailed}</p>
      </div>
    );
  }

  const bank = detail.bank;
  return (
    <div className={`pbk pbk--${variant}`}>
      {hideTitle && !detail.canEdit ? null : (
        <div className="pbk-head">
          <span>{hideTitle ? "" : copy.title}</span>
          {detail.canEdit && !editing ? (
            <button type="button" className="pbk-lnk" onClick={() => setEditing(true)}>
              {bank ? copy.edit : copy.add}
            </button>
          ) : null}
        </div>
      )}
      {editing ? (
        <BankForm
          initial={bank?.current ?? null}
          copy={copy}
          hint={copy.adminHint}
          variant={variant}
          onCancel={() => setEditing(false)}
          onSubmit={async (account) => {
            const res = await saveMemberBank({ userId, account });
            if (!res.ok) {
              return {
                ok: false as const,
                field: res.field,
                message: res.reason === "forbidden" ? copy.errForbidden : copy.errSave,
              };
            }
            haptic("success");
            apply(res);
            setEditing(false);
            onToast?.(copy.savedToast);
            return { ok: true as const };
          }}
        />
      ) : bank ? (
        <>
          <BankBook account={bank.current} copy={copy} onCopied={(ok) => onToast?.(ok ? copy.copied : copy.errSave)} />
          <BankPendingNote
            bank={bank}
            copy={copy}
            localeTag={localeTag}
            busy={busy}
            onConfirm={
              detail.canConfirm
                ? async () => {
                    setBusy(true);
                    const res = await confirmMemberBank({ userId });
                    setBusy(false);
                    if (!res.ok) {
                      haptic("error");
                      onToast?.(copy.errSave);
                      return;
                    }
                    haptic("success");
                    apply(res);
                    onToast?.(copy.confirmedToast);
                  }
                : undefined
            }
          />
          <BankHistoryList history={detail.history} copy={copy} />
        </>
      ) : (
        <p className="pbk-empty">{copy.empty}</p>
      )}
    </div>
  );
}

/** 목록 한 줄용 요약 — 「りそな銀行 •••8812」. 확인 전이면 새 계좌. */
export function bankSummary(bank: MemberBank | null | undefined): string | null {
  if (!bank) return null;
  return `${bank.current.bankName} ${maskedNumber(bank.current.accountNumber)}`;
}

/** 이체에 쓸 계좌(확인 전이면 이전 계좌). */
export { usableAccount };
