"use client";

// 관리자 청소 콘솔 — 오늘 보드의 객실 카드와 이력 표의 행이 함께 쓰는 우측 상세 패널.
// clean-views.js panel() 을 따른다. admin-console.css + cleaning-console.css 의 공용 .panel/.panel-scrim/
// .pblock/.kv/.locknote/.rptiles primitive 를 쓴다. 데이터는
// 2026-07-14 기준 실데이터(src/lib/admin-cleaning.ts)다.
import { BedDouble, ChevronRight, Info, PackageSearch, ShieldCheck, Wrench, X } from "lucide-react";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import type { AdminCleaningHistoryItem, AdminCleaningTask, AdminSettingTarget } from "@/lib/admin-cleaning";
import { durationMin, elapsedMin, fmtDate, todayDateKeyTokyo, toMin } from "./cleaning-console-data";
import {
  ReportBadges,
  StatusPill,
  TYPE_ICON,
  buildingLabelOf,
  durLabel,
  localeTagOf,
  staffLabelOf,
  typeLabel,
  type ConsoleCopy,
  type StaffDirectory,
} from "./cleaning-console-shared";
import type { Locale } from "@/lib/i18n";
import { useRoomPlaceLabel } from "@/components/shared/building-names";

type DetailPanelProps = {
  task: AdminCleaningTask | null;
  history: AdminCleaningHistoryItem | null;
  setupTarget: AdminSettingTarget | null;
  t: ConsoleCopy;
  buildingLabels: Record<string, string>;
  staffDirectory: StaffDirectory;
  locale: Locale;
  onClose: () => void;
  onOpenForceComplete: (task: AdminCleaningTask) => void;
  onOpenReport: (kind: "lost" | "issue") => void;
  /** 서버(canForceCompleteCleaning)가 내려준 권한. false면 강제완료 버튼 자체를 감춘다. */
  canForceComplete: boolean;
  disabled?: boolean;
};

export function CleaningDetailPanel({
  task,
  history,
  setupTarget,
  t,
  buildingLabels,
  staffDirectory,
  locale,
  onClose,
  onOpenForceComplete,
  onOpenReport,
  canForceComplete,
  disabled,
}: DetailPanelProps) {
  const bRoom = useRoomPlaceLabel();
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled });
  if (!task && !history && !setupTarget) return null;

  // 셋팅 대상은 예약만 있고 아직 cleaning_sessions 레코드가 없는 방이라, 청소 세션 상세(시간·담당·
  // 리포트)를 보여줄 데이터가 없다 — 예약 정보만 담은 축소 패널을 별도로 렌더링한다.
  if (!task && !history && setupTarget) {
    return (
      <>
        <div className="panel-scrim on" onClick={onClose} />
        <aside ref={panelRef} className="panel on" role="dialog" aria-label={t.secSetup} tabIndex={-1}>
          <div className="panel__h">
            <div className="panel__top">
              <span className="panel__kicker">
                {t.secSetup} · {buildingLabelOf(setupTarget, buildingLabels)}
              </span>
              <button type="button" className="panel__x" onClick={onClose} aria-label={t.close}>
                <X />
              </button>
            </div>
            <div className="panel__title" style={{ alignItems: "baseline", marginTop: 11 }}>
              <span className="panel__room">{bRoom(setupTarget.room)}</span>
              <span className="cpanel__type">
                <BedDouble aria-hidden="true" />
                {t.tySetup}
              </span>
            </div>
          </div>

          <div className="panel__body">
            <div className="pblock">
              <div className="pblock__t">{t.pInfo}</div>
              <div className="kv">
                <span className="kv__k">{t.pRoom}</span>
                <span className="kv__v">
                  {buildingLabelOf(setupTarget, buildingLabels)} · {bRoom(setupTarget.room)}
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">{t.pGuest}</span>
                <span className="kv__v">{setupTarget.guest}</span>
              </div>
              <div className="kv">
                <span className="kv__k">{t.pPax}</span>
                <span className="kv__v">
                  {setupTarget.pax == null ? "—" : `${setupTarget.pax}${t.pax}`}
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">{t.arriving}</span>
                <span className="kv__v">{t.today}</span>
              </div>
            </div>

            <div className="pblock">
              <div className="locknote">
                <Info className="ic" aria-hidden="true" />
                {t.setupNoSession}
              </div>
            </div>
          </div>

          <div className="panel__foot">
            <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
              {t.close}
            </button>
          </div>
        </aside>
      </>
    );
  }

  const isHist = !task;
  const location = task ? task : history!;
  const room = task ? task.room : history!.room;
  const type = task ? task.type : history!.type;
  const status = task ? task.status : history!.status;
  const staffId = task ? task.staffId : history!.staffId;
  const proxy = task ? task.proxy : history!.proxy;
  const closed = task ? task.closed : history!.closed;
  const note = task ? task.note : history!.note;
  const reports = task ? task.reports : history!.reports;
  const start = task ? task.start : history!.start;
  const dur = task ? durationMin(task.start, task.end) : history!.dur;
  const localeTag = localeTagOf(locale);
  const dateStr = fmtDate(isHist ? history!.date : todayDateKeyTokyo(), localeTag);
  const TypeIcon = TYPE_ICON[type];

  // 진행중·취소 세션은 duration 이 없으므로 종료 시각을 만들 수 없다 — 시간 블록을 "시작만"
  // 형태로 떨어뜨린다.
  let end: string | null = null;
  if (isHist && history!.dur != null) {
    const startMin = toMin(history!.start);
    const totalMin = (startMin ?? 0) + history!.dur;
    end = `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
  } else if (!isHist && task!.end) {
    end = task!.end;
  }

  const staff = staffId ? staffDirectory.get(staffId) : null;

  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside ref={panelRef} className="panel on" role="dialog" aria-label={t.pKicker} tabIndex={-1}>
        <div className="panel__h">
          <div className="panel__top">
            <span className="panel__kicker">
              {t.pKicker} · {buildingLabelOf(location, buildingLabels)}
            </span>
            <button type="button" className="panel__x" onClick={onClose} aria-label={t.close}>
              <X />
            </button>
          </div>
          <div className="panel__title" style={{ alignItems: "baseline", marginTop: 11 }}>
            <span className="panel__room">{bRoom(room)}</span>
            <span className="cpanel__type">
              <TypeIcon aria-hidden="true" />
              {typeLabel(type, t)}
            </span>
          </div>
          <div className="panel__chips" style={{ marginTop: 11 }}>
            <StatusPill status={status} t={t} />
            <ReportBadges reports={reports} t={t} />
          </div>
        </div>

        <div className="panel__body">
          <div className="pblock">
            <div className="pblock__t">{t.pInfo}</div>
            <div className="kv">
              <span className="kv__k">{t.pRoom}</span>
              <span className="kv__v">
                {buildingLabelOf(location, buildingLabels)} · {bRoom(room)}
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{t.pType}</span>
              <span className="kv__v">{typeLabel(type, t)}</span>
            </div>
            <div className="kv">
              <span className="kv__k">{t.pDate}</span>
              <span className="kv__v">{dateStr}</span>
            </div>
          </div>

          {start && end ? (
            <div className="pblock">
              <div className="pblock__t">{t.pTime}</div>
              <div className="timespan">
                <div className="timenode">
                  <div className="timenode__lbl">{t.startAt}</div>
                  <div className="timenode__t">{start}</div>
                </div>
                <div className="timemid">
                  <div className="timemid__n">{durLabel(dur, t)}</div>
                  <div className="timeline2" />
                </div>
                <div className="timenode">
                  <div className="timenode__lbl">{t.endAt}</div>
                  <div className="timenode__t">{end}</div>
                </div>
              </div>
              <div className="durbig" style={{ marginTop: 12 }}>
                <div className="durbig__v">{durLabel(dur, t)}</div>
                <span className="durbig__lbl">{t.duration}</span>
              </div>
            </div>
          ) : start && !closed ? (
            <div className="pblock">
              <div className="pblock__t">{t.pTime}</div>
              <div className="durbig">
                <div className="durbig__v">{start}</div>
                <span className="durbig__lbl">
                  {t.startAt} · {t.elapsed} {durLabel(task ? elapsedMin(task.start) : null, t)}
                </span>
              </div>
            </div>
          ) : null}

          {staff ? (
            <div className="pblock">
              <div className="pblock__t">{t.pStaff}</div>
              <div className="staffpill">
                <span className="staffpill__av" style={{ background: staff.bg }}>
                  {staff.name.slice(0, 1)}
                </span>
                <div>
                  <div className="staffpill__nm">{staffLabelOf(staff.id, staffDirectory)}</div>
                  <div className="staffpill__s">{t.pAssignee}</div>
                </div>
              </div>
              {proxy ? (
                <div className="proxynote" style={{ marginTop: 10 }}>
                  <span className="proxynote__ic">
                    <ShieldCheck aria-hidden="true" />
                  </span>
                  <div>
                    <div className="proxynote__t">{closed ? t.closedNote : t.proxy}</div>
                    <div className="proxynote__s">{closed ? t.closedNoteDesc : t.proxyNoteDesc}</div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {note ? (
            <div className="pblock">
              <div className="pblock__t">{t.pNote}</div>
              <div className="locknote">
                <Info className="ic" aria-hidden="true" />
                {note}
              </div>
            </div>
          ) : null}

          <div className="pblock">
            <div className="pblock__t">{t.pLinked}</div>
            {reports && (reports.lost || reports.issue) ? (
              <div className="rptiles">
                {reports.issue ? (
                  <button type="button" className="rptile rptile--issue" onClick={() => onOpenReport("issue")}>
                    <span className="rptile__ic">
                      <Wrench aria-hidden="true" />
                    </span>
                    <span className="rptile__b">
                      <span className="rptile__t">{t.pIssue}</span>
                      <span className="rptile__s">{reports.issue}</span>
                    </span>
                    <ChevronRight className="ic rptile__go" aria-hidden="true" />
                  </button>
                ) : null}
                {reports.lost ? (
                  <button type="button" className="rptile rptile--lost" onClick={() => onOpenReport("lost")}>
                    <span className="rptile__ic">
                      <PackageSearch aria-hidden="true" />
                    </span>
                    <span className="rptile__b">
                      <span className="rptile__t">{t.pLostItem}</span>
                      <span className="rptile__s">{reports.lost}</span>
                    </span>
                    <ChevronRight className="ic rptile__go" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="locknote">
                <Info className="ic" aria-hidden="true" />
                {t.noReports}
              </div>
            )}
          </div>
        </div>

        <div className="panel__foot">
          {/* 강제완료는 권한이 있는 역할에게만 노출한다. cs_staff/staff 는 예전엔 모달을 다 채운
              뒤에야 사유 없는 실패 토스트를 받았다. 서버(canForceCompleteCleaning)의 검사는
              그대로 남아 있으며 이 게이트는 UI 편의일 뿐이다. */}
          {canForceComplete && !isHist && status !== "done" ? (
            <>
              <button type="button" className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>
                {t.close}
              </button>
              <button
                type="button"
                className="btn btn--pri"
                style={{ flex: 1.4 }}
                onClick={() => task && onOpenForceComplete(task)}
              >
                {t.forceDone}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
              {t.close}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
