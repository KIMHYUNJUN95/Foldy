import { describe, expect, it } from "vitest";
import {
  anyPaymentCheck,
  canRequestApproval,
  checkAt,
  checkFitsMethod,
  currentSlot,
  EMPTY_PAYMENT_CHECK,
  firstApprovalStatus,
  isRoundLocked,
  paidCount,
  parseRoundStatus,
  parseSnapshot,
  paymentDone,
  statusAfterApprove,
} from "@/lib/payroll-approval";
import { stampText } from "@/lib/payroll-export/payroll-book";
import type { PrepRow, PrepTotals } from "@/lib/payroll-prep";

/** 알바 급여 P5 — 결재 · 지급 확인 규칙(docs/product/40 §4-3 ~ §6). 사람은 가짜. */

const row = (userId: string, paymentMethod: PrepRow["paymentMethod"], finalized = true) =>
  ({ userId, paymentMethod, finalized }) as PrepRow;
const totals = (needsCheck = 0, uncalculated = 0) => ({ needsCheck, uncalculated }) as PrepTotals;
const at = "2026-11-09T01:00:00Z";

describe("payroll round status", () => {
  it("모르는 값은 급여 준비", () => {
    expect(parseRoundStatus("paying")).toBe("paying");
    expect(parseRoundStatus("nope")).toBe("preparing");
    expect(parseRoundStatus(null)).toBe("preparing");
  });

  it("결재 요청 뒤부터 잠긴다", () => {
    expect(isRoundLocked("preparing")).toBe(false);
    for (const s of ["approval_senmu", "approval_president", "paying", "paid", "sent_to_accountant"] as const) {
      expect(isRoundLocked(s)).toBe(true);
    }
  });

  it("전무 결재자가 없으면 바로 사장 칸", () => {
    expect(firstApprovalStatus("m")).toBe("approval_senmu");
    expect(firstApprovalStatus(null)).toBe("approval_president");
    expect(statusAfterApprove("senmu")).toBe("approval_president");
    expect(statusAfterApprove("president")).toBe("paying");
    expect(currentSlot("approval_senmu")).toBe("senmu");
    expect(currentSlot("approval_president")).toBe("president");
    expect(currentSlot("paying")).toBeNull();
  });

  it("결재 요청 — 사람 있음 · 확인 필요 0 · 모두 계산 · 근태 마감", () => {
    expect(canRequestApproval([row("a", "cash")], totals())).toBe(true);
    expect(canRequestApproval([], totals())).toBe(false);
    expect(canRequestApproval([row("a", "cash")], totals(1))).toBe(false);
    expect(canRequestApproval([row("a", "cash")], totals(0, 1))).toBe(false);
    expect(canRequestApproval([row("a", "cash", false)], totals())).toBe(false);
  });
});

describe("payment checks", () => {
  it("현금은 본인 확인까지, 이체는 이체 완료", () => {
    expect(paymentDone("cash", { ...EMPTY_PAYMENT_CHECK, envelopeAt: at })).toBe(false);
    expect(paymentDone("cash", { ...EMPTY_PAYMENT_CHECK, envelopeAt: at, receivedAt: at })).toBe(true);
    expect(paymentDone("transfer", { ...EMPTY_PAYMENT_CHECK, transferredAt: at })).toBe(true);
    expect(paymentDone(null, { ...EMPTY_PAYMENT_CHECK, transferredAt: at })).toBe(false);
    expect(paymentDone("cash", undefined)).toBe(false);
  });

  it("지급 방식에 맞는 체크만", () => {
    expect(checkFitsMethod("cash", "envelope")).toBe(true);
    expect(checkFitsMethod("cash", "received")).toBe(true);
    expect(checkFitsMethod("cash", "transfer")).toBe(false);
    expect(checkFitsMethod("transfer", "transfer")).toBe(true);
    expect(checkFitsMethod("transfer", "envelope")).toBe(false);
    expect(checkFitsMethod(null, "transfer")).toBe(false);
  });

  it("끝난 사람 수 · 아무 체크 · 체크 시각", () => {
    const checks = {
      a: { ...EMPTY_PAYMENT_CHECK, envelopeAt: at, receivedAt: at },
      b: { ...EMPTY_PAYMENT_CHECK, envelopeAt: at },
      c: { ...EMPTY_PAYMENT_CHECK, transferredAt: at },
    };
    expect(paidCount([row("a", "cash"), row("b", "cash"), row("c", "transfer"), row("d", "transfer")], checks)).toBe(2);
    expect(anyPaymentCheck(checks)).toBe(true);
    expect(anyPaymentCheck({ a: EMPTY_PAYMENT_CHECK })).toBe(false);
    expect(checkAt(checks.b, "envelope")).toBe(at);
    expect(checkAt(checks.b, "received")).toBeNull();
    expect(checkAt(undefined, "transfer")).toBeNull();
  });
});

describe("snapshot", () => {
  it("모양이 틀리면 null", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ v: 2, rows: [], totals: {}, payday: { date: "2026-11-10" } })).toBeNull();
    expect(parseSnapshot({ v: 1, rows: [], totals: {}, payday: {} })).toBeNull();
    const ok = parseSnapshot({ v: 1, rows: [], totals: { people: 0 }, payday: { date: "2026-11-10" } });
    expect(ok?.companyName).toBe("");
    expect(ok?.payday.date).toBe("2026-11-10");
  });
});

describe("export stamps", () => {
  it("도장 칸 = 이름 + 도쿄 날짜", () => {
    // 11/9 23:30 UTC = 도쿄 11/10
    expect(stampText({ name: "가명", at: "2026-11-09T23:30:00Z" })).toBe("가명\n11/10");
    expect(stampText({ name: null, at: "2026-11-09T01:00:00Z" })).toBe("11/9");
    expect(stampText({ name: "가명", at: null })).toBeNull();
    expect(stampText(null)).toBeNull();
  });
});
