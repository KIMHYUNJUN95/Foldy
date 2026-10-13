"use client";

// Admin 수리·점검 console — 우측 상세 패널. Read-centric: 처리(확인·상태 변경·메모)는 현장 모바일이
// 담당하고, 여기서는 기록 열람 + 관리자 예외 개입(강제 완료 / 무효 / 삭제)만 한다.
// Mirrors maint-views.js panel().
import Image from "next/image";
import { Trash2, TriangleAlert, X } from "lucide-react";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import type { Locale } from "@/lib/i18n";
import type { AdminMaintenanceReport } from "@/lib/admin-maintenance";
import { fmtDate, fmtDateTime, fmtElapsed, isActive } from "./maintenance-console-data";
import { categoryLabel, priorityLabel, statusLabel, type MaintCopy } from "./maintenance-console-shared";

export type MaintExceptionKind = "force" | "void" | "del";

type PanelProps = {
  report: AdminMaintenanceReport | null;
  t: MaintCopy;
  locale: Locale;
  onClose: () => void;
  onException: (kind: MaintExceptionKind, id: string) => void;
  onOpenLink: (kind: "clean" | "resv") => void;
  disabled?: boolean;
};

export function MaintenanceDetailPanel({
  report,
  t,
  locale,
  onClose,
  onException,
  onOpenLink,
  disabled,
}: PanelProps) {
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled });
  if (!report) return null;

  const occupied = report.occupied;
  const aging = report.aging;
  const canAct = isActive(report);

  const resv = report.link.reservation;
  const clean = report.link.cleaning;

  // 화이트 리디자인(2026-10-13, 시안 Maint-PC 오른쪽 패널): 위 한 줄(우선순위 · 상태 · 분류) + 삭제 · 닫기 → 제목 → 호실 · 건물 →
  // 재실 경고 한 줄 → 사진 → 설명 → 정보 줄(신고자 · 접수 · 연동 · 처리 메모) → 아래 관리자 예외 개입(강제 완료 · 무효). 칩 · 상자 · 아래 닫기 버튼 제거.
  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside ref={panelRef} className="panel on mwp" role="dialog" aria-label={t.pKicker} tabIndex={-1}>
        <div className="panel__h">
          <div className="panel__top">
            <span className="mwp__kick">
              <span className={`mwp__pri is-${report.priority}`}>{priorityLabel(report.priority, t)}</span>
              <span>{statusLabel(report.status, t)}</span>
              <span>{categoryLabel(report.category, t)}</span>
            </span>
            <span className="mwp__acts">
              <button type="button" className="mwp__del" title={t.del} aria-label={t.del} onClick={() => onException("del", report.id)}>
                <Trash2 aria-hidden="true" />
              </button>
              <button type="button" className="panel__x" onClick={onClose} aria-label={t.close}>
                <X />
              </button>
            </span>
          </div>
          <div className="mwp__title">{report.title}</div>
          <div className="mwp__sub">
            {report.room ? <b className="mono">{report.room}</b> : <b>{t.buildingOnly}</b>} · {report.buildingLabel}
            {aging ? <span className="mwp__aging"> · {t.oldFlag}</span> : null}
          </div>
        </div>

        <div className="panel__body mwp__body">
          {occupied ? (
            <p className="mwp__warn">
              <TriangleAlert aria-hidden="true" />
              <span>
                {t.occupied}
                {resv ? ` · ${resv.guest} (${fmtDate(resv.checkIn, locale)} – ${fmtDate(resv.checkOut, locale)})` : ""}. {t.occNote}
              </span>
            </p>
          ) : null}

          {report.photos.length ? (
            <div className="mwp__gal">
              {report.photos.map((url) => (
                <a className="mwp__shot" href={url} key={url} rel="noreferrer" target="_blank">
                  <Image alt="" src={url} fill sizes="160px" />
                </a>
              ))}
            </div>
          ) : (
            <p className="mwp__dim">{t.noPhoto}</p>
          )}

          <p className="mwp__desc">{report.description || "—"}</p>

          <dl className="mwp__dl">
            <dt>{t.pReporter}</dt>
            <dd>{report.reporterName}</dd>
            <dt>{t.pReportedAt}</dt>
            <dd>
              {fmtDateTime(report.createdAt, locale)}
              {canAct ? <span className="mwp__muted"> · {fmtElapsed(report.createdAt, locale)}</span> : null}
            </dd>
            {report.completedAt ? (
              <>
                <dt>{t.pCompletedAt}</dt>
                <dd>
                  {fmtDateTime(report.completedAt, locale)}
                  {report.completedByName ? <span className="mwp__muted"> · {report.completedByName}</span> : null}
                </dd>
              </>
            ) : null}
            <dt>{t.pLinked}</dt>
            <dd>
              {clean ? (
                <button type="button" className="mwp__link" onClick={() => onOpenLink("clean")}>
                  {t.pCleaning} · {clean.room} {fmtDate(clean.date, locale)}
                </button>
              ) : null}
              {clean && resv ? <br /> : null}
              {resv && !occupied ? (
                <button type="button" className="mwp__link" onClick={() => onOpenLink("resv")}>
                  {t.pReservation} · {resv.guest}
                </button>
              ) : null}
              {!clean && (!resv || occupied) ? <span className="mwp__muted">{t.noLinked}</span> : null}
            </dd>
            <dt>{t.pMemo}</dt>
            <dd>{report.memo ? report.memo : <span className="mwp__muted">{t.noMemo}</span>}</dd>
          </dl>

          {report.status === "closed" ? (
            <>
              <div className="mwp__sec">{t.pResPhotos}</div>
              {report.resolutionPhotos.length ? (
                <div className="mwp__gal">
                  {report.resolutionPhotos.map((url) => (
                    <a className="mwp__shot" href={url} key={url} rel="noreferrer" target="_blank">
                      <Image alt="" src={url} fill sizes="160px" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="mwp__dim">{t.noResPhoto}</p>
              )}
            </>
          ) : null}
        </div>

        {canAct ? (
          <div className="panel__foot mwp__foot">
            <div className="mwp__exc">
              <b>{t.exceptionT}</b>
              <span>{t.exceptionS}</span>
            </div>
            <div className="mwp__btns">
              <button type="button" className="btn btn--pri" onClick={() => onException("force", report.id)}>
                {t.forceClose}
              </button>
              <button type="button" className="btn mwp__void" onClick={() => onException("void", report.id)}>
                {t.voidReport}
              </button>
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}
