import { describe, expect, it } from "vitest";
import { maskedNumber, parseBankInput, sameAccount, usableAccount, type BankAccount } from "@/lib/payroll-bank";
import { getPayrollBankCopy } from "@/lib/payroll-bank-i18n";

/** 급여 계좌 규칙(docs/product/39 §3-A). 계좌는 모두 가짜. */
const base = {
  bankName: "みずほ銀行",
  branchName: "新宿支店",
  accountType: "ordinary",
  accountNumber: "1234567",
  holderKana: "グエン ヴァン アン",
};

describe("parseBankInput", () => {
  it("정상 입력", () => {
    const r = parseBankInput(base);
    expect(r).toEqual({ ok: true, account: base });
  });

  it("전각 숫자 · 하이픈 · 공백을 받고, 짧으면 앞을 0으로", () => {
    const r = parseBankInput({ ...base, accountNumber: "１２-３ ４５" });
    expect(r.ok && r.account.accountNumber).toBe("0012345");
  });

  it("8자리 · 글자 섞인 번호는 거절", () => {
    expect(parseBankInput({ ...base, accountNumber: "12345678" })).toEqual({ ok: false, field: "accountNumber" });
    expect(parseBankInput({ ...base, accountNumber: "12a4567" })).toEqual({ ok: false, field: "accountNumber" });
  });

  it("명의 — 히라가나 · 반각 가타카나는 전각 가타카나로 바꿔 받고, 한글 · 한자는 거절", () => {
    const hira = parseBankInput({ ...base, holderKana: "ぐえん　あん" });
    expect(hira.ok && hira.account.holderKana).toBe("グエン アン");
    const half = parseBankInput({ ...base, holderKana: "ｸﾞｴﾝ ｱﾝ" });
    expect(half.ok && half.account.holderKana).toBe("グエン アン");
    expect(parseBankInput({ ...base, holderKana: "응우옌" })).toEqual({ ok: false, field: "holderKana" });
    expect(parseBankInput({ ...base, holderKana: "山田" })).toEqual({ ok: false, field: "holderKana" });
  });

  it("빈 칸 · 종류는 그 칸으로 알려 준다", () => {
    expect(parseBankInput({ ...base, bankName: "  " })).toEqual({ ok: false, field: "bankName" });
    expect(parseBankInput({ ...base, branchName: "" })).toEqual({ ok: false, field: "branchName" });
    expect(parseBankInput({ ...base, accountType: "savings" })).toEqual({ ok: false, field: "accountType" });
    expect(parseBankInput(null)).toEqual({ ok: false, field: "bankName" });
  });
});

describe("usableAccount — 확인 전엔 이전에 확인한 계좌(결정 3)", () => {
  const prev = base as BankAccount;
  const next: BankAccount = { ...prev, bankName: "りそな銀行", accountNumber: "0098812" };
  it("확인 전 + 이전 계좌 있음 → 이전 계좌", () => {
    expect(usableAccount({ current: next, pending: true, confirmed: prev, updatedAt: "" })).toBe(prev);
  });
  it("처음 등록(확인한 계좌 없음) → 지금 값", () => {
    expect(usableAccount({ current: next, pending: true, confirmed: null, updatedAt: "" })).toBe(next);
  });
  it("확인됨 → 지금 값", () => {
    expect(usableAccount({ current: next, pending: false, confirmed: next, updatedAt: "" })).toBe(next);
  });
  it("가림 · 같은 계좌", () => {
    expect(maskedNumber("0098812")).toBe("•••8812");
    expect(sameAccount(prev, { ...prev })).toBe(true);
    expect(sameAccount(prev, next)).toBe(false);
    expect(sameAccount(null, null)).toBe(true);
  });
});

describe("문구", () => {
  it("세 언어 키가 같다", () => {
    const keys = Object.keys(getPayrollBankCopy("ko")).sort();
    expect(Object.keys(getPayrollBankCopy("ja")).sort()).toEqual(keys);
    expect(Object.keys(getPayrollBankCopy("en")).sort()).toEqual(keys);
    expect(getPayrollBankCopy("xx")).toBe(getPayrollBankCopy("ko"));
  });
});

describe("isYuchoBank", () => {
  it("유초은행 이름을 알아본다", async () => {
    const { isYuchoBank } = await import("@/lib/payroll-bank");
    expect(isYuchoBank("ゆうちょ銀行")).toBe(true);
    expect(isYuchoBank("ﾕｳﾁｮ")).toBe(true); // 반각도 NFKC 로
    expect(isYuchoBank("Japan Post Bank")).toBe(true);
    expect(isYuchoBank("三井住友銀行")).toBe(false);
  });
});
