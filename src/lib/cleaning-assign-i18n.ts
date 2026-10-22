import type { Locale } from "@/lib/i18n";

/**
 * 시프트 신청 · 청소 배정 문구(ko · ja · en). 화면이 클라이언트로 통째로 넘기므로 **문자열만**(함수 금지) — `{n}` 자리표시자 + `.replace()`.
 * docs/product/37-cleaning-shift-assignment.md
 */
export type CleaningAssignCopy = {
  // ── 공통 ──
  title: string;
  crumb: string;
  viewDay: string;
  viewMonth: string;
  prevDay: string;
  nextDay: string;
  prevMonth: string;
  nextMonth: string;
  weekdaysShort: string; // "일,월,화,수,목,금,토"
  dateLong: string; // "{m}월 {d}일 ({w})"
  monthLabel: string; // "{y}년 {m}월"
  live: string; // "실시간 · {ago} {name}님이 배정"
  liveNone: string;
  agoJustNow: string;
  agoMin: string; // "{n}분 전"
  agoHour: string;
  agoDay: string;
  myBuildings: string; // "내 건물 · {list}"
  allBuildings: string;
  pickBuildings: string;
  saveBuildings: string;
  addRoom: string;
  fixedFirst: string;
  settingsLink: string;
  compareLink: string;
  unitRoom: string; // "실"
  unitPerson: string; // "명"
  statRooms: string;
  statOpen: string;
  statApplied: string;
  statAssigned: string;
  statWaiting: string;
  // ── 방 쪽 ──
  openTitle: string;
  applyAll: string; // "제안대로 {n}개 넣기"
  suggest: string; // "제안"
  put: string; // "{name} 넣기"
  tagCarry: string; // "어제부터 · {n}일째"
  tagNew: string; // "새로 들어옴 {time}"
  tagExtra: string; // "직접 추가"
  tagBig: string; // "큰 방 · {have}/{need} · {more}명 더 필요"
  tagCancelled: string;
  cancelledBody: string; // "{names} — 방이 없어졌어요"
  attachElsewhere: string;
  cancelDay: string;
  turnover: string; // "오늘 체크인 {n}명"
  turnoverUnknown: string;
  noCheckin: string; // "체크인 없음"
  nextCheckin: string; // "다음 체크인 {date}"
  guestsN: string; // "{n}명"
  calendarOpenMark: string; // 달력 칸 숫자의 뜻 "미배정 {n}실"
  bigRoom: string; // "큰 방"
  statusProgress: string;
  statusDone: string;
  deferredTo: string; // "{date}로 미룸"
  moreActions: string;
  deferNextDay: string;
  deferPick: string;
  resolve: string; // "처리 끝(청소 필요 없음)"
  undoHold: string;
  tagResolved: string; // "처리 끝"
  heldDeferred: string; // "{room} — {date}로 미뤘어요"
  heldResolved: string; // "{room} — 처리 끝으로 뒀어요"
  heldUndone: string; // "되돌렸어요"
  reasonPlaceholder: string;
  deferUntilLabel: string;
  confirm: string;
  cancel: string;
  noRooms: string;
  noOpen: string;
  roomsMore: string; // "{name} {n}개 더 보기"
  pickBanner: string; // "{name} · 방 {n}개 — 방을 누르면 넣고, 다시 누르면 빼요"
  pickClear: string; // "고르기 해제 · Esc"
  addHere: string; // "+ 넣기"
  removeHere: string; // "빼기"
  traineeShort: string; // "견습 {n}"
  // ── 사람 쪽 ──
  applicants: string;
  applicantsSub: string; // "현장 {total}명 중 신청 {applied} · 신청 안 함 {none}"
  tabApplied: string; // "신청 {n}"
  tabWaiting: string; // "배정 전 {n}"
  tabNone: string; // "신청 안 함 {n}"
  searchName: string;
  stateWaiting: string; // "배정 전"
  stateWaitingSuggest: string; // "배정 전 · 제안 {room}"
  stateAssigned: string; // "배정 {n} · {rooms}"
  withOthers: string; // "({n}명)"
  statePersonCancelled: string; // "그날 일정 취소됨"
  restoreDay: string;
  cancelRequest: string; // "취소 요청"
  cancelRequestAccept: string;
  cancelRequestReject: string;
  prio: string; // "우선"
  traineeNth: string; // "견습 {n}번째"
  traineeAsk: string; // "아직 견습인가요?"
  traineeDone: string;
  traineeKeep: string;
  traineeBuildings: string; // "건물별 — {list}"
  tierBadge: string; // "{n}순위"
  byAdmin: string; // "관리자가 넣음"
  startTime: string;
  startTimeReset: string;
  noneHint: string; // "{date}에 신청하지 않은 사람 · 최근 출근이 가까운 순"
  lastWorked: string; // "최근 출근 {date} · 이번 달 {n}일"
  neverWorked: string;
  putInstead: string; // "대신 넣기"
  roleStaff: string;
  rolePart: string;
  roleManager: string;
  roleLeader: string;
  more: string; // "{n}명 더 보기"
  conflict: string;
  failed: string;
  done: string;
  added: string; // "{n}개 넣었어요"
  nothingToAdd: string;
  // ── 방 추가 창 ──
  addRoomTitle: string;
  addRoomSub: string; // "{date} · 체크아웃이 없어도 청소할 방"
  building: string;
  room: string;
  memoOptional: string;
  peopleOptional: string;
  addAndPut: string;
  addOnly: string;
  // ── 월 보기 ──
  monthSuggest: string; // "{m}월 자동 제안"
  monthNoDeadline: string;
  legendApplied: string;
  legendAssigned: string;
  legendSuggested: string;
  legendHint: string;
  sumRooms: string;
  sumApplied: string;
  sumOpen: string;
  previewTitle: string;
  previewBody: string; // "미배정 방 {open}개 중 {fill}개를 채워요 · 이미 배정된 방은 그대로"
  previewShort: string; // "사람이 모자란 날 {n}일 ({days}) — {left}개 남아요"
  previewApply: string; // "{n}개 반영"
  monthTotal: string; // "{n}방"
  // ── 배정 설정 ──
  settingsTitle: string;
  settingsBack: string;
  lastChanged: string; // "마지막 변경 · {name} {date}"
  tabRules: string;
  tabFixed: string;
  tabPeople: string;
  tabRooms: string;
  rulesTitle: string;
  rulesSub: string;
  moveUp: string;
  moveDown: string;
  resetRules: string;
  alwaysTitle: string;
  alwaysSub: string;
  always1: string;
  always2: string;
  always3: string;
  always4: string;
  rule_fixed_staff: string;
  rule_fixed_staff_desc: string;
  rule_fewest_rooms: string;
  rule_fewest_rooms_desc: string;
  rule_priority: string;
  rule_priority_desc: string;
  rule_same_building: string;
  rule_same_building_desc: string;
  rule_fewest_month_days: string;
  rule_fewest_month_days_desc: string;
  rule_late_start_last: string;
  rule_late_start_last_desc: string;
  fixedTitle: string; // "{building} 고정 인력"
  fixedSub: string;
  tierLabel: string; // "{n}순위"
  addToTier: string; // "+ {tier}에 사람 넣기"
  addTier: string;
  removePerson: string; // "{name} 빼기"
  fixedMonth: string; // "이번 달 {n}일 · 최근 {date}"
  peopleTitle: string; // "현장 {n}명"
  colName: string;
  colRole: string;
  colStart: string;
  colPriority: string;
  colTrainee: string;
  colTrainer: string;
  colFixed: string;
  colMemo: string;
  memoPlaceholder: string;
  roomsTitle: string;
  roomsSub: string;
  headcount: string; // "보통 {n}명"
  saved: string;
  // ── 비교표 ──
  compareTitle: string;
  excludeToggle: string;
  payNote: string;
  avgPerRoom: string;
  avgMinutes: string;
  flagged: string; // "평균에서 {n}% 넘게 벗어남"
  checkTitle: string;
  checkLine: string; // "방 {rooms}개에 {pay}"
  checkPer: string; // "방당 {per} ({dev})"
  checkMinutes: string; // "방당 {min}분"
  checkMore: string; // "{n}명 더 · 표에서 신호 있는 사람만 보기"
  checkNone: string;
  attendanceLink: string;
  readGuide: string;
  chartCaption: string;
  colDays: string;
  colAssigned: string;
  colCleaned: string;
  colHours: string;
  colPay: string;
  colPerRoom: string;
  colPerMinutes: string;
  colSignal: string;
  sigHigh: string; // "방당 급여 평균보다 {n}% 높음 — 확인"
  sigLow: string; // "방당 급여 평균보다 {n}% 낮음"
  sigTrainee: string;
  sigStaff: string;
  showAll: string;
  showFlagged: string;
  minutesUnit: string;
  hoursUnit: string; // "{n}시간"
  daysUnit: string; // "{n}일"
  compareEmpty: string;
  // ── 모바일 — 내 시프트 ──
  /** 2026-10-22 다듬기(HIG) — 내 시프트 · 오늘 내 방 */
  applyNextMonth: string; // "{m}월 신청"
  nextMonthDue: string; // "{m}월 신청은 월말까지 · {n}일 남음"
  nextShift: string; // "다음 근무"
  nextShiftTitle: string; // "{rel} {time} · 방 {n}개"
  markNoneShort: string; // "없음"
  ringHint: string; // "빈 원은 신청한 날, 채운 원은 배정된 날이에요."
  startAt: string; // "{time} 출근"
  roomsN: string; // "방 {n}개"
  matesHead: string; // "같이 일해요"
  progressDone: string; // "{n}개 중 {d}개 끝남"
  nowRoom: string; // "지금 할 방"
  restRooms: string; // "남은 방"
  doneRooms: string; // "끝난 방"
  factCheckin: string;
  factWith: string;
  factNote: string;
  factDoor: string;
  startRoom: string; // "{room} 청소 시작"
  continueCleaning: string;
  myShiftTitle: string;
  nextMonthBanner: string; // "{m}월 시프트를 월말까지 신청해 주세요"
  goNextMonth: string; // "{m}월로"
  monthSummary: string; // "신청 {a}일 · 배정 {b}일"
  legendMyAssigned: string;
  legendMyWaiting: string;
  legendMyNone: string;
  tapHint: string;
  markRooms: string; // "{n}방"
  markApplied: string; // "신청"
  markNone: string; // "배정 없음"
  markWorked: string; // "완료"
  upcoming: string;
  upcomingEmpty: string;
  upAssigned: string; // "{time} · 방 {n}개 — {rooms}"
  upWaiting: string;
  upWaitingSub: string;
  upNone: string;
  upNoneSub: string;
  upCancelled: string;
  withMate: string; // "{names}와 같이"
  sheetDay: string; // "{date} · {rel}"
  sheetTitle: string; // "{time} 출근 · 방 {n}개"
  mates: string; // "같이 일해요 · {names}"
  requestCancel: string;
  requestCancelNote: string;
  requestPending: string;
  withdrawRequest: string;
  today: string;
  tomorrow: string;
  errAssigned: string;
  errCancelledDay: string;
  errPast: string;
  errTooFar: string;
  // ── 모바일 — 오늘 내 방 ──
  todayTitle: string;
  todayHeadline: string; // "출근 · 방 {n}개 · {d}개 끝남"
  changedLastNight: string;
  changedBody: string; // "{time} · {rooms}이 더해졌어요"
  startCleaning: string;
  viewRecord: string;
  roomLinks: string;
  stateWaitingRoom: string; // "대기"
  stateDoneRoom: string; // "끝남"
  stateProgressRoom: string; // "청소 중"
  alone: string; // "혼자"
  todayMates: string;
  tomorrowLine: string; // "내일 {date}"
  emptyTitle: string;
  emptyBodyNone: string;
  emptyBodyWaiting: string;
  emptyBodyFree: string;
  goMyShift: string;
};

const ko: CleaningAssignCopy = {
  title: "청소 배정",
  crumb: "운영",
  viewDay: "하루",
  viewMonth: "월",
  prevDay: "이전 날",
  nextDay: "다음 날",
  prevMonth: "이전 달",
  nextMonth: "다음 달",
  weekdaysShort: "일,월,화,수,목,금,토",
  dateLong: "{m}월 {d}일 ({w})",
  monthLabel: "{y}년 {m}월",
  live: "실시간 · {ago} {name}님이 배정",
  liveNone: "실시간 · 아직 배정 없음",
  agoJustNow: "방금",
  agoMin: "{n}분 전",
  agoHour: "{n}시간 전",
  agoDay: "{n}일 전",
  myBuildings: "내 건물 · {list}",
  allBuildings: "전체 건물",
  pickBuildings: "볼 건물",
  saveBuildings: "내 건물로 저장",
  addRoom: "+ 방 추가",
  fixedFirst: "고정 인력 먼저 넣기",
  settingsLink: "배정 설정",
  compareLink: "월 비교표",
  unitRoom: "실",
  unitPerson: "명",
  statRooms: "청소 방",
  statOpen: "미배정",
  statApplied: "신청",
  statAssigned: "배정됨",
  statWaiting: "배정 전",
  openTitle: "미배정",
  applyAll: "제안대로 {n}개 넣기",
  suggest: "제안",
  put: "{name} 넣기",
  tagCarry: "어제부터 · {n}일째",
  tagNew: "새로 들어옴 {time}",
  tagExtra: "직접 추가",
  tagBig: "큰 방 · {have}/{need} · {more}명 더 필요",
  tagCancelled: "예약 취소됨",
  cancelledBody: "{names} — 방이 없어졌어요",
  attachElsewhere: "다른 방에 붙이기",
  cancelDay: "일정 취소",
  turnover: "오늘 체크인 {n}명",
  turnoverUnknown: "오늘 체크인",
  noCheckin: "체크인 없음",
  nextCheckin: "다음 체크인 {date}",
  guestsN: "{n}명",
  calendarOpenMark: "미배정 {n}실",
  bigRoom: "큰 방",
  statusProgress: "청소 중",
  statusDone: "끝남",
  deferredTo: "{date}로 미룸",
  moreActions: "미루기 · 처리 끝",
  deferNextDay: "다음 날로 미루기",
  deferPick: "날짜 정해 미루기",
  resolve: "처리 끝 (청소 필요 없음)",
  undoHold: "되돌리기",
  tagResolved: "처리 끝",
  heldDeferred: "{room} — {date}로 미뤘어요",
  heldResolved: "{room} — 처리 끝으로 뒀어요",
  heldUndone: "되돌렸어요",
  reasonPlaceholder: "사유 한 줄 (예: 인원 부족)",
  deferUntilLabel: "이날 다시 보여요",
  confirm: "확인",
  cancel: "취소",
  noRooms: "이날 청소할 방이 없어요",
  noOpen: "미배정 방이 없어요",
  roomsMore: "{name} {n}개 더 보기",
  pickBanner: "{name} · 방 {n}개 — 방을 누르면 넣고, 다시 누르면 빼요",
  pickClear: "고르기 해제 · Esc",
  addHere: "+ 넣기",
  removeHere: "빼기",
  traineeShort: "견습 {n}",
  applicants: "신청자",
  applicantsSub: "현장 {total}명 중 신청 {applied} · 신청 안 함 {none}",
  tabApplied: "신청 {n}",
  tabWaiting: "배정 전 {n}",
  tabNone: "신청 안 함 {n}",
  searchName: "이름 찾기",
  stateWaiting: "배정 전",
  stateWaitingSuggest: "배정 전 · 제안 {room}",
  stateAssigned: "배정 {n} · {rooms}",
  withOthers: "({n}명)",
  statePersonCancelled: "그날 일정 취소됨",
  restoreDay: "다시 넣기",
  cancelRequest: "취소 요청",
  cancelRequestAccept: "취소 받아 주기",
  cancelRequestReject: "돌려보내기",
  prio: "우선",
  traineeNth: "견습 {n}번째",
  traineeAsk: "아직 견습인가요?",
  traineeDone: "견습 끝",
  traineeKeep: "계속 견습",
  traineeBuildings: "건물별 — {list}",
  tierBadge: "{n}순위",
  byAdmin: "관리자가 넣음",
  startTime: "그날 출근 시각",
  startTimeReset: "기본 시각으로",
  noneHint: "{date}에 신청하지 않은 사람 · 최근 출근이 가까운 순",
  lastWorked: "최근 출근 {date} · 이번 달 {n}일",
  neverWorked: "아직 출근 기록 없음",
  putInstead: "대신 넣기",
  roleStaff: "직원",
  rolePart: "알바",
  roleManager: "현장 관리자",
  roleLeader: "알바 리더",
  more: "{n}명 더 보기",
  conflict: "방금 다른 담당자가 바꿔서 새로 불러왔어요",
  failed: "저장하지 못했어요. 다시 시도해 주세요",
  done: "저장했어요",
  added: "{n}개 넣었어요",
  nothingToAdd: "넣을 제안이 없어요",
  addRoomTitle: "청소할 방 추가",
  addRoomSub: "{date} · 체크아웃이 없어도 청소할 방",
  building: "건물",
  room: "방",
  memoOptional: "메모 (선택)",
  peopleOptional: "바로 넣을 사람 (선택)",
  addAndPut: "추가하고 넣기",
  addOnly: "추가",
  monthSuggest: "{m}월 자동 제안",
  monthNoDeadline: "신청 마감 없음 · 20일부터 알바에게 「다음 달 신청」 안내",
  legendApplied: "신청만 함",
  legendAssigned: "배정 · 방 수",
  legendSuggested: "제안 (반영 전)",
  legendHint: "날짜를 누르면 그날 하루 보기 · 칸을 누르면 신청 넣기/빼기",
  sumRooms: "청소 방 (예약 기준)",
  sumApplied: "신청",
  sumOpen: "미배정 방",
  previewTitle: "제안 미리 보기",
  previewBody: "미배정 방 {open}개 중 {fill}개를 채워요 · 이미 배정된 방은 그대로",
  previewShort: "사람이 모자란 날 {n}일 ({days})",
  previewApply: "{n}개 반영",
  monthTotal: "{n}방",
  settingsTitle: "배정 설정",
  settingsBack: "‹ 청소 배정",
  lastChanged: "마지막 변경 · {name} {date}",
  tabRules: "제안 규칙",
  tabFixed: "건물별 고정 인력",
  tabPeople: "사람별",
  tabRooms: "큰 방",
  rulesTitle: "제안 규칙",
  rulesSub: "위에서부터 먼저 봐요 · 끌거나 위아래 버튼으로 순서 바꾸기",
  moveUp: "위로",
  moveDown: "아래로",
  resetRules: "처음 값으로 되돌리기",
  alwaysTitle: "항상 지켜요",
  alwaysSub: "규칙 순서와 상관없이 끌 수 없어요",
  always1: "견습은 혼자 두지 않아요 — 매니저 · 견습 담당이 있는 방에만",
  always2: "같은 사람을 같은 방에 두 번 넣지 않아요",
  always3: "큰 방은 보통 인원까지 채워요",
  always4: "그날 신청한 사람만 제안해요 — 신청 안 한 사람은 「대신 넣기」로",
  rule_fixed_staff: "건물 고정 인력 먼저",
  rule_fixed_staff_desc: "「건물별 고정 인력」의 1순위 → 2순위 → 3순위, 그날 신청한 사람만",
  rule_fewest_rooms: "배정 전인 사람 먼저 · 방이 적은 사람 먼저",
  rule_fewest_rooms_desc: "방이 0개인 사람부터, 그다음 그날 방이 적은 순 — 고르게 나눠요",
  rule_priority: "「우선 배정」 표시 먼저",
  rule_priority_desc: "사람별에서 켜 둔 사람(일 잘하는 · 자주 나오는 고정 인력)",
  rule_same_building: "같은 건물끼리 묶기",
  rule_same_building_desc: "이미 그 건물에 방이 있는 사람 먼저 — 건물 사이 이동을 줄여요",
  rule_fewest_month_days: "이번 달 근무 일수가 적은 사람 먼저",
  rule_fewest_month_days_desc: "이번 달에 덜 나온 사람에게 기회를 더 줘요",
  rule_late_start_last: "늦게 출근하는 사람은 뒤로",
  rule_late_start_last_desc: "그날 출근 시각이 늦은 사람은 나중에 골라요",
  fixedTitle: "{building} 고정 인력",
  fixedSub: "그날 신청한 사람만 1순위부터 이 건물 방에 먼저 들어가요 · 같은 순위 안에서는 방이 적은 사람 먼저",
  tierLabel: "{n}순위",
  addToTier: "+ {tier}에 사람 넣기",
  addTier: "+ 순위 추가",
  removePerson: "{name} 빼기",
  fixedMonth: "이번 달 {n}일 · 최근 {date}",
  peopleTitle: "현장 {n}명",
  colName: "이름",
  colRole: "구분",
  colStart: "기본 출근",
  colPriority: "우선 배정",
  colTrainee: "견습",
  colTrainer: "견습 담당",
  colFixed: "고정 건물",
  colMemo: "메모 (관리자만)",
  memoPlaceholder: "관리자끼리만 봐요",
  roomsTitle: "큰 방 · 보통 인원",
  roomsSub: "보통 2명이 들어가는 방을 정해 두면 제안이 그 인원만큼 채워요. 나머지는 1명.",
  headcount: "보통 {n}명",
  saved: "저장했어요",
  compareTitle: "청소 월 비교표",
  excludeToggle: "견습 · 직원 빼고 비교",
  payNote: "급여는 근태 · 급여 화면 값 그대로",
  avgPerRoom: "평균 방당 급여",
  avgMinutes: "평균 방당 시간",
  flagged: "평균에서 {n}% 넘게 벗어남",
  checkTitle: "확인할 사람",
  checkLine: "방 {rooms}개에 {pay}",
  checkPer: "방당 {per} ({dev})",
  checkMinutes: "방당 {min}분",
  checkMore: "{n}명 더 · 표에서 신호 있는 사람만 보기",
  checkNone: "이번 달은 평균에서 크게 벗어난 사람이 없어요",
  attendanceLink: "출근 기록 보기",
  readGuide: "방당 급여 = 그달 급여 ÷ 청소한 방(같이 한 방은 나눠 셈). 벗어났다고 잘못은 아니에요 — 다른 일 · 큰 방 · 이동이 많았을 수 있어요.",
  chartCaption: "청소한 방(가로) · 급여(세로) — 선은 평균 방당 급여",
  colDays: "근무일",
  colAssigned: "배정 방",
  colCleaned: "청소한 방",
  colHours: "근무 시간",
  colPay: "급여",
  colPerRoom: "방당 급여",
  colPerMinutes: "방당 시간",
  colSignal: "신호",
  sigHigh: "방당 급여 평균보다 {n}% 높음 — 확인",
  sigLow: "방당 급여 평균보다 {n}% 낮음",
  sigTrainee: "견습 — 비교에서 빠짐",
  sigStaff: "직원 — 비교에서 빠짐",
  showAll: "전체 보기",
  showFlagged: "신호 있는 사람만",
  minutesUnit: "분",
  hoursUnit: "{n}시간",
  daysUnit: "{n}일",
  compareEmpty: "이 달에는 배정 기록이 없어요",
  applyNextMonth: "{m}월 신청",
  nextMonthDue: "{m}월 신청은 월말까지 · {n}일 남음",
  nextShift: "다음 근무",
  nextShiftTitle: "{rel} {time} · 방 {n}개",
  markNoneShort: "없음",
  ringHint: "빈 원은 신청한 날, 채운 원은 배정된 날이에요.",
  startAt: "{time} 출근",
  roomsN: "방 {n}개",
  matesHead: "같이 일해요",
  progressDone: "{n}개 중 {d}개 끝남",
  nowRoom: "지금 할 방",
  restRooms: "남은 방",
  doneRooms: "끝난 방",
  factCheckin: "체크인",
  factWith: "같이",
  factNote: "메모",
  factDoor: "문 번호",
  startRoom: "{room} 청소 시작",
  continueCleaning: "청소 이어서 하기",
  myShiftTitle: "내 시프트",
  nextMonthBanner: "{m}월 시프트를 월말까지 신청해 주세요",
  goNextMonth: "{m}월로",
  monthSummary: "신청 {a}일 · 배정 {b}일",
  legendMyAssigned: "배정됨",
  legendMyWaiting: "신청 · 배정 전",
  legendMyNone: "배정 없음",
  tapHint: "날짜를 누르면 신청, 다시 누르면 취소예요. 배정된 날은 관리자에게 취소 요청이 가요.",
  markRooms: "{n}방",
  markApplied: "신청",
  markNone: "배정 없음",
  markWorked: "완료",
  upcoming: "다가오는 일정",
  upcomingEmpty: "앞으로 7일 동안 신청한 날이 없어요. 일할 수 있는 날을 달력에서 눌러 주세요.",
  upAssigned: "{time} · 방 {n}개 — {rooms}",
  upWaiting: "신청함 · 배정 전",
  upWaitingSub: "아직 방이 남아 있어요 · 전날 밤까지 정해져요",
  upNone: "배정 없음",
  upNoneSub: "그날 방이 모두 배정됐어요 · 나오지 않아도 돼요",
  upCancelled: "관리자가 그날 일정을 취소했어요",
  withMate: "{names}와 같이",
  sheetDay: "{date} · {rel}",
  sheetTitle: "{time} 출근 · 방 {n}개",
  mates: "같이 일해요 · {names}",
  requestCancel: "취소 요청",
  requestCancelNote: "배정된 날은 관리자가 확인한 뒤 취소돼요",
  requestPending: "취소 요청을 보냈어요 · 관리자 확인 중",
  withdrawRequest: "요청 거두기",
  today: "오늘",
  tomorrow: "내일",
  errAssigned: "배정된 날이에요 — 날짜를 눌러 취소 요청을 보내 주세요",
  errCancelledDay: "관리자가 취소한 날이에요 — 다시 나오려면 관리자에게 연락해 주세요",
  errPast: "지난날은 바꿀 수 없어요",
  errTooFar: "신청은 오늘부터 약 3달 뒤까지만 할 수 있어요",
  todayTitle: "오늘 내 방",
  todayHeadline: "출근 · 방 {n}개 · {d}개 끝남",
  changedLastNight: "어젯밤 바뀜",
  changedBody: "{time} · {rooms} 이(가) 더해졌어요",
  startCleaning: "청소 시작",
  viewRecord: "기록 보기",
  roomLinks: "길 · 문 번호",
  stateWaitingRoom: "대기",
  stateDoneRoom: "끝남",
  stateProgressRoom: "청소 중",
  alone: "혼자",
  todayMates: "오늘 같이 일해요",
  tomorrowLine: "내일 {date}",
  emptyTitle: "오늘은 배정된 방이 없어요",
  emptyBodyNone: "신청하신 날이지만 그날 방이 모두 배정됐어요. 나오지 않아도 돼요.",
  emptyBodyWaiting: "신청하셨어요. 아직 방을 나누는 중이에요.",
  emptyBodyFree: "오늘은 신청하지 않은 날이에요.",
  goMyShift: "내 시프트 보기",
};

const ja: CleaningAssignCopy = {
  title: "清掃割り当て",
  crumb: "運営",
  viewDay: "日",
  viewMonth: "月",
  prevDay: "前の日",
  nextDay: "次の日",
  prevMonth: "前の月",
  nextMonth: "次の月",
  weekdaysShort: "日,月,火,水,木,金,土",
  dateLong: "{m}月{d}日（{w}）",
  monthLabel: "{y}年{m}月",
  live: "リアルタイム · {ago} {name}さんが割り当て",
  liveNone: "リアルタイム · まだ割り当てなし",
  agoJustNow: "たった今",
  agoMin: "{n}分前",
  agoHour: "{n}時間前",
  agoDay: "{n}日前",
  myBuildings: "担当の建物 · {list}",
  allBuildings: "すべての建物",
  pickBuildings: "表示する建物",
  saveBuildings: "担当の建物として保存",
  addRoom: "+ 部屋を追加",
  fixedFirst: "固定スタッフを先に入れる",
  settingsLink: "割り当て設定",
  compareLink: "月比較表",
  unitRoom: "室",
  unitPerson: "人",
  statRooms: "清掃部屋",
  statOpen: "未割り当て",
  statApplied: "申請",
  statAssigned: "割り当て済み",
  statWaiting: "割り当て前",
  openTitle: "未割り当て",
  applyAll: "提案どおり{n}件入れる",
  suggest: "提案",
  put: "{name}を入れる",
  tagCarry: "昨日から · {n}日目",
  tagNew: "新着 {time}",
  tagExtra: "手動追加",
  tagBig: "大部屋 · {have}/{need} · あと{more}人",
  tagCancelled: "予約キャンセル",
  cancelledBody: "{names} — 部屋がなくなりました",
  attachElsewhere: "別の部屋に回す",
  cancelDay: "予定を取り消す",
  turnover: "本日チェックイン {n}人",
  turnoverUnknown: "本日チェックイン",
  noCheckin: "チェックインなし",
  nextCheckin: "次のチェックイン {date}",
  guestsN: "{n}人",
  calendarOpenMark: "未割り当て {n}室",
  bigRoom: "大部屋",
  statusProgress: "清掃中",
  statusDone: "完了",
  deferredTo: "{date}に延期",
  moreActions: "延期 · 処理済み",
  deferNextDay: "翌日に延期",
  deferPick: "日付を決めて延期",
  resolve: "処理済み（清掃不要）",
  undoHold: "元に戻す",
  tagResolved: "処理済み",
  heldDeferred: "{room} — {date}に延期しました",
  heldResolved: "{room} — 処理済みにしました",
  heldUndone: "元に戻しました",
  reasonPlaceholder: "理由を一言（例：人手不足）",
  deferUntilLabel: "この日に再表示",
  confirm: "確認",
  cancel: "キャンセル",
  noRooms: "この日に清掃する部屋はありません",
  noOpen: "未割り当ての部屋はありません",
  roomsMore: "{name} あと{n}室を表示",
  pickBanner: "{name} · {n}室 — 部屋を押すと入れ、もう一度押すと外します",
  pickClear: "選択解除 · Esc",
  addHere: "+ 入れる",
  removeHere: "外す",
  traineeShort: "見習い {n}",
  applicants: "申請者",
  applicantsSub: "現場{total}人中 申請{applied} · 未申請{none}",
  tabApplied: "申請 {n}",
  tabWaiting: "割り当て前 {n}",
  tabNone: "未申請 {n}",
  searchName: "名前で検索",
  stateWaiting: "割り当て前",
  stateWaitingSuggest: "割り当て前 · 提案 {room}",
  stateAssigned: "割り当て {n} · {rooms}",
  withOthers: "（{n}人）",
  statePersonCancelled: "その日の予定は取り消し",
  restoreDay: "戻す",
  cancelRequest: "取り消し依頼",
  cancelRequestAccept: "取り消しを承認",
  cancelRequestReject: "差し戻す",
  prio: "優先",
  traineeNth: "見習い{n}回目",
  traineeAsk: "まだ見習いですか？",
  traineeDone: "見習い終了",
  traineeKeep: "見習い継続",
  traineeBuildings: "建物別 — {list}",
  tierBadge: "{n}順位",
  byAdmin: "管理者が追加",
  startTime: "その日の出勤時刻",
  startTimeReset: "基本の時刻に戻す",
  noneHint: "{date}に申請していない人 · 最近出勤した順",
  lastWorked: "最近の出勤 {date} · 今月{n}日",
  neverWorked: "まだ出勤記録なし",
  putInstead: "代わりに入れる",
  roleStaff: "社員",
  rolePart: "アルバイト",
  roleManager: "現場管理者",
  roleLeader: "バイトリーダー",
  more: "あと{n}人を表示",
  conflict: "ほかの担当者が変更したため再読み込みしました",
  failed: "保存できませんでした。もう一度お試しください",
  done: "保存しました",
  added: "{n}件入れました",
  nothingToAdd: "入れる提案がありません",
  addRoomTitle: "清掃する部屋を追加",
  addRoomSub: "{date} · チェックアウトがなくても清掃する部屋",
  building: "建物",
  room: "部屋",
  memoOptional: "メモ（任意）",
  peopleOptional: "すぐ入れる人（任意）",
  addAndPut: "追加して入れる",
  addOnly: "追加",
  monthSuggest: "{m}月の自動提案",
  monthNoDeadline: "申請の締め切りなし · 20日からアルバイトに「来月の申請」を案内",
  legendApplied: "申請のみ",
  legendAssigned: "割り当て · 部屋数",
  legendSuggested: "提案（反映前）",
  legendHint: "日付を押すとその日の画面 · マスを押すと申請の追加/削除",
  sumRooms: "清掃部屋（予約基準）",
  sumApplied: "申請",
  sumOpen: "未割り当て部屋",
  previewTitle: "提案のプレビュー",
  previewBody: "未割り当て{open}室のうち{fill}件を埋めます · 割り当て済みの部屋はそのまま",
  previewShort: "人手が足りない日 {n}日（{days}）",
  previewApply: "{n}件を反映",
  monthTotal: "{n}室",
  settingsTitle: "割り当て設定",
  settingsBack: "‹ 清掃割り当て",
  lastChanged: "最終変更 · {name} {date}",
  tabRules: "提案ルール",
  tabFixed: "建物別固定スタッフ",
  tabPeople: "スタッフ別",
  tabRooms: "大部屋",
  rulesTitle: "提案ルール",
  rulesSub: "上から順に見ます · ドラッグか上下ボタンで順番を変更",
  moveUp: "上へ",
  moveDown: "下へ",
  resetRules: "初期値に戻す",
  alwaysTitle: "常に守ること",
  alwaysSub: "ルールの順番に関係なくオフにできません",
  always1: "見習いを一人にしない — マネージャー · 見習い担当がいる部屋だけ",
  always2: "同じ人を同じ部屋に二重に入れない",
  always3: "大部屋は通常の人数まで埋める",
  always4: "その日に申請した人だけを提案 — 未申請の人は「代わりに入れる」で",
  rule_fixed_staff: "建物の固定スタッフを先に",
  rule_fixed_staff_desc: "「建物別固定スタッフ」の1順位 → 2順位 → 3順位、その日に申請した人だけ",
  rule_fewest_rooms: "割り当て前の人 · 部屋が少ない人を先に",
  rule_fewest_rooms_desc: "部屋が0の人から、次にその日の部屋が少ない順 — 均等に分けます",
  rule_priority: "「優先割り当て」の人を先に",
  rule_priority_desc: "スタッフ別でオンにした人（仕事が丁寧 · よく出勤する固定スタッフ）",
  rule_same_building: "同じ建物でまとめる",
  rule_same_building_desc: "すでにその建物に部屋がある人を先に — 建物間の移動を減らします",
  rule_fewest_month_days: "今月の勤務日数が少ない人を先に",
  rule_fewest_month_days_desc: "今月あまり出ていない人に機会を多く",
  rule_late_start_last: "出勤が遅い人は後に",
  rule_late_start_last_desc: "その日の出勤時刻が遅い人は後で選びます",
  fixedTitle: "{building} 固定スタッフ",
  fixedSub: "その日に申請した人だけ、1順位からこの建物の部屋に先に入ります · 同じ順位では部屋が少ない人が先",
  tierLabel: "{n}順位",
  addToTier: "+ {tier}に人を追加",
  addTier: "+ 順位を追加",
  removePerson: "{name}を外す",
  fixedMonth: "今月{n}日 · 最近 {date}",
  peopleTitle: "現場{n}人",
  colName: "名前",
  colRole: "区分",
  colStart: "基本の出勤",
  colPriority: "優先割り当て",
  colTrainee: "見習い",
  colTrainer: "見習い担当",
  colFixed: "固定の建物",
  colMemo: "メモ（管理者のみ）",
  memoPlaceholder: "管理者同士だけが見ます",
  roomsTitle: "大部屋 · 通常人数",
  roomsSub: "通常2人で入る部屋を決めておくと、提案がその人数まで埋めます。ほかは1人。",
  headcount: "通常{n}人",
  saved: "保存しました",
  compareTitle: "清掃 月比較表",
  excludeToggle: "見習い · 社員を除いて比較",
  payNote: "給与は勤怠 · 給与画面の値をそのまま",
  avgPerRoom: "平均 1室あたり給与",
  avgMinutes: "平均 1室あたり時間",
  flagged: "平均から{n}%以上ずれ",
  checkTitle: "確認する人",
  checkLine: "{rooms}室で{pay}",
  checkPer: "1室あたり{per}（{dev}）",
  checkMinutes: "1室あたり{min}分",
  checkMore: "あと{n}人 · 表でシグナルのある人だけ表示",
  checkNone: "今月は平均から大きくずれた人はいません",
  attendanceLink: "出勤記録を見る",
  readGuide: "1室あたり給与 = その月の給与 ÷ 清掃した部屋（一緒に入った部屋は分けて数える）。ずれていても誤りとは限りません — ほかの業務 · 大部屋 · 移動が多かった可能性があります。",
  chartCaption: "清掃した部屋（横）· 給与（縦）— 線は平均 1室あたり給与",
  colDays: "勤務日",
  colAssigned: "割り当て部屋",
  colCleaned: "清掃した部屋",
  colHours: "勤務時間",
  colPay: "給与",
  colPerRoom: "1室あたり給与",
  colPerMinutes: "1室あたり時間",
  colSignal: "シグナル",
  sigHigh: "1室あたり給与が平均より{n}%高い — 確認",
  sigLow: "1室あたり給与が平均より{n}%低い",
  sigTrainee: "見習い — 比較から除外",
  sigStaff: "社員 — 比較から除外",
  showAll: "すべて表示",
  showFlagged: "シグナルのある人だけ",
  minutesUnit: "分",
  hoursUnit: "{n}時間",
  daysUnit: "{n}日",
  compareEmpty: "この月は割り当ての記録がありません",
  applyNextMonth: "{m}月を申請",
  nextMonthDue: "{m}月の申請は月末まで · あと{n}日",
  nextShift: "次の勤務",
  nextShiftTitle: "{rel} {time} · {n}部屋",
  markNoneShort: "なし",
  ringHint: "白い丸は申請した日、塗りつぶしの丸は割り当て済みの日です。",
  startAt: "{time} 出勤",
  roomsN: "{n}部屋",
  matesHead: "一緒に働く人",
  progressDone: "{n}部屋中 {d}部屋完了",
  nowRoom: "今の部屋",
  restRooms: "残りの部屋",
  doneRooms: "完了した部屋",
  factCheckin: "チェックイン",
  factWith: "一緒に",
  factNote: "メモ",
  factDoor: "ドア番号",
  startRoom: "{room} の清掃を開始",
  continueCleaning: "清掃を続ける",
  myShiftTitle: "マイシフト",
  nextMonthBanner: "{m}月のシフトを月末までに申請してください",
  goNextMonth: "{m}月へ",
  monthSummary: "申請{a}日 · 割り当て{b}日",
  legendMyAssigned: "割り当て済み",
  legendMyWaiting: "申請 · 割り当て前",
  legendMyNone: "割り当てなし",
  tapHint: "日付を押すと申請、もう一度押すと取り消しです。割り当て済みの日は管理者に取り消し依頼が送られます。",
  markRooms: "{n}室",
  markApplied: "申請",
  markNone: "割り当てなし",
  markWorked: "完了",
  upcoming: "これからの予定",
  upcomingEmpty: "これから7日間に申請した日はありません。働ける日をカレンダーで押してください。",
  upAssigned: "{time} · {n}室 — {rooms}",
  upWaiting: "申請済み · 割り当て前",
  upWaitingSub: "まだ部屋が残っています · 前日の夜までに決まります",
  upNone: "割り当てなし",
  upNoneSub: "その日の部屋はすべて割り当て済み · 出勤しなくて大丈夫です",
  upCancelled: "管理者がその日の予定を取り消しました",
  withMate: "{names}と一緒",
  sheetDay: "{date} · {rel}",
  sheetTitle: "{time} 出勤 · {n}室",
  mates: "一緒に働く人 · {names}",
  requestCancel: "取り消し依頼",
  requestCancelNote: "割り当て済みの日は管理者が確認してから取り消されます",
  requestPending: "取り消し依頼を送りました · 管理者が確認中",
  withdrawRequest: "依頼を取り下げる",
  today: "今日",
  tomorrow: "明日",
  errAssigned: "割り当て済みの日です — 日付を押して取り消し依頼を送ってください",
  errCancelledDay: "管理者が取り消した日です — 出勤する場合は管理者に連絡してください",
  errPast: "過去の日は変更できません",
  errTooFar: "申請できるのは今日から約3か月先までです",
  todayTitle: "今日の部屋",
  todayHeadline: "出勤 · {n}室 · {d}室完了",
  changedLastNight: "昨夜の変更",
  changedBody: "{time} · {rooms}が追加されました",
  startCleaning: "清掃開始",
  viewRecord: "記録を見る",
  roomLinks: "道順 · ドア番号",
  stateWaitingRoom: "待機",
  stateDoneRoom: "完了",
  stateProgressRoom: "清掃中",
  alone: "一人",
  todayMates: "今日一緒に働く人",
  tomorrowLine: "明日 {date}",
  emptyTitle: "今日は割り当てられた部屋がありません",
  emptyBodyNone: "申請した日ですが、その日の部屋はすべて割り当て済みです。出勤しなくて大丈夫です。",
  emptyBodyWaiting: "申請済みです。まだ部屋を割り振っています。",
  emptyBodyFree: "今日は申請していない日です。",
  goMyShift: "マイシフトを見る",
};

const en: CleaningAssignCopy = {
  title: "Cleaning assignment",
  crumb: "Ops",
  viewDay: "Day",
  viewMonth: "Month",
  prevDay: "Previous day",
  nextDay: "Next day",
  prevMonth: "Previous month",
  nextMonth: "Next month",
  weekdaysShort: "Sun,Mon,Tue,Wed,Thu,Fri,Sat",
  dateLong: "{w}, {mon} {d}",
  monthLabel: "{mon} {y}",
  live: "Live · {name} assigned {ago}",
  liveNone: "Live · none assigned yet",
  agoJustNow: "just now",
  agoMin: "{n} min ago",
  agoHour: "{n} h ago",
  agoDay: "{n} d ago",
  myBuildings: "My buildings · {list}",
  allBuildings: "All buildings",
  pickBuildings: "Buildings to show",
  saveBuildings: "Save as my buildings",
  addRoom: "+ Add room",
  fixedFirst: "Fill regulars first",
  settingsLink: "Settings",
  compareLink: "Compare",
  unitRoom: "",
  unitPerson: "",
  statRooms: "Rooms to clean",
  statOpen: "Unassigned",
  statApplied: "Applied",
  statAssigned: "Assigned",
  statWaiting: "Waiting",
  openTitle: "Unassigned",
  applyAll: "Add {n} as suggested",
  suggest: "Suggested",
  put: "Add {name}",
  tagCarry: "Since yesterday · day {n}",
  tagNew: "New {time}",
  tagExtra: "Added by hand",
  tagBig: "Large room · {have}/{need} · {more} more needed",
  tagCancelled: "Booking cancelled",
  cancelledBody: "{names} — room no longer needed",
  attachElsewhere: "Move to another room",
  cancelDay: "Cancel their day",
  turnover: "Check-in today · {n} guests",
  turnoverUnknown: "Check-in today",
  noCheckin: "No check-in",
  nextCheckin: "Next check-in {date}",
  guestsN: "{n} guests",
  calendarOpenMark: "{n} unassigned",
  bigRoom: "Large room",
  statusProgress: "Cleaning",
  statusDone: "Done",
  deferredTo: "Postponed to {date}",
  moreActions: "Postpone · close",
  deferNextDay: "Postpone to next day",
  deferPick: "Postpone to a date",
  resolve: "Close (no cleaning needed)",
  undoHold: "Undo",
  tagResolved: "Closed",
  heldDeferred: "{room} — postponed to {date}",
  heldResolved: "{room} — marked as closed",
  heldUndone: "Restored",
  reasonPlaceholder: "Reason (e.g. short-staffed)",
  deferUntilLabel: "Shows again on",
  confirm: "Confirm",
  cancel: "Cancel",
  noRooms: "No rooms to clean on this day",
  noOpen: "No unassigned rooms",
  roomsMore: "Show {n} more in {name}",
  pickBanner: "{name} · {n} rooms — click a room to add, click again to remove",
  pickClear: "Clear · Esc",
  addHere: "+ Add",
  removeHere: "Remove",
  traineeShort: "Trainee {n}",
  applicants: "Applicants",
  applicantsSub: "{applied} of {total} field staff applied · {none} did not",
  tabApplied: "Applied {n}",
  tabWaiting: "Waiting {n}",
  tabNone: "Not applied {n}",
  searchName: "Find name",
  stateWaiting: "Waiting",
  stateWaitingSuggest: "Waiting · suggested {room}",
  stateAssigned: "{n} assigned · {rooms}",
  withOthers: "({n} people)",
  statePersonCancelled: "Day cancelled",
  restoreDay: "Restore",
  cancelRequest: "Cancel request",
  cancelRequestAccept: "Accept",
  cancelRequestReject: "Decline",
  prio: "Priority",
  traineeNth: "Trainee #{n}",
  traineeAsk: "Still a trainee?",
  traineeDone: "Training done",
  traineeKeep: "Keep training",
  traineeBuildings: "By building — {list}",
  tierBadge: "Tier {n}",
  byAdmin: "Added by manager",
  startTime: "Start time that day",
  startTimeReset: "Back to default",
  noneHint: "Not applied for {date} · most recently worked first",
  lastWorked: "Last worked {date} · {n} days this month",
  neverWorked: "No shifts yet",
  putInstead: "Add on their behalf",
  roleStaff: "Staff",
  rolePart: "Part-time",
  roleManager: "Field manager",
  roleLeader: "Part-time leader",
  more: "Show {n} more",
  conflict: "Another manager just changed this — reloaded",
  failed: "Couldn't save. Please try again",
  done: "Saved",
  added: "Added {n}",
  nothingToAdd: "Nothing to add",
  addRoomTitle: "Add a room to clean",
  addRoomSub: "{date} · rooms to clean without a check-out",
  building: "Building",
  room: "Room",
  memoOptional: "Note (optional)",
  peopleOptional: "Assign now (optional)",
  addAndPut: "Add and assign",
  addOnly: "Add",
  monthSuggest: "Suggest for {mon}",
  monthNoDeadline: "No application deadline · from the 20th staff are reminded to apply for next month",
  legendApplied: "Applied only",
  legendAssigned: "Assigned · rooms",
  legendSuggested: "Suggested (not saved)",
  legendHint: "Click a date for that day · click a cell to add or remove an application",
  sumRooms: "Rooms (from bookings)",
  sumApplied: "Applied",
  sumOpen: "Unassigned rooms",
  previewTitle: "Suggestion preview",
  previewBody: "Fills {fill} of {open} unassigned rooms · rooms already assigned stay as they are",
  previewShort: "{n} short-staffed days ({days})",
  previewApply: "Apply {n}",
  monthTotal: "{n} rooms",
  settingsTitle: "Assignment settings",
  settingsBack: "‹ Cleaning assignment",
  lastChanged: "Last changed · {name} {date}",
  tabRules: "Suggestion rules",
  tabFixed: "Regulars by building",
  tabPeople: "People",
  tabRooms: "Large rooms",
  rulesTitle: "Suggestion rules",
  rulesSub: "Checked from the top · drag or use the arrows to reorder",
  moveUp: "Move up",
  moveDown: "Move down",
  resetRules: "Reset to defaults",
  alwaysTitle: "Always applied",
  alwaysSub: "These can't be turned off",
  always1: "Trainees never go alone — only into rooms with a manager or trainer",
  always2: "The same person is never added to the same room twice",
  always3: "Large rooms are filled up to their usual headcount",
  always4: "Only people who applied that day are suggested — add others on their behalf",
  rule_fixed_staff: "Building regulars first",
  rule_fixed_staff_desc: "Tier 1 → 2 → 3 from “Regulars by building”, only if they applied that day",
  rule_fewest_rooms: "People without rooms first · fewest rooms first",
  rule_fewest_rooms_desc: "Start with people who have no room, then those with the fewest that day — spread evenly",
  rule_priority: "“Priority” people first",
  rule_priority_desc: "People switched on under People (reliable, frequent regulars)",
  rule_same_building: "Keep the same building together",
  rule_same_building_desc: "People already in that building first — less moving between buildings",
  rule_fewest_month_days: "Fewest days this month first",
  rule_fewest_month_days_desc: "Give more chances to people who worked less this month",
  rule_late_start_last: "Late starters last",
  rule_late_start_last_desc: "People starting later that day are picked later",
  fixedTitle: "{building} regulars",
  fixedSub: "Only people who applied that day go into this building's rooms first, from tier 1 · within a tier, fewest rooms first",
  tierLabel: "Tier {n}",
  addToTier: "+ Add to {tier}",
  addTier: "+ Add tier",
  removePerson: "Remove {name}",
  fixedMonth: "{n} days this month · last {date}",
  peopleTitle: "{n} field staff",
  colName: "Name",
  colRole: "Type",
  colStart: "Default start",
  colPriority: "Priority",
  colTrainee: "Trainee",
  colTrainer: "Trainer",
  colFixed: "Regular in",
  colMemo: "Note (managers only)",
  memoPlaceholder: "Only managers see this",
  roomsTitle: "Large rooms · usual headcount",
  roomsSub: "Mark rooms that usually take 2 people and suggestions fill them to that number. Others take 1.",
  headcount: "Usually {n}",
  saved: "Saved",
  compareTitle: "Cleaning monthly comparison",
  excludeToggle: "Exclude trainees and staff",
  payNote: "Pay comes straight from Attendance · Payroll",
  avgPerRoom: "Average pay per room",
  avgMinutes: "Average time per room",
  flagged: "More than {n}% off average",
  checkTitle: "People to check",
  checkLine: "{pay} for {rooms} rooms",
  checkPer: "{per} per room ({dev})",
  checkMinutes: "{min} min per room",
  checkMore: "{n} more · show only flagged people in the table",
  checkNone: "Nobody is far off the average this month",
  attendanceLink: "View attendance",
  readGuide: "Pay per room = monthly pay ÷ rooms cleaned (shared rooms are split). Being off isn't a mistake — other work, large rooms or travel may explain it.",
  chartCaption: "Rooms cleaned (across) · pay (up) — the line is average pay per room",
  colDays: "Days",
  colAssigned: "Assigned",
  colCleaned: "Cleaned",
  colHours: "Hours",
  colPay: "Pay",
  colPerRoom: "Per room",
  colPerMinutes: "Min per room",
  colSignal: "Signal",
  sigHigh: "{n}% above average pay per room — check",
  sigLow: "{n}% below average pay per room",
  sigTrainee: "Trainee — not compared",
  sigStaff: "Staff — not compared",
  showAll: "Show all",
  showFlagged: "Flagged only",
  minutesUnit: " min",
  hoursUnit: "{n} h",
  daysUnit: "{n}",
  compareEmpty: "No assignments this month",
  applyNextMonth: "Apply for {mon}",
  nextMonthDue: "{mon} applications close at month end · {n} days left",
  nextShift: "Next shift",
  nextShiftTitle: "{rel} {time} · {n} rooms",
  markNoneShort: "None",
  ringHint: "An outlined circle is a day you applied for; a filled circle is an assigned day.",
  startAt: "Start {time}",
  roomsN: "{n} rooms",
  matesHead: "Working with you",
  progressDone: "{d} of {n} done",
  nowRoom: "Up next",
  restRooms: "Still to do",
  doneRooms: "Done",
  factCheckin: "Check-in",
  factWith: "With",
  factNote: "Note",
  factDoor: "Door code",
  startRoom: "Start {room}",
  continueCleaning: "Continue cleaning",
  myShiftTitle: "My shifts",
  nextMonthBanner: "Please apply for {mon} shifts by the end of the month",
  goNextMonth: "Go to {mon}",
  monthSummary: "Applied {a} days · assigned {b}",
  legendMyAssigned: "Assigned",
  legendMyWaiting: "Applied · waiting",
  legendMyNone: "No assignment",
  tapHint: "Tap a date to apply, tap again to cancel. For assigned days a cancel request goes to the manager.",
  markRooms: "{n} rm",
  markApplied: "Applied",
  markNone: "None",
  markWorked: "Done",
  upcoming: "Coming up",
  upcomingEmpty: "No shifts in the next 7 days. Tap the days you can work on the calendar.",
  upAssigned: "{time} · {n} rooms — {rooms}",
  upWaiting: "Applied · waiting",
  upWaitingSub: "Rooms are still open · decided by the night before",
  upNone: "No assignment",
  upNoneSub: "All rooms that day are assigned · you don't need to come in",
  upCancelled: "The manager cancelled your day",
  withMate: "with {names}",
  sheetDay: "{date} · {rel}",
  sheetTitle: "Start {time} · {n} rooms",
  mates: "Working with · {names}",
  requestCancel: "Request to cancel",
  requestCancelNote: "Assigned days are cancelled after a manager confirms",
  requestPending: "Cancel request sent · waiting for the manager",
  withdrawRequest: "Withdraw request",
  today: "Today",
  tomorrow: "Tomorrow",
  errAssigned: "You're assigned that day — tap the date to send a cancel request",
  errCancelledDay: "A manager cancelled this day — contact them if you can still work",
  errPast: "Past days can't be changed",
  errTooFar: "You can apply up to about 3 months ahead",
  todayTitle: "My rooms today",
  todayHeadline: "start · {n} rooms · {d} done",
  changedLastNight: "Changed last night",
  changedBody: "{time} · {rooms} added",
  startCleaning: "Start cleaning",
  viewRecord: "View record",
  roomLinks: "Directions · door code",
  stateWaitingRoom: "To do",
  stateDoneRoom: "Done",
  stateProgressRoom: "Cleaning",
  alone: "On your own",
  todayMates: "Working with you today",
  tomorrowLine: "Tomorrow {date}",
  emptyTitle: "No rooms for you today",
  emptyBodyNone: "You applied, but all rooms that day are assigned. You don't need to come in.",
  emptyBodyWaiting: "You applied. Rooms are still being assigned.",
  emptyBodyFree: "You didn't apply for today.",
  goMyShift: "View my shifts",
};

const COPY: Record<Locale, CleaningAssignCopy> = { en, ja, ko };

export function getCleaningAssignCopy(locale: Locale): CleaningAssignCopy {
  return COPY[locale] ?? ko;
}

/** `{name}` 자리표시자 채우기. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
