import type { Locale } from "@/lib/i18n";
import type { JapanHolidayKey } from "@/lib/japan-holidays";

/**
 * 알바 급여 P1 문구(ko · ja · en) — PC 근태 › 시급 패널 · 설정 › 급여 · 모바일 멤버 상세가 같이 쓴다.
 * 클라이언트로 통째로 넘기므로 **문자열만**(함수 금지) — `{n}` 자리표시자 + `fill()`.
 * 甲 · 乙 · 丙 · 雇用保険 · 会社名 · 専務 · 社長 은 명세서 양식 용어라 모든 언어에서 그대로 쓴다.
 * docs/product/39 §3-A · §3-C
 */
export type PayrollSettingsCopy = {
  sectionTitle: string;
  needsCheck: string; // "확인 필요 {n}"
  needsCheckFilter: string;
  needsCheckHint: string;
  savesInstantly: string;
  paymentMethod: string;
  cash: string;
  transfer: string;
  withholding: string;
  kouHelp: string;
  otsuHelp: string;
  heiHelp: string;
  pickOne: string;
  allClassesHelp: string;
  dependents: string;
  dependentsMinus: string;
  dependentsPlus: string;
  katakana: string;
  katakanaMissing: string;
  hireDate: string;
  hireDateMissing: string;
  edit: string;
  employmentInsurance: string;
  insuranceOff: string;
  insuranceOn: string;
  insuranceSince: string;
  insuranceSincePick: string;
  salariedNote: string;
  salariedShort: string;
  hourlyRate: string;
  rateFrom: string; // "{date}부터"
  issuePaymentMethod: string;
  issueWithholding: string;
  issueKatakana: string;
  issueHeiOver: string;
  issueHeiNoHireDate: string;
  heiOverError: string; // "{date}"
  heiNoHireDateError: string;
  columnHeader: string;
  toastSaved: string; // "{name} · {field} → {value}"
  undo: string;
  toastUndone: string;
  errorSave: string;
  errorForbidden: string;
  none: string;
  // ── 설정 › 급여 ──
  tab: string;
  pageTitle: string;
  secPayslip: string;
  companyName: string;
  companyNamePlaceholder: string;
  companyNameNote: string;
  secPayday: string;
  payDayLabel: string;
  payDayUnit: string;
  payDayRange: string;
  holidayRule: string;
  secApproval: string;
  senmuApprover: string;
  presidentApprover: string;
  approverNone: string;
  approvalNote: string;
  sameApproverError: string;
  secInsurance: string;
  insuranceRateValue: string; // "1,000분의 {n}"
  insuranceRatePrefix: string;
  insuranceRateMissing: string;
  insuranceRateEnter: string;
  insuranceRateRemove: string;
  insuranceRateInvalid: string;
  yearLabel: string; // "{y}년도" — 雇用保険 율은 年度(4월~3월) 단위
  upcomingTitle: string;
  upcomingNote: string;
  monthFor: string; // "{m}월분"
  payDate: string; // "{m}월 {d}일 ({w})"
  nextPay: string;
  shiftedSun: string; // "{d}일 일요일"
  shiftedSat: string;
  shiftedHoliday: string; // "{d}일 {holiday}"
  weekdaysShort: string; // "일,월,화,수,목,금,토"
  save: string;
  cancel: string;
  saved: string;
  holidays: Record<JapanHolidayKey, string>;
};

const ko: PayrollSettingsCopy = {
  sectionTitle: "급여 설정",
  needsCheck: "확인 필요 {n}",
  needsCheckFilter: "확인 필요",
  needsCheckHint: "급여 준비 전에 채워 주세요",
  savesInstantly: "고르면 바로 저장돼요. 아직 마감하지 않은 달 급여부터 반영돼요.",
  paymentMethod: "지급 방식",
  cash: "현금",
  transfer: "계좌이체",
  withholding: "원천세 구분",
  kouHelp: "甲 — 이곳이 주된 일자리 · 워킹홀리데이 포함",
  otsuHelp: "乙 — 다른 곳이 주된 급여",
  heiHelp: "丙 — 2개월 이내 고용",
  pickOne: "하나 골라 주세요",
  allClassesHelp: "甲 이곳이 주된 일자리 · 乙 다른 곳이 주된 급여 · 丙 2개월 이내 고용",
  dependents: "부양 인원",
  dependentsMinus: "한 명 빼기",
  dependentsPlus: "한 명 더하기",
  katakana: "일본 이름",
  katakanaMissing: "아직 없음 — 본인이 내 정보에서 넣어요",
  hireDate: "입사일",
  hireDateMissing: "없음",
  edit: "고치기",
  employmentInsurance: "雇用保険",
  insuranceOff: "가입 안 함",
  insuranceOn: "가입",
  insuranceSince: "가입일",
  insuranceSincePick: "날짜 고르기",
  salariedNote: "월급제 — 세무사 담당이라 설정이 없어요",
  salariedShort: "세무사 담당",
  hourlyRate: "시급",
  rateFrom: "{date}부터",
  issuePaymentMethod: "지급 방식 없음",
  issueWithholding: "원천세 구분 없음",
  issueKatakana: "일본 이름 없음",
  issueHeiOver: "丙 · 2개월 지남",
  issueHeiNoHireDate: "丙 · 입사일 없음",
  heiOverError: "입사({date})부터 2개월이 지났어요. 계속 일하면 甲 또는 乙로 바꿔 주세요.",
  heiNoHireDateError: "丙은 입사일이 있어야 2개월을 셀 수 있어요. 입사일을 넣어 주세요.",
  columnHeader: "급여 설정",
  toastSaved: "{name} · {field} → {value}",
  undo: "되돌리기",
  toastUndone: "되돌렸어요",
  errorSave: "저장하지 못했어요. 다시 시도해 주세요.",
  errorForbidden: "이 설정을 바꿀 권한이 없어요.",
  none: "없음",
  tab: "급여",
  pageTitle: "급여",
  secPayslip: "명세서",
  companyName: "会社名 · 명세서에 찍히는 회사 이름",
  companyNamePlaceholder: "株式会社〇〇",
  companyNameNote: "알바 급여명세서 · 사장 확인표 · 세무사용 명세 맨 위에 그대로 나와요.",
  secPayday: "지급일",
  payDayLabel: "매월 지급일",
  payDayUnit: "일",
  payDayRange: "1~28 사이로 넣어 주세요.",
  holidayRule: "토 · 일 · 일본 공휴일(대체휴일 포함)이면 앞 평일로 옮겨요. 급여 기간은 1일~말일.",
  secApproval: "결재",
  senmuApprover: "専務 결재",
  presidentApprover: "社長 결재",
  approverNone: "정하지 않음",
  approvalNote: "급여를 넘기기 전에 이 순서로 확인을 받아요.",
  sameApproverError: "専務와 社長은 다른 사람이어야 해요.",
  secInsurance: "雇用保険 근로자 부담률",
  insuranceRateValue: "1,000분의 {n}",
  insuranceRatePrefix: "1,000분의",
  insuranceRateMissing: "아직 없음 — 가입자가 생기기 전에 넣어 주세요",
  insuranceRateEnter: "요율 입력",
  insuranceRateRemove: "지우기",
  insuranceRateInvalid: "0 이상 100 미만의 숫자로 넣어 주세요.",
  yearLabel: "{y}년도",
  upcomingTitle: "앞으로 12달 지급일",
  upcomingNote: "위 규칙으로 계산한 실제 날짜예요.",
  monthFor: "{m}월분",
  payDate: "{m}월 {d}일 ({w})",
  nextPay: "다음 지급",
  shiftedSun: "{d}일 일요일",
  shiftedSat: "{d}일 토요일",
  shiftedHoliday: "{d}일 {holiday}",
  weekdaysShort: "일,월,화,수,목,금,토",
  save: "저장",
  cancel: "취소",
  saved: "저장했어요",
  holidays: {
    newYear: "새해 첫날(元日)",
    comingOfAge: "성인의 날",
    foundation: "건국기념일",
    emperor: "천황 탄생일",
    vernal: "춘분의 날",
    showa: "쇼와의 날",
    constitution: "헌법기념일",
    greenery: "녹색의 날",
    children: "어린이날",
    marine: "바다의 날",
    mountain: "산의 날",
    respectAged: "경로의 날",
    autumnal: "추분의 날",
    sports: "스포츠의 날",
    culture: "문화의 날",
    labor: "근로감사의 날",
    substitute: "대체휴일",
    citizens: "국민의 휴일",
  },
};

const ja: PayrollSettingsCopy = {
  sectionTitle: "給与設定",
  needsCheck: "要確認 {n}",
  needsCheckFilter: "要確認",
  needsCheckHint: "給与準備の前に入力してください",
  savesInstantly: "選ぶとすぐ保存されます。まだ締めていない月の給与から反映されます。",
  paymentMethod: "支払方法",
  cash: "現金",
  transfer: "振込",
  withholding: "源泉税区分",
  kouHelp: "甲 — ここが主たる勤務先 · ワーキングホリデー含む",
  otsuHelp: "乙 — 主たる給与は他社",
  heiHelp: "丙 — 2か月以内の雇用",
  pickOne: "一つ選んでください",
  allClassesHelp: "甲 ここが主たる勤務先 · 乙 主たる給与は他社 · 丙 2か月以内の雇用",
  dependents: "扶養人数",
  dependentsMinus: "1人減らす",
  dependentsPlus: "1人増やす",
  katakana: "氏名(カナ)",
  katakanaMissing: "未入力 — 本人がマイページで入力します",
  hireDate: "入社日",
  hireDateMissing: "なし",
  edit: "修正",
  employmentInsurance: "雇用保険",
  insuranceOff: "未加入",
  insuranceOn: "加入",
  insuranceSince: "加入日",
  insuranceSincePick: "日付を選ぶ",
  salariedNote: "月給制 — 税理士の担当のため設定はありません",
  salariedShort: "税理士担当",
  hourlyRate: "時給",
  rateFrom: "{date}から",
  issuePaymentMethod: "支払方法なし",
  issueWithholding: "源泉税区分なし",
  issueKatakana: "カナ氏名なし",
  issueHeiOver: "丙 · 2か月経過",
  issueHeiNoHireDate: "丙 · 入社日なし",
  heiOverError: "入社({date})から2か月が過ぎました。続けて働く場合は甲か乙に変えてください。",
  heiNoHireDateError: "丙は入社日がないと2か月を数えられません。入社日を入れてください。",
  columnHeader: "給与設定",
  toastSaved: "{name} · {field} → {value}",
  undo: "元に戻す",
  toastUndone: "元に戻しました",
  errorSave: "保存できませんでした。もう一度お試しください。",
  errorForbidden: "この設定を変更する権限がありません。",
  none: "なし",
  tab: "給与",
  pageTitle: "給与",
  secPayslip: "明細書",
  companyName: "会社名 · 明細書に印字される社名",
  companyNamePlaceholder: "株式会社〇〇",
  companyNameNote: "アルバイト給与明細 · 社長確認表 · 税理士用明細の上にそのまま出ます。",
  secPayday: "支給日",
  payDayLabel: "毎月の支給日",
  payDayUnit: "日",
  payDayRange: "1〜28の間で入れてください。",
  holidayRule: "土 · 日 · 祝日(振替休日を含む)なら前の平日に繰り上げます。給与期間は1日〜末日。",
  secApproval: "決裁",
  senmuApprover: "専務決裁",
  presidentApprover: "社長決裁",
  approverNone: "未設定",
  approvalNote: "給与を確定する前にこの順で確認を受けます。",
  sameApproverError: "専務と社長は別の人にしてください。",
  secInsurance: "雇用保険 労働者負担率",
  insuranceRateValue: "1,000分の{n}",
  insuranceRatePrefix: "1,000分の",
  insuranceRateMissing: "未登録 — 加入者が出る前に入れてください",
  insuranceRateEnter: "料率を入力",
  insuranceRateRemove: "削除",
  insuranceRateInvalid: "0以上100未満の数字で入れてください。",
  yearLabel: "{y}年度",
  upcomingTitle: "今後12か月の支給日",
  upcomingNote: "上のルールで計算した実際の日付です。",
  monthFor: "{m}月分",
  payDate: "{m}月{d}日({w})",
  nextPay: "次回支給",
  shiftedSun: "{d}日が日曜",
  shiftedSat: "{d}日が土曜",
  shiftedHoliday: "{d}日が{holiday}",
  weekdaysShort: "日,月,火,水,木,金,土",
  save: "保存",
  cancel: "キャンセル",
  saved: "保存しました",
  holidays: {
    newYear: "元日",
    comingOfAge: "成人の日",
    foundation: "建国記念の日",
    emperor: "天皇誕生日",
    vernal: "春分の日",
    showa: "昭和の日",
    constitution: "憲法記念日",
    greenery: "みどりの日",
    children: "こどもの日",
    marine: "海の日",
    mountain: "山の日",
    respectAged: "敬老の日",
    autumnal: "秋分の日",
    sports: "スポーツの日",
    culture: "文化の日",
    labor: "勤労感謝の日",
    substitute: "振替休日",
    citizens: "国民の休日",
  },
};

const en: PayrollSettingsCopy = {
  sectionTitle: "Payroll",
  needsCheck: "Needs check {n}",
  needsCheckFilter: "Needs check",
  needsCheckHint: "Fill these in before payroll prep",
  savesInstantly: "Choices save right away and apply from the next month that isn’t closed yet.",
  paymentMethod: "Payment",
  cash: "Cash",
  transfer: "Transfer",
  withholding: "Tax column",
  kouHelp: "甲 — main job here · includes working holiday",
  otsuHelp: "乙 — main pay comes from another job",
  heiHelp: "丙 — hired for 2 months or less",
  pickOne: "Choose one",
  allClassesHelp: "甲 main job here · 乙 main pay elsewhere · 丙 hired for 2 months or less",
  dependents: "Dependents",
  dependentsMinus: "One fewer",
  dependentsPlus: "One more",
  katakana: "Name (katakana)",
  katakanaMissing: "Not set — they add it in My info",
  hireDate: "Hire date",
  hireDateMissing: "None",
  edit: "Edit",
  employmentInsurance: "Employment insurance",
  insuranceOff: "Not enrolled",
  insuranceOn: "Enrolled",
  insuranceSince: "Enrolled on",
  insuranceSincePick: "Pick a date",
  salariedNote: "Salaried — handled by the tax accountant, nothing to set",
  salariedShort: "Accountant",
  hourlyRate: "Hourly rate",
  rateFrom: "from {date}",
  issuePaymentMethod: "No payment method",
  issueWithholding: "No tax column",
  issueKatakana: "No katakana name",
  issueHeiOver: "丙 · past 2 months",
  issueHeiNoHireDate: "丙 · no hire date",
  heiOverError: "It’s been over 2 months since they were hired ({date}). If they keep working, switch to 甲 or 乙.",
  heiNoHireDateError: "丙 needs a hire date to count the 2 months. Add the hire date.",
  columnHeader: "Payroll",
  toastSaved: "{name} · {field} → {value}",
  undo: "Undo",
  toastUndone: "Undone",
  errorSave: "Couldn’t save. Please try again.",
  errorForbidden: "You don’t have permission to change this.",
  none: "None",
  tab: "Payroll",
  pageTitle: "Payroll",
  secPayslip: "Payslips",
  companyName: "会社名 · company name on payslips",
  companyNamePlaceholder: "株式会社〇〇",
  companyNameNote: "Printed at the top of part-time payslips, the president’s check sheet and the accountant’s list.",
  secPayday: "Pay day",
  payDayLabel: "Pay day (day of month)",
  payDayUnit: "",
  payDayRange: "Enter a day from 1 to 28.",
  holidayRule: "If it falls on a Saturday, Sunday or Japanese holiday (incl. substitute holidays), pay moves to the weekday before. Pay period: 1st to month end.",
  secApproval: "Approval",
  senmuApprover: "専務 approval",
  presidentApprover: "社長 approval",
  approverNone: "Not set",
  approvalNote: "Payroll is checked in this order before it goes out.",
  sameApproverError: "専務 and 社長 must be different people.",
  secInsurance: "Employment insurance — employee rate",
  insuranceRateValue: "{n} per 1,000",
  insuranceRatePrefix: "per 1,000",
  insuranceRateMissing: "Not set — add it before anyone enrolls",
  insuranceRateEnter: "Add rate",
  insuranceRateRemove: "Remove",
  insuranceRateInvalid: "Enter a number from 0 up to (not including) 100.",
  yearLabel: "FY{y}",
  upcomingTitle: "Pay days for the next 12 months",
  upcomingNote: "Actual dates from the rule above.",
  monthFor: "{m} pay",
  payDate: "{w}, {m} {d}",
  nextPay: "Next",
  shiftedSun: "{d} is a Sunday",
  shiftedSat: "{d} is a Saturday",
  shiftedHoliday: "{d} is {holiday}",
  weekdaysShort: "Sun,Mon,Tue,Wed,Thu,Fri,Sat",
  save: "Save",
  cancel: "Cancel",
  saved: "Saved",
  holidays: {
    newYear: "New Year’s Day",
    comingOfAge: "Coming of Age Day",
    foundation: "National Foundation Day",
    emperor: "Emperor’s Birthday",
    vernal: "Vernal Equinox Day",
    showa: "Showa Day",
    constitution: "Constitution Day",
    greenery: "Greenery Day",
    children: "Children’s Day",
    marine: "Marine Day",
    mountain: "Mountain Day",
    respectAged: "Respect for the Aged Day",
    autumnal: "Autumnal Equinox Day",
    sports: "Sports Day",
    culture: "Culture Day",
    labor: "Labor Thanksgiving Day",
    substitute: "a substitute holiday",
    citizens: "a citizens’ holiday",
  },
};

const COPY: Record<Locale, PayrollSettingsCopy> = { ko, ja, en };

export function getPayrollSettingsCopy(locale: Locale): PayrollSettingsCopy {
  return COPY[locale] ?? ko;
}

/** `{name}` 자리표시자 채우기. */
export function fillCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, k: string) => (k in values ? String(values[k]) : match));
}
