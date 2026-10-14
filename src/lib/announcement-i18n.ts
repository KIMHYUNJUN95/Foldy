import type { OrganizationRole } from "@/config/roles";
import type { Locale } from "@/lib/i18n";
import type { Database } from "@/types/database";

type AnnouncementStatus = Database["public"]["Enums"]["announcement_status"];
type AnnouncementTargetScope =
  Database["public"]["Enums"]["announcement_target_scope"];

// Admin 공지 관리 콘솔 (desktop) — dashboard-only strings.
// Mobile / legacy admin strings stay in the flat AnnouncementDictionary above.
// Templated values use `{n}` / `{d}` / `{r}` placeholders resolved with String.replace in the UI.
export type AnnouncementConsoleDictionary = {
  // KPI ops bar
  kpiPublished: string;
  kpiPublishedSub: string;
  kpiDrafts: string;
  kpiDraftsSub: string;
  kpiImportant: string;
  kpiImportantSub: string;
  kpiPopup: string;
  kpiPopupSub: string;
  kpiImpUnread: string;
  kpiImpUnreadRemain: string;
  kpiImpUnreadClear: string;
  // Tabs + view bar
  tabPublished: string;
  tabDrafts: string;
  tabArchived: string;
  permLegend: string;
  newBtn: string;
  channelNote: string;
  countUnit: string;
  searchResult: string;
  // Table
  colStatus: string;
  colAnnouncement: string;
  colTarget: string;
  colAuthor: string;
  colPublishedAt: string;
  colUpdatedAt: string;
  colRead: string;
  dateKindPublished: string;
  dateKindUpdated: string;
  readUnsent: string;
  unreadN: string;
  // Short status labels
  stDraft: string;
  stPublished: string;
  stArchived: string;
  // Flag chips
  flImportant: string;
  flPinned: string;
  flPopup: string;
  flPopupOff: string;
  flImage: string;
  // Target
  everyone: string;
  targetMore: string;
  // Empty states
  emptyPubT: string;
  emptyPubS: string;
  emptyDraftT: string;
  emptyDraftS: string;
  emptyArcT: string;
  emptyArcS: string;
  emptySearchS: string;
  // Detail panel
  pInfo: string;
  pOrg: string;
  pAuthor: string;
  pTarget: string;
  pCountSuffix: string;
  pPublishedAt: string;
  pArchivedAt: string;
  pPopupUntil: string;
  pBody: string;
  pImages: string;
  pReadTitle: string;
  pRead: string;
  pUnread: string;
  pTotal: string;
  pOpenReaders: string;
  pOpenReadersSub: string;
  pnoteTitle: string;
  pnoteBody: string;
  notSentTitle: string;
  notSentSub: string;
  zAuthorTitle: string;
  zAuthorTag: string;
  zAuthorDesc: string;
  zEditContent: string;
  zEditDraft: string;
  zAuthorLocked: string;
  zOpTitle: string;
  zOpTag: string;
  zOpDesc: string;
  zPublish: string;
  zRepublish: string;
  zRevert: string;
  zArchive: string;
  zDelete: string;
  zOpLocked: string;
  mobileDetail: string;
  close: string;
  // Form modal
  fNewKicker: string;
  fEditKicker: string;
  fNewTitle: string;
  fOrg: string;
  fTitle: string;
  fTitlePh: string;
  fBody: string;
  fBodyPh: string;
  fImages: string;
  fImagesMax: string;
  fImageCount: string;
  fImgAdd: string;
  fImgTooMany: string;
  fImgTooLarge: string;
  fImgBadType: string;
  fScope: string;
  fScopeEveryone: string;
  fScopeEveryoneSub: string;
  fScopeRoles: string;
  fScopeRolesSub: string;
  fRoles: string;
  fStatus: string;
  fStDraft: string;
  fStDraftSub: string;
  fStPublish: string;
  fStPublishSub: string;
  fOptions: string;
  fImportant: string;
  fImportantSub: string;
  fPinned: string;
  fPinnedSub: string;
  fPopup: string;
  fPopupSub: string;
  fPopupUntil: string;
  /** aria-label for the popup-end date control (shared `AdminDatePicker`). */
  fPopupUntilDate: string;
  fPopupUntilDatePh: string;
  /** aria-label for the popup-end time control (shared `AdminTimePicker`). */
  fPopupUntilTime: string;
  // Shared date-picker chrome labels (month nav + "today" shortcut).
  datePickerPrevMonth: string;
  datePickerNextMonth: string;
  datePickerToday: string;
  fPublishNote: string;
  fDraftNote: string;
  fCancel: string;
  fSaveDraft: string;
  fSave: string;
  fPublish: string;
  vTitleRequired: string;
  vBodyRequired: string;
  vRolesRequired: string;
  // Read-status modal
  rKicker: string;
  rSegAll: string;
  rSegRead: string;
  rSegUnread: string;
  rStatRead: string;
  rStatUnread: string;
  rStatTotal: string;
  rRowRead: string;
  rRowUnread: string;
  rEmpty: string;
  rFootNote: string;
  rConfirm: string;
  rLoading: string;
  // Confirm modal
  cFootNote: string;
  cPublishKicker: string;
  cPublishT: string;
  cPublishS: string;
  cPublishBtn: string;
  cRepublishKicker: string;
  cRepublishT: string;
  cRepublishS: string;
  cRepublishBtn: string;
  cArchiveKicker: string;
  cArchiveT: string;
  cArchiveS: string;
  cArchiveBtn: string;
  cRevertKicker: string;
  cRevertT: string;
  cRevertS: string;
  cRevertBtn: string;
  cDelKicker: string;
  cDelT: string;
  cDelS: string;
  cDelBtn: string;
  // Image viewer
  imgViewTitle: string;
  // Toasts
  tSaved: string;
  tPublished: string;
  tRepublished: string;
  tArchived: string;
  tReverted: string;
  tDeleted: string;
  tSynced: string;
  errProcess: string;
  // Load error state
  errT: string;
  errS: string;
  retry: string;
};

// 화이트 리디자인 공지 콘솔(2026-10-15) 문구. `{n}` `{p}` `{r}` `{t}` `{d}` `{date}` 는 String.replace 로 채운다.
export type AnnouncementWhiteCopy = {
  sumPinned: string;
  sumPopup: string;
  sumImpUnread: string;
  sumImpClear: string;
  colTitle: string;
  colTarget: string;
  colAuthor: string;
  colPublished: string;
  colUpdated: string;
  colRead: string;
  unreadPeople: string;
  allRead: string;
  readOf: string;
  notPublished: string;
  pinned: string;
  important: string;
  popupUntil: string;
  popupOn: string;
  popupEnded: string;
  everyone: string;
  emptyPub: string;
  emptyDraft: string;
  emptyArc: string;
  emptyPubHint: string;
  loadError: string;
  stPublished: string;
  stDraft: string;
  stArchived: string;
  readTitle: string;
  tabUnread: string;
  tabRead: string;
  readLoading: string;
  readListError: string;
  noneUnread: string;
  noneRead: string;
  notSentNote: string;
  popupNote: string;
  org: string;
  edit: string;
  archive: string;
  publish: string;
  revert: string;
  republish: string;
  delete: string;
  close: string;
  mobileView: string;
  noPermission: string;
  photoOpen: string;
  keep: string;
  cDelT: string;
  cDelS: string;
  cDelBtn: string;
  cArcT: string;
  cArcS: string;
  cRevT: string;
  cRevS: string;
  cPubT: string;
  cPubS: string;
  cRepT: string;
  back: string;
  newTitle: string;
  editTitle: string;
  fTitle: string;
  fBody: string;
  fTitlePh: string;
  fBodyPh: string;
  photoAdd: string;
  photoRemove: string;
  photoCount: string;
  settings: string;
  target: string;
  scopeEveryone: string;
  scopeRoles: string;
  recipients: string;
  fImportant: string;
  fImportantSub: string;
  fPinned: string;
  fPinnedSub: string;
  fPopup: string;
  fPopupSub: string;
  fPopupEnd: string;
  fPopupEndPh: string;
  publishHint: string;
  saveDraft: string;
  save: string;
  cancel: string;
  saving: string;
  uploading: string;
  leaveT: string;
  leaveS: string;
  leaveBtn: string;
};

type AnnouncementDictionary = {
  console: AnnouncementConsoleDictionary;
  white: AnnouncementWhiteCopy;
  allowComments: string;
  archive: string;
  archivedAt: string;
  author: string;
  authorCredit: string;
  backToDraft: string;
  backToAnnouncements: string;
  close: string;
  commentBlocked: string;
  commentDeleted: string;
  commentPlaceholder: string;
  commentSaved: string;
  commentSubmit: string;
  commentUpdated: string;
  comments: string;
  commentsEmpty: string;
  content: string;
  confirmCommentDeleteTitle: string;
  create: string;
  createTitle: string;
  confirmDeleteBody: string;
  confirmDeleteTitle: string;
  cancel: string;
  confirm: string;
  delete: string;
  description: string;
  edit: string;
  edited: string;
  empty: string;
  hideForWeek: string;
  important: string;
  imageAdd: string;
  imageAttachments: string;
  imageLimit: string;
  imageRemove: string;
  latest: string;
  memberName: string;
  mobileDescription: string;
  mobileEmpty: string;
  noMembers: string;
  organization: string;
  pinned: string;
  publishedForYou: string;
  popupPreview: string;
  publish: string;
  publishedAt: string;
  readAnnouncement: string;
  readAt: string;
  readCount: string;
  readers: string;
  readSummary: string;
  markAsRead: string;
  markedAsRead: string;
  notReadYet: string;
  openList: string;
  roleTargets: string;
  roleLabel: string;
  showPopup: string;
  status: string;
  save: string;
  tapToZoom: string;
  target: string;
  title: string;
  titleField: string;
  unreadCount: string;
  viewDetail: string;
  unreadMembers: string;
  success: {
    created: string;
    deleted: string;
    statusUpdated: string;
  };
  errors: Record<string, string>;
  statuses: Record<AnnouncementStatus, string>;
  targetScopes: Record<AnnouncementTargetScope, string>;
  targetRoles: Record<OrganizationRole, string>;
  maintenance: {
    button: string;
    deleted: string;
    description: string;
    errors: string;
    failed: string;
    listingFailures: string;
    running: string;
    skippedGrace: string;
    skippedReferenced: string;
    title: string;
  };
};

const dictionaries: Record<Locale, AnnouncementDictionary> = {
  ko: {
    allowComments: "\uB313\uAE00 \uD5C8\uC6A9",
    archive: "\uBCF4\uAD00",
    archivedAt: "\uBCF4\uAD00\uC77C",
    author: "\uC791\uC131\uC790",
    authorCredit: "\uC791\uC131",
    backToDraft: "\uC784\uC2DC\uC800\uC7A5",
    backToAnnouncements: "\uACF5\uC9C0 \uBAA9\uB85D\uC73C\uB85C",
    close: "\uB2EB\uAE30",
    commentBlocked:
      "\uC774 \uACF5\uC9C0\uC5D0\uB294 \uB313\uAE00\uC744 \uC791\uC131\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
    commentDeleted: "\uB313\uAE00\uC774 \uC0AD\uC81C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
    commentPlaceholder:
      "\uACF5\uC9C0\uC5D0 \uB300\uD55C \uD655\uC778 \uC0AC\uD56D\uC774\uB098 \uACF5\uC720\uD560 \uB0B4\uC6A9\uC744 \uC785\uB825\uD558\uC138\uC694.",
    commentSaved: "\uB313\uAE00\uC774 \uB4F1\uB85D\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
    commentSubmit: "\uB313\uAE00 \uB4F1\uB85D",
    commentUpdated: "\uB313\uAE00\uC774 \uC218\uC815\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
    comments: "\uB313\uAE00",
    commentsEmpty: "\uC544\uC9C1 \uB4F1\uB85D\uB41C \uB313\uAE00\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
    cancel: "\uCDE8\uC18C",
    confirm: "\uD655\uC778",
    confirmCommentDeleteTitle:
      "\uC815\uB9D0 \uC774 \uB313\uAE00\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694?",
    confirmDeleteBody:
      "\uC815\uB9D0 \uC774 \uACF5\uC9C0\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694? \uC0AD\uC81C\uD558\uBA74 \uBC14\uB85C \uBAA9\uB85D\uC5D0\uC11C \uC0AC\uB77C\uC9D1\uB2C8\uB2E4.",
    confirmDeleteTitle:
      "\uC815\uB9D0 \uC774 \uACF5\uC9C0\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?",
    content: "\uB0B4\uC6A9",
    create: "\uC0DD\uC131",
    createTitle: "\uACF5\uC9C0 \uC0DD\uC131",
    delete: "\uC0AD\uC81C",
    description:
      "\uC870\uC9C1 \uACF5\uC9C0\uB97C \uC791\uC131\uD558\uACE0 \uAC8C\uC2DC \uC0C1\uD0DC\uB97C \uAD00\uB9AC\uD569\uB2C8\uB2E4.",
    edit: "\uC218\uC815",
    edited: "\uC218\uC815\uB428",
    empty: "\uC544\uC9C1 \uC0DD\uC131\uB41C \uACF5\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.",
    hideForWeek: "7\uC77C \uB3D9\uC548 \uB2E4\uC2DC \uBCF4\uC9C0 \uC54A\uAE30",
    important: "\uC911\uC694",
    imageAdd: "\uC774\uBBF8\uC9C0 \uCD94\uAC00",
    imageAttachments: "\uC774\uBBF8\uC9C0 \uCCA8\uBD80",
    imageLimit: "\uCD5C\uB300 5\uC7A5, \uAC01 8MB \uC774\uD558",
    imageRemove: "\uC774\uBBF8\uC9C0 \uC81C\uAC70",
    latest: "\uCD5C\uC2E0 \uACF5\uC9C0",
    memberName: "\uC0AC\uC6A9\uC790",
    mobileDescription:
      "\uB0B4\uAC8C \uACF5\uAC1C\uB41C \uACF5\uC9C0\uB9CC \uBAA8\uC544 \uBCF4\uACE0 \uD544\uC694\uD55C \uB0B4\uC6A9\uC744 \uD655\uC778\uD569\uB2C8\uB2E4.",
    mobileEmpty:
      "\uC544\uC9C1 \uD655\uC778\uD560 \uACF5\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.",
    noMembers: "\uD45C\uC2DC\uD560 \uC0AC\uC6A9\uC790\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.",
    organization: "\uC870\uC9C1",
    pinned: "\uACE0\uC815",
    publishedForYou: "\uB0B4\uAC8C \uACF5\uAC1C\uB41C \uACF5\uC9C0",
    popupPreview: "\uD31D\uC5C5 \uACF5\uC9C0",
    publish: "\uAC8C\uC2DC",
    publishedAt: "\uAC8C\uC2DC\uC77C",
    readAnnouncement: "\uACF5\uC9C0 \uC0C1\uC138",
    readAt: "\uD655\uC778\uC77C",
    readCount: "\uC77D\uC74C",
    readers: "\uC77D\uC740 \uC0AC\uC6A9\uC790",
    readSummary: "\uC77D\uC74C \uD604\uD669",
    markAsRead: "\uC77D\uC74C\uC73C\uB85C \uD655\uC778",
    markedAsRead: "\uC774 \uACF5\uC9C0\uB97C \uD655\uC778\uD588\uC2B5\uB2C8\uB2E4.",
    notReadYet: "\uC544\uC9C1 \uD655\uC778\uD558\uC9C0 \uC54A\uC74C",
    openList: "\uBA85\uB2E8 \uBCF4\uAE30",
    roleTargets: "\uB300\uC0C1 \uC5ED\uD560",
    roleLabel: "\uC5ED\uD560",
    showPopup: "\uC571 \uC2E4\uD589 \uC2DC \uD31D\uC5C5",
    status: "\uC0C1\uD0DC",
    save: "\uC800\uC7A5",
    target: "\uB300\uC0C1",
    title: "\uACF5\uC9C0",
    titleField: "\uC81C\uBAA9",
    unreadCount: "\uBBF8\uD655\uC778",
    unreadMembers: "\uBBF8\uD655\uC778 \uC0AC\uC6A9\uC790",
    tapToZoom: "\uD0ED\uD558\uC5EC \uD06C\uAC8C \uBCF4\uAE30",
    viewDetail: "\uC790\uC138\uD788 \uBCF4\uAE30",
    success: {
      created: "\uACF5\uC9C0\uAC00 \uC0DD\uC131\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
      deleted: "\uACF5\uC9C0\uAC00 \uC0AD\uC81C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
      statusUpdated:
        "\uACF5\uC9C0 \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
    },
    errors: {
      forbidden: "\uACF5\uC9C0 \uAD00\uB9AC \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
      comment_failed: "\uB313\uAE00\uC744 \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
      comment_forbidden:
        "\uC774 \uACF5\uC9C0\uC5D0 \uB313\uAE00\uC744 \uB0A8\uAE30\uB294 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
      comment_invalid:
        "\uB313\uAE00 \uB0B4\uC6A9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.",
      comment_delete_failed:
        "\uB313\uAE00\uC744 \uC0AD\uC81C\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
      comment_not_found:
        "\uB313\uAE00\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
      comment_update_failed:
        "\uB313\uAE00\uC744 \uC218\uC815\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
      comments_disabled:
        "\uC774 \uACF5\uC9C0\uC5D0\uB294 \uB313\uAE00\uC774 \uBE44\uD65C\uC131\uD654\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.",
      image_count_exceeded:
        "\uC774\uBBF8\uC9C0\uB294 \uCD5C\uB300 5\uC7A5\uAE4C\uC9C0 \uCCA8\uBD80\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
      image_size_exceeded:
        "\uC774\uBBF8\uC9C0 1\uC7A5\uC740 8MB \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4.",
      image_type_invalid:
        "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uC774\uBBF8\uC9C0 \uD615\uC2DD\uC785\uB2C8\uB2E4. JPEG, PNG, WebP, GIF\uB9CC \uD5C8\uC6A9\uB429\uB2C8\uB2E4.",
      invalid_images:
        "\uC774\uBBF8\uC9C0\uB294 5\uC7A5\uAE4C\uC9C0, \uAC01 8MB \uC774\uD558\uB85C \uCCA8\uBD80\uD574 \uC8FC\uC138\uC694.",
      invalid_announcement:
        "\uACF5\uC9C0 \uB0B4\uC6A9\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.",
      invalid_organization:
        "\uC870\uC9C1\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.",
      save_failed: "\uACF5\uC9C0\uB97C \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
    },
    statuses: {
      archived: "\uBCF4\uAD00\uB428",
      draft: "\uC784\uC2DC\uC800\uC7A5",
      published: "\uAC8C\uC2DC\uB428",
    },
    targetScopes: {
      everyone: "\uC804\uCCB4",
      roles: "\uC5ED\uD560\uBCC4",
    },
    targetRoles: {
      cs_staff: "CS \uB2F4\uB2F9\uC790",
      field_manager: "\uD604\uC7A5 \uB9E4\uB2C8\uC800",
      office_admin: "\uC624\uD53C\uC2A4 \uAD00\uB9AC\uC790",
      owner: "\uC624\uB108",
      part_time_staff: "\uD30C\uD2B8\uD0C0\uC784 \uC9C1\uC6D0",
      senior_managing_director: "\uC804\uBB34",
      staff: "\uC9C1\uC6D0",
    },
    maintenance: {
      title: "\uC2A4\uD1A0\uB9AC\uC9C0 \uC815\uB9AC",
      description:
        "\uC5C5\uB85C\uB4DC \uD6C4 \uC800\uC7A5\uB418\uC9C0 \uC54A\uC740 \uC774\uBBF8\uC9C0(\uACE0\uC544 \uD30C\uC77C)\uB97C \uC815\uB9AC\uD569\uB2C8\uB2E4. 60\uBD84 \uC720\uC608 \uAE30\uAC04 \uB0B4 \uD30C\uC77C\uACFC DB\uC5D0 \uCC38\uC870\uB41C \uD30C\uC77C\uC740 \uC0AD\uC81C\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
      button: "\uACE0\uC544 \uC774\uBBF8\uC9C0 \uC815\uB9AC",
      running: "\uC815\uB9AC \uC911\u2026",
      failed:
        "\uC815\uB9AC\uAC00 \uC644\uB8CC\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uB85C\uADF8\uB97C \uD655\uC778\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694.",
      deleted: "\uC0AD\uC81C\uB428",
      skippedGrace: "\uC720\uC608 \uAE30\uAC04 \uB0B4 \uAC74\uB108\uB32C",
      skippedReferenced: "DB \uCC38\uC870 \uAC74\uB108\uB32C",
      errors: "\uC624\uB958",
      listingFailures: "\uBAA9\uB85D \uC870\uD68C \uC2E4\uD328",
    },
    console: {
      kpiPublished: "\uAC8C\uC2DC\uC911 \uACF5\uC9C0",
      kpiPublishedSub: "\uC9C1\uC6D0\uC5D0\uAC8C \uB178\uCD9C \uC911",
      kpiDrafts: "\uCD08\uC548",
      kpiDraftsSub: "\uBBF8\uAC8C\uC2DC \uC791\uC131 \uC911",
      kpiImportant: "\uC911\uC694 \uACF5\uC9C0",
      kpiImportantSub: "\uAC8C\uC2DC\uC911 \u00B7 \uC911\uC694 \uD45C\uC2DC",
      kpiPopup: "\uD31D\uC5C5 \uD65C\uC131",
      kpiPopupSub: "\uC571 \uC624\uD508 \uC2DC \uB178\uCD9C",
      kpiImpUnread: "\uC911\uC694 \u00B7 \uBBF8\uC77D\uC74C",
      kpiImpUnreadRemain: "\uBBF8\uC77D\uC74C \uB300\uC0C1\uC790 \uB0A8\uC74C",
      kpiImpUnreadClear: "\uC804\uC6D0 \uD655\uC778",
      tabPublished: "\uAC8C\uC2DC\uC911",
      tabDrafts: "\uCD08\uC548",
      tabArchived: "\uBCF4\uAD00",
      permLegend: "\uAC8C\uC2DC\u00B7\uBCF4\uAD00\u00B7\uC0AD\uC81C \uAC00\uB2A5",
      newBtn: "\uC0C8 \uACF5\uC9C0",
      channelNote: "\uACF5\uC2DD \uC804\uB2EC \uCC44\uB110 \u00B7 \uC571 \uC54C\uB9BC \uBC1C\uC1A1",
      countUnit: "\uAC74",
      searchResult: "\uAC80\uC0C9\uACB0\uACFC (\uC804\uCCB4 {n}\uAC74)",
      colStatus: "\uC0C1\uD0DC",
      colAnnouncement: "\uACF5\uC9C0",
      colTarget: "\uB300\uC0C1",
      colAuthor: "\uC791\uC131\uC790",
      colPublishedAt: "\uAC8C\uC2DC\uC77C",
      colUpdatedAt: "\uCD5C\uC885 \uC218\uC815",
      colRead: "\uC77D\uC74C \uC694\uC57D",
      dateKindPublished: "\uAC8C\uC2DC",
      dateKindUpdated: "\uC218\uC815",
      readUnsent: "\uBBF8\uAC8C\uC2DC",
      unreadN: "\uBBF8\uC77D\uC74C {n}",
      stDraft: "\uCD08\uC548",
      stPublished: "\uAC8C\uC2DC\uC911",
      stArchived: "\uBCF4\uAD00",
      flImportant: "\uC911\uC694",
      flPinned: "\uACE0\uC815",
      flPopup: "\uD31D\uC5C5",
      flPopupOff: "\uD31D\uC5C5 \uC885\uB8CC",
      flImage: "\uC774\uBBF8\uC9C0 {n}\uC7A5",
      everyone: "\uC804 \uC9C1\uC6D0",
      targetMore: "\uC678 {n}",
      emptyPubT: "\uAC8C\uC2DC\uC911 \uACF5\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4",
      emptyPubS: "\uC0C8 \uACF5\uC9C0\uB97C \uC791\uC131\uD574 \uC9C1\uC6D0\uC5D0\uAC8C \uBC30\uD3EC\uD558\uC138\uC694.",
      emptyDraftT: "\uC791\uC131 \uC911\uC778 \uCD08\uC548\uC774 \uC5C6\uC2B5\uB2C8\uB2E4",
      emptyDraftS: "\uCD08\uC548\uC744 \uC800\uC7A5\uD558\uBA74 \uC5EC\uAE30\uC5D0\uC11C \uC774\uC5B4\uC11C \uD3B8\uC9D1\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
      emptyArcT: "\uBCF4\uAD00\uB41C \uACF5\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4",
      emptyArcS: "\uAC8C\uC2DC \uC885\uB8CC\uB41C \uACF5\uC9C0\uAC00 \uC774\uACF3\uC5D0 \uBCF4\uAD00\uB429\uB2C8\uB2E4.",
      emptySearchS: "\uAC80\uC0C9\uC5B4\uC640 \uC77C\uCE58\uD558\uB294 \uACF5\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.",
      pInfo: "\uACF5\uC9C0 \uC815\uBCF4",
      pOrg: "\uC870\uC9C1",
      pAuthor: "\uC791\uC131\uC790",
      pTarget: "\uB300\uC0C1",
      pCountSuffix: "{n}\uBA85",
      pPublishedAt: "\uAC8C\uC2DC\uC77C",
      pArchivedAt: "\uBCF4\uAD00\uC77C",
      pPopupUntil: "\uD31D\uC5C5 \uC885\uB8CC",
      pBody: "\uBCF8\uBB38",
      pImages: "\uCCA8\uBD80 \uC774\uBBF8\uC9C0",
      pReadTitle: "\uC77D\uC74C \uC694\uC57D",
      pRead: "\uC77D\uC74C",
      pUnread: "\uBBF8\uC77D\uC74C",
      pTotal: "\uB300\uC0C1\uC790",
      pOpenReaders: "\uC77D\uC74C \uD604\uD669 \uC5F4\uAE30",
      pOpenReadersSub: "\uC77D\uC740 / \uC548 \uC77D\uC740 \uB300\uC0C1\uC790 \uBA85\uB2E8 \uD655\uC778",
      pnoteTitle: "\uC77D\uC74C\uACFC \uD31D\uC5C5 \uB2EB\uC74C\uC740 \uBCC4\uAC1C\uC785\uB2C8\uB2E4",
      pnoteBody: "\uC571 \uC624\uD508 \uD31D\uC5C5\uC744 {d}\uBA85\uC774 \uB2EB\uC558\uC9C0\uB9CC, \uC774\uB294 \uBCF8\uBB38 \uC77D\uC74C({r}\uBA85)\uACFC \uB2E4\uB974\uAC8C \uC9D1\uACC4\uB429\uB2C8\uB2E4.",
      notSentTitle: "\uC544\uC9C1 \uAC8C\uC2DC\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4",
      notSentSub: "\uAC8C\uC2DC \uD6C4 \uB300\uC0C1\uC790 {n}\uBA85\uC758 \uC77D\uC74C \uB370\uC774\uD130\uAC00 \uC9D1\uACC4\uB429\uB2C8\uB2E4.",
      zAuthorTitle: "\uC791\uC131",
      zAuthorTag: "\uC791\uC131 \uAD8C\uD55C",
      zAuthorDesc: "\uC81C\uBAA9\u00B7\uBCF8\uBB38\u00B7\uC774\uBBF8\uC9C0\u00B7\uB300\uC0C1 \uB4F1 \uB0B4\uC6A9 \uD3B8\uC9D1. \uBAA8\uBC14\uC77C \uC791\uC131 \uAD8C\uD55C\uACFC \uB3D9\uC77C\uD569\uB2C8\uB2E4.",
      zEditContent: "\uB0B4\uC6A9 \uD3B8\uC9D1",
      zEditDraft: "\uCD08\uC548 \uD3B8\uC9D1",
      zAuthorLocked: "\uC791\uC131 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4",
      zOpTitle: "\uC6B4\uC601 \uAD00\uB9AC",
      zOpTag: "\uC6B4\uC601 \uAD8C\uD55C \u00B7 \uAD00\uB9AC\uC790",
      zOpDesc: "\uAC8C\uC2DC \u00B7 \uBCF4\uAD00 \u00B7 \uC0AD\uC81C\uB294 \uC6B4\uC601 \uAD00\uB9AC\uC790 \uAD8C\uD55C\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.",
      zPublish: "\uAC8C\uC2DC",
      zRepublish: "\uC7AC\uAC8C\uC2DC",
      zRevert: "\uCD08\uC548 \uBCF5\uADC0",
      zArchive: "\uBCF4\uAD00",
      zDelete: "\uC0AD\uC81C",
      zOpLocked: "\uC6B4\uC601 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4",
      mobileDetail: "\uBAA8\uBC14\uC77C \uC0C1\uC138",
      close: "\uB2EB\uAE30",
      fNewKicker: "\uC0C8 \uACF5\uC9C0",
      fEditKicker: "\uACF5\uC9C0 \uD3B8\uC9D1",
      fNewTitle: "\uACF5\uC9C0 \uC791\uC131",
      fOrg: "\uC870\uC9C1",
      fTitle: "\uC81C\uBAA9",
      fTitlePh: "\uACF5\uC9C0 \uC81C\uBAA9\uC744 \uC785\uB825\uD558\uC138\uC694",
      fBody: "\uBCF8\uBB38",
      fBodyPh: "\uACF5\uC9C0 \uBCF8\uBB38\uC744 \uC785\uB825\uD558\uC138\uC694",
      fImages: "\uC774\uBBF8\uC9C0 \uCCA8\uBD80",
      fImagesMax: "\u00B7 \uCD5C\uB300 5\uC7A5",
      fImageCount: "{n} / 5 \uCCA8\uBD80\uB428",
      fImgAdd: "\uCD94\uAC00",
      fImgTooMany: "\uC774\uBBF8\uC9C0\uB294 \uCD5C\uB300 5\uC7A5\uAE4C\uC9C0 \uCCA8\uBD80\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
      fImgTooLarge: "\uC774\uBBF8\uC9C0 1\uC7A5\uC740 8MB \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4.",
      fImgBadType: "JPEG, PNG, WebP, GIF\uB9CC \uCCA8\uBD80\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
      fScope: "\uB300\uC0C1 \uBC94\uC704",
      fScopeEveryone: "\uC804 \uC9C1\uC6D0",
      fScopeEveryoneSub: "\uBAA8\uB4E0 \uB300\uC0C1\uC790",
      fScopeRoles: "\uC5ED\uD560 \uC9C0\uC815",
      fScopeRolesSub: "\uC120\uD0DD\uD55C \uC5ED\uD560",
      fRoles: "\uB300\uC0C1 \uC5ED\uD560",
      fStatus: "\uC0C1\uD0DC",
      fStDraft: "\uCD08\uC548 \uC800\uC7A5",
      fStDraftSub: "\uAC8C\uC2DC \uC548 \uD568",
      fStPublish: "\uBC14\uB85C \uAC8C\uC2DC",
      fStPublishSub: "\uB300\uC0C1\uC790\uC5D0\uAC8C \uBC1C\uC1A1",
      fOptions: "\uD45C\uC2DC \uC635\uC158",
      fImportant: "\uC911\uC694",
      fImportantSub: "\uC911\uC694 \uACF5\uC9C0\uB85C \uAC15\uC870 \uD45C\uC2DC",
      fPinned: "\uACE0\uC815",
      fPinnedSub: "\uBAA9\uB85D \uC0C1\uB2E8\uC5D0 \uACE0\uC815",
      fPopup: "\uC571 \uC624\uD508 \uD31D\uC5C5",
      fPopupSub: "\uC571 \uC2E4\uD589 \uC2DC \uD31D\uC5C5\uC73C\uB85C \uB178\uCD9C",
      fPopupUntil: "\uD31D\uC5C5 \uC885\uB8CC \uC2DC\uAC01",
      fPopupUntilDate: "\uD31D\uC5C5 \uC885\uB8CC\uC77C",
      fPopupUntilDatePh: "\uB0A0\uC9DC \uC120\uD0DD",
      fPopupUntilTime: "\uD31D\uC5C5 \uC885\uB8CC \uC2DC\uAC01",
      datePickerPrevMonth: "\uC774\uC804 \uB2EC",
      datePickerNextMonth: "\uB2E4\uC74C \uB2EC",
      datePickerToday: "\uC624\uB298",
      fPublishNote: "\uAC8C\uC2DC\uD558\uBA74 \uB300\uC0C1\uC790\uC5D0\uAC8C \uC571 \uC54C\uB9BC\uC774 \uBC1C\uC1A1\uB429\uB2C8\uB2E4.",
      fDraftNote: "\uCD08\uC548\uC740 \uB098\uC5D0\uAC8C\uB9CC \uBCF4\uC785\uB2C8\uB2E4.",
      fCancel: "\uCDE8\uC18C",
      fSaveDraft: "\uCD08\uC548 \uC800\uC7A5",
      fSave: "\uC800\uC7A5",
      fPublish: "\uAC8C\uC2DC",
      vTitleRequired: "\uC81C\uBAA9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.",
      vBodyRequired: "\uBCF8\uBB38\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.",
      vRolesRequired: "\uB300\uC0C1 \uC5ED\uD560\uC744 \uD558\uB098 \uC774\uC0C1 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.",
      rKicker: "\uC77D\uC74C \uD604\uD669",
      rSegAll: "\uC804\uCCB4",
      rSegRead: "\uC77D\uC74C",
      rSegUnread: "\uBBF8\uC77D\uC74C",
      rStatRead: "\uC77D\uC74C",
      rStatUnread: "\uBBF8\uC77D\uC74C",
      rStatTotal: "\uB300\uC0C1\uC790",
      rRowRead: "\uC77D\uC74C",
      rRowUnread: "\uC548 \uC77D\uC74C",
      rEmpty: "\uD574\uB2F9 \uB300\uC0C1\uC790\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4",
      rFootNote: "\uB300\uC0C1\uC790 \uBA85\uB2E8 \u00B7 \uAC10\uC0AC\uC6A9",
      rConfirm: "\uD655\uC778",
      rLoading: "\uBD88\uB7EC\uC624\uB294 \uC911\u2026",
      cFootNote: "\uC6B4\uC601 \uAD00\uB9AC\uC790 \uAD8C\uD55C",
      cPublishKicker: "\uACF5\uC9C0 \uAC8C\uC2DC",
      cPublishT: "\uC774 \uACF5\uC9C0\uB97C \uAC8C\uC2DC\uD560\uAE4C\uC694?",
      cPublishS: "\uB300\uC0C1\uC790 {n}\uBA85\uC5D0\uAC8C \uC571 \uC54C\uB9BC\uC774 \uBC1C\uC1A1\uB429\uB2C8\uB2E4.",
      cPublishBtn: "\uAC8C\uC2DC",
      cRepublishKicker: "\uACF5\uC9C0 \uC7AC\uAC8C\uC2DC",
      cRepublishT: "\uBCF4\uAD00\uB41C \uACF5\uC9C0\uB97C \uC7AC\uAC8C\uC2DC\uD560\uAE4C\uC694?",
      cRepublishS: "\uB2E4\uC2DC \uB300\uC0C1\uC790 {n}\uBA85\uC5D0\uAC8C \uB178\uCD9C\uB429\uB2C8\uB2E4.",
      cRepublishBtn: "\uC7AC\uAC8C\uC2DC",
      cArchiveKicker: "\uACF5\uC9C0 \uBCF4\uAD00",
      cArchiveT: "\uC774 \uACF5\uC9C0\uB97C \uBCF4\uAD00\uD560\uAE4C\uC694?",
      cArchiveS: "\uC9C1\uC6D0 \uB178\uCD9C\uC774 \uC885\uB8CC\uB418\uACE0 \uBCF4\uAD00\uD568\uC73C\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4. \uC77D\uC74C \uAE30\uB85D\uC740 \uBCF4\uC874\uB429\uB2C8\uB2E4.",
      cArchiveBtn: "\uBCF4\uAD00",
      cRevertKicker: "\uCD08\uC548 \uBCF5\uADC0",
      cRevertT: "\uCD08\uC548\uC73C\uB85C \uB418\uB3CC\uB9B4\uAE4C\uC694?",
      cRevertS: "\uC9C1\uC6D0 \uB178\uCD9C\uC774 \uC911\uB2E8\uB418\uACE0 \uCD08\uC548 \uC0C1\uD0DC\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4.",
      cRevertBtn: "\uCD08\uC548 \uBCF5\uADC0",
      cDelKicker: "\uACF5\uC9C0 \uC0AD\uC81C",
      cDelT: "\uC774 \uACF5\uC9C0\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?",
      cDelS: "\uC0AD\uC81C\uD558\uBA74 \uB418\uB3CC\uB9B4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC77D\uC74C \uAE30\uB85D\uB3C4 \uD568\uAED8 \uC0AD\uC81C\uB429\uB2C8\uB2E4.",
      cDelBtn: "\uC0AD\uC81C",
      imgViewTitle: "\uCCA8\uBD80 \uC774\uBBF8\uC9C0",
      tSaved: "\uACF5\uC9C0\uAC00 \uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
      tPublished: "\uACF5\uC9C0\uB97C \uAC8C\uC2DC\uD588\uC2B5\uB2C8\uB2E4.",
      tRepublished: "\uACF5\uC9C0\uB97C \uC7AC\uAC8C\uC2DC\uD588\uC2B5\uB2C8\uB2E4.",
      tArchived: "\uACF5\uC9C0\uB97C \uBCF4\uAD00\uD588\uC2B5\uB2C8\uB2E4.",
      tReverted: "\uCD08\uC548\uC73C\uB85C \uB418\uB3CC\uB838\uC2B5\uB2C8\uB2E4.",
      tDeleted: "\uACF5\uC9C0\uB97C \uC0AD\uC81C\uD588\uC2B5\uB2C8\uB2E4.",
      tSynced: "\uCD5C\uC2E0 \uC0C1\uD0DC\uC785\uB2C8\uB2E4.",
      errProcess: "\uCC98\uB9AC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.",
      errT: "\uACF5\uC9C0\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4",
      errS: "\uB124\uD2B8\uC6CC\uD06C \uC0C1\uD0DC\uB97C \uD655\uC778\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.",
      retry: "\uB2E4\uC2DC \uC2DC\uB3C4",
    },
    // 화이트 리디자인(2026-10-15) — PC 공지 콘솔 · 작성 화면.
    white: {
      sumPinned: "고정 {n}",
      sumPopup: "팝업 켜짐 {n}",
      sumImpUnread: "중요 공지 {n}건에 아직 안 읽은 사람 {p}명",
      sumImpClear: "중요 공지는 모두 읽었어요",
      colTitle: "제목",
      colTarget: "대상",
      colAuthor: "작성자",
      colPublished: "게시일",
      colUpdated: "수정일",
      colRead: "읽음",
      unreadPeople: "{n}명 안 읽음",
      allRead: "모두 읽음",
      readOf: "{r} / {t}명",
      notPublished: "게시 전",
      pinned: "고정",
      important: "중요",
      popupUntil: "팝업 {date}까지",
      popupOn: "팝업",
      popupEnded: "팝업 끝남",
      everyone: "전체",
      emptyPub: "게시 중인 공지가 없어요",
      emptyDraft: "초안이 없어요",
      emptyArc: "보관한 공지가 없어요",
      emptyPubHint: "새 공지를 쓰면 받는 사람 앱에 바로 보여요",
      loadError: "공지를 불러오지 못했어요",
      stPublished: "게시 중",
      stDraft: "초안",
      stArchived: "보관됨",
      readTitle: "읽음",
      tabUnread: "안 읽음",
      tabRead: "읽음",
      readLoading: "명단을 불러오는 중…",
      readListError: "명단을 불러오지 못했어요",
      noneUnread: "모두 읽었어요",
      noneRead: "아직 읽은 사람이 없어요",
      notSentNote: "게시하면 받는 사람 {n}명의 읽음이 여기 보여요",
      popupNote: "팝업을 닫은 사람 {d}명 · 닫은 것은 읽음으로 세지 않아요",
      org: "조직",
      edit: "수정",
      archive: "보관하기",
      publish: "게시하기",
      revert: "초안으로",
      republish: "다시 게시",
      delete: "공지 삭제",
      close: "상세 닫기",
      mobileView: "모바일 화면으로 보기",
      noPermission: "이 공지는 작성자와 운영 관리자만 바꿀 수 있어요",
      photoOpen: "사진 {n} 크게 보기",
      keep: "그대로 두기",
      cDelT: "이 공지를 삭제할까요?",
      cDelS: "삭제하면 되돌릴 수 없어요. 읽음 기록도 함께 지워져요.",
      cDelBtn: "삭제",
      cArcT: "이 공지를 보관할까요?",
      cArcS: "직원 앱에서 내려가고 보관 탭으로 옮겨져요. 읽음 기록은 남아요.",
      cRevT: "초안으로 되돌릴까요?",
      cRevS: "직원 앱에서 내려가고 초안 탭으로 옮겨져요.",
      cPubT: "이 공지를 게시할까요?",
      cPubS: "받는 사람 {n}명의 앱에 바로 보여요.",
      cRepT: "보관한 공지를 다시 게시할까요?",
      back: "공지 목록",
      newTitle: "새 공지",
      editTitle: "공지 수정",
      fTitle: "제목",
      fBody: "본문",
      fTitlePh: "예) 11월 근무표 제출 안내",
      fBodyPh: "직원에게 전할 내용을 써 주세요",
      photoAdd: "사진 추가",
      photoRemove: "사진 빼기",
      photoCount: "{n} / 5",
      settings: "게시 설정",
      target: "대상",
      scopeEveryone: "전체",
      scopeRoles: "역할 선택",
      recipients: "받는 사람 {n}명",
      fImportant: "중요",
      fImportantSub: "목록에서 빨간 글자로 강조",
      fPinned: "맨 위 고정",
      fPinnedSub: "목록 맨 위에 계속 보여요",
      fPopup: "앱 열 때 팝업",
      fPopupSub: "받는 사람이 7일 동안 숨길 수 있어요",
      fPopupEnd: "팝업 끝나는 날",
      fPopupEndPh: "정하지 않음",
      publishHint: "게시하면 받는 사람 앱에 바로 보여요",
      saveDraft: "초안 저장",
      save: "저장",
      cancel: "취소",
      saving: "저장하는 중…",
      uploading: "사진 올리는 중…",
      leaveT: "작성 중인 내용을 버릴까요?",
      leaveS: "지금 나가면 저장하지 않은 내용이 사라져요.",
      leaveBtn: "버리고 나가기",
    },
  },
  ja: {
    allowComments: "\u30B3\u30E1\u30F3\u30C8\u3092\u8A31\u53EF",
    archive: "\u30A2\u30FC\u30AB\u30A4\u30D6",
    archivedAt: "\u30A2\u30FC\u30AB\u30A4\u30D6\u65E5",
    author: "\u4F5C\u6210\u8005",
    authorCredit: "\u4F5C\u6210\u8005",
    backToDraft: "\u4E0B\u66F8\u304D",
    backToAnnouncements: "\u304A\u77E5\u3089\u305B\u4E00\u89A7\u3078",
    close: "\u9589\u3058\u308B",
    commentBlocked:
      "\u3053\u306E\u304A\u77E5\u3089\u305B\u306B\u306F\u30B3\u30E1\u30F3\u30C8\u3067\u304D\u307E\u305B\u3093\u3002",
    commentDeleted:
      "\u30B3\u30E1\u30F3\u30C8\u3092\u524A\u9664\u3057\u307E\u3057\u305F\u3002",
    commentPlaceholder:
      "\u78BA\u8A8D\u4E8B\u9805\u3084\u5171\u6709\u3057\u305F\u3044\u5185\u5BB9\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    commentSaved: "\u30B3\u30E1\u30F3\u30C8\u3092\u767B\u9332\u3057\u307E\u3057\u305F\u3002",
    commentSubmit: "\u30B3\u30E1\u30F3\u30C8\u3092\u767B\u9332",
    commentUpdated:
      "\u30B3\u30E1\u30F3\u30C8\u3092\u66F4\u65B0\u3057\u307E\u3057\u305F\u3002",
    comments: "\u30B3\u30E1\u30F3\u30C8",
    commentsEmpty:
      "\u307E\u3060\u767B\u9332\u3055\u308C\u305F\u30B3\u30E1\u30F3\u30C8\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
    cancel: "\u30AD\u30E3\u30F3\u30BB\u30EB",
    confirm: "\u78BA\u8A8D",
    confirmCommentDeleteTitle:
      "\u3053\u306E\u30B3\u30E1\u30F3\u30C8\u3092\u672C\u5F53\u306B\u524A\u9664\u3057\u307E\u3059\u304B\u3002",
    confirmDeleteBody:
      "\u3053\u306E\u304A\u77E5\u3089\u305B\u3092\u672C\u5F53\u306B\u524A\u9664\u3057\u307E\u3059\u304B\u3002\u524A\u9664\u3059\u308B\u3068\u4E00\u89A7\u304B\u3089\u3059\u3050\u306B\u8868\u793A\u304C\u6D88\u3048\u307E\u3059\u3002",
    confirmDeleteTitle:
      "\u3053\u306E\u304A\u77E5\u3089\u305B\u3092\u672C\u5F53\u306B\u524A\u9664\u3057\u307E\u3059\u304B\u3002",
    content: "\u672C\u6587",
    create: "\u4F5C\u6210",
    createTitle: "\u304A\u77E5\u3089\u305B\u4F5C\u6210",
    delete: "\u524A\u9664",
    description:
      "\u7D44\u7E54\u306E\u304A\u77E5\u3089\u305B\u3092\u4F5C\u6210\u3057\u3001\u516C\u958B\u72B6\u614B\u3092\u7BA1\u7406\u3057\u307E\u3059\u3002",
    edit: "\u7DE8\u96C6",
    edited: "\u7DE8\u96C6\u6E08\u307F",
    empty:
      "\u4F5C\u6210\u3055\u308C\u305F\u304A\u77E5\u3089\u305B\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002",
    hideForWeek: "7\u65E5\u9593\u306F\u518D\u8868\u793A\u3057\u306A\u3044",
    important: "\u91CD\u8981",
    imageAdd: "\u753B\u50CF\u3092\u8FFD\u52A0",
    imageAttachments: "\u753B\u50CF\u6DFB\u4ED8",
    imageLimit: "\u6700\u59275\u679A\u3001\u54048MB\u4EE5\u4E0B",
    imageRemove: "\u753B\u50CF\u3092\u524A\u9664",
    latest: "\u6700\u65B0\u306E\u304A\u77E5\u3089\u305B",
    memberName: "\u30E6\u30FC\u30B6\u30FC",
    mobileDescription:
      "\u81EA\u5206\u306B\u516C\u958B\u3055\u308C\u305F\u304A\u77E5\u3089\u305B\u3060\u3051\u3092\u78BA\u8A8D\u3057\u3001\u5FC5\u8981\u306A\u5185\u5BB9\u3092\u3059\u3050\u306B\u898B\u3089\u308C\u307E\u3059\u3002",
    mobileEmpty:
      "\u78BA\u8A8D\u3067\u304D\u308B\u304A\u77E5\u3089\u305B\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002",
    noMembers:
      "\u8868\u793A\u3067\u304D\u308B\u30E6\u30FC\u30B6\u30FC\u306F\u307E\u3060\u3044\u307E\u305B\u3093\u3002",
    organization: "\u7D44\u7E54",
    pinned: "\u56FA\u5B9A",
    publishedForYou: "\u81EA\u5206\u5411\u3051\u306B\u516C\u958B\u4E2D",
    popupPreview: "\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7\u304A\u77E5\u3089\u305B",
    publish: "\u516C\u958B",
    publishedAt: "\u516C\u958B\u65E5",
    readAnnouncement: "\u304A\u77E5\u3089\u305B\u8A73\u7D30",
    readAt: "\u78BA\u8A8D\u65E5",
    readCount: "\u65E2\u8AAD",
    readers: "\u65E2\u8AAD\u30E6\u30FC\u30B6\u30FC",
    readSummary: "\u65E2\u8AAD\u72B6\u6CC1",
    markAsRead: "\u65E2\u8AAD\u306B\u3059\u308B",
    markedAsRead:
      "\u3053\u306E\u304A\u77E5\u3089\u305B\u3092\u78BA\u8A8D\u3057\u307E\u3057\u305F\u3002",
    notReadYet: "\u672A\u78BA\u8A8D",
    openList: "\u540D\u7C3F\u3092\u898B\u308B",
    roleTargets: "\u5BFE\u8C61\u30ED\u30FC\u30EB",
    roleLabel: "\u30ED\u30FC\u30EB",
    showPopup:
      "\u30A2\u30D7\u30EA\u8D77\u52D5\u6642\u306B\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7",
    status: "\u72B6\u614B",
    save: "\u4FDD\u5B58",
    target: "\u5BFE\u8C61",
    title: "\u304A\u77E5\u3089\u305B",
    titleField: "\u30BF\u30A4\u30C8\u30EB",
    unreadCount: "\u672A\u8AAD",
    unreadMembers: "\u672A\u8AAD\u30E6\u30FC\u30B6\u30FC",
    tapToZoom: "\u30BF\u30C3\u30D7\u3057\u3066\u62E1\u5927",
    viewDetail: "\u8A73\u3057\u304F\u898B\u308B",
    success: {
      created: "\u304A\u77E5\u3089\u305B\u3092\u4F5C\u6210\u3057\u307E\u3057\u305F\u3002",
      deleted: "\u304A\u77E5\u3089\u305B\u3092\u524A\u9664\u3057\u307E\u3057\u305F\u3002",
      statusUpdated:
        "\u304A\u77E5\u3089\u305B\u306E\u72B6\u614B\u3092\u5909\u66F4\u3057\u307E\u3057\u305F\u3002",
    },
    errors: {
      forbidden:
        "\u304A\u77E5\u3089\u305B\u3092\u7BA1\u7406\u3059\u308B\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093\u3002",
      comment_failed:
        "\u30B3\u30E1\u30F3\u30C8\u3092\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      comment_forbidden:
        "\u3053\u306E\u304A\u77E5\u3089\u305B\u306B\u30B3\u30E1\u30F3\u30C8\u3059\u308B\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093\u3002",
      comment_invalid:
        "\u30B3\u30E1\u30F3\u30C8\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      comment_delete_failed:
        "\u30B3\u30E1\u30F3\u30C8\u3092\u524A\u9664\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      comment_not_found:
        "\u30B3\u30E1\u30F3\u30C8\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002",
      comment_update_failed:
        "\u30B3\u30E1\u30F3\u30C8\u3092\u66F4\u65B0\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      comments_disabled:
        "\u3053\u306E\u304A\u77E5\u3089\u305B\u3067\u306F\u30B3\u30E1\u30F3\u30C8\u304C\u7121\u52B9\u3067\u3059\u3002",
      image_count_exceeded:
        "\u753B\u50CF\u306F\u6700\u59275\u679A\u307E\u3067\u6DFB\u4ED8\u3067\u304D\u307E\u3059\u3002",
      image_size_exceeded:
        "\u753B\u50CF1\u679A\u306F8MB\u4EE5\u4E0B\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\u3002",
      image_type_invalid:
        "\u30B5\u30DD\u30FC\u30C8\u3055\u308C\u3066\u3044\u306A\u3044\u753B\u50CF\u5F62\u5F0F\u3067\u3059\u3002JPEG\u3001PNG\u3001WebP\u3001GIF\u306E\u307F\u8A31\u53EF\u3055\u308C\u307E\u3059\u3002",
      invalid_images:
        "\u753B\u50CF\u306F5\u679A\u307E\u3067\u3001\u54041\u679A8MB\u4EE5\u4E0B\u3067\u6DFB\u4ED8\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      invalid_announcement:
        "\u304A\u77E5\u3089\u305B\u306E\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      invalid_organization:
        "\u7D44\u7E54\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      save_failed:
        "\u304A\u77E5\u3089\u305B\u3092\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
    },
    statuses: {
      archived: "\u30A2\u30FC\u30AB\u30A4\u30D6\u6E08\u307F",
      draft: "\u4E0B\u66F8\u304D",
      published: "\u516C\u958B\u4E2D",
    },
    targetScopes: {
      everyone: "\u5168\u54E1",
      roles: "\u30ED\u30FC\u30EB\u5225",
    },
    targetRoles: {
      cs_staff: "CS\u62C5\u5F53",
      field_manager: "\u73FE\u5834\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC",
      office_admin: "\u30AA\u30D5\u30A3\u30B9\u7BA1\u7406\u8005",
      owner: "\u30AA\u30FC\u30CA\u30FC",
      part_time_staff: "\u30D1\u30FC\u30C8\u30BF\u30A4\u30E0\u30B9\u30BF\u30C3\u30D5",
      senior_managing_director: "\u5C02\u52D9",
      staff: "\u30B9\u30BF\u30C3\u30D5",
    },
    maintenance: {
      title: "\u30B9\u30C8\u30EC\u30FC\u30B8\u6574\u7406",
      description:
        "\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u5F8C\u306B\u4FDD\u5B58\u3055\u308C\u306A\u304B\u3063\u305F\u753B\u50CF\uFF08\u5B64\u7ACB\u30D5\u30A1\u30A4\u30EB\uFF09\u3092\u6574\u7406\u3057\u307E\u3059\u300260\u5206\u306E\u7336\u4E88\u671F\u9593\u5185\u306E\u30D5\u30A1\u30A4\u30EB\u3068DB\u3067\u53C2\u7167\u3055\u308C\u3066\u3044\u308B\u30D5\u30A1\u30A4\u30EB\u306F\u524A\u9664\u3057\u307E\u305B\u3093\u3002",
      button: "\u5B64\u7ACB\u753B\u50CF\u3092\u6574\u7406",
      running: "\u6574\u7406\u4E2D\u2026",
      failed:
        "\u6574\u7406\u306F\u5B8C\u4E86\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u30ED\u30B0\u3092\u78BA\u8A8D\u3057\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      deleted: "\u524A\u9664\u6E08\u307F",
      skippedGrace: "\u7336\u4E88\u671F\u9593\u5185\u306E\u305F\u3081\u30B9\u30AD\u30C3\u30D7",
      skippedReferenced: "DB\u53C2\u7167\u306E\u305F\u3081\u30B9\u30AD\u30C3\u30D7",
      errors: "\u30A8\u30E9\u30FC",
      listingFailures: "\u4E00\u89A7\u53D6\u5F97\u5931\u6557",
    },
    console: {
      kpiPublished: "\u516C\u958B\u4E2D",
      kpiPublishedSub: "\u30B9\u30BF\u30C3\u30D5\u306B\u8868\u793A\u4E2D",
      kpiDrafts: "\u4E0B\u66F8\u304D",
      kpiDraftsSub: "\u672A\u516C\u958B\u30FB\u4F5C\u6210\u4E2D",
      kpiImportant: "\u91CD\u8981",
      kpiImportantSub: "\u516C\u958B\u4E2D\u30FB\u91CD\u8981\u8868\u793A",
      kpiPopup: "\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7\u6709\u52B9",
      kpiPopupSub: "\u30A2\u30D7\u30EA\u8D77\u52D5\u6642\u306B\u8868\u793A",
      kpiImpUnread: "\u91CD\u8981\u30FB\u672A\u8AAD",
      kpiImpUnreadRemain: "\u672A\u8AAD\u306E\u5BFE\u8C61\u8005\u3042\u308A",
      kpiImpUnreadClear: "\u5168\u54E1\u78BA\u8A8D\u6E08\u307F",
      tabPublished: "\u516C\u958B\u4E2D",
      tabDrafts: "\u4E0B\u66F8\u304D",
      tabArchived: "\u30A2\u30FC\u30AB\u30A4\u30D6",
      permLegend: "\u516C\u958B\u30FB\u30A2\u30FC\u30AB\u30A4\u30D6\u30FB\u524A\u9664\u304C\u53EF\u80FD",
      newBtn: "\u65B0\u898F\u304A\u77E5\u3089\u305B",
      channelNote: "\u516C\u5F0F\u9023\u7D61\u30C1\u30E3\u30CD\u30EB\u30FB\u30A2\u30D7\u30EA\u901A\u77E5\u9001\u4FE1",
      countUnit: "\u4EF6",
      searchResult: "\u691C\u7D22\u7D50\u679C (\u5168{n}\u4EF6)",
      colStatus: "\u72B6\u614B",
      colAnnouncement: "\u304A\u77E5\u3089\u305B",
      colTarget: "\u5BFE\u8C61",
      colAuthor: "\u4F5C\u6210\u8005",
      colPublishedAt: "\u516C\u958B\u65E5",
      colUpdatedAt: "\u6700\u7D42\u66F4\u65B0",
      colRead: "\u65E2\u8AAD\u72B6\u6CC1",
      dateKindPublished: "\u516C\u958B",
      dateKindUpdated: "\u66F4\u65B0",
      readUnsent: "\u672A\u516C\u958B",
      unreadN: "\u672A\u8AAD {n}",
      stDraft: "\u4E0B\u66F8\u304D",
      stPublished: "\u516C\u958B\u4E2D",
      stArchived: "\u30A2\u30FC\u30AB\u30A4\u30D6",
      flImportant: "\u91CD\u8981",
      flPinned: "\u56FA\u5B9A",
      flPopup: "\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7",
      flPopupOff: "\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7\u7D42\u4E86",
      flImage: "\u753B\u50CF {n}\u679A",
      everyone: "\u5168\u30B9\u30BF\u30C3\u30D5",
      targetMore: "\u4ED6 {n}",
      emptyPubT: "\u516C\u958B\u4E2D\u306E\u304A\u77E5\u3089\u305B\u306F\u3042\u308A\u307E\u305B\u3093",
      emptyPubS: "\u65B0\u3057\u3044\u304A\u77E5\u3089\u305B\u3092\u4F5C\u6210\u3057\u3066\u30B9\u30BF\u30C3\u30D5\u306B\u914D\u4FE1\u3057\u307E\u3057\u3087\u3046\u3002",
      emptyDraftT: "\u4F5C\u6210\u4E2D\u306E\u4E0B\u66F8\u304D\u306F\u3042\u308A\u307E\u305B\u3093",
      emptyDraftS: "\u4E0B\u66F8\u304D\u3092\u4FDD\u5B58\u3059\u308B\u3068\u3001\u3053\u3053\u3067\u7DE8\u96C6\u3092\u518D\u958B\u3067\u304D\u307E\u3059\u3002",
      emptyArcT: "\u30A2\u30FC\u30AB\u30A4\u30D6\u3055\u308C\u305F\u304A\u77E5\u3089\u305B\u306F\u3042\u308A\u307E\u305B\u3093",
      emptyArcS: "\u516C\u958B\u7D42\u4E86\u3057\u305F\u304A\u77E5\u3089\u305B\u304C\u3053\u3053\u306B\u4FDD\u7BA1\u3055\u308C\u307E\u3059\u3002",
      emptySearchS: "\u691C\u7D22\u6761\u4EF6\u306B\u4E00\u81F4\u3059\u308B\u304A\u77E5\u3089\u305B\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
      pInfo: "\u304A\u77E5\u3089\u305B\u60C5\u5831",
      pOrg: "\u7D44\u7E54",
      pAuthor: "\u4F5C\u6210\u8005",
      pTarget: "\u5BFE\u8C61",
      pCountSuffix: "{n}\u540D",
      pPublishedAt: "\u516C\u958B\u65E5",
      pArchivedAt: "\u30A2\u30FC\u30AB\u30A4\u30D6\u65E5",
      pPopupUntil: "\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7\u7D42\u4E86",
      pBody: "\u672C\u6587",
      pImages: "\u6DFB\u4ED8\u753B\u50CF",
      pReadTitle: "\u65E2\u8AAD\u72B6\u6CC1",
      pRead: "\u65E2\u8AAD",
      pUnread: "\u672A\u8AAD",
      pTotal: "\u5BFE\u8C61\u8005",
      pOpenReaders: "\u65E2\u8AAD\u72B6\u6CC1\u3092\u958B\u304F",
      pOpenReadersSub: "\u65E2\u8AAD / \u672A\u8AAD\u306E\u5BFE\u8C61\u8005\u540D\u7C3F\u3092\u78BA\u8A8D",
      pnoteTitle: "\u65E2\u8AAD\u3068\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7\u9589\u3058\u306F\u5225\u3067\u3059",
      pnoteBody: "\u30A2\u30D7\u30EA\u8D77\u52D5\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7\u3092{d}\u540D\u304C\u9589\u3058\u307E\u3057\u305F\u304C\u3001\u3053\u308C\u306F\u672C\u6587\u306E\u65E2\u8AAD({r}\u540D)\u3068\u306F\u5225\u306B\u96C6\u8A08\u3055\u308C\u307E\u3059\u3002",
      notSentTitle: "\u307E\u3060\u516C\u958B\u3055\u308C\u3066\u3044\u307E\u305B\u3093",
      notSentSub: "\u516C\u958B\u5F8C\u3001\u5BFE\u8C61\u8005{n}\u540D\u306E\u65E2\u8AAD\u30C7\u30FC\u30BF\u304C\u96C6\u8A08\u3055\u308C\u307E\u3059\u3002",
      zAuthorTitle: "\u4F5C\u6210",
      zAuthorTag: "\u4F5C\u6210\u6A29\u9650",
      zAuthorDesc: "\u30BF\u30A4\u30C8\u30EB\u30FB\u672C\u6587\u30FB\u753B\u50CF\u30FB\u5BFE\u8C61\u306A\u3069\u306E\u5185\u5BB9\u7DE8\u96C6\u3002\u30E2\u30D0\u30A4\u30EB\u306E\u4F5C\u6210\u6A29\u9650\u3068\u540C\u3058\u3067\u3059\u3002",
      zEditContent: "\u5185\u5BB9\u3092\u7DE8\u96C6",
      zEditDraft: "\u4E0B\u66F8\u304D\u3092\u7DE8\u96C6",
      zAuthorLocked: "\u4F5C\u6210\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093",
      zOpTitle: "\u904B\u7528\u7BA1\u7406",
      zOpTag: "\u904B\u7528\u6A29\u9650\u30FB\u7BA1\u7406\u8005",
      zOpDesc: "\u516C\u958B\u30FB\u30A2\u30FC\u30AB\u30A4\u30D6\u30FB\u524A\u9664\u306B\u306F\u904B\u7528\u7BA1\u7406\u8005\u6A29\u9650\u304C\u5FC5\u8981\u3067\u3059\u3002",
      zPublish: "\u516C\u958B",
      zRepublish: "\u518D\u516C\u958B",
      zRevert: "\u4E0B\u66F8\u304D\u306B\u623B\u3059",
      zArchive: "\u30A2\u30FC\u30AB\u30A4\u30D6",
      zDelete: "\u524A\u9664",
      zOpLocked: "\u904B\u7528\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093",
      mobileDetail: "\u30E2\u30D0\u30A4\u30EB\u8A73\u7D30",
      close: "\u9589\u3058\u308B",
      fNewKicker: "\u65B0\u898F\u304A\u77E5\u3089\u305B",
      fEditKicker: "\u304A\u77E5\u3089\u305B\u7DE8\u96C6",
      fNewTitle: "\u304A\u77E5\u3089\u305B\u4F5C\u6210",
      fOrg: "\u7D44\u7E54",
      fTitle: "\u30BF\u30A4\u30C8\u30EB",
      fTitlePh: "\u304A\u77E5\u3089\u305B\u306E\u30BF\u30A4\u30C8\u30EB\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044",
      fBody: "\u672C\u6587",
      fBodyPh: "\u304A\u77E5\u3089\u305B\u306E\u672C\u6587\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044",
      fImages: "\u753B\u50CF\u6DFB\u4ED8",
      fImagesMax: "\u00B7 \u6700\u59275\u679A",
      fImageCount: "{n} / 5 \u6DFB\u4ED8\u6E08\u307F",
      fImgAdd: "\u8FFD\u52A0",
      fImgTooMany: "\u753B\u50CF\u306F\u6700\u59275\u679A\u307E\u3067\u6DFB\u4ED8\u3067\u304D\u307E\u3059\u3002",
      fImgTooLarge: "\u753B\u50CF1\u679A\u306F8MB\u4EE5\u4E0B\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\u3002",
      fImgBadType: "JPEG\u3001PNG\u3001WebP\u3001GIF\u306E\u307F\u6DFB\u4ED8\u3067\u304D\u307E\u3059\u3002",
      fScope: "\u5BFE\u8C61\u7BC4\u56F2",
      fScopeEveryone: "\u5168\u30B9\u30BF\u30C3\u30D5",
      fScopeEveryoneSub: "\u3059\u3079\u3066\u306E\u5BFE\u8C61\u8005",
      fScopeRoles: "\u30ED\u30FC\u30EB\u6307\u5B9A",
      fScopeRolesSub: "\u9078\u629E\u3057\u305F\u30ED\u30FC\u30EB",
      fRoles: "\u5BFE\u8C61\u30ED\u30FC\u30EB",
      fStatus: "\u72B6\u614B",
      fStDraft: "\u4E0B\u66F8\u304D\u4FDD\u5B58",
      fStDraftSub: "\u516C\u958B\u3057\u306A\u3044",
      fStPublish: "\u3059\u3050\u516C\u958B",
      fStPublishSub: "\u5BFE\u8C61\u8005\u3078\u9001\u4FE1",
      fOptions: "\u8868\u793A\u30AA\u30D7\u30B7\u30E7\u30F3",
      fImportant: "\u91CD\u8981",
      fImportantSub: "\u91CD\u8981\u306A\u304A\u77E5\u3089\u305B\u3068\u3057\u3066\u5F37\u8ABF\u8868\u793A",
      fPinned: "\u56FA\u5B9A",
      fPinnedSub: "\u4E00\u89A7\u306E\u4E0A\u90E8\u306B\u56FA\u5B9A",
      fPopup: "\u30A2\u30D7\u30EA\u8D77\u52D5\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7",
      fPopupSub: "\u30A2\u30D7\u30EA\u8D77\u52D5\u6642\u306B\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7\u8868\u793A",
      fPopupUntil: "\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7\u7D42\u4E86\u6642\u523B",
      fPopupUntilDate: "\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7\u7D42\u4E86\u65E5",
      fPopupUntilDatePh: "\u65E5\u4ED8\u3092\u9078\u629E",
      fPopupUntilTime: "\u30DD\u30C3\u30D7\u30A2\u30C3\u30D7\u7D42\u4E86\u6642\u523B",
      datePickerPrevMonth: "\u524D\u6708",
      datePickerNextMonth: "\u7FCC\u6708",
      datePickerToday: "\u4ECA\u65E5",
      fPublishNote: "\u516C\u958B\u3059\u308B\u3068\u5BFE\u8C61\u8005\u3078\u30A2\u30D7\u30EA\u901A\u77E5\u304C\u9001\u4FE1\u3055\u308C\u307E\u3059\u3002",
      fDraftNote: "\u4E0B\u66F8\u304D\u306F\u81EA\u5206\u3060\u3051\u306B\u8868\u793A\u3055\u308C\u307E\u3059\u3002",
      fCancel: "\u30AD\u30E3\u30F3\u30BB\u30EB",
      fSaveDraft: "\u4E0B\u66F8\u304D\u4FDD\u5B58",
      fSave: "\u4FDD\u5B58",
      fPublish: "\u516C\u958B",
      vTitleRequired: "\u30BF\u30A4\u30C8\u30EB\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      vBodyRequired: "\u672C\u6587\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      vRolesRequired: "\u5BFE\u8C61\u30ED\u30FC\u30EB\u30921\u3064\u4EE5\u4E0A\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      rKicker: "\u65E2\u8AAD\u72B6\u6CC1",
      rSegAll: "\u5168\u4F53",
      rSegRead: "\u65E2\u8AAD",
      rSegUnread: "\u672A\u8AAD",
      rStatRead: "\u65E2\u8AAD",
      rStatUnread: "\u672A\u8AAD",
      rStatTotal: "\u5BFE\u8C61\u8005",
      rRowRead: "\u65E2\u8AAD",
      rRowUnread: "\u672A\u8AAD",
      rEmpty: "\u8A72\u5F53\u3059\u308B\u5BFE\u8C61\u8005\u306F\u3044\u307E\u305B\u3093",
      rFootNote: "\u5BFE\u8C61\u8005\u540D\u7C3F\u30FB\u76E3\u67FB\u7528",
      rConfirm: "\u78BA\u8A8D",
      rLoading: "\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026",
      cFootNote: "\u904B\u7528\u7BA1\u7406\u8005\u6A29\u9650",
      cPublishKicker: "\u304A\u77E5\u3089\u305B\u516C\u958B",
      cPublishT: "\u3053\u306E\u304A\u77E5\u3089\u305B\u3092\u516C\u958B\u3057\u307E\u3059\u304B\uFF1F",
      cPublishS: "\u5BFE\u8C61\u8005{n}\u540D\u3078\u30A2\u30D7\u30EA\u901A\u77E5\u304C\u9001\u4FE1\u3055\u308C\u307E\u3059\u3002",
      cPublishBtn: "\u516C\u958B",
      cRepublishKicker: "\u304A\u77E5\u3089\u305B\u518D\u516C\u958B",
      cRepublishT: "\u30A2\u30FC\u30AB\u30A4\u30D6\u3055\u308C\u305F\u304A\u77E5\u3089\u305B\u3092\u518D\u516C\u958B\u3057\u307E\u3059\u304B\uFF1F",
      cRepublishS: "\u518D\u3073\u5BFE\u8C61\u8005{n}\u540D\u306B\u8868\u793A\u3055\u308C\u307E\u3059\u3002",
      cRepublishBtn: "\u518D\u516C\u958B",
      cArchiveKicker: "\u304A\u77E5\u3089\u305B\u30A2\u30FC\u30AB\u30A4\u30D6",
      cArchiveT: "\u3053\u306E\u304A\u77E5\u3089\u305B\u3092\u30A2\u30FC\u30AB\u30A4\u30D6\u3057\u307E\u3059\u304B\uFF1F",
      cArchiveS: "\u30B9\u30BF\u30C3\u30D5\u3078\u306E\u8868\u793A\u304C\u7D42\u4E86\u3057\u3001\u30A2\u30FC\u30AB\u30A4\u30D6\u3078\u79FB\u52D5\u3057\u307E\u3059\u3002\u65E2\u8AAD\u8A18\u9332\u306F\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002",
      cArchiveBtn: "\u30A2\u30FC\u30AB\u30A4\u30D6",
      cRevertKicker: "\u4E0B\u66F8\u304D\u306B\u623B\u3059",
      cRevertT: "\u4E0B\u66F8\u304D\u306B\u623B\u3057\u307E\u3059\u304B\uFF1F",
      cRevertS: "\u30B9\u30BF\u30C3\u30D5\u3078\u306E\u8868\u793A\u304C\u505C\u6B62\u3057\u3001\u4E0B\u66F8\u304D\u72B6\u614B\u3078\u79FB\u52D5\u3057\u307E\u3059\u3002",
      cRevertBtn: "\u4E0B\u66F8\u304D\u306B\u623B\u3059",
      cDelKicker: "\u304A\u77E5\u3089\u305B\u524A\u9664",
      cDelT: "\u3053\u306E\u304A\u77E5\u3089\u305B\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F",
      cDelS: "\u524A\u9664\u3059\u308B\u3068\u5143\u306B\u623B\u305B\u307E\u305B\u3093\u3002\u65E2\u8AAD\u8A18\u9332\u3082\u4E00\u7DD2\u306B\u524A\u9664\u3055\u308C\u307E\u3059\u3002",
      cDelBtn: "\u524A\u9664",
      imgViewTitle: "\u6DFB\u4ED8\u753B\u50CF",
      tSaved: "\u304A\u77E5\u3089\u305B\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F\u3002",
      tPublished: "\u304A\u77E5\u3089\u305B\u3092\u516C\u958B\u3057\u307E\u3057\u305F\u3002",
      tRepublished: "\u304A\u77E5\u3089\u305B\u3092\u518D\u516C\u958B\u3057\u307E\u3057\u305F\u3002",
      tArchived: "\u304A\u77E5\u3089\u305B\u3092\u30A2\u30FC\u30AB\u30A4\u30D6\u3057\u307E\u3057\u305F\u3002",
      tReverted: "\u4E0B\u66F8\u304D\u306B\u623B\u3057\u307E\u3057\u305F\u3002",
      tDeleted: "\u304A\u77E5\u3089\u305B\u3092\u524A\u9664\u3057\u307E\u3057\u305F\u3002",
      tSynced: "\u6700\u65B0\u306E\u72B6\u614B\u3067\u3059\u3002",
      errProcess: "\u51E6\u7406\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
      errT: "\u304A\u77E5\u3089\u305B\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F",
      errS: "\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u72B6\u614B\u3092\u78BA\u8A8D\u3057\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      retry: "\u518D\u8A66\u884C",
    },
    // 화이트 리디자인(2026-10-15) — PC 공지 콘솔 · 작성 화면.
    white: {
      sumPinned: "固定 {n}",
      sumPopup: "ポップアップ {n}",
      sumImpUnread: "重要なお知らせ{n}件に未読 {p}人",
      sumImpClear: "重要なお知らせは全員既読です",
      colTitle: "タイトル",
      colTarget: "対象",
      colAuthor: "作成者",
      colPublished: "掲載日",
      colUpdated: "更新日",
      colRead: "既読",
      unreadPeople: "未読 {n}人",
      allRead: "全員既読",
      readOf: "{r} / {t}人",
      notPublished: "未掲載",
      pinned: "固定",
      important: "重要",
      popupUntil: "ポップアップ {date}まで",
      popupOn: "ポップアップ",
      popupEnded: "ポップアップ終了",
      everyone: "全員",
      emptyPub: "掲載中のお知らせはありません",
      emptyDraft: "下書きはありません",
      emptyArc: "アーカイブしたお知らせはありません",
      emptyPubHint: "新しいお知らせはすぐに対象者のアプリに表示されます",
      loadError: "お知らせを読み込めませんでした",
      stPublished: "掲載中",
      stDraft: "下書き",
      stArchived: "アーカイブ済み",
      readTitle: "既読",
      tabUnread: "未読",
      tabRead: "既読",
      readLoading: "名簿を読み込み中…",
      readListError: "名簿を読み込めませんでした",
      noneUnread: "全員既読です",
      noneRead: "まだ誰も読んでいません",
      notSentNote: "掲載すると対象者{n}人の既読がここに表示されます",
      popupNote: "ポップアップを閉じた人 {d}人 · 閉じただけでは既読になりません",
      org: "組織",
      edit: "編集",
      archive: "アーカイブ",
      publish: "掲載する",
      revert: "下書きに戻す",
      republish: "再掲載",
      delete: "お知らせを削除",
      close: "詳細を閉じる",
      mobileView: "モバイル画面で見る",
      noPermission: "このお知らせは作成者と運営管理者のみ変更できます",
      photoOpen: "写真{n}を拡大",
      keep: "そのままにする",
      cDelT: "このお知らせを削除しますか？",
      cDelS: "削除すると元に戻せません。既読の記録も消えます。",
      cDelBtn: "削除",
      cArcT: "このお知らせをアーカイブしますか？",
      cArcS: "スタッフのアプリから外れ、アーカイブに移ります。既読の記録は残ります。",
      cRevT: "下書きに戻しますか？",
      cRevS: "スタッフのアプリから外れ、下書きに移ります。",
      cPubT: "このお知らせを掲載しますか？",
      cPubS: "対象者{n}人のアプリにすぐ表示されます。",
      cRepT: "アーカイブしたお知らせを再掲載しますか？",
      back: "お知らせ一覧",
      newTitle: "新しいお知らせ",
      editTitle: "お知らせを編集",
      fTitle: "タイトル",
      fBody: "本文",
      fTitlePh: "例）11月のシフト提出のお願い",
      fBodyPh: "スタッフに伝える内容を入力してください",
      photoAdd: "写真を追加",
      photoRemove: "写真を外す",
      photoCount: "{n} / 5",
      settings: "掲載設定",
      target: "対象",
      scopeEveryone: "全員",
      scopeRoles: "役割を選ぶ",
      recipients: "対象者 {n}人",
      fImportant: "重要",
      fImportantSub: "一覧で赤字で強調",
      fPinned: "上部に固定",
      fPinnedSub: "一覧の一番上に表示し続けます",
      fPopup: "アプリ起動時にポップアップ",
      fPopupSub: "対象者は7日間非表示にできます",
      fPopupEnd: "ポップアップ終了日",
      fPopupEndPh: "指定しない",
      publishHint: "掲載するとすぐに対象者のアプリに表示されます",
      saveDraft: "下書き保存",
      save: "保存",
      cancel: "キャンセル",
      saving: "保存中…",
      uploading: "写真をアップロード中…",
      leaveT: "入力中の内容を破棄しますか？",
      leaveS: "今離れると保存していない内容は消えます。",
      leaveBtn: "破棄して戻る",
    },
  },
  en: {
    allowComments: "Allow comments",
    archive: "Archive",
    archivedAt: "Archived",
    author: "Author",
    authorCredit: "Author",
    backToDraft: "Draft",
    backToAnnouncements: "Back to announcements",
    close: "Close",
    commentBlocked: "Comments are not available for this announcement.",
    commentDeleted: "Comment deleted.",
    commentPlaceholder:
      "Add a confirmation note or a message to share with the team.",
    commentSaved: "Comment posted.",
    commentSubmit: "Post comment",
    commentUpdated: "Comment updated.",
    comments: "Comments",
    commentsEmpty: "There are no comments yet.",
    cancel: "Cancel",
    confirm: "Confirm",
    confirmCommentDeleteTitle: "Delete this comment?",
    confirmDeleteBody:
      "Delete this announcement? Once deleted, it disappears from the list immediately.",
    confirmDeleteTitle: "Delete this announcement?",
    content: "Content",
    create: "Create",
    createTitle: "Create announcement",
    delete: "Delete",
    description: "Create organization announcements and manage publish status.",
    edit: "Edit",
    edited: "Edited",
    empty: "No announcements have been created yet.",
    hideForWeek: "Do not show again for 7 days",
    important: "Important",
    imageAdd: "Add images",
    imageAttachments: "Image attachments",
    imageLimit: "Up to 5 images, 8MB or less each",
    imageRemove: "Remove image",
    latest: "Latest announcements",
    memberName: "User",
    mobileDescription:
      "See only the announcements published for you and open the details you need right away.",
    mobileEmpty: "There are no announcements for you yet.",
    noMembers: "There are no users to show.",
    organization: "Organization",
    pinned: "Pinned",
    publishedForYou: "Published for you",
    popupPreview: "Popup announcement",
    publish: "Publish",
    publishedAt: "Published",
    readAnnouncement: "Announcement detail",
    readAt: "Read at",
    readCount: "Read",
    readers: "Readers",
    readSummary: "Read status",
    markAsRead: "Mark as read",
    markedAsRead: "You have read this announcement.",
    notReadYet: "Not read yet",
    openList: "Open list",
    roleTargets: "Target roles",
    roleLabel: "Role",
    showPopup: "Show popup on app open",
    status: "Status",
    save: "Save",
    target: "Target",
    title: "Announcements",
    titleField: "Title",
    unreadCount: "Unread",
    unreadMembers: "Unread users",
    tapToZoom: "Tap to zoom",
    viewDetail: "View detail",
    success: {
      created: "Announcement created.",
      deleted: "Announcement deleted.",
      statusUpdated: "Announcement status updated.",
    },
    errors: {
      forbidden: "You do not have permission to manage announcements.",
      comment_failed: "Could not save comment.",
      comment_forbidden:
        "You do not have permission to comment on this announcement.",
      comment_invalid: "Check the comment content.",
      comment_delete_failed: "Could not delete comment.",
      comment_not_found: "Could not find that comment.",
      comment_update_failed: "Could not update comment.",
      comments_disabled: "Comments are disabled for this announcement.",
      image_count_exceeded: "You can attach up to 5 images.",
      image_size_exceeded: "Each image must be 8MB or less.",
      image_type_invalid:
        "Unsupported image format. Only JPEG, PNG, WebP, and GIF are allowed.",
      invalid_images: "Attach up to 5 images, 8MB or less each.",
      invalid_announcement: "Check the announcement details.",
      invalid_organization: "Choose an organization.",
      save_failed: "Could not save announcement.",
    },
    statuses: {
      archived: "Archived",
      draft: "Draft",
      published: "Published",
    },
    targetScopes: {
      everyone: "Everyone",
      roles: "By role",
    },
    targetRoles: {
      cs_staff: "CS Staff",
      field_manager: "Field Manager",
      office_admin: "Office Admin",
      owner: "Owner",
      part_time_staff: "Part-time Staff",
      senior_managing_director: "Managing Director",
      staff: "Staff",
    },
    maintenance: {
      title: "Storage maintenance",
      description:
        "Remove images uploaded but never saved to an announcement (orphaned files). Files within the 60-minute grace period and files referenced in the database are not deleted.",
      button: "Clean up orphaned images",
      running: "Cleaning up…",
      failed: "Cleanup did not complete. Check logs and try again.",
      deleted: "Deleted",
      skippedGrace: "Skipped (grace period)",
      skippedReferenced: "Skipped (DB referenced)",
      errors: "Errors",
      listingFailures: "Listing failures",
    },
    console: {
      kpiPublished: "Published",
      kpiPublishedSub: "Visible to staff",
      kpiDrafts: "Drafts",
      kpiDraftsSub: "Unpublished, in progress",
      kpiImportant: "Important",
      kpiImportantSub: "Published · marked important",
      kpiPopup: "Popup active",
      kpiPopupSub: "Shown on app open",
      kpiImpUnread: "Important · unread",
      kpiImpUnreadRemain: "Recipients still unread",
      kpiImpUnreadClear: "All confirmed",
      tabPublished: "Published",
      tabDrafts: "Drafts",
      tabArchived: "Archived",
      permLegend: "Can publish, archive, delete",
      newBtn: "New announcement",
      channelNote: "Official channel · app notification",
      countUnit: "",
      searchResult: "search results (of {n})",
      colStatus: "Status",
      colAnnouncement: "Announcement",
      colTarget: "Target",
      colAuthor: "Author",
      colPublishedAt: "Published",
      colUpdatedAt: "Last updated",
      colRead: "Read status",
      dateKindPublished: "Published",
      dateKindUpdated: "Updated",
      readUnsent: "Not published",
      unreadN: "{n} unread",
      stDraft: "Draft",
      stPublished: "Published",
      stArchived: "Archived",
      flImportant: "Important",
      flPinned: "Pinned",
      flPopup: "Popup",
      flPopupOff: "Popup ended",
      flImage: "{n} image(s)",
      everyone: "Everyone",
      targetMore: "+{n}",
      emptyPubT: "No published announcements",
      emptyPubS: "Create a new announcement to reach your staff.",
      emptyDraftT: "No drafts in progress",
      emptyDraftS: "Saved drafts appear here so you can keep editing.",
      emptyArcT: "No archived announcements",
      emptyArcS: "Announcements you stop publishing are kept here.",
      emptySearchS: "No announcements match your search.",
      pInfo: "Announcement info",
      pOrg: "Organization",
      pAuthor: "Author",
      pTarget: "Target",
      pCountSuffix: "{n} people",
      pPublishedAt: "Published",
      pArchivedAt: "Archived",
      pPopupUntil: "Popup ends",
      pBody: "Body",
      pImages: "Attached images",
      pReadTitle: "Read status",
      pRead: "Read",
      pUnread: "Unread",
      pTotal: "Recipients",
      pOpenReaders: "Open read status",
      pOpenReadersSub: "See who has and hasn't read it",
      pnoteTitle: "Read is separate from dismissing the popup",
      pnoteBody: "{d} people dismissed the app-open popup, but that is counted separately from reading the body ({r} read).",
      notSentTitle: "Not published yet",
      notSentSub: "Read data for {n} recipients is collected once published.",
      zAuthorTitle: "Author",
      zAuthorTag: "Author permission",
      zAuthorDesc: "Edit title, body, images, target. Same as the mobile author permission.",
      zEditContent: "Edit content",
      zEditDraft: "Edit draft",
      zAuthorLocked: "You do not have author permission",
      zOpTitle: "Operations",
      zOpTag: "Operator · admin",
      zOpDesc: "Publishing, archiving, and deleting require operator permission.",
      zPublish: "Publish",
      zRepublish: "Republish",
      zRevert: "Back to draft",
      zArchive: "Archive",
      zDelete: "Delete",
      zOpLocked: "You do not have operator permission",
      mobileDetail: "Mobile view",
      close: "Close",
      fNewKicker: "New announcement",
      fEditKicker: "Edit announcement",
      fNewTitle: "Create announcement",
      fOrg: "Organization",
      fTitle: "Title",
      fTitlePh: "Enter the announcement title",
      fBody: "Body",
      fBodyPh: "Enter the announcement body",
      fImages: "Image attachments",
      fImagesMax: "· up to 5",
      fImageCount: "{n} / 5 attached",
      fImgAdd: "Add",
      fImgTooMany: "You can attach up to 5 images.",
      fImgTooLarge: "Each image must be 8MB or less.",
      fImgBadType: "Only JPEG, PNG, WebP, and GIF can be attached.",
      fScope: "Target scope",
      fScopeEveryone: "Everyone",
      fScopeEveryoneSub: "All recipients",
      fScopeRoles: "By role",
      fScopeRolesSub: "Selected roles",
      fRoles: "Target roles",
      fStatus: "Status",
      fStDraft: "Save draft",
      fStDraftSub: "Not published",
      fStPublish: "Publish now",
      fStPublishSub: "Send to recipients",
      fOptions: "Display options",
      fImportant: "Important",
      fImportantSub: "Highlight as an important announcement",
      fPinned: "Pinned",
      fPinnedSub: "Pin to the top of the list",
      fPopup: "App-open popup",
      fPopupSub: "Show as a popup when the app opens",
      fPopupUntil: "Popup end time",
      fPopupUntilDate: "Popup end date",
      fPopupUntilDatePh: "Select a date",
      fPopupUntilTime: "Popup end time",
      datePickerPrevMonth: "Previous month",
      datePickerNextMonth: "Next month",
      datePickerToday: "Today",
      fPublishNote: "Publishing sends an app notification to recipients.",
      fDraftNote: "Drafts are visible only to you.",
      fCancel: "Cancel",
      fSaveDraft: "Save draft",
      fSave: "Save",
      fPublish: "Publish",
      vTitleRequired: "Please enter a title.",
      vBodyRequired: "Please enter the body.",
      vRolesRequired: "Please select at least one target role.",
      rKicker: "Read status",
      rSegAll: "All",
      rSegRead: "Read",
      rSegUnread: "Unread",
      rStatRead: "Read",
      rStatUnread: "Unread",
      rStatTotal: "Recipients",
      rRowRead: "Read",
      rRowUnread: "Unread",
      rEmpty: "No recipients here",
      rFootNote: "Recipient list · for audit",
      rConfirm: "OK",
      rLoading: "Loading…",
      cFootNote: "Operator permission",
      cPublishKicker: "Publish announcement",
      cPublishT: "Publish this announcement?",
      cPublishS: "An app notification will be sent to {n} recipients.",
      cPublishBtn: "Publish",
      cRepublishKicker: "Republish announcement",
      cRepublishT: "Republish this archived announcement?",
      cRepublishS: "It will be shown to {n} recipients again.",
      cRepublishBtn: "Republish",
      cArchiveKicker: "Archive announcement",
      cArchiveT: "Archive this announcement?",
      cArchiveS: "Staff visibility ends and it moves to the archive. Read records are kept.",
      cArchiveBtn: "Archive",
      cRevertKicker: "Back to draft",
      cRevertT: "Move back to draft?",
      cRevertS: "Staff visibility stops and it returns to draft.",
      cRevertBtn: "Back to draft",
      cDelKicker: "Delete announcement",
      cDelT: "Delete this announcement?",
      cDelS: "Deletion cannot be undone. Read records are deleted too.",
      cDelBtn: "Delete",
      imgViewTitle: "Attached image",
      tSaved: "Announcement saved.",
      tPublished: "Announcement published.",
      tRepublished: "Announcement republished.",
      tArchived: "Announcement archived.",
      tReverted: "Moved back to draft.",
      tDeleted: "Announcement deleted.",
      tSynced: "Up to date.",
      errProcess: "Could not complete. Please try again.",
      errT: "Could not load announcements",
      errS: "Check your connection and try again.",
      retry: "Retry",
    },
    // 화이트 리디자인(2026-10-15) — PC 공지 콘솔 · 작성 화면.
    white: {
      sumPinned: "{n} pinned",
      sumPopup: "{n} with pop-up",
      sumImpUnread: "{p} people still haven't read {n} important notices",
      sumImpClear: "Everyone has read the important notices",
      colTitle: "Title",
      colTarget: "Audience",
      colAuthor: "Author",
      colPublished: "Posted",
      colUpdated: "Edited",
      colRead: "Read",
      unreadPeople: "{n} unread",
      allRead: "All read",
      readOf: "{r} / {t}",
      notPublished: "Not posted",
      pinned: "Pinned",
      important: "Important",
      popupUntil: "Pop-up until {date}",
      popupOn: "Pop-up",
      popupEnded: "Pop-up ended",
      everyone: "Everyone",
      emptyPub: "No notices are posted",
      emptyDraft: "No drafts",
      emptyArc: "No archived notices",
      emptyPubHint: "A new notice shows up in recipients' app right away",
      loadError: "Couldn't load notices",
      stPublished: "Posted",
      stDraft: "Draft",
      stArchived: "Archived",
      readTitle: "Read",
      tabUnread: "Unread",
      tabRead: "Read",
      readLoading: "Loading list…",
      readListError: "Couldn't load the list",
      noneUnread: "Everyone has read it",
      noneRead: "No one has read it yet",
      notSentNote: "Once posted, read status for {n} recipients shows here",
      popupNote: "{d} closed the pop-up · closing it doesn't count as read",
      org: "Organization",
      edit: "Edit",
      archive: "Archive",
      publish: "Post",
      revert: "Back to draft",
      republish: "Post again",
      delete: "Delete notice",
      close: "Close details",
      mobileView: "View on mobile",
      noPermission: "Only the author and operations admins can change this notice",
      photoOpen: "Open photo {n}",
      keep: "Keep it",
      cDelT: "Delete this notice?",
      cDelS: "This can't be undone. Read records are deleted too.",
      cDelBtn: "Delete",
      cArcT: "Archive this notice?",
      cArcS: "It leaves the staff app and moves to Archived. Read records are kept.",
      cRevT: "Move back to draft?",
      cRevS: "It leaves the staff app and moves to Drafts.",
      cPubT: "Post this notice?",
      cPubS: "It shows up right away for {n} recipients.",
      cRepT: "Post this archived notice again?",
      back: "Notices",
      newTitle: "New notice",
      editTitle: "Edit notice",
      fTitle: "Title",
      fBody: "Body",
      fTitlePh: "e.g. Submit your November shifts",
      fBodyPh: "Write what staff need to know",
      photoAdd: "Add photo",
      photoRemove: "Remove photo",
      photoCount: "{n} / 5",
      settings: "Posting",
      target: "Audience",
      scopeEveryone: "Everyone",
      scopeRoles: "Pick roles",
      recipients: "{n} recipients",
      fImportant: "Important",
      fImportantSub: "Highlighted in red in the list",
      fPinned: "Pin to top",
      fPinnedSub: "Stays at the top of the list",
      fPopup: "Pop-up on app open",
      fPopupSub: "Recipients can hide it for 7 days",
      fPopupEnd: "Pop-up ends",
      fPopupEndPh: "No end date",
      publishHint: "Posting shows it in recipients' app right away",
      saveDraft: "Save draft",
      save: "Save",
      cancel: "Cancel",
      saving: "Saving…",
      uploading: "Uploading photos…",
      leaveT: "Discard what you wrote?",
      leaveS: "Unsaved changes will be lost if you leave now.",
      leaveBtn: "Discard and leave",
    },
  },
};

export function getAnnouncementDictionary(locale: Locale) {
  return dictionaries[locale];
}
