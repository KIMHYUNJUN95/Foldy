import type { Locale } from "@/lib/i18n";

/**
 * 급여 계좌 문구(ko · ja · en) — 내 계정 · PC 근태 › 시급 패널 · 모바일 사용자 상세 · 급여 준비가 같이 쓴다.
 * 클라이언트로 통째로 넘기므로 **문자열만** — `{n}` 자리표시자 + `fillCopy()`. 은행 · 지점 · 명의는 데이터(그대로 그림).
 * docs/product/39 §3-A 「급여 계좌」
 */
export type PayrollBankCopy = {
  section: string;
  title: string;
  selfHint: string;
  adminHint: string;
  bankName: string;
  branchName: string;
  accountType: string;
  ordinary: string;
  current: string;
  accountNumber: string;
  accountNumberHint: string;
  holderKana: string;
  holderHint: string;
  yuchoHint: string;
  save: string;
  cancel: string;
  edit: string;
  add: string;
  empty: string;
  pendingSelf: string;
  pendingAdmin: string; // "{date} 본인이 바꿨어요"
  pendingAdminSub: string; // "{prev}"
  pendingFirst: string;
  pendingFirstSub: string;
  pendingShort: string;
  confirm: string;
  confirmedToast: string;
  savedToast: string;
  savedSelfToast: string;
  historyTitle: string;
  hSelf: string;
  hCreated: string;
  hUpdated: string; // "이전 {bank} {last4}"
  hConfirmed: string;
  errBankName: string;
  errBranchName: string;
  errAccountType: string;
  errAccountNumber: string;
  errHolderKana: string;
  errSave: string;
  errForbidden: string;
  copy: string;
  copied: string;
  loading: string;
  loadFailed: string;
};

const ko: PayrollBankCopy = {
  section: "급여",
  title: "급여 계좌",
  selfHint: "급여가 들어갈 계좌예요. 바꾸면 급여 담당자가 확인한 뒤부터 이 계좌로 보내요.",
  adminHint: "관리자가 바꾸면 바로 확인된 계좌로 써요. 본인에게도 보여요.",
  bankName: "은행",
  branchName: "지점",
  accountType: "종류",
  ordinary: "보통",
  current: "당좌",
  accountNumber: "계좌번호",
  accountNumberHint: "숫자 7자리",
  holderKana: "명의(가타카나)",
  holderHint: "통장에 적힌 그대로",
  yuchoHint: "유초은행은 이체용 지점명과 7자리 번호를 적어 주세요",
  save: "저장",
  cancel: "취소",
  edit: "바꾸기",
  add: "계좌 넣기",
  empty: "아직 없어요",
  pendingSelf: "확인 중 · 담당자가 확인하면 써요",
  pendingAdmin: "{date} 본인이 바꿨어요",
  pendingAdminSub: "확인 전에는 이전 계좌({prev})로 보내요",
  pendingFirst: "{date} 본인이 처음 적었어요",
  pendingFirstSub: "번호가 맞는지 확인해 주세요",
  pendingShort: "확인 필요",
  confirm: "확인함",
  confirmedToast: "계좌를 확인했어요",
  savedToast: "계좌를 저장했어요",
  savedSelfToast: "저장했어요. 담당자가 확인하면 이 계좌로 보내요",
  historyTitle: "바뀐 기록",
  hSelf: "본인",
  hCreated: "처음 등록",
  hUpdated: "이전 {bank} {last4}",
  hConfirmed: "확인함",
  errBankName: "은행 이름을 적어 주세요",
  errBranchName: "지점 이름을 적어 주세요",
  errAccountType: "종류를 골라 주세요",
  errAccountNumber: "계좌번호는 숫자 7자리예요",
  errHolderKana: "명의는 가타카나로 적어 주세요",
  errSave: "저장하지 못했어요. 다시 해 주세요",
  errForbidden: "이 계좌를 고칠 권한이 없어요",
  copy: "계좌번호 복사",
  copied: "계좌번호를 복사했어요",
  loading: "불러오는 중…",
  loadFailed: "계좌를 불러오지 못했어요",
};

const ja: PayrollBankCopy = {
  section: "給与",
  title: "給与振込口座",
  selfHint: "給与が振り込まれる口座です。変更すると、給与担当が確認した後からこの口座に振り込みます。",
  adminHint: "管理者が変更した口座はそのまま確認済みになります。本人にも表示されます。",
  bankName: "銀行",
  branchName: "支店",
  accountType: "種別",
  ordinary: "普通",
  current: "当座",
  accountNumber: "口座番号",
  accountNumberHint: "数字7桁",
  holderKana: "名義（カナ）",
  holderHint: "通帳の表記どおり",
  yuchoHint: "ゆうちょ銀行は振込用の店名と7桁の番号を入力してください",
  save: "保存",
  cancel: "キャンセル",
  edit: "変更",
  add: "口座を登録",
  empty: "未登録",
  pendingSelf: "確認中 · 担当が確認すると使われます",
  pendingAdmin: "{date} 本人が変更しました",
  pendingAdminSub: "確認するまでは以前の口座（{prev}）に振り込みます",
  pendingFirst: "{date} 本人が初めて登録しました",
  pendingFirstSub: "番号が正しいか確認してください",
  pendingShort: "要確認",
  confirm: "確認済みにする",
  confirmedToast: "口座を確認しました",
  savedToast: "口座を保存しました",
  savedSelfToast: "保存しました。担当が確認するとこの口座に振り込みます",
  historyTitle: "変更履歴",
  hSelf: "本人",
  hCreated: "初回登録",
  hUpdated: "以前 {bank} {last4}",
  hConfirmed: "確認済み",
  errBankName: "銀行名を入力してください",
  errBranchName: "支店名を入力してください",
  errAccountType: "種別を選んでください",
  errAccountNumber: "口座番号は数字7桁です",
  errHolderKana: "名義はカタカナで入力してください",
  errSave: "保存できませんでした。もう一度お試しください",
  errForbidden: "この口座を変更する権限がありません",
  copy: "口座番号をコピー",
  copied: "口座番号をコピーしました",
  loading: "読み込み中…",
  loadFailed: "口座を読み込めませんでした",
};

const en: PayrollBankCopy = {
  section: "Pay",
  title: "Pay account",
  selfHint: "The bank account your pay goes to. If you change it, pay goes here once payroll has checked it.",
  adminHint: "Changes made by an admin count as checked right away. The staff member sees them too.",
  bankName: "Bank",
  branchName: "Branch",
  accountType: "Type",
  ordinary: "Ordinary",
  current: "Current",
  accountNumber: "Account number",
  accountNumberHint: "7 digits",
  holderKana: "Holder (katakana)",
  holderHint: "Exactly as on the passbook",
  yuchoHint: "For Japan Post Bank, enter the transfer branch name and 7-digit number",
  save: "Save",
  cancel: "Cancel",
  edit: "Change",
  add: "Add account",
  empty: "Not added yet",
  pendingSelf: "Being checked · used once payroll checks it",
  pendingAdmin: "Changed by staff on {date}",
  pendingAdminSub: "Until checked, pay goes to the previous account ({prev})",
  pendingFirst: "First entered by staff on {date}",
  pendingFirstSub: "Check that the number is right",
  pendingShort: "Needs check",
  confirm: "Mark checked",
  confirmedToast: "Account checked",
  savedToast: "Account saved",
  savedSelfToast: "Saved. Pay goes here once payroll checks it",
  historyTitle: "Change history",
  hSelf: "Staff",
  hCreated: "First added",
  hUpdated: "Was {bank} {last4}",
  hConfirmed: "Checked",
  errBankName: "Enter the bank name",
  errBranchName: "Enter the branch name",
  errAccountType: "Choose a type",
  errAccountNumber: "The account number is 7 digits",
  errHolderKana: "Enter the holder name in katakana",
  errSave: "Couldn’t save. Try again",
  errForbidden: "You can’t change this account",
  copy: "Copy account number",
  copied: "Account number copied",
  loading: "Loading…",
  loadFailed: "Couldn’t load the account",
};

const COPY: Record<Locale, PayrollBankCopy> = { ko, ja, en };

export function getPayrollBankCopy(locale: Locale | string): PayrollBankCopy {
  return COPY[(locale as Locale) in COPY ? (locale as Locale) : "ko"];
}

/** 종류 글자. */
export function bankTypeLabel(copy: PayrollBankCopy, type: "ordinary" | "current"): string {
  return type === "current" ? copy.current : copy.ordinary;
}
