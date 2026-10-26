import type { Locale } from "@/lib/i18n";
import type { PrepIssue } from "@/lib/payroll-prep";

/**
 * 알바 급여 P3 급여 준비 문구(ko · ja · en) — PC 근태 › 급여 · 모바일 급여 준비가 같이 쓴다.
 * 클라이언트로 통째로 넘기므로 **문자열만**(함수 금지) — `{n}` 자리표시자 + `fillCopy()`(payroll-settings-i18n).
 * 한국어는 한자 없이(갑 · 을 · 병 · 잔업수당 · 지난달 조정 …), 일본어는 명세서 양식 용어. docs/product/39 §5-A
 */
export type PayrollPrepCopy = {
  title: string; // "{month}분 급여"
  payday: string; // "{date} 지급"
  stepClose: string;
  stepPrep: string;
  stepApproval: string;
  stepPay: string;
  stepLater: string;
  stepsLabel: string;
  openPrep: string;
  filterLabel: string;
  all: string;
  transfer: string;
  cash: string;
  noMethod: string;
  colName: string;
  colHours: string;
  colBasePay: string;
  colAdjustments: string;
  colCommute: string;
  colGross: string;
  colWithholding: string;
  colNet: string;
  people: string; // "{n}명"
  netTotal: string;
  uncalculated: string; // "{n}명 계산 전"
  checkPeople: string; // "확인할 사람 {n}명"
  noChecks: string;
  requestApproval: string;
  approvalLater: string;
  /** P4 — 급여 준비 값으로 만드는 출력 파일. */
  filesTitle: string;
  fileBook: string;
  fileBookHint: string;
  fileTax: string;
  fileTaxHint: string;
  fileSaved: string; // "{name} 저장됨"
  fileOpened: string;
  fileFailed: string;
  fileBlocked: string;
  fileXls: string;
  filePdf: string;
  empty: string;
  readOnly: string;
  classLine: string; // "원천세 {cls}"
  issues: Record<PrepIssue, string>;
  hintWithholding: string;
  hintKatakana: string;
  hintNotFinalized: string;
  work: string; // "근무 {time}"
  rateLine: string; // "{rate}엔 × {time}"
  rateSince: string; // "{date}부터"
  secAdjust: string;
  overtime: string;
  weekend: string;
  special: string;
  prevAdjust: string;
  prevAdjustTaxable: string;
  prevAdjustCommute: string;
  prevAdjustYm: string;
  prevAdjustYmPlaceholder: string;
  yearEnd: string;
  autoHint: string; // "근태 수당에서 자동 {n}"
  more: string;
  less: string;
  signToggle: string;
  secResult: string;
  gross: string;
  grossHint: string; // "교통비 {n} 포함"
  withholding: string;
  withholdingHint: string; // "{year}년 세금표"
  withholdingManual: string;
  withholdingOverride: string;
  withholdingAuto: string;
  overrideReason: string;
  overrideReasonPlaceholder: string;
  employmentInsurance: string;
  net: string;
  roundUp: string; // "10엔 단위 올림 +{n}"
  memo: string;
  close: string;
  saved: string; // "{name} · {field} 저장"
  undo: string;
  undone: string;
  errorSave: string;
  errorForbidden: string;
  minutesShort: string; // "{h}:{m}"
  yen: string; // "{n}엔"
  prevMonth: string;
  nextMonth: string;
};

const ko: PayrollPrepCopy = {
  title: "{month}분 급여",
  payday: "{date} 지급",
  stepClose: "근태 마감",
  stepPrep: "급여 준비",
  stepApproval: "결재",
  stepPay: "지급",
  stepLater: "다음 단계에서 열려요",
  stepsLabel: "급여 단계",
  openPrep: "급여 준비 보기",
  filterLabel: "지급 방식",
  all: "전체",
  transfer: "이체",
  cash: "현금",
  noMethod: "지급 방식 없음",
  colName: "이름",
  colHours: "시간",
  colBasePay: "시급 합계",
  colAdjustments: "수당 · 조정",
  colCommute: "교통비",
  colGross: "총지급",
  colWithholding: "원천세",
  colNet: "실수령",
  people: "{n}명",
  netTotal: "실수령 합계",
  uncalculated: "{n}명 계산 전",
  checkPeople: "확인할 사람 {n}명",
  noChecks: "확인할 사람 없음",
  requestApproval: "결재 요청",
  approvalLater: "결재는 다음 단계에서 열려요",
  filesTitle: "파일",
  fileBook: "급여 파일",
  fileBookHint: "명세서 · 사장 확인표 · 지급 확인 목록",
  fileTax: "세무사용",
  fileTaxHint: "원천세 구분별 지급 목록",
  fileSaved: "{name} 저장됨",
  fileOpened: "PDF 를 새 탭에 열었어요",
  fileFailed: "파일을 만들지 못했어요",
  fileBlocked: "팝업이 막혔어요. 허용한 뒤 다시 눌러 주세요",
  fileXls: "Excel",
  filePdf: "PDF",
  empty: "이 달엔 시급 근무가 없어요.",
  readOnly: "보기만 할 수 있어요",
  classLine: "원천세 {cls}",
  issues: {
    not_finalized: "근태 마감 전이에요",
    withholding: "원천세 구분을 골라 주세요",
    payment_method: "지급 방식이 없어요",
    no_tax_table: "그해 세금표가 없어요",
    hei_over: "병인데 입사 2개월이 지났어요",
    hei_no_hire_date: "병인데 입사일이 없어요",
    katakana: "가타카나 이름이 없어요",
    prev_adjustment_month_missing: "지난달 조정이 몇 월분인지 없어요",
    override_no_reason: "원천세를 바꾼 사유가 없어요",
    no_insurance_rate: "그해 고용보험 율이 없어요",
    allowance_without_work: "근무 없이 수당만 있어요",
  },
  hintWithholding: "여기가 주된 일터면 갑",
  hintKatakana: "본인이 앱 「내 정보」에서 넣어요",
  hintNotFinalized: "근태 마감 단계에서 마감해 주세요",
  work: "근무 {time}",
  rateLine: "{rate}엔 × {time}",
  rateSince: "{date}부터",
  secAdjust: "수당 · 조정",
  overtime: "잔업수당",
  weekend: "주말수당",
  special: "특별수당",
  prevAdjust: "지난달 조정",
  prevAdjustTaxable: "급여 조정",
  prevAdjustCommute: "교통비 조정",
  prevAdjustYm: "몇 월분",
  prevAdjustYmPlaceholder: "월 고르기",
  yearEnd: "연말정산",
  autoHint: "근태 수당에서 자동 {n}",
  more: "잔업 · 주말 · 연말정산 더 넣기",
  less: "접기",
  signToggle: "빼기 · 더하기 바꾸기",
  secResult: "계산",
  gross: "총지급",
  grossHint: "교통비 {n} 포함",
  withholding: "원천세",
  withholdingHint: "{year}년 세금표",
  withholdingManual: "직접 넣음",
  withholdingOverride: "원천세 직접 넣기",
  withholdingAuto: "계산값으로",
  overrideReason: "바꾼 사유",
  overrideReasonPlaceholder: "예: 세무사 확인",
  employmentInsurance: "고용보험",
  net: "실수령",
  roundUp: "10엔 단위 올림 +{n}",
  memo: "메모",
  close: "닫기",
  saved: "{name} · {field} 저장했어요",
  undo: "되돌리기",
  undone: "되돌렸어요",
  errorSave: "저장하지 못했어요. 다시 해 주세요.",
  errorForbidden: "입력 권한이 없어요.",
  minutesShort: "{h}:{m}",
  yen: "{n}엔",
  prevMonth: "이전 달",
  nextMonth: "다음 달",
};

const ja: PayrollPrepCopy = {
  title: "{month}分 給与",
  payday: "{date} 支給",
  stepClose: "勤怠締め",
  stepPrep: "給与準備",
  stepApproval: "決裁",
  stepPay: "支給",
  stepLater: "次の段階で使えます",
  stepsLabel: "給与の段階",
  openPrep: "給与準備を見る",
  filterLabel: "支払方法",
  all: "全員",
  transfer: "振込",
  cash: "現金",
  noMethod: "支払方法なし",
  colName: "氏名",
  colHours: "時間",
  colBasePay: "時給計",
  colAdjustments: "手当・調整",
  colCommute: "通勤費",
  colGross: "総支給",
  colWithholding: "源泉税",
  colNet: "差引支給",
  people: "{n}名",
  netTotal: "差引支給 合計",
  uncalculated: "{n}名 未計算",
  checkPeople: "要確認 {n}名",
  noChecks: "要確認なし",
  requestApproval: "決裁を依頼",
  approvalLater: "決裁は次の段階で使えます",
  filesTitle: "ファイル",
  fileBook: "給与ファイル",
  fileBookHint: "明細・社長確認表・支給確認一覧",
  fileTax: "税理士用",
  fileTaxHint: "源泉区分ごとの支給一覧",
  fileSaved: "{name} を保存しました",
  fileOpened: "PDFを新しいタブで開きました",
  fileFailed: "ファイルを作れませんでした",
  fileBlocked: "ポップアップがブロックされました。許可してからもう一度押してください",
  fileXls: "Excel",
  filePdf: "PDF",
  empty: "この月は時給の勤務がありません。",
  readOnly: "閲覧のみ",
  classLine: "源泉 {cls}",
  issues: {
    not_finalized: "勤怠が未締めです",
    withholding: "源泉区分を選んでください",
    payment_method: "支払方法が未設定です",
    no_tax_table: "その年の税額表がありません",
    hei_over: "丙で入社2か月を超えています",
    hei_no_hire_date: "丙ですが入社日がありません",
    katakana: "カタカナ氏名がありません",
    prev_adjustment_month_missing: "前月調整額の対象月がありません",
    override_no_reason: "源泉税の変更理由がありません",
    no_insurance_rate: "雇用保険料率が未設定です",
    allowance_without_work: "勤務なしで手当だけあります",
  },
  hintWithholding: "ここが主たる勤務先なら甲",
  hintKatakana: "本人がアプリの「マイ情報」で入力します",
  hintNotFinalized: "勤怠締めの段階で締めてください",
  work: "勤務 {time}",
  rateLine: "{rate}円 × {time}",
  rateSince: "{date}から",
  secAdjust: "手当・調整",
  overtime: "残業手当",
  weekend: "週末手当",
  special: "特別手当",
  prevAdjust: "前月調整額",
  prevAdjustTaxable: "給与の調整",
  prevAdjustCommute: "通勤費の調整",
  prevAdjustYm: "対象月",
  prevAdjustYmPlaceholder: "月を選ぶ",
  yearEnd: "年末調整",
  autoHint: "勤怠の手当から自動 {n}",
  more: "残業・週末・年末調整を追加",
  less: "閉じる",
  signToggle: "プラス・マイナスを切り替え",
  secResult: "計算",
  gross: "総支給",
  grossHint: "通勤費 {n} を含む",
  withholding: "源泉税",
  withholdingHint: "{year}年 税額表",
  withholdingManual: "手入力",
  withholdingOverride: "源泉税を手入力",
  withholdingAuto: "計算値に戻す",
  overrideReason: "変更理由",
  overrideReasonPlaceholder: "例：税理士確認",
  employmentInsurance: "雇用保険",
  net: "差引支給",
  roundUp: "10円単位切り上げ +{n}",
  memo: "備考",
  close: "閉じる",
  saved: "{name} · {field} を保存しました",
  undo: "元に戻す",
  undone: "元に戻しました",
  errorSave: "保存できませんでした。もう一度お試しください。",
  errorForbidden: "入力する権限がありません。",
  minutesShort: "{h}:{m}",
  yen: "{n}円",
  prevMonth: "前の月",
  nextMonth: "次の月",
};

const en: PayrollPrepCopy = {
  title: "{month} payroll",
  payday: "Paid {date}",
  stepClose: "Close attendance",
  stepPrep: "Prepare",
  stepApproval: "Approval",
  stepPay: "Payment",
  stepLater: "Opens in a later step",
  stepsLabel: "Payroll steps",
  openPrep: "View payroll prep",
  filterLabel: "Payment method",
  all: "All",
  transfer: "Transfer",
  cash: "Cash",
  noMethod: "No payment method",
  colName: "Name",
  colHours: "Hours",
  colBasePay: "Hourly pay",
  colAdjustments: "Allowances",
  colCommute: "Commute",
  colGross: "Gross",
  colWithholding: "Withholding",
  colNet: "Net pay",
  people: "{n} people",
  netTotal: "Net pay total",
  uncalculated: "{n} not calculated",
  checkPeople: "{n} to check",
  noChecks: "Nothing to check",
  requestApproval: "Request approval",
  approvalLater: "Approval opens in a later step",
  filesTitle: "Files",
  fileBook: "Payroll file",
  fileBookHint: "Payslips · owner sheet · payment check",
  fileTax: "Tax accountant",
  fileTaxHint: "Pay list by tax column",
  fileSaved: "Saved {name}",
  fileOpened: "Opened the PDF in a new tab",
  fileFailed: "Couldn't create the file",
  fileBlocked: "Pop-up blocked. Allow pop-ups and try again",
  fileXls: "Excel",
  filePdf: "PDF",
  empty: "No hourly work this month.",
  readOnly: "View only",
  classLine: "Withholding {cls}",
  issues: {
    not_finalized: "Attendance not closed yet",
    withholding: "Pick a withholding class",
    payment_method: "No payment method",
    no_tax_table: "No tax table for that year",
    hei_over: "丙 past 2 months since hire",
    hei_no_hire_date: "丙 without a hire date",
    katakana: "No katakana name",
    prev_adjustment_month_missing: "Pick the adjustment month",
    override_no_reason: "Withholding needs a reason",
    no_insurance_rate: "No insurance rate for that year",
    allowance_without_work: "Allowance with no work",
  },
  hintWithholding: "甲 if this is their main job",
  hintKatakana: "They add it in the app under My info",
  hintNotFinalized: "Close it in the attendance step",
  work: "Worked {time}",
  rateLine: "¥{rate} × {time}",
  rateSince: "from {date}",
  secAdjust: "Allowances",
  overtime: "Overtime",
  weekend: "Weekend",
  special: "Special",
  prevAdjust: "Adjustment",
  prevAdjustTaxable: "Pay",
  prevAdjustCommute: "Commute",
  prevAdjustYm: "For month",
  prevAdjustYmPlaceholder: "Pick a month",
  yearEnd: "Year-end adjustment",
  autoHint: "From attendance {n}",
  more: "Add overtime, weekend, year-end",
  less: "Hide",
  signToggle: "Switch plus or minus",
  secResult: "Result",
  gross: "Gross",
  grossHint: "includes commute {n}",
  withholding: "Withholding",
  withholdingHint: "{year} tax table",
  withholdingManual: "Entered by hand",
  withholdingOverride: "Manual withholding",
  withholdingAuto: "Use calculated",
  overrideReason: "Reason",
  overrideReasonPlaceholder: "e.g. checked with accountant",
  employmentInsurance: "Employment insurance",
  net: "Net pay",
  roundUp: "rounded up to ¥10 +{n}",
  memo: "Note",
  close: "Close",
  saved: "Saved {field} for {name}",
  undo: "Undo",
  undone: "Undone",
  errorSave: "Couldn’t save. Try again.",
  errorForbidden: "You don’t have permission to edit this.",
  minutesShort: "{h}:{m}",
  yen: "¥{n}",
  prevMonth: "Previous month",
  nextMonth: "Next month",
};

const COPY: Record<Locale, PayrollPrepCopy> = { ko, ja, en };

export function getPayrollPrepCopy(locale: Locale | string): PayrollPrepCopy {
  return COPY[(locale as Locale) in COPY ? (locale as Locale) : "ko"];
}
