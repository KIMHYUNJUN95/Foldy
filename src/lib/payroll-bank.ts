/**
 * 알바 급여 — 급여 계좌 순수 규칙(서버 · 화면 공용, DB 없음). docs/product/39 §3-A 「급여 계좌」.
 *
 * - 칸: 은행 · 지점 · 종류(보통 / 당좌) · 번호(숫자 7자리, 짧으면 앞을 0으로 채움) · 명의(가타카나 — 히라가나 · 반각은 바꿔 받음).
 * - 본인이 바꾸면 `pending` — 확인 전 이체는 마지막으로 확인한 계좌(없으면 지금 값)로 보낸다(2026-10-26 결정 3).
 * - 보기: 본인 + `payroll.view`. 목록에선 끝 4자리만, 패널 · 이체 목록에선 전체.
 */

export type BankAccountType = "ordinary" | "current";
export const BANK_ACCOUNT_TYPES: readonly BankAccountType[] = ["ordinary", "current"];

export type BankAccount = {
  bankName: string;
  branchName: string;
  accountType: BankAccountType;
  /** 숫자 7자리. */
  accountNumber: string;
  holderKana: string;
};

export type MemberBank = {
  /** 지금 적힌 계좌(본인이 바꿨으면 확인 전 값). */
  current: BankAccount;
  /** 본인이 바꾸고 아직 급여 담당이 확인하지 않음. */
  pending: boolean;
  /** 마지막으로 확인한 계좌 — 처음부터 본인이 적고 아직 확인 전이면 null. */
  confirmed: BankAccount | null;
  updatedAt: string;
};

export type BankChange = {
  at: string;
  kind: "created" | "updated" | "confirmed";
  bySelf: boolean;
  changedByName: string | null;
  prevBankName: string | null;
  prevLast4: string | null;
  newBankName: string | null;
  newLast4: string | null;
};

/** 이체에 쓰는 계좌 — 확인 전이면 이전에 확인한 계좌, 그것도 없으면 지금 값. */
export function usableAccount(bank: MemberBank): BankAccount {
  return bank.pending && bank.confirmed ? bank.confirmed : bank.current;
}

export function last4(accountNumber: string): string {
  return accountNumber.slice(-4);
}

export function maskedNumber(accountNumber: string): string {
  return `•••${last4(accountNumber)}`;
}

const MAX_NAME = 60;
const MAX_HOLDER = 80;

function cleanName(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= max ? t : null;
}

/** 히라가나 → 가타카나(NFKC 뒤) — 명의는 통장처럼 가타카나로 받는다. */
function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

const HOLDER_RE = /^[ァ-ヺー・ ().]+$/;

export type BankField = "bankName" | "branchName" | "accountType" | "accountNumber" | "holderKana";

export type BankInputResult = { ok: true; account: BankAccount } | { ok: false; field: BankField };

/** 화면 · 액션 입력 검사 — 전각 숫자 · 공백 · 하이픈 허용, 7자리보다 짧으면 앞을 0으로. */
export function parseBankInput(raw: unknown): BankInputResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const bankName = cleanName(r.bankName, MAX_NAME);
  if (!bankName) return { ok: false, field: "bankName" };
  const branchName = cleanName(r.branchName, MAX_NAME);
  if (!branchName) return { ok: false, field: "branchName" };
  if (r.accountType !== "ordinary" && r.accountType !== "current") return { ok: false, field: "accountType" };
  const digits = typeof r.accountNumber === "string" ? r.accountNumber.normalize("NFKC").replace(/[\s-]/g, "") : "";
  if (!/^\d{1,7}$/.test(digits)) return { ok: false, field: "accountNumber" };
  const holderRaw = cleanName(r.holderKana, MAX_HOLDER);
  const holderKana = holderRaw ? toKatakana(holderRaw) : null;
  if (!holderKana || !HOLDER_RE.test(holderKana)) return { ok: false, field: "holderKana" };
  return {
    ok: true,
    account: { bankName, branchName, accountType: r.accountType, accountNumber: digits.padStart(7, "0"), holderKana },
  };
}

export function sameAccount(a: BankAccount | null, b: BankAccount | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.bankName === b.bankName &&
    a.branchName === b.branchName &&
    a.accountType === b.accountType &&
    a.accountNumber === b.accountNumber &&
    a.holderKana === b.holderKana
  );
}

/** 유초은행인지 — 입력 칸에 「이체용 지점명 · 7자리」 안내 한 줄을 띄울 때(은행 이름은 데이터라 일본어 그대로 본다). */
export function isYuchoBank(bankName: string): boolean {
  return /ゆうちょ|ユウチョ|郵便貯金|유초|yucho|japan post/i.test(bankName.normalize("NFKC"));
}
