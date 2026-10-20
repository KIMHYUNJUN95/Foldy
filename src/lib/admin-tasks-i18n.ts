import type { Locale } from "@/lib/i18n";

// Admin Todoist 콘솔(데스크톱) 전용 i18n. 모바일/공용 tasks 문자열과 분리(공지 콘솔 패턴).
// 뷰 라벨·섹션·우선순위·상태·반복·기간·일정/공유 팝오버·빈 상태·상세·보고서·토스트.
export type AdminTasksDictionary = {
  // views
  vInbox: string;
  vToday: string;
  vTomorrow: string;
  vShared: string;
  vInstr: string;
  vCompleted: string;
  vCalendar: string;
  crumb: string;
  taskWord: string; // "N작업"
  addTask: string;
  searchPlaceholder: string;
  mobileView: string;
  sharedProjects: string;
  newProject: string;
  // filter
  filterSearch: string;
  filterDate: string;
  filterPrio: string;
  // sections / banners
  secOverdue: string;
  secToday: string;
  overdueTitle: string; // "지난(지연) 작업 {n}건"
  overdueSub: string;
  overdueReschedule: string;
  overdueClear: string;
  previewOnlyHint: string; // 다가오는 일정에서 완료 불가 안내(툴팁)
  odDaysBehind: string; // 반복 지연 묶음 "{n}일 밀림"
  inboxNote: string;
  // priority / status / repeat / duration
  prioNormal: string; // 우선순위 4 (기본)
  prioImportant: string; // 우선순위 2
  prioUrgent: string; // 우선순위 1
  prioMedium: string; // 우선순위 3
  stOpen: string;
  stInProgress: string;
  stCompleted: string;
  stOverdue: string;
  repDaily: string;
  repWeekly: string; // "매주 {wd}요일"
  repWeekdays: string;
  repMonthly: string; // "매월 {d}일"
  repYearly: string; // "매년 {m}월 {d}일"
  repCustom: string;
  repCustomDays: string; // "매주 {wd}"
  repPickDays: string;
  repPickDaysHint: string;
  repNone: string;
  repShortWeekly: string;
  repShortMonthly: string;
  repShortYearly: string;
  repShortWeekdays: string;
  repShortWeekends: string;
  durNone: string;
  dur15: string;
  dur30: string;
  dur60: string;
  dur120: string;
  durCustom: string;
  // chips / row
  today: string;
  tomorrow: string;
  noDate: string;
  instructedBy: string; // "{name} 지시"
  sharedWith: string; // "공유됨"
  andMore: string; // "{name} 외 {n}명"
  // inline add
  iaTitle: string;
  iaDesc: string;
  iaSchedule: string;
  iaPriority: string;
  iaTarget: string;
  iaAttach: string;
  iaAttachN: string; // "사진 {n}"
  iaCancel: string;
  iaSave: string;
  iaInbox: string;
  iaSendInstr: string; // "지시로 전송"
  iaSendInstrCta: string; // 지시 탭의 추가 트리거 · 저장 버튼
  // detail panel
  dpTask: string;
  dpInbox: string;
  dpStatus: string;
  /** 회차 없이 연 반복 작업 — 완료를 막고 띄우는 안내. */
  dpCompleteNeedsOccurrence: string;
  dpSchedule: string;
  dpScheduleChange: string;
  dpDue: string;
  dpSched: string;
  dpTime: string;
  dpRepeat: string;
  dpNoDate: string;
  dpLinked: string;
  dpViewResv: string;
  dpParticipants: string; // "참여자 · {n}명 · 상태 공통"
  dpAuthor: string;
  dpFirstRecipient: string;
  dpMe: string;
  dpShareManage: string;
  dpShareCta: string; // "멤버에게 공유 / 지시"
  dpPhotos: string; // "첨부 사진 {n}"
  dpLog: string;
  dpLogCreated: string; // "{name} 님이 작업 생성"
  // 시스템 로그 한 줄(노트가 아닌 task_updates) — 모두 {name} 을 받는다. 모바일
  // `task-detail-view.tsx` 의 systemLabel 과 같은 종류를 덮는다.
  logShared: string;
  logEdited: string;
  logCompleted: string;
  logReopened: string;
  logInProgress: string;
  logOpen: string;
  logUpdated: string; // 알 수 없는 update_type 폴백
  dpLogInput: string;
  dpEdit: string;
  dpSave: string;
  dpTagAdd: string;
  // 사진 업로더(TaskPhotoUploader) — {n} 현재 개수, {max} 상한
  phAdd: string;
  phAddCompact: string;
  phDropHint: string;
  phCount: string;
  phRemove: string;
  phTooMany: string;
  phInvalidType: string;
  phTooLarge: string;
  phUploading: string;
  // 컨텍스트 피커(ContextPickerPopover)
  cpTitle: string;
  cpHintBuilding: string;
  cpHintRoom: string;
  cpBuildings: string;
  cpRooms: string;
  cpReservations: string;
  cpSearch: string;
  cpSearchClear: string;
  cpSearchEmpty: string;
  cpSearchEmptySub: string;
  cpNoBuilding: string;
  cpNoRooms: string;
  cpNoReservation: string;
  cpGuest: string;
  cpLoading: string;
  cpBack: string;
  cpClear: string;
  cpApply: string;
  cpCancel: string;
  cpOccupied: string;
  cpVacant: string;
  cpBlocked: string;
  cpNightsUnit: string;
  cpChannelDirect: string;
  cpLive: string;
  cpRoomsUnit: string;
  cpTodayGuests: string;
  cpRoomSuffix: string;
  cpBookingId: string;
  dpShare: string;
  dpDelete: string;
  dpUnshareDelete: string;
  dpAuthorOnly: string; // "원문은 작성자({name})만 수정할 수 있습니다"
  dpLeave: string;
  dpMobileDetail: string;
  ctxBuilding: string;
  ctxBed: string;
  ctxTicket: string;
  ctxGuest: string;
  // schedule popover
  schApply: string;
  schCancel: string;
  schNoRepeat: string;
  schQToday: string;
  schQTomorrow: string;
  schQNextWeek: string;
  schQNextWeekend: string;
  schQNoDate: string;
  schTime: string;
  schTimeNone: string;
  schRepeat: string;
  schDuration: string;
  // share / target popover
  shTargetTitle: string;
  shShareTitle: string;
  shTargetSub: string;
  shShareSub: string;
  shTargetHint: string; // "대상에게는 “{name} 지시” 표식이 붙습니다..."
  shSearch: string;
  shTargetCta: string; // "{name}에게 지시" / "{n}명에게 지시" / "대상 선택"
  shShareCta: string; // "{n}명에게 공유" / "공유할 멤버 선택"
  shNoResult: string;
  shManager: string;
  // menus
  mScheduleChange: string;
  mPriority: string;
  mShareInstr: string;
  mMoveToday: string;
  mMoveTomorrow: string;
  mMoveInbox: string;
  mDelete: string;
  mLeave: string;
  // instr view
  // 반복 회차 건너뛰기 (2026-07-30)
  recurDeleteTitle: string;
  recurSkipOne: string;
  recurSkipOneSub: string;
  recurDeleteAll: string;
  recurDeleteAllSub: string;
  recurSkippedToast: string;
  instrRecv: string;
  instrSent: string;
  instrSentNote: string;
  instrRecvNote: string;
  instrSecUnconfirmed: string;
  instrSecInProgress: string;
  instrSecCompleted: string;
  instrSecOverdue: string;
  instrSecTodo: string;
  instrUnconfirmed: string; // "미확인"
  instrRemind: string;
  instrReply: string;
  instrChangeTarget: string;
  instrEmptySentT: string;
  instrEmptySentS: string;
  instrEmptyRecvT: string;
  instrEmptyRecvS: string;
  instrCommon: string; // "공동 {n}명"
  // shared view
  sharedRecvSec: string;
  sharedSentSec: string;
  // completed
  cmpDone: string; // "{n}건 완료"
  cmpReport: string;
  cmpBy: string; // "{name} 완료"
  cmpToday: string;
  cmpYesterday: string;
  // calendar
  calThisMonth: string;
  calPreviousMonth: string;
  calNextMonth: string;
  calLegendPersonal: string;
  calLegendShared: string;
  calLegendUrgent: string;
  calUpcoming: string;
  calMore: string; // "+{n}건 더보기"
  calNoMonth: string;
  calHideRepeat: string; // 반복 숨기기 토글
  calAddOnDay: string;
  calDayEmpty: string;
  // project
  pjBanner: string; // "공유 프로젝트 · 멤버 {n}명"
  pjMembers: string;
  pjAddTaskTo: string; // "{name}에 작업 추가"
  pjEmptyT: string;
  pjEmptyS: string;
  pjDelete: string; // 프로젝트 삭제 버튼
  pjDeleteMsg: string; // "'{title}' 프로젝트를 삭제하시겠어요? ..." 확인 문구
  // 섹션 · 멤버 관리 (2026-07-30)
  pjSectionAdd: string;
  pjSectionNamePh: string;
  pjSectionRename: string;
  pjSectionDelete: string;
  pjSectionDeleteMsg: string; // "'{title}' 섹션과 그 안의 작업을 삭제할까요?"
  pjMembersManage: string;
  pjDeleted: string; // 삭제 완료 토스트
  // new project modal
  npTitle: string;
  npName: string;
  npNamePh: string;
  npMembers: string; // "{n}명 · 나 포함"
  npSearch: string;
  npHint: string;
  npCancel: string;
  npCreate: string;
  // report
  rptTitle: string; // "업무일지 · {date}"
  rptHint: string;
  /** 화이트 리디자인(2026-10-15) 업무일지 창 부제 — "{date} · 완료 {total}건 중 {selected}건 포함" */
  rptSub: string;
  rptBodyLabel: string;
  rptReset: string;
  rptPickTitle: string;
  rptPickAll: string;
  rptPickNone: string;
  rptPickCount: string; // "{total}개 중 {selected}개"
  rptPickEmpty: string;
  rptPickResetHint: string;
  rptClose: string;
  rptCopy: string;
  rptCopied: string;
  rptSlackSend: string;
  rptSlackSending: string;
  rptSlackSent: string;
  rptSlackNotConfigured: string;
  rptSlackTooLong: string;
  rptSlackError: string;
  // 예약 보내기(2026-10-20) — 모바일 tasks.report* 와 같은 문구
  rptWhen: string;
  rptWhenNow: string;
  rptWhenToday: string;
  rptWhenCustom: string;
  rptWhenHour: string;
  rptWhenMinute: string;
  rptWhenNoSlots: string;
  rptWhenAsk: string;
  rptSendAt: string;
  rptScheduledBtn: string;
  rptReschedule: string;
  rptScheduledBanner: string;
  rptScheduleCancel: string;
  rptScheduling: string;
  rptScheduledToast: string;
  rptScheduleChanged: string;
  rptScheduleSent: string;
  rptScheduleFailed: string;
  rptScheduleCancelled: string;
  rptSchedulePast: string;
  rptScheduleBusy: string;
  rptListScheduled: string;
  rptListSent: string;
  rptListFailed: string;
  // empty / loading / error
  emToday: string;
  emTodayS: string;
  emTomorrow: string;
  emTomorrowS: string;
  emInbox: string;
  emInboxS: string;
  emShared: string;
  emSharedS: string;
  emFilter: string;
  emFilterS: string;
  emProject: string;
  emProjectS: string;
  emCompleted: string;
  emCompletedS: string;
  errT: string;
  errS: string;
  retry: string;
  // toasts / errors
  errAuth: string;
  errForbidden: string;
  errSave: string;
  errGeneric: string;
  errMissingTitle: string;
  errTimeNeedsDate: string;
  errRepeatNeedsDate: string;
  errNotFound: string;
  errInvalidDate: string;
  errEmpty: string;
  errDuplicateOccurrence: string;
  // 반복 업무는 고정 앵커라 「오늘로 이동」류가 시리즈를 옮기지 못한다(2026-08-25).
  errRecurringSeries: string;
  tCreated: string;
  tUpdated: string;
  tCompleted: string;
  tReopened: string;
  tShared: string;
  tInstructed: string;
  tDeleted: string;
  tMoved: string;
  tRescheduled: string;
  tNoteAdded: string;
  tProjectCreated: string;
  tReminded: string;
  // confirm modal (destructive)
  confirmTitle: string;
  confirmDeleteMsg: string;
  confirmLeaveMsg: string;
  confirmClearMsg: string;
  confirmDeleteBtn: string;
  // rail
  railTodayTitle: string;
  railTodayProgress: string;
  railDoneToday: string; // 진행 현황 "오늘 완료" 스탯 라벨
  railUpcomingEmpty: string;
  // undo toast
  undoBtn: string;
  undoNext: string; // "다음: {date}"
  tDeletedUndoable: string;
  // selection mode + bulk delete
  selMode: string;
  selHint: string;
  selSelected: string; // "{n}개 선택"
  selAll: string;
  selClear: string;
  selDelete: string;
  selEmptyHint: string;
  odPickHint: string; // 지연 배너 — 대상 미선택 안내
  confirmBulkMsg: string; // "{n}개 …"
  confirmBulkSharedNote: string;
  tBulkDeleted: string; // "{n}개 …"
  tBulkPartial: string; // "{n}개 삭제, {f}개 실패"
  /** 화이트 리디자인(2026-10-15) 문구 — 3단(보기 목록 · 목록 · 상세) 콘솔. */
  w: AdminTasksWhiteCopy;
};

/** 화이트 리디자인 문구. 자리표시자는 `{n}` 꼴 문자열만(함수 금지). */
export type AdminTasksWhiteCopy = {
  navAria: string;
  projects: string;
  prioUrgent: string;
  prioImportant: string;
  prioMedium: string;
  prioNone: string;
  todaySub: string; // "{date} · {total}개 중 {done}개 완료"
  progressAria: string; // "오늘 {total}개 중 {done}개 완료"
  dayCount: string; // "{n}개"
  secDone: string;
  reschedule: string;
  odPickDate: string;
  shareN: string; // "공유 {n}명"
  photoN: string; // "사진 {n}"
  dueBy: string; // "{date}까지"
  fromTo: string; // "{from} → {to}"
  detailEmpty: string;
  detailEmptySub: string;
  close: string;
  more: string;
  edit: string;
  dlSchedule: string;
  dlPriority: string;
  dlLinked: string;
  dlTags: string;
  dlWith: string;
  dlProject: string;
  linkCta: string;
  shareManage: string;
  photosCount: string; // "사진 {n} / {max}"
  photoAdd: string;
  updates: string;
  updateInput: string;
  send: string;
  weekDone: string; // "이번 주 {n}개 완료"
  report: string;
  fieldBadge: string;
  fieldSub: string;
  dayToday: string; // "{date} · 오늘"
  calMore: string; // "+{n}건"
  calToday: string;
  instrHint: string;
  projSub: string; // "섹션 {s} · 작업 {n} · 사진 최대 20장"
  membersN: string; // "멤버 {n}명"
  sectionAdd: string;
  directiveFrom: string; // "{name} 지시"
  sharedFrom: string; // "{name} 공유"
  completedAt: string; // "{time} 완료"
  descMore: string;
  descLess: string;
};

const koW: AdminTasksWhiteCopy = {
  descMore: "더 보기", descLess: "접기",
  navAria: "투두 보기", projects: "프로젝트",
  prioUrgent: "긴급", prioImportant: "중요", prioMedium: "보통", prioNone: "없음",
  todaySub: "{date} · {total}개 중 {done}개 완료", progressAria: "오늘 {total}개 중 {done}개 완료",
  dayCount: "{n}개", secDone: "완료", reschedule: "날짜 다시 정하기", odPickDate: "날짜 정하기",
  shareN: "공유 {n}명", photoN: "사진 {n}", dueBy: "{date}까지", fromTo: "{from} → {to}",
  detailEmpty: "작업을 고르면 여기에 자세히 보여요", detailEmptySub: "목록에서 작업을 누르세요.",
  close: "닫기", more: "더 보기", edit: "편집",
  dlSchedule: "일정", dlPriority: "우선순위", dlLinked: "연결", dlTags: "태그", dlWith: "함께", dlProject: "프로젝트",
  linkCta: "연결하기", shareManage: "관리", photosCount: "사진 {n} / {max}", photoAdd: "사진 추가",
  updates: "업데이트", updateInput: "업데이트 남기기", send: "보내기",
  weekDone: "이번 주 {n}개 완료", report: "업무일지", fieldBadge: "현",
  fieldSub: "자동으로 모여요 · 업무일지에 함께 들어가요",
  dayToday: "{date} · 오늘", calMore: "+{n}건", calToday: "오늘",
  instrHint: "매니저가 보낸 업무 · 보낸 지시는 내 일정에 뜨지 않아요",
  projSub: "섹션 {s} · 작업 {n} · 사진 최대 20장", membersN: "멤버 {n}명", sectionAdd: "섹션 추가",
  directiveFrom: "{name} 지시", sharedFrom: "{name} 공유", completedAt: "{time} 완료",
};

const ko: AdminTasksDictionary = {
  vInbox: "관리함", vToday: "오늘", vTomorrow: "내일", vShared: "공유함", vInstr: "지시",
  vCompleted: "완료 · 기록", vCalendar: "캘린더", crumb: "사무실 · 투두이스트", taskWord: "{n}작업",
  addTask: "작업 추가", searchPlaceholder: "작업 · 담당자 · 객실 검색", mobileView: "모바일 보기",
  sharedProjects: "공유 프로젝트", newProject: "새 프로젝트",
  filterSearch: "제목 · 작성자 검색", filterDate: "날짜", filterPrio: "우선순위",
  secOverdue: "지연", secToday: "오늘",
  overdueTitle: "지난(지연) 작업 {n}건", overdueSub: "마감이 지난 작업입니다. 오늘로 옮기거나 정리하세요.",
  overdueReschedule: "일정 변경", overdueClear: "지난 미완료 삭제",
  odDaysBehind: "{n}일 밀림", previewOnlyHint: "다가오는 일정에서는 완료할 수 없습니다. 그날 「오늘」에서 처리하세요.",
  inboxNote: "프로젝트 밖의 모든 작업이 여기 모입니다. 날짜를 정하면 오늘·캘린더에도 함께 표시됩니다.",
  prioNormal: "우선순위 4", prioImportant: "우선순위 2", prioUrgent: "우선순위 1", prioMedium: "우선순위 3",
  stOpen: "대기", stInProgress: "진행 중", stCompleted: "완료", stOverdue: "지연",
  repDaily: "매일", repWeekly: "매주 {wd}요일", repWeekdays: "평일마다 (월–금)", repMonthly: "매월 {d}일",
  repYearly: "매년 {m}월 {d}일", repCustom: "사용자 정의…", repCustomDays: "매주 {wd}", repPickDays: "사용자 지정", repPickDaysHint: "반복할 요일을 선택하세요", repNone: "반복 없음",
  repShortWeekly: "매주", repShortMonthly: "매월", repShortYearly: "매년", repShortWeekdays: "평일", repShortWeekends: "주말",
  durNone: "기간 없음", dur15: "15분", dur30: "30분", dur60: "1시간", dur120: "2시간", durCustom: "사용자 정의",
  today: "오늘", tomorrow: "내일", noDate: "날짜 없음", instructedBy: "{name} 지시", sharedWith: "공유됨", andMore: "{name} 외 {n}명",
  iaTitle: "작업 이름", iaDesc: "설명", iaSchedule: "일정", iaPriority: "우선순위", iaTarget: "대상 (지시)",
  iaAttach: "첨부", iaAttachN: "사진 {n}", iaCancel: "취소", iaSave: "작업 추가", iaInbox: "관리함", iaSendInstr: "지시로 전송", iaSendInstrCta: "지시 보내기",
  dpTask: "작업", dpInbox: "관리함", dpStatus: "상태", dpCompleteNeedsOccurrence: "반복 작업은 오늘 · 내일 · 캘린더에서 열어야 그 날짜를 완료할 수 있어요", dpSchedule: "일정", dpScheduleChange: "일정 변경",
  dpDue: "마감", dpSched: "예정", dpTime: "시간", dpRepeat: "반복", dpNoDate: "일정 없음",
  dpLinked: "연결됨", dpViewResv: "예약 보기", dpParticipants: "참여자 · {n}명 · 상태 공통",
  dpAuthor: "작성자", dpFirstRecipient: "최초 수신", dpMe: "나", dpShareManage: "멤버 추가 / 공유 관리",
  dpShareCta: "멤버에게 공유 / 지시", dpPhotos: "첨부 사진 {n}", dpLog: "업데이트 로그",
  dpLogCreated: "{name} 님이 작업 생성",
  logShared: "{name} 님이 공유", logEdited: "{name} 님이 내용 수정", logCompleted: "{name} 님이 완료 처리",
  logReopened: "{name} 님이 다시 열기", logInProgress: "{name} 님이 진행 중으로 변경",
  logOpen: "{name} 님이 대기로 변경", logUpdated: "{name} 님이 업데이트",
  dpLogInput: "노트 추가…", dpEdit: "편집", dpSave: "저장", dpTagAdd: "태그 추가",
  phAdd: "사진 추가", phAddCompact: "사진", phDropHint: "클릭하거나 파일을 끌어다 놓으세요",
  phCount: "{n}/{max}", phRemove: "사진 삭제", phTooMany: "최대 {max}장까지 첨부할 수 있습니다",
  phInvalidType: "이미지 파일만 첨부할 수 있습니다", phTooLarge: "파일 용량은 {max}MB 이하만 가능합니다",
  phUploading: "업로드 중…",
  cpTitle: "예약 연결", cpHintBuilding: "건물을 선택하세요", cpHintRoom: "객실을 선택하면 해당 기간 예약이 표시됩니다", cpBuildings: "건물", cpRooms: "객실", cpReservations: "예약", cpSearch: "게스트명 또는 예약번호 검색", cpSearchClear: "지우기", cpSearchEmpty: "검색 결과가 없습니다", cpSearchEmptySub: "게스트명이나 예약번호로 다시 검색해보세요", cpNoBuilding: "등록된 건물이 없습니다", cpNoRooms: "등록된 객실이 없습니다", cpNoReservation: "이 기간에는 예약이 없습니다", cpGuest: "게스트", cpLoading: "불러오는 중", cpBack: "뒤로", cpClear: "연결 해제", cpApply: "적용", cpCancel: "취소", cpOccupied: "투숙 중", cpVacant: "공실", cpBlocked: "차단", cpNightsUnit: "박", cpChannelDirect: "직접 예약", cpLive: "체류중", cpRoomsUnit: "실", cpTodayGuests: "오늘 투숙", cpRoomSuffix: "호", cpBookingId: "예약번호", dpShare: "공유",
  dpDelete: "삭제", dpUnshareDelete: "공유 해제·삭제", dpAuthorOnly: "원문은 작성자({name})만 수정할 수 있습니다",
  dpLeave: "나만 빠지기", dpMobileDetail: "모바일 상세",
  ctxBuilding: "건물", ctxBed: "객실", ctxTicket: "예약", ctxGuest: "게스트",
  schApply: "적용", schCancel: "취소", schNoRepeat: "반복 안 함",
  schQToday: "오늘", schQTomorrow: "내일", schQNextWeek: "다음 주", schQNextWeekend: "다음 주말", schQNoDate: "날짜 없음",
  schTime: "시간", schTimeNone: "시간 없음", schRepeat: "반복", schDuration: "기간",
  shTargetTitle: "대상 지정 (업무 지시)", shShareTitle: "멤버 공유",
  shTargetSub: "1명 이상 선택하면 지시로 전송됩니다.", shShareSub: "활성 멤버를 선택해 함께 진행합니다.",
  shTargetHint: "대상에게는 “{name} 지시” 표식이 붙습니다. 담당자 지정이 아닌 공유 기반입니다.",
  shSearch: "멤버 검색", shTargetCta: "지시", shShareCta: "공유", shNoResult: "검색 결과가 없습니다.", shManager: "매니저",
  mScheduleChange: "일정 변경", mPriority: "우선순위", mShareInstr: "공유 / 지시", mMoveToday: "오늘로 이동", mMoveTomorrow: "내일로 이동",
  mMoveInbox: "관리함으로", mDelete: "삭제", mLeave: "나만 빠지기",
  recurDeleteTitle: "반복되는 작업입니다", recurSkipOne: "{date}만 건너뛰기",
  recurSkipOneSub: "이 날짜만 넘어가고 반복은 계속됩니다", recurDeleteAll: "반복 전체 삭제",
  recurDeleteAllSub: "모든 날짜에서 사라집니다", recurSkippedToast: "{date} 건너뜀",
  instrRecv: "받은 지시", instrSent: "보낸 지시",
  instrSentNote: "지시한 업무는 대상자의 일정으로 잡힙니다. 내 “오늘” 목록에는 들어오지 않고, 이 화면에서 진행 상황만 챙깁니다.",
  instrRecvNote: "나에게 부여된 업무입니다. 내 “오늘 · 캘린더”에도 함께 표시되며, 상황을 바꾸면 지시한 사람에게 바로 공유됩니다.",
  instrSecUnconfirmed: "미확인 · 대기", instrSecInProgress: "진행 중", instrSecCompleted: "완료", instrSecOverdue: "지연", instrSecTodo: "해야 할 지시",
  instrUnconfirmed: "미확인", instrRemind: "리마인드 보내기", instrReply: "답장 · 노트", instrChangeTarget: "대상 변경",
  instrEmptySentT: "보낸 지시가 없습니다", instrEmptySentS: "작업을 만들 때 “대상(지시)”을 지정하면 여기에서 진행을 추적합니다.",
  instrEmptyRecvT: "받은 지시가 없습니다", instrEmptyRecvS: "매니저가 부여한 업무가 여기에 모입니다.", instrCommon: "공동 {n}명",
  sharedRecvSec: "다른 멤버가 공유함", sharedSentSec: "내가 공유함",
  cmpDone: "{n}건 완료", cmpReport: "보고서 (업무일지)", cmpBy: "{name} 완료", cmpToday: "오늘", cmpYesterday: "어제",
  calThisMonth: "이번 달", calPreviousMonth: "이전 달", calNextMonth: "다음 달", calLegendPersonal: "개인", calLegendShared: "공유", calLegendUrgent: "긴급 · 지연",
  calUpcoming: "다가오는 일정", calMore: "+{n}건 더보기", calNoMonth: "이번 달 예정된 작업이 없습니다.",
  calHideRepeat: "반복 숨기기",
  calAddOnDay: "이 날짜에 작업 추가", calDayEmpty: "이 날짜에 예정된 작업이 없습니다.",
  pjBanner: "공유 프로젝트 · 멤버 {n}명", pjMembers: "멤버 관리", pjAddTaskTo: "{name}에 작업 추가",
  pjEmptyT: "이 프로젝트에 작업이 없습니다", pjEmptyS: "첫 작업을 추가해 프로젝트를 시작하세요.",
  pjDelete: "프로젝트 삭제", pjSectionAdd: "섹션 추가", pjSectionNamePh: "섹션 이름", pjSectionRename: "이름 변경", pjSectionDelete: "섹션 삭제", pjSectionDeleteMsg: "'{title}' 섹션과 그 안의 작업을 함께 삭제할까요?", pjMembersManage: "멤버 관리", pjDeleteMsg: "'{title}' 프로젝트를 삭제할까요? 프로젝트의 모든 작업·섹션·멤버가 함께 삭제되며 되돌릴 수 없습니다.", pjDeleted: "프로젝트를 삭제했습니다",
  npTitle: "새 공유 프로젝트", npName: "프로젝트 이름", npNamePh: "예: 성수기 오픈 준비",
  npMembers: "{n}명 · 나 포함", npSearch: "이름 · 직무 검색", npHint: "프로젝트 작업은 멤버 전원이 같은 상태를 공유합니다.",
  npCancel: "취소", npCreate: "프로젝트 만들기",
  rptTitle: "업무일지", rptHint: "필요한 부분을 고친 뒤 복사하거나 Slack으로 보내세요",
  rptSub: "{date} · 완료 {total}건 중 {selected}건 포함", rptBodyLabel: "본문",
  rptPickTitle: "포함할 항목", rptPickAll: "전체 선택", rptPickNone: "전체 해제",
  rptPickCount: "{total}개 중 {selected}개", rptPickEmpty: "최소 한 개는 선택해 주세요.",
  rptPickResetHint: "선택을 바꾸면 편집한 내용이 다시 만들어져요.",
  rptReset: "원본으로", rptClose: "닫기", rptCopy: "전체 복사", rptCopied: "복사했습니다.",
  rptSlackSend: "Slack으로 보내기", rptSlackSending: "전송 중…", rptSlackSent: "Slack으로 보냈습니다.",
  rptSlackNotConfigured: "Slack 전송이 아직 설정되지 않았습니다.", rptSlackTooLong: "보고서가 너무 길어 Slack으로 보낼 수 없습니다.", rptSlackError: "Slack으로 보내지 못했습니다. 다시 시도해 주세요.",
  rptWhen: "보낼 시각", rptWhenNow: "지금 바로", rptWhenToday: "오늘 {time}", rptWhenCustom: "직접", rptWhenHour: "시", rptWhenMinute: "분", rptWhenNoSlots: "오늘은 더 고를 시각이 없어요", rptWhenAsk: "오늘 언제 보낼까요?", rptSendAt: "{time}에 보내기", rptScheduledBtn: "{time} 예약됨", rptReschedule: "바뀐 내용으로 예약", rptScheduledBanner: "오늘 {time}에 Slack으로 보내요", rptScheduleCancel: "예약 취소", rptScheduling: "예약하는 중…", rptScheduledToast: "{time}에 보내도록 예약했어요", rptScheduleChanged: "바뀐 내용은 아직 예약에 반영되지 않았어요", rptScheduleSent: "{time}에 Slack으로 보냈어요", rptScheduleFailed: "{time} 예약을 보내지 못했어요", rptScheduleCancelled: "예약을 취소했어요", rptSchedulePast: "지난 시각이에요. 다시 골라 주세요", rptScheduleBusy: "지금 보내는 중이에요. 잠시 뒤 다시 확인해 주세요", rptListScheduled: "{time} 예약", rptListSent: "{time} 보냄", rptListFailed: "보내지 못함",
  emToday: "오늘 처리할 일이 없습니다", emTodayS: "관리함을 정리하거나 새 작업을 추가해 보세요.",
  emTomorrow: "내일 예정된 작업이 없습니다", emTomorrowS: "일정을 잡아두면 여기에서 미리 볼 수 있어요.",
  emInbox: "관리함이 비어 있습니다", emInboxS: "프로젝트 밖의 작업이 여기에 모두 모입니다.",
  emShared: "공유 중인 작업이 없습니다", emSharedS: "작업에 멤버를 추가하면 함께 진행할 수 있어요.",
  emFilter: "조건에 맞는 작업이 없습니다", emFilterS: "검색어나 필터를 바꿔 보세요.",
  emProject: "이 프로젝트에 작업이 없습니다", emProjectS: "첫 작업을 추가해 프로젝트를 시작하세요.",
  emCompleted: "완료된 작업이 없습니다", emCompletedS: "작업을 완료하면 날짜별로 여기에 기록됩니다.",
  errT: "작업을 불러오지 못했습니다", errS: "네트워크 연결을 확인하고 다시 시도해 주세요.", retry: "다시 시도",
  errAuth: "다시 로그인해 주세요.", errForbidden: "권한이 없습니다.", errSave: "저장하지 못했습니다.", errGeneric: "처리하지 못했습니다. 다시 시도해 주세요.",
  errMissingTitle: "제목을 입력해 주세요.", errTimeNeedsDate: "시간을 지정하려면 날짜를 먼저 선택해 주세요.",
  errRepeatNeedsDate: "반복을 설정하려면 날짜를 먼저 선택해 주세요.", errNotFound: "작업을 찾을 수 없습니다.",
  errInvalidDate: "날짜 형식이 올바르지 않습니다.", errEmpty: "내용을 입력해 주세요.",
  errDuplicateOccurrence: "그 날짜에는 이미 같은 반복 작업이 있습니다.",
  errRecurringSeries: "반복 업무는 일정을 옮길 수 없습니다. 반복 설정을 수정하거나 이 회차만 건너뛰세요.",
  tCreated: "작업을 추가했습니다.", tUpdated: "작업을 수정했습니다.", tCompleted: "완료 처리했습니다.", tReopened: "다시 열었습니다.",
  tShared: "공유했습니다.", tInstructed: "지시를 보냈습니다.", tDeleted: "삭제했습니다.", tMoved: "이동했습니다.",
  tRescheduled: "일정을 변경했습니다.", tNoteAdded: "노트를 추가했습니다.", tProjectCreated: "프로젝트를 만들었습니다.", tReminded: "리마인드를 보냈습니다.",
  confirmTitle: "확인",
  confirmDeleteMsg: "이 작업을 삭제할까요? 되돌릴 수 없습니다.",
  confirmLeaveMsg: "이 작업에서 나만 빠질까요?",
  confirmClearMsg: "지난 미완료 작업을 모두 정리할까요?",
  confirmDeleteBtn: "삭제",
  railTodayTitle: "오늘 진행 현황", railTodayProgress: "오늘 작업 진척률", railDoneToday: "오늘 완료", railUpcomingEmpty: "다가오는 일정이 없습니다",
  undoBtn: "실행 취소", undoNext: "다음: {date}", tDeletedUndoable: "작업을 삭제했습니다",
  selMode: "선택", selSelected: "{n}개 선택", selAll: "전체 선택", selClear: "선택 해제",
  selDelete: "삭제", selEmptyHint: "삭제할 작업을 선택하세요",
  odPickHint: "처리할 지연 작업을 선택하세요",
  selHint: "행을 클릭해 선택하거나 해제하세요",
  confirmBulkMsg: "선택한 {n}개 작업을 삭제할까요?",
  confirmBulkSharedNote: "공유·지시받은 작업은 삭제 대신 나만 빠집니다. 이 항목은 실행 취소로 되돌릴 수 없습니다.",
  tBulkDeleted: "{n}개 작업을 삭제했습니다",
  tBulkPartial: "{n}개 삭제, {f}개 실패",
  w: koW,
};

const jaW: AdminTasksWhiteCopy = {
  descMore: "もっと見る", descLess: "閉じる",
  navAria: "ToDo の表示", projects: "プロジェクト",
  prioUrgent: "至急", prioImportant: "重要", prioMedium: "普通", prioNone: "なし",
  todaySub: "{date} · {total}件中{done}件完了", progressAria: "今日 {total}件中{done}件完了",
  dayCount: "{n}件", secDone: "完了", reschedule: "日付を変更", odPickDate: "日付を選ぶ",
  shareN: "共有 {n}人", photoN: "写真 {n}", dueBy: "{date}まで", fromTo: "{from} → {to}",
  detailEmpty: "タスクを選ぶとここに詳細が表示されます", detailEmptySub: "一覧からタスクを選んでください。",
  close: "閉じる", more: "その他", edit: "編集",
  dlSchedule: "日程", dlPriority: "優先度", dlLinked: "連携", dlTags: "タグ", dlWith: "メンバー", dlProject: "プロジェクト",
  linkCta: "連携する", shareManage: "管理", photosCount: "写真 {n} / {max}", photoAdd: "写真を追加",
  updates: "アップデート", updateInput: "アップデートを残す", send: "送信",
  weekDone: "今週 {n}件完了", report: "業務日誌", fieldBadge: "現",
  fieldSub: "自動で集計されます · 業務日誌にも含まれます",
  dayToday: "{date} · 今日", calMore: "+{n}件", calToday: "今日",
  instrHint: "マネージャーからの業務 · 送った指示は自分の予定に表示されません",
  projSub: "セクション {s} · タスク {n} · 写真は最大20枚", membersN: "メンバー {n}人", sectionAdd: "セクションを追加",
  directiveFrom: "{name}の指示", sharedFrom: "{name}が共有", completedAt: "{time} 完了",
};

const ja: AdminTasksDictionary = {
  vInbox: "管理箱", vToday: "今日", vTomorrow: "明日", vShared: "共有", vInstr: "指示",
  vCompleted: "完了 · 記録", vCalendar: "カレンダー", crumb: "オフィス · Todoist", taskWord: "{n}件",
  addTask: "タスク追加", searchPlaceholder: "タスク · 担当者 · 部屋 検索", mobileView: "モバイル表示",
  sharedProjects: "共有プロジェクト", newProject: "新規プロジェクト",
  filterSearch: "タイトル · 作成者 検索", filterDate: "日付", filterPrio: "優先度",
  secOverdue: "遅延", secToday: "今日",
  overdueTitle: "過ぎた(遅延)タスク {n}件", overdueSub: "締切を過ぎたタスクです。今日に移すか整理してください。",
  overdueReschedule: "日程変更", overdueClear: "過去の未完了を削除",
  odDaysBehind: "{n}日 遅延", previewOnlyHint: "予定リストでは完了にできません。当日「今日」で処理してください。",
  inboxNote: "プロジェクト外のすべてのタスクがここに集まります。日付を決めると今日・カレンダーにも表示されます。",
  prioNormal: "優先度 4", prioImportant: "優先度 2", prioUrgent: "優先度 1", prioMedium: "優先度 3",
  stOpen: "待機", stInProgress: "進行中", stCompleted: "完了", stOverdue: "遅延",
  repDaily: "毎日", repWeekly: "毎週{wd}曜日", repWeekdays: "平日ごと (月–金)", repMonthly: "毎月{d}日",
  repYearly: "毎年{m}月{d}日", repCustom: "カスタム…", repCustomDays: "毎週{wd}", repPickDays: "カスタム", repPickDaysHint: "繰り返す曜日を選択してください", repNone: "繰り返しなし",
  repShortWeekly: "毎週", repShortMonthly: "毎月", repShortYearly: "毎年", repShortWeekdays: "平日", repShortWeekends: "週末",
  durNone: "期間なし", dur15: "15分", dur30: "30分", dur60: "1時間", dur120: "2時間", durCustom: "カスタム",
  today: "今日", tomorrow: "明日", noDate: "日付なし", instructedBy: "{name} 指示", sharedWith: "共有中", andMore: "{name} 他 {n}名",
  iaTitle: "タスク名", iaDesc: "説明", iaSchedule: "日程", iaPriority: "優先度", iaTarget: "対象 (指示)",
  iaAttach: "添付", iaAttachN: "写真 {n}", iaCancel: "キャンセル", iaSave: "タスク追加", iaInbox: "管理箱", iaSendInstr: "指示で送信", iaSendInstrCta: "指示を送る",
  dpTask: "タスク", dpInbox: "管理箱", dpStatus: "状態", dpCompleteNeedsOccurrence: "繰り返しタスクは今日・明日・カレンダーから開くと、その日付を完了にできます", dpSchedule: "日程", dpScheduleChange: "日程変更",
  dpDue: "締切", dpSched: "予定", dpTime: "時間", dpRepeat: "繰り返し", dpNoDate: "日程なし",
  dpLinked: "リンク", dpViewResv: "予約を見る", dpParticipants: "参加者 · {n}名 · 状態共通",
  dpAuthor: "作成者", dpFirstRecipient: "最初の受信", dpMe: "自分", dpShareManage: "メンバー追加 / 共有管理",
  dpShareCta: "メンバーに共有 / 指示", dpPhotos: "添付写真 {n}", dpLog: "更新ログ",
  dpLogCreated: "{name} さんがタスク作成",
  logShared: "{name} さんが共有", logEdited: "{name} さんが内容を編集", logCompleted: "{name} さんが完了",
  logReopened: "{name} さんが再オープン", logInProgress: "{name} さんが進行中に変更",
  logOpen: "{name} さんが待機に変更", logUpdated: "{name} さんが更新",
  dpLogInput: "ノート追加…", dpEdit: "編集", dpSave: "保存", dpTagAdd: "タグ追加",
  phAdd: "写真を追加", phAddCompact: "写真", phDropHint: "クリックまたはファイルをドラッグしてください",
  phCount: "{n}/{max}", phRemove: "写真を削除", phTooMany: "最大{max}枚まで添付できます",
  phInvalidType: "画像ファイルのみ添付できます", phTooLarge: "ファイルサイズは{max}MB以下のみ可能です",
  phUploading: "アップロード中…",
  cpTitle: "予約リンク", cpHintBuilding: "建物を選択してください", cpHintRoom: "客室を選択すると該当期間の予約が表示されます", cpBuildings: "建物", cpRooms: "客室", cpReservations: "予約", cpSearch: "ゲスト名または予約番号で検索", cpSearchClear: "クリア", cpSearchEmpty: "検索結果がありません", cpSearchEmptySub: "ゲスト名や予約番号で再検索してください", cpNoBuilding: "登録された建物がありません", cpNoRooms: "登録された客室がありません", cpNoReservation: "この期間に予約はありません", cpGuest: "ゲスト", cpLoading: "読み込み中", cpBack: "戻る", cpClear: "リンク解除", cpApply: "適用", cpCancel: "キャンセル", cpOccupied: "滞在中", cpVacant: "空室", cpBlocked: "ブロック", cpNightsUnit: "泊", cpChannelDirect: "直接予約", cpLive: "滞在中", cpRoomsUnit: "室", cpTodayGuests: "本日の宿泊", cpRoomSuffix: "号", cpBookingId: "予約番号", dpShare: "共有",
  dpDelete: "削除", dpUnshareDelete: "共有解除・削除", dpAuthorOnly: "本文は作成者({name})のみ編集できます",
  dpLeave: "自分だけ抜ける", dpMobileDetail: "モバイル詳細",
  ctxBuilding: "建物", ctxBed: "部屋", ctxTicket: "予約", ctxGuest: "ゲスト",
  schApply: "適用", schCancel: "キャンセル", schNoRepeat: "繰り返さない",
  schQToday: "今日", schQTomorrow: "明日", schQNextWeek: "来週", schQNextWeekend: "次の週末", schQNoDate: "日付なし",
  schTime: "時間", schTimeNone: "時間なし", schRepeat: "繰り返し", schDuration: "期間",
  shTargetTitle: "対象指定 (業務指示)", shShareTitle: "メンバー共有",
  shTargetSub: "1名以上選ぶと指示として送信されます。", shShareSub: "アクティブなメンバーを選んで一緒に進めます。",
  shTargetHint: "対象には「{name} 指示」の表示が付きます。担当者指定ではなく共有ベースです。",
  shSearch: "メンバー検索", shTargetCta: "指示", shShareCta: "共有", shNoResult: "検索結果がありません。", shManager: "マネージャー",
  mScheduleChange: "日程変更", mPriority: "優先度", mShareInstr: "共有 / 指示", mMoveToday: "今日に移動", mMoveTomorrow: "明日に移動",
  mMoveInbox: "管理箱へ", mDelete: "削除", mLeave: "自分だけ抜ける",
  recurDeleteTitle: "繰り返しのタスクです", recurSkipOne: "{date}のみスキップ",
  recurSkipOneSub: "この日だけ飛ばし、繰り返しは続きます", recurDeleteAll: "繰り返しを全て削除",
  recurDeleteAllSub: "全ての日付から消えます", recurSkippedToast: "{date} をスキップ",
  instrRecv: "受けた指示", instrSent: "送った指示",
  instrSentNote: "指示した業務は対象者の日程に入ります。自分の「今日」には入らず、この画面で進捗のみ確認します。",
  instrRecvNote: "自分に付与された業務です。自分の「今日 · カレンダー」にも表示され、状態を変えると指示者にすぐ共有されます。",
  instrSecUnconfirmed: "未確認 · 待機", instrSecInProgress: "進行中", instrSecCompleted: "完了", instrSecOverdue: "遅延", instrSecTodo: "やるべき指示",
  instrUnconfirmed: "未確認", instrRemind: "リマインド送信", instrReply: "返信 · ノート", instrChangeTarget: "対象変更",
  instrEmptySentT: "送った指示がありません", instrEmptySentS: "タスク作成時に「対象(指示)」を指定するとここで進捗を追跡します。",
  instrEmptyRecvT: "受けた指示がありません", instrEmptyRecvS: "マネージャーが付与した業務がここに集まります。", instrCommon: "共同 {n}名",
  sharedRecvSec: "他のメンバーが共有", sharedSentSec: "自分が共有",
  cmpDone: "{n}件完了", cmpReport: "レポート (業務日報)", cmpBy: "{name} 完了", cmpToday: "今日", cmpYesterday: "昨日",
  calThisMonth: "今月", calPreviousMonth: "前の月", calNextMonth: "次の月", calLegendPersonal: "個人", calLegendShared: "共有", calLegendUrgent: "緊急 · 遅延",
  calUpcoming: "今後の予定", calMore: "+{n}件 もっと見る", calNoMonth: "今月の予定はありません。",
  calHideRepeat: "繰り返しを隠す",
  calAddOnDay: "この日にタスク追加", calDayEmpty: "この日の予定はありません。",
  pjBanner: "共有プロジェクト · メンバー {n}名", pjMembers: "メンバー管理", pjAddTaskTo: "{name}にタスク追加",
  pjEmptyT: "このプロジェクトにタスクがありません", pjEmptyS: "最初のタスクを追加してプロジェクトを始めましょう。",
  pjDelete: "プロジェクト削除", pjSectionAdd: "セクション追加", pjSectionNamePh: "セクション名", pjSectionRename: "名前を変更", pjSectionDelete: "セクション削除", pjSectionDeleteMsg: "'{title}' セクションと中のタスクをまとめて削除しますか？", pjMembersManage: "メンバー管理", pjDeleteMsg: "「{title}」プロジェクトを削除しますか？プロジェクトのすべてのタスク・セクション・メンバーも一緒に削除され、元に戻せません。", pjDeleted: "プロジェクトを削除しました",
  npTitle: "新規共有プロジェクト", npName: "プロジェクト名", npNamePh: "例: 繁忙期オープン準備",
  npMembers: "{n}名 · 自分含む", npSearch: "名前 · 職務 検索", npHint: "プロジェクトのタスクはメンバー全員が同じ状態を共有します。",
  npCancel: "キャンセル", npCreate: "プロジェクト作成",
  rptTitle: "業務日報", rptHint: "必要な部分を編集してから、コピーまたはSlackへ送信してください",
  rptSub: "{date} · 完了{total}件中 {selected}件を含む", rptBodyLabel: "本文",
  rptPickTitle: "含める項目", rptPickAll: "すべて選択", rptPickNone: "すべて解除",
  rptPickCount: "{total}件中 {selected}件", rptPickEmpty: "少なくとも1件は選択してください。",
  rptPickResetHint: "選択を変えると編集内容が作り直されます。",
  rptReset: "元に戻す", rptClose: "閉じる", rptCopy: "全体コピー", rptCopied: "コピーしました。",
  rptSlackSend: "Slackへ送る", rptSlackSending: "送信中…", rptSlackSent: "Slackへ送信しました。",
  rptSlackNotConfigured: "Slack送信はまだ設定されていません。", rptSlackTooLong: "レポートが長すぎてSlackへ送信できません。", rptSlackError: "Slackへ送信できませんでした。もう一度お試しください。",
  rptWhen: "送信時刻", rptWhenNow: "今すぐ", rptWhenToday: "今日 {time}", rptWhenCustom: "指定", rptWhenHour: "時", rptWhenMinute: "分", rptWhenNoSlots: "今日はもう選べる時刻がありません", rptWhenAsk: "今日いつ送りますか？", rptSendAt: "{time}に送信", rptScheduledBtn: "{time} 予約済み", rptReschedule: "変更内容で予約", rptScheduledBanner: "今日 {time} にSlackへ送信します", rptScheduleCancel: "予約取消", rptScheduling: "予約中…", rptScheduledToast: "{time} に送信するよう予約しました", rptScheduleChanged: "変更内容はまだ予約に反映されていません", rptScheduleSent: "{time} にSlackへ送信しました", rptScheduleFailed: "{time} の予約を送信できませんでした", rptScheduleCancelled: "予約を取り消しました", rptSchedulePast: "過ぎた時刻です。もう一度選んでください", rptScheduleBusy: "今送信中です。少し後でもう一度確認してください", rptListScheduled: "{time} 予約", rptListSent: "{time} 送信済み", rptListFailed: "送信できず",
  emToday: "今日やることはありません", emTodayS: "管理箱を整理するか新しいタスクを追加しましょう。",
  emTomorrow: "明日の予定はありません", emTomorrowS: "日程を入れておくとここで先に見られます。",
  emInbox: "管理箱が空です", emInboxS: "プロジェクト外のタスクがすべてここに集まります。",
  emShared: "共有中のタスクがありません", emSharedS: "タスクにメンバーを追加すると一緒に進められます。",
  emFilter: "条件に合うタスクがありません", emFilterS: "検索語やフィルターを変えてみてください。",
  emProject: "このプロジェクトにタスクがありません", emProjectS: "最初のタスクを追加してプロジェクトを始めましょう。",
  emCompleted: "完了したタスクがありません", emCompletedS: "タスクを完了すると日付ごとにここに記録されます。",
  errT: "タスクを読み込めませんでした", errS: "ネットワーク接続を確認して再試行してください。", retry: "再試行",
  errAuth: "再度ログインしてください。", errForbidden: "権限がありません。", errSave: "保存できませんでした。", errGeneric: "処理できませんでした。もう一度お試しください。",
  errMissingTitle: "タイトルを入力してください。", errTimeNeedsDate: "時間を指定するには先に日付を選択してください。",
  errRepeatNeedsDate: "繰り返しを設定するには先に日付を選択してください。", errNotFound: "タスクが見つかりません。",
  errInvalidDate: "日付の形式が正しくありません。", errEmpty: "内容を入力してください。",
  errDuplicateOccurrence: "その日付には同じ繰り返しタスクが既にあります。",
  errRecurringSeries: "繰り返しタスクの日程は移動できません。繰り返し設定を編集するか、この回だけスキップしてください。",
  tCreated: "タスクを追加しました。", tUpdated: "タスクを更新しました。", tCompleted: "完了しました。", tReopened: "再度開きました。",
  tShared: "共有しました。", tInstructed: "指示を送りました。", tDeleted: "削除しました。", tMoved: "移動しました。",
  tRescheduled: "日程を変更しました。", tNoteAdded: "ノートを追加しました。", tProjectCreated: "プロジェクトを作成しました。", tReminded: "リマインドを送りました。",
  confirmTitle: "確認",
  confirmDeleteMsg: "このタスクを削除しますか？元に戻せません。",
  confirmLeaveMsg: "このタスクから自分だけ抜けますか？",
  confirmClearMsg: "過去の未完了タスクをすべて整理しますか？",
  confirmDeleteBtn: "削除",
  railTodayTitle: "今日の進捗", railTodayProgress: "今日のタスク進捗率", railDoneToday: "本日完了", railUpcomingEmpty: "今後の予定はありません",
  undoBtn: "元に戻す", undoNext: "次回: {date}", tDeletedUndoable: "タスクを削除しました",
  selMode: "選択", selSelected: "{n}件選択", selAll: "すべて選択", selClear: "選択解除",
  selDelete: "削除", selEmptyHint: "削除するタスクを選択してください",
  odPickHint: "処理する遅延タスクを選択してください",
  selHint: "行をクリックして選択・解除できます",
  confirmBulkMsg: "選択した{n}件のタスクを削除しますか？",
  confirmBulkSharedNote: "共有・指示されたタスクは削除ではなく自分だけ抜けます。この項目は元に戻せません。",
  tBulkDeleted: "{n}件のタスクを削除しました",
  tBulkPartial: "{n}件削除、{f}件失敗",
  w: jaW,
};

const enW: AdminTasksWhiteCopy = {
  descMore: "Show more", descLess: "Show less",
  navAria: "To-do views", projects: "Projects",
  prioUrgent: "Urgent", prioImportant: "Important", prioMedium: "Normal", prioNone: "None",
  todaySub: "{date} · {done} of {total} done", progressAria: "{done} of {total} done today",
  dayCount: "{n} tasks", secDone: "Done", reschedule: "Reschedule", odPickDate: "Pick a date",
  shareN: "Shared · {n}", photoN: "{n} photos", dueBy: "due {date}", fromTo: "{from} → {to}",
  detailEmpty: "Select a task to see its details here", detailEmptySub: "Pick a task from the list.",
  close: "Close", more: "More", edit: "Edit",
  dlSchedule: "Schedule", dlPriority: "Priority", dlLinked: "Linked", dlTags: "Tags", dlWith: "With", dlProject: "Project",
  linkCta: "Link", shareManage: "Manage", photosCount: "Photos {n} / {max}", photoAdd: "Add photo",
  updates: "Updates", updateInput: "Leave an update", send: "Send",
  weekDone: "{n} done this week", report: "Daily report", fieldBadge: "F",
  fieldSub: "Collected automatically · included in the daily report",
  dayToday: "{date} · Today", calMore: "+{n} more", calToday: "Today",
  instrHint: "Work sent by managers · directives you send don't appear in your schedule",
  projSub: "{s} sections · {n} tasks · up to 20 photos", membersN: "{n} members", sectionAdd: "Add section",
  directiveFrom: "Directive from {name}", sharedFrom: "Shared by {name}", completedAt: "Done {time}",
};

const en: AdminTasksDictionary = {
  vInbox: "Inbox", vToday: "Today", vTomorrow: "Tomorrow", vShared: "Shared", vInstr: "Directives",
  vCompleted: "Completed", vCalendar: "Calendar", crumb: "Office · Todoist", taskWord: "{n} tasks",
  addTask: "Add task", searchPlaceholder: "Search tasks · people · rooms", mobileView: "Mobile view",
  sharedProjects: "Shared projects", newProject: "New project",
  filterSearch: "Search title · author", filterDate: "Date", filterPrio: "Priority",
  secOverdue: "Overdue", secToday: "Today",
  overdueTitle: "{n} overdue task(s)", overdueSub: "Past their due date. Move them to today or clear them out.",
  overdueReschedule: "Reschedule", overdueClear: "Clear past unfinished",
  odDaysBehind: "{n} days behind", previewOnlyHint: "Upcoming items can't be completed here — do it on the day, from Today.",
  inboxNote: "Every task outside a project lives here. Give it a date and it also shows in Today · Calendar.",
  prioNormal: "Priority 4", prioImportant: "Priority 2", prioUrgent: "Priority 1", prioMedium: "Priority 3",
  stOpen: "Open", stInProgress: "In progress", stCompleted: "Done", stOverdue: "Overdue",
  repDaily: "Daily", repWeekly: "Weekly on {wd}", repWeekdays: "Every weekday (Mon–Fri)", repMonthly: "Monthly on the {d}",
  repYearly: "Yearly on {m}/{d}", repCustom: "Custom…", repCustomDays: "Weekly on {wd}", repPickDays: "Custom", repPickDaysHint: "Pick the days to repeat on", repNone: "No repeat",
  repShortWeekly: "Weekly", repShortMonthly: "Monthly", repShortYearly: "Yearly", repShortWeekdays: "Weekdays", repShortWeekends: "Weekends",
  durNone: "No duration", dur15: "15 min", dur30: "30 min", dur60: "1 hour", dur120: "2 hours", durCustom: "Custom",
  today: "Today", tomorrow: "Tomorrow", noDate: "No date", instructedBy: "{name} directive", sharedWith: "Shared", andMore: "{name} +{n}",
  iaTitle: "Task name", iaDesc: "Description", iaSchedule: "Schedule", iaPriority: "Priority", iaTarget: "Target (directive)",
  iaAttach: "Attach", iaAttachN: "{n} photos", iaCancel: "Cancel", iaSave: "Add task", iaInbox: "Inbox", iaSendInstr: "Send as directive", iaSendInstrCta: "Send a directive",
  dpTask: "Task", dpInbox: "Inbox", dpStatus: "Status", dpCompleteNeedsOccurrence: "Open a recurring task from Today, Tomorrow, or Calendar to complete a specific date.", dpSchedule: "Schedule", dpScheduleChange: "Reschedule",
  dpDue: "Due", dpSched: "Scheduled", dpTime: "Time", dpRepeat: "Repeat", dpNoDate: "No date",
  dpLinked: "Linked", dpViewResv: "View reservation", dpParticipants: "Participants · {n} · shared status",
  dpAuthor: "Author", dpFirstRecipient: "First recipient", dpMe: "You", dpShareManage: "Add member / manage sharing",
  dpShareCta: "Share / assign directive", dpPhotos: "Attached photos {n}", dpLog: "Update log",
  dpLogCreated: "{name} created the task",
  logShared: "{name} shared it", logEdited: "{name} edited the content", logCompleted: "{name} completed it",
  logReopened: "{name} reopened it", logInProgress: "{name} set it to in progress",
  logOpen: "{name} set it back to open", logUpdated: "{name} updated it",
  dpLogInput: "Add a note…", dpEdit: "Edit", dpSave: "Save", dpTagAdd: "Add tag",
  phAdd: "Add photos", phAddCompact: "Photos", phDropHint: "Click or drag files here",
  phCount: "{n}/{max}", phRemove: "Remove photo", phTooMany: "Up to {max} photos",
  phInvalidType: "Image files only", phTooLarge: "Files must be {max}MB or smaller",
  phUploading: "Uploading…",
  cpTitle: "Link reservation", cpHintBuilding: "Pick a building", cpHintRoom: "Pick a room to see its reservations", cpBuildings: "Buildings", cpRooms: "Rooms", cpReservations: "Reservations", cpSearch: "Search guest or booking id", cpSearchClear: "Clear", cpSearchEmpty: "No results", cpSearchEmptySub: "Try a guest name or booking id", cpNoBuilding: "No buildings registered", cpNoRooms: "No rooms registered", cpNoReservation: "No reservations in this period", cpGuest: "Guest", cpLoading: "Loading", cpBack: "Back", cpClear: "Unlink", cpApply: "Apply", cpCancel: "Cancel", cpOccupied: "Occupied", cpVacant: "Vacant", cpBlocked: "Blocked", cpNightsUnit: "n", cpChannelDirect: "Direct booking", cpLive: "Staying", cpRoomsUnit: "rooms", cpTodayGuests: "Guests today", cpRoomSuffix: "", cpBookingId: "Booking id", dpShare: "Share",
  dpDelete: "Delete", dpUnshareDelete: "Unshare · delete", dpAuthorOnly: "Only the author ({name}) can edit the content",
  dpLeave: "Leave (me only)", dpMobileDetail: "Mobile detail",
  ctxBuilding: "Building", ctxBed: "Room", ctxTicket: "Reservation", ctxGuest: "Guest",
  schApply: "Apply", schCancel: "Cancel", schNoRepeat: "No repeat",
  schQToday: "Today", schQTomorrow: "Tomorrow", schQNextWeek: "Next week", schQNextWeekend: "Next weekend", schQNoDate: "No date",
  schTime: "Time", schTimeNone: "No time", schRepeat: "Repeat", schDuration: "Duration",
  shTargetTitle: "Assign target (directive)", shShareTitle: "Share with members",
  shTargetSub: "Selecting 1+ sends it as a directive.", shShareSub: "Pick active members to collaborate.",
  shTargetHint: "The target sees a “{name} directive” marker. Share-based, not a formal assignee.",
  shSearch: "Search members", shTargetCta: "Assign", shShareCta: "Share", shNoResult: "No results.", shManager: "Manager",
  mScheduleChange: "Reschedule", mPriority: "Priority", mShareInstr: "Share / directive", mMoveToday: "Move to today", mMoveTomorrow: "Move to tomorrow",
  mMoveInbox: "Move to inbox", mDelete: "Delete", mLeave: "Leave (me only)",
  recurDeleteTitle: "This task repeats", recurSkipOne: "Skip {date} only",
  recurSkipOneSub: "Skips this date; the series keeps running", recurDeleteAll: "Delete the whole series",
  recurDeleteAllSub: "Removes it from every date", recurSkippedToast: "Skipped {date}",
  instrRecv: "Received", instrSent: "Sent",
  instrSentNote: "Directives land on the recipient's schedule. They don't enter your Today; track progress here.",
  instrRecvNote: "Assigned to you. Also shown in your Today · Calendar; status changes are shared back to the sender.",
  instrSecUnconfirmed: "Unconfirmed · open", instrSecInProgress: "In progress", instrSecCompleted: "Done", instrSecOverdue: "Overdue", instrSecTodo: "To do",
  instrUnconfirmed: "Unconfirmed", instrRemind: "Send reminder", instrReply: "Reply · note", instrChangeTarget: "Change target",
  instrEmptySentT: "No sent directives", instrEmptySentS: "Set a Target (directive) when creating a task to track it here.",
  instrEmptyRecvT: "No received directives", instrEmptyRecvS: "Tasks assigned by a manager collect here.", instrCommon: "{n} shared",
  sharedRecvSec: "Shared by others", sharedSentSec: "Shared by me",
  cmpDone: "{n} done", cmpReport: "Report (work log)", cmpBy: "done by {name}", cmpToday: "Today", cmpYesterday: "Yesterday",
  calThisMonth: "This month", calPreviousMonth: "Previous month", calNextMonth: "Next month", calLegendPersonal: "Personal", calLegendShared: "Shared", calLegendUrgent: "Urgent · overdue",
  calUpcoming: "Upcoming", calMore: "+{n} more", calNoMonth: "No tasks scheduled this month.",
  calHideRepeat: "Hide recurring",
  calAddOnDay: "Add a task on this date", calDayEmpty: "No tasks scheduled on this date.",
  pjBanner: "Shared project · {n} members", pjMembers: "Manage members", pjAddTaskTo: "Add task to {name}",
  pjEmptyT: "No tasks in this project", pjEmptyS: "Add the first task to start the project.",
  pjDelete: "Delete project", pjSectionAdd: "Add section", pjSectionNamePh: "Section name", pjSectionRename: "Rename", pjSectionDelete: "Delete section", pjSectionDeleteMsg: "Delete the '{title}' section and its tasks?", pjMembersManage: "Manage members", pjDeleteMsg: "Delete the project “{title}”? All of its tasks, sections, and members are deleted too, and this cannot be undone.", pjDeleted: "Project deleted",
  npTitle: "New shared project", npName: "Project name", npNamePh: "e.g. Peak-season opening prep",
  npMembers: "{n} · incl. you", npSearch: "Search name · role", npHint: "Project tasks share one status across all members.",
  npCancel: "Cancel", npCreate: "Create project",
  rptTitle: "Work log", rptHint: "Edit as needed, then copy it or send it to Slack",
  rptSub: "{date} · {selected} of {total} completed included", rptBodyLabel: "Text",
  rptPickTitle: "Items to include", rptPickAll: "Select all", rptPickNone: "Clear all",
  rptPickCount: "{selected} of {total}", rptPickEmpty: "Select at least one item to include.",
  rptPickResetHint: "Changing the selection rebuilds the text below.",
  rptReset: "Reset", rptClose: "Close", rptCopy: "Copy all", rptCopied: "Copied.",
  rptSlackSend: "Send to Slack", rptSlackSending: "Sending…", rptSlackSent: "Sent to Slack.",
  rptSlackNotConfigured: "Slack sending is not configured yet.", rptSlackTooLong: "This report is too long to send to Slack.", rptSlackError: "Couldn't send to Slack. Please try again.",
  rptWhen: "Send time", rptWhenNow: "Right now", rptWhenToday: "Today {time}", rptWhenCustom: "Pick", rptWhenHour: "Hour", rptWhenMinute: "Minute", rptWhenNoSlots: "No more times left today", rptWhenAsk: "When should it go out today?", rptSendAt: "Send at {time}", rptScheduledBtn: "Scheduled {time}", rptReschedule: "Schedule with changes", rptScheduledBanner: "Sends to Slack today at {time}", rptScheduleCancel: "Cancel", rptScheduling: "Scheduling…", rptScheduledToast: "Scheduled to send at {time}", rptScheduleChanged: "Your changes aren’t in the scheduled report yet", rptScheduleSent: "Sent to Slack at {time}", rptScheduleFailed: "The {time} send didn’t go through", rptScheduleCancelled: "Schedule cancelled", rptSchedulePast: "That time has passed. Pick another", rptScheduleBusy: "It’s sending right now. Check again shortly", rptListScheduled: "{time} scheduled", rptListSent: "{time} sent", rptListFailed: "Not sent",
  emToday: "Nothing due today", emTodayS: "Clear your inbox or add a new task.",
  emTomorrow: "No tasks scheduled for tomorrow", emTomorrowS: "Schedule tasks to preview them here.",
  emInbox: "Your inbox is empty", emInboxS: "Every task outside a project collects here.",
  emShared: "No shared tasks", emSharedS: "Add members to a task to work on it together.",
  emFilter: "No matching tasks", emFilterS: "Try a different search or filter.",
  emProject: "No tasks in this project", emProjectS: "Add the first task to start the project.",
  emCompleted: "No completed tasks", emCompletedS: "Completed tasks are logged here by day.",
  errT: "Couldn't load tasks", errS: "Check your connection and try again.", retry: "Retry",
  errAuth: "Please sign in again.", errForbidden: "You don't have permission.", errSave: "Couldn't save.", errGeneric: "Couldn't complete. Please try again.",
  errMissingTitle: "Enter a title.", errTimeNeedsDate: "Pick a date before setting a time.",
  errRepeatNeedsDate: "Pick a date before setting a repeat.", errNotFound: "Task not found.",
  errInvalidDate: "That date isn't valid.", errEmpty: "Enter some content.",
  errDuplicateOccurrence: "That date already has this recurring task.",
  errRecurringSeries: "Recurring tasks can't be rescheduled this way. Edit the recurrence rule instead, or skip just this occurrence.",
  tCreated: "Task added.", tUpdated: "Task updated.", tCompleted: "Marked complete.", tReopened: "Reopened.",
  tShared: "Shared.", tInstructed: "Directive sent.", tDeleted: "Deleted.", tMoved: "Moved.",
  tRescheduled: "Rescheduled.", tNoteAdded: "Note added.", tProjectCreated: "Project created.", tReminded: "Reminder sent.",
  confirmTitle: "Confirm",
  confirmDeleteMsg: "Delete this task? This can't be undone.",
  confirmLeaveMsg: "Leave this task (you only)?",
  confirmClearMsg: "Clear all past unfinished tasks?",
  confirmDeleteBtn: "Delete",
  railTodayTitle: "Today's progress", railTodayProgress: "Today's completion", railDoneToday: "Done today", railUpcomingEmpty: "Nothing upcoming",
  undoBtn: "Undo", undoNext: "Next: {date}", tDeletedUndoable: "Task deleted",
  selMode: "Select", selSelected: "{n} selected", selAll: "Select all", selClear: "Clear selection",
  selDelete: "Delete", selEmptyHint: "Select tasks to delete",
  odPickHint: "Select the overdue tasks to act on",
  selHint: "Click a row to select or deselect it",
  confirmBulkMsg: "Delete the {n} selected tasks?",
  confirmBulkSharedNote: "Tasks shared with you are left rather than deleted. Those can't be undone.",
  tBulkDeleted: "Deleted {n} tasks",
  tBulkPartial: "{n} deleted, {f} failed",
  w: enW,
};

const dictionaries: Record<Locale, AdminTasksDictionary> = { ko, ja, en };

export function getAdminTasksDictionary(locale: Locale): AdminTasksDictionary {
  return dictionaries[locale] ?? ko;
}
