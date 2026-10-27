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
  /** P5 — 결재 · 지급 확인 · 세무사 송부(2026-10-26). */
  lockedNote: string; // 결재 화면 — 결재자에게
  lockedShort: string;
  errorLocked: string;
  errorConflict: string;
  errorHasChecks: string;
  errorOrder: string;
  errorNotReady: string;
  errorNoApprover: string;
  reasonRequired: string;
  ownerSheet: string;
  approvalTitle: string;
  slotSenmu: string;
  slotPresident: string;
  slotSenmuShort: string; // 좁은 도장 칸
  slotPresidentShort: string;
  stampWaiting: string;
  approve: string;
  returnAction: string;
  returnBody: string;
  revertAction: string;
  revertBody: string;
  reasonLabel: string;
  cancel: string;
  cancelRequest: string;
  requestedToast: string;
  cancelledToast: string;
  approvedToast: string; // {slot} = 전무 · 사장
  returnedToast: string;
  turnOf: string;
  myTurnCard: string; // 모바일 카드 머리
  approveCardTitle: string;
  approveCardSub: string;
  returnedNote: string;
  stampNote: string;
  historyTitle: string;
  evRequest: string;
  evCancel: string;
  evApprove: string;
  evUndo: string;
  evReturn: string;
  evRevert: string;
  evPaid: string;
  evUnpaid: string;
  evSent: string;
  evUnsent: string;
  stPreparing: string;
  stApprovalSenmu: string;
  stApprovalPresident: string;
  stPaying: string;
  stPaid: string;
  stSent: string;
  approvalWait: string;
  payProgressLabel: string;
  payProgress: string;
  envelope: string;
  envelopeShort: string; // 좁은 칸
  received: string;
  transferDone: string;
  allTransferred: string;
  cashGroup: string;
  transferGroup: string;
  cashHint: string;
  checkToast: string; // {name} · {what}
  uncheckToast: string;
  allTransferredToast: string;
  paidAllToast: string;
  taxSend: string;
  taxSendHint: string;
  taxSentToast: string;
  taxFiles: string;
  /** P4 — 급여 준비 값으로 만드는 출력 파일. */
  filesTitle: string;
  fileBook: string;
  fileBookHint: string;
  fileTax: string;
  fileTaxHint: string;
  fileSaved: string; // "{name} 저장됨"
  fileOpened: string;
  /** 고른 사람 명세서만(docs/product/39 §6-3). */
  slip: string;
  slipThis: string;
  slipOnly: string;
  slipOnlyHint: string;
  slipSheetTitle: string;
  slipSheetSub: string; // "{month} · …"
  slipSearch: string;
  slipSearchLabel: string;
  slipPickAll: string;
  slipPickOne: string; // "{name}"
  slipPicked: string; // "{n}"
  slipBarLabel: string;
  slipClear: string;
  slipNoMatch: string;
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
  /** 그 달만 지급 방식 · 지난달 값 가져오기 · 급여 계좌(2026-10-26). */
  monthMethod: string;
  monthMethodDiffers: string;
  monthMethodReset: string;
  monthOnlyTag: string;
  carryOpen: string;
  carryTitle: string;
  carryBody: string;
  carrySpecial: string;
  carrySpecialHint: string;
  carryWithholding: string;
  carryMemo: string;
  carryOvertimeWeekend: string;
  carryOvertimeWeekendHint: string;
  carryNever: string;
  carryCount: string;
  carryRun: string;
  carryNothing: string;
  carryDone: string;
  carryLoading: string;
  bankChanged: string;
  bankChangedLine: string;
  bankFirstLine: string;
  bankConfirm: string;
  bankConfirmedToast: string;
  bankBeforeConfirm: string;
  bankView: string;
  bankAdd: string;
  bankCopy: string;
  bankCopied: string;
  bankAccount: string;
  bankNoticeTitle: string;
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
  lockedNote: "결재가 진행 중이라 숫자를 고칠 수 없어요. 고칠 게 있으면 돌려보내 주세요.",
  lockedShort: "결재 중이라 숫자가 잠겨 있어요",
  errorLocked: "결재 중이라 고칠 수 없어요",
  errorConflict: "다른 사람이 먼저 바꿨어요. 화면을 새로 고쳤어요.",
  errorHasChecks: "지급 체크가 있어 되돌릴 수 없어요",
  errorOrder: "봉투를 먼저 넣어 주세요",
  errorNotReady: "확인할 사람이 남아 있어요",
  errorNoApprover: "설정 › 급여에서 사장 결재자를 정해 주세요",
  reasonRequired: "이유를 적어 주세요",
  ownerSheet: "사장 확인표",
  approvalTitle: "결재",
  slotSenmu: "전무",
  slotPresident: "사장",
  slotSenmuShort: "전무",
  slotPresidentShort: "사장",
  stampWaiting: "대기",
  approve: "결재",
  returnAction: "돌려보내기",
  returnBody: "급여 준비로 돌아가고, 결재도 함께 풀려요. 고칠 점을 남겨 주세요.",
  revertAction: "결재 되돌리기",
  revertBody: "급여 준비로 돌아가고 결재가 모두 풀려요. 이유를 남겨 주세요.",
  reasonLabel: "이유",
  cancel: "취소",
  cancelRequest: "요청 취소",
  requestedToast: "결재를 요청했어요",
  cancelledToast: "결재 요청을 취소했어요",
  approvedToast: "{slot} 결재했어요",
  returnedToast: "급여 준비로 돌려보냈어요",
  turnOf: "{slot} 결재 차례",
  myTurnCard: "결재할 급여",
  approveCardTitle: "{month}분 급여",
  approveCardSub: "{n}명 · 실수령 {amount}",
  returnedNote: "{name} 님이 돌려보냈어요 · {reason}",
  stampNote: "결재 도장이 같이 찍혀 나가요",
  historyTitle: "기록",
  evRequest: "결재 요청",
  evCancel: "결재 요청 취소",
  evApprove: "{slot} 결재",
  evUndo: "{slot} 결재 취소",
  evReturn: "돌려보냄",
  evRevert: "결재 되돌림",
  evPaid: "지급 완료",
  evUnpaid: "지급 완료 풀림",
  evSent: "세무사에게 보냄",
  evUnsent: "세무사 송부 취소",
  stPreparing: "급여 준비",
  stApprovalSenmu: "전무 결재 중",
  stApprovalPresident: "사장 결재 중",
  stPaying: "지급 중",
  stPaid: "지급 완료",
  stSent: "세무사 송부 끝",
  approvalWait: "결재를 기다리고 있어요",
  payProgressLabel: "지급 확인",
  payProgress: "{done} / {n}명",
  envelope: "봉투 넣음",
  envelopeShort: "봉투",
  received: "본인 확인",
  transferDone: "이체 완료",
  allTransferred: "모두 이체 완료",
  cashGroup: "현금",
  transferGroup: "이체",
  cashHint: "봉투에 넣고, 받은 사람이 확인해요",
  checkToast: "{name} {what}",
  uncheckToast: "{name} {what} 취소",
  allTransferredToast: "{n}명 이체 완료",
  paidAllToast: "지급이 모두 끝났어요",
  taxSend: "세무사에게 보냄",
  taxSendHint: "지급이 모두 끝나면 체크할 수 있어요",
  taxSentToast: "세무사에게 보냈다고 표시했어요",
  taxFiles: "세무사용 파일",
  filesTitle: "파일",
  fileBook: "급여 파일",
  fileBookHint: "명세서 · 사장 확인표 · 지급 확인 목록",
  fileTax: "세무사용",
  fileTaxHint: "원천세 구분별 지급 목록",
  fileSaved: "{name} 저장됨",
  fileOpened: "PDF 를 새 탭에 열었어요",
  slip: "명세서",
  slipThis: "이 사람 것만",
  slipOnly: "명세서만 뽑기",
  slipOnlyHint: "사람을 골라 그 사람 명세서만",
  slipSheetTitle: "명세서 뽑을 사람",
  slipSheetSub: "{month} · 고른 사람 것만",
  slipSearch: "이름 · 가타카나",
  slipSearchLabel: "이름 찾기",
  slipPickAll: "전체 고르기",
  slipPickOne: "{name} 고르기",
  slipPicked: "{n}명",
  slipBarLabel: "고른 사람 명세서",
  slipClear: "고르기 해제",
  slipNoMatch: "찾는 사람이 없어요",
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
    bank_missing: "계좌 이체인데 계좌가 없어요",
  },
  hintWithholding: "여기가 주된 일터면 갑",
  hintKatakana: "본인이 앱 「내 정보」에서 넣어요",
  hintNotFinalized: "근태 마감 단계에서 마감해 주세요",
  monthMethod: "이번 달 지급",
  monthMethodDiffers: "기본은 {base} · 이번 달만 {method}",
  monthMethodReset: "기본으로",
  monthOnlyTag: "이번 달만 {method}",
  carryOpen: "지난달 값 가져오기",
  carryTitle: "{month}분 값을 가져올까요",
  carryBody: "비어 있는 칸만 채워요. 이미 적은 칸은 그대로예요.",
  carrySpecial: "특별수당",
  carrySpecialHint: "손으로 적은 몫만",
  carryWithholding: "원천세 직접 입력 · 사유",
  carryMemo: "메모",
  carryOvertimeWeekend: "잔업 · 주말 손 입력분",
  carryOvertimeWeekendHint: "달마다 달라서 기본은 빼요",
  carryNever: "지난달 조정 · 연말정산 · 이번 달만 지급 방식은 그 달 값이라 가져오지 않아요.",
  carryCount: "{n}명",
  carryRun: "가져오기",
  carryNothing: "가져올 값이 없어요",
  carryDone: "{people}명 {cells}칸 채웠어요",
  carryLoading: "확인 중…",
  bankChanged: "계좌 바뀜",
  bankChangedLine: "{date} 본인이 바꿈 · {from} → {to}",
  bankFirstLine: "{date} 본인이 처음 적음 · {to}",
  bankConfirm: "확인함",
  bankConfirmedToast: "{name} 계좌를 확인했어요",
  bankBeforeConfirm: "확인 전 · 이전 계좌로",
  bankView: "보기",
  bankAdd: "계좌 넣기",
  bankCopy: "계좌번호 복사",
  bankCopied: "계좌번호를 복사했어요",
  bankAccount: "계좌",
  bankNoticeTitle: "계좌 확인",
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
  lockedNote: "決裁中のため数字は変更できません。直す点があれば差し戻してください。",
  lockedShort: "決裁中のため数字はロックされています",
  errorLocked: "決裁中のため変更できません",
  errorConflict: "他の人が先に変更しました。画面を更新しました。",
  errorHasChecks: "支給チェックがあるため戻せません",
  errorOrder: "先に封入してください",
  errorNotReady: "確認が必要な人が残っています",
  errorNoApprover: "設定 › 給与で社長の決裁者を決めてください",
  reasonRequired: "理由を入力してください",
  ownerSheet: "社長確認表",
  approvalTitle: "決裁",
  slotSenmu: "専務",
  slotPresident: "社長",
  slotSenmuShort: "専務",
  slotPresidentShort: "社長",
  stampWaiting: "未",
  approve: "決裁する",
  returnAction: "差し戻す",
  returnBody: "給与準備に戻り、決裁も解除されます。直す点を書いてください。",
  revertAction: "決裁を戻す",
  revertBody: "給与準備に戻り、決裁はすべて解除されます。理由を書いてください。",
  reasonLabel: "理由",
  cancel: "キャンセル",
  cancelRequest: "依頼を取り消す",
  requestedToast: "決裁を依頼しました",
  cancelledToast: "決裁依頼を取り消しました",
  approvedToast: "{slot}として決裁しました",
  returnedToast: "給与準備に差し戻しました",
  turnOf: "{slot}の決裁待ち",
  myTurnCard: "決裁する給与",
  approveCardTitle: "{month}分 給与",
  approveCardSub: "{n}人 · 差引支給 {amount}",
  returnedNote: "{name}さんが差し戻しました · {reason}",
  stampNote: "決裁の印が一緒に印字されます",
  historyTitle: "履歴",
  evRequest: "決裁依頼",
  evCancel: "決裁依頼の取消",
  evApprove: "{slot} 決裁",
  evUndo: "{slot} 決裁取消",
  evReturn: "差し戻し",
  evRevert: "決裁を戻した",
  evPaid: "支給完了",
  evUnpaid: "支給完了を解除",
  evSent: "税理士に送付",
  evUnsent: "税理士送付の取消",
  stPreparing: "給与準備",
  stApprovalSenmu: "専務 決裁中",
  stApprovalPresident: "社長 決裁中",
  stPaying: "支給中",
  stPaid: "支給完了",
  stSent: "税理士送付済み",
  approvalWait: "決裁を待っています",
  payProgressLabel: "支給確認",
  payProgress: "{done} / {n}人",
  envelope: "封入済み",
  envelopeShort: "封入",
  received: "本人確認",
  transferDone: "振込済み",
  allTransferred: "すべて振込済み",
  cashGroup: "現金",
  transferGroup: "振込",
  cashHint: "封入して、受け取った本人が確認します",
  checkToast: "{name} {what}",
  uncheckToast: "{name} {what}を取消",
  allTransferredToast: "{n}人 振込済み",
  paidAllToast: "支給がすべて完了しました",
  taxSend: "税理士に送付済み",
  taxSendHint: "支給がすべて終わるとチェックできます",
  taxSentToast: "税理士に送付済みにしました",
  taxFiles: "税理士用ファイル",
  filesTitle: "ファイル",
  fileBook: "給与ファイル",
  fileBookHint: "明細・社長確認表・支給確認一覧",
  fileTax: "税理士用",
  fileTaxHint: "源泉区分ごとの支給一覧",
  fileSaved: "{name} を保存しました",
  fileOpened: "PDFを新しいタブで開きました",
  slip: "給与明細書",
  slipThis: "この人の分だけ",
  slipOnly: "明細書だけ出す",
  slipOnlyHint: "人を選んで、その人の明細書だけ",
  slipSheetTitle: "明細書を出す人",
  slipSheetSub: "{month}・選んだ人の分だけ",
  slipSearch: "名前・カタカナ",
  slipSearchLabel: "名前で探す",
  slipPickAll: "全員を選ぶ",
  slipPickOne: "{name}を選ぶ",
  slipPicked: "{n}名",
  slipBarLabel: "選んだ人の明細書",
  slipClear: "選択を解除",
  slipNoMatch: "該当する人がいません",
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
    bank_missing: "振込なのに口座がありません",
  },
  hintWithholding: "ここが主たる勤務先なら甲",
  hintKatakana: "本人がアプリの「マイ情報」で入力します",
  hintNotFinalized: "勤怠締めの段階で締めてください",
  monthMethod: "今月の支払方法",
  monthMethodDiffers: "通常は{base} · 今月のみ{method}",
  monthMethodReset: "通常に戻す",
  monthOnlyTag: "今月のみ{method}",
  carryOpen: "前月の値を引き継ぐ",
  carryTitle: "{month}分の値を引き継ぎますか",
  carryBody: "空欄だけを埋めます。入力済みの欄はそのままです。",
  carrySpecial: "特別手当",
  carrySpecialHint: "手入力分のみ",
  carryWithholding: "源泉税の直接入力 · 理由",
  carryMemo: "メモ",
  carryOvertimeWeekend: "残業 · 週末の手入力分",
  carryOvertimeWeekendHint: "毎月変わるので初期は外しています",
  carryNever: "前月調整額 · 年末調整 · 今月のみの支払方法はその月だけの値なので引き継ぎません。",
  carryCount: "{n}人",
  carryRun: "引き継ぐ",
  carryNothing: "引き継ぐ値がありません",
  carryDone: "{people}人 {cells}欄を埋めました",
  carryLoading: "確認中…",
  bankChanged: "口座変更",
  bankChangedLine: "{date} 本人が変更 · {from} → {to}",
  bankFirstLine: "{date} 本人が初めて登録 · {to}",
  bankConfirm: "確認済みにする",
  bankConfirmedToast: "{name}の口座を確認しました",
  bankBeforeConfirm: "確認前 · 以前の口座へ",
  bankView: "見る",
  bankAdd: "口座を登録",
  bankCopy: "口座番号をコピー",
  bankCopied: "口座番号をコピーしました",
  bankAccount: "口座",
  bankNoticeTitle: "口座の確認",
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
  lockedNote: "Numbers are locked during approval. Send it back if something needs fixing.",
  lockedShort: "Numbers are locked during approval",
  errorLocked: "Locked during approval",
  errorConflict: "Someone else changed this first. The screen has been refreshed.",
  errorHasChecks: "Can’t undo: payments are already checked",
  errorOrder: "Mark the envelope first",
  errorNotReady: "Some people still need checking",
  errorNoApprover: "Set the president approver in Settings › Payroll",
  reasonRequired: "Enter a reason",
  ownerSheet: "Owner sheet",
  approvalTitle: "Approval",
  slotSenmu: "Managing director",
  slotPresident: "President",
  slotSenmuShort: "MD",
  slotPresidentShort: "Pres.",
  stampWaiting: "Waiting",
  approve: "Approve",
  returnAction: "Send back",
  returnBody: "It goes back to Pay prep and approvals are cleared. Say what needs fixing.",
  revertAction: "Undo approval",
  revertBody: "It goes back to Pay prep and all approvals are cleared. Give a reason.",
  reasonLabel: "Reason",
  cancel: "Cancel",
  cancelRequest: "Cancel request",
  requestedToast: "Approval requested",
  cancelledToast: "Request cancelled",
  approvedToast: "Approved as {slot}",
  returnedToast: "Sent back to Pay prep",
  turnOf: "{slot} to approve",
  myTurnCard: "Pay to approve",
  approveCardTitle: "{month} pay",
  approveCardSub: "{n} people · take-home {amount}",
  returnedNote: "{name} sent it back · {reason}",
  stampNote: "Approval stamps are printed on the files",
  historyTitle: "History",
  evRequest: "Approval requested",
  evCancel: "Request cancelled",
  evApprove: "{slot} approved",
  evUndo: "{slot} approval undone",
  evReturn: "Sent back",
  evRevert: "Approval undone",
  evPaid: "Paid",
  evUnpaid: "Paid status cleared",
  evSent: "Sent to accountant",
  evUnsent: "Accountant send undone",
  stPreparing: "Pay prep",
  stApprovalSenmu: "Waiting for MD",
  stApprovalPresident: "Waiting for president",
  stPaying: "Paying",
  stPaid: "Paid",
  stSent: "Sent to accountant",
  approvalWait: "Waiting for approval",
  payProgressLabel: "Payments checked",
  payProgress: "{done} / {n}",
  envelope: "In envelope",
  envelopeShort: "Envelope",
  received: "Received",
  transferDone: "Transferred",
  allTransferred: "Mark all transferred",
  cashGroup: "Cash",
  transferGroup: "Transfer",
  cashHint: "Put it in an envelope; the person confirms receipt",
  checkToast: "{name}: {what}",
  uncheckToast: "{name}: {what} undone",
  allTransferredToast: "{n} marked transferred",
  paidAllToast: "All payments are done",
  taxSend: "Sent to accountant",
  taxSendHint: "Available once all payments are done",
  taxSentToast: "Marked as sent to accountant",
  taxFiles: "Files for accountant",
  filesTitle: "Files",
  fileBook: "Payroll file",
  fileBookHint: "Payslips · owner sheet · payment check",
  fileTax: "Tax accountant",
  fileTaxHint: "Pay list by tax column",
  fileSaved: "Saved {name}",
  fileOpened: "Opened the PDF in a new tab",
  slip: "Payslip",
  slipThis: "This person only",
  slipOnly: "Payslips only",
  slipOnlyHint: "Pick people, get just their payslips",
  slipSheetTitle: "Who gets a payslip",
  slipSheetSub: "{month} · selected people only",
  slipSearch: "Name or katakana",
  slipSearchLabel: "Find by name",
  slipPickAll: "Select all",
  slipPickOne: "Select {name}",
  slipPicked: "{n} selected",
  slipBarLabel: "Payslips for selected people",
  slipClear: "Clear",
  slipNoMatch: "No one matches",
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
    bank_missing: "Bank transfer but no account",
  },
  hintWithholding: "甲 if this is their main job",
  hintKatakana: "They add it in the app under My info",
  hintNotFinalized: "Close it in the attendance step",
  monthMethod: "Payment this month",
  monthMethodDiffers: "Usually {base} · {method} this month only",
  monthMethodReset: "Use default",
  monthOnlyTag: "{method} this month only",
  carryOpen: "Copy last month",
  carryTitle: "Copy values from {month}?",
  carryBody: "Only empty fields are filled. Fields you already entered stay as they are.",
  carrySpecial: "Special allowance",
  carrySpecialHint: "Hand-entered part only",
  carryWithholding: "Withholding override · reason",
  carryMemo: "Memo",
  carryOvertimeWeekend: "Overtime · weekend hand-entered part",
  carryOvertimeWeekendHint: "Off by default — it changes every month",
  carryNever: "Previous-month adjustment, year-end adjustment and this month’s payment method belong to that month, so they aren’t copied.",
  carryCount: "{n}",
  carryRun: "Copy",
  carryNothing: "Nothing to copy",
  carryDone: "Filled {cells} fields for {people} people",
  carryLoading: "Checking…",
  bankChanged: "Account changed",
  bankChangedLine: "{date} changed by staff · {from} → {to}",
  bankFirstLine: "{date} first entered by staff · {to}",
  bankConfirm: "Mark checked",
  bankConfirmedToast: "Checked {name}’s account",
  bankBeforeConfirm: "Not checked · paying to previous account",
  bankView: "View",
  bankAdd: "Add account",
  bankCopy: "Copy account number",
  bankCopied: "Account number copied",
  bankAccount: "Account",
  bankNoticeTitle: "Bank account check",
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
