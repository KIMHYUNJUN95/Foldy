"use client";

// Admin 분실물 console — 우측 상세 패널. 화이트 리디자인(2026-10-14, 시안 LF-PC · LFReturn-PC): 위 한 줄(임박 · 상태 ·
// 분류) + 삭제 · 닫기, 제목, 사진, 진행 중이면 「자동 폐기까지 D-n」 막대, 정보 줄. 아래는 진행 중이면
// [반환 처리] · [보관 연장 | 폐기 처리] · 상태 정정, 완료면 「관리자 예외 개입」 복원. 상자 · 칩 없음.
import Image from "next/image";
import { RotateCcw, Trash2, X } from "lucide-react";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import type { Locale } from "@/lib/i18n";
import type { AdminLostItemVM } from "@/lib/admin-lost-found";
import { localizeLostFoundMemo } from "@/lib/lost-found-memo";
import { fmtDate, fmtDateTime, isActive, tpl } from "./lost-found-console-data";
import { categoryLabel, statusLabel, type LFCopy } from "./lost-found-console-shared";
import { dueText, storageTotal } from "./lost-found-board";

export type LFActionKind = "return" | "dispose" | "extend" | "correct" | "restore" | "delete";

type PanelProps = {
  item: AdminLostItemVM | null;
  t: LFCopy;
  adminRestoreLabel: string;
  autoDisposeLabel: string;
  locale: Locale;
  onClose: () => void;
  onAction: (kind: LFActionKind, id: string) => void;
  disabled?: boolean;
};

function Gallery({ urls }: { urls: readonly string[] }) {
  return (
    <div className="lfp__gal">
      {urls.map((url) => (
        <a className="lfp__shot" href={url} key={url} rel="noreferrer" target="_blank">
          <Image alt="" src={url} fill sizes="170px" />
        </a>
      ))}
    </div>
  );
}

export function LostFoundDetailPanel({ item, t, adminRestoreLabel, autoDisposeLabel, locale, onClose, onAction, disabled }: PanelProps) {
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled });
  if (!item) return null;

  const active = isActive(item);
  const flag = active && item.isExpired ? t.expiredFlag : active && item.isDueSoon ? t.soonFlag : null;
  const total = storageTotal(item);
  const pct = Math.min(100, Math.round((item.storedDays / total) * 100));
  const guest = item.guest
    ? t.guestStay
        .replace("{name}", item.guest.name)
        .replace("{in}", fmtDate(item.guest.checkIn, locale))
        .replace("{out}", fmtDate(item.guest.checkOut, locale))
    : null;
  const memo = item.handlingMemo ? localizeLostFoundMemo(item.handlingMemo, adminRestoreLabel, autoDisposeLabel) : null;

  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside ref={panelRef} className="panel on lfp" role="dialog" aria-label={t.pKicker} tabIndex={-1}>
        <div className="panel__h">
          <div className="panel__top">
            <span className="lfp__kick">
              {flag ? <span className="lfp__flag">{flag}</span> : null}
              {flag && item.status === "disposal_scheduled" ? null : (
                <span className={`lfp__st is-${item.status}`}>{statusLabel(item.status, t)}</span>
              )}
              {item.status === "returned" && item.returnMethod ? (
                <span>{item.returnMethod === "delivery" ? t.methodDelivery : t.methodPickup}</span>
              ) : null}
              {item.isExtended && active ? <span>{t.extended}</span> : null}
              <span>{categoryLabel(item.category, t)}</span>
            </span>
            <span className="lfp__acts">
              <button type="button" className="lfp__del" title={t.del} aria-label={t.del} onClick={() => onAction("delete", item.id)}>
                <Trash2 aria-hidden="true" />
              </button>
              <button type="button" className="panel__x" onClick={onClose} aria-label={t.close}>
                <X />
              </button>
            </span>
          </div>
          <div className="lfp__title">{item.itemName}</div>
          <div className="lfp__sub">
            {item.room ? <b className="mono">{item.room}</b> : <b>{t.buildingWhole}</b>} · {item.buildingLabel}
          </div>
        </div>

        <div className="panel__body lfp__body">
          {item.photos.length ? <Gallery urls={item.photos} /> : <p className="lfp__dim">{t.noPhoto}</p>}

          {active ? (
            <div className="lfp__clock">
              <div className="lfp__clockh">
                <span>{t.autoDueIn}</span>
                <b className={item.isDueSoon || item.isExpired ? "is-soon" : ""}>{dueText(item, t, locale)}</b>
              </div>
              <span className="lfw-bar lfw-bar--lg">
                <i className={item.isExtended && !item.isDueSoon ? "is-ext" : ""} style={{ width: `${pct}%` }} />
              </span>
              <span className="lfp__clocks">
                {tpl(t.regOn, fmtDate(item.foundAt.split(" ")[0], locale))} · {tpl(t.storedNth, item.storedDays)} ·{" "}
                {tpl(t.dueOnDate, fmtDate(item.dueDate, locale))}
              </span>
            </div>
          ) : null}

          <dl className="lfp__dl">
            {!active ? (
              <>
                <dt>{t.pClosedAt}</dt>
                <dd>
                  {fmtDateTime(item.handledAt, locale)} · {item.handledByName ?? t.sysAuto}
                </dd>
                {item.status === "returned" && item.returnTrackingNo ? (
                  <>
                    <dt>{t.pTracking}</dt>
                    <dd className="mono">{item.returnTrackingNo}</dd>
                  </>
                ) : null}
                {item.status === "disposed" && item.deleteDate ? (
                  <>
                    <dt>{t.pDelDate}</dt>
                    <dd className={item.isDeleteSoon ? "lfp__danger" : ""}>
                      {tpl(t.delIn, fmtDate(item.deleteDate, locale))} · {tpl(t.delDaysLeft, item.deleteDaysLeft ?? 0)}
                    </dd>
                  </>
                ) : null}
              </>
            ) : null}
            <dt>{t.guestShort}</dt>
            <dd>{guest ?? <span className="lfp__muted">—</span>}</dd>
            <dt>{t.pReporter}</dt>
            <dd>
              {item.reporterName} · {fmtDateTime(item.foundAt, locale)}
            </dd>
            {item.isExtended && item.holdReason ? (
              <>
                <dt>{t.pExtReason}</dt>
                <dd>{item.holdReason}</dd>
              </>
            ) : null}
            <dt>{t.memoShort}</dt>
            <dd>{item.description || <span className="lfp__muted">—</span>}</dd>
            {!active ? (
              <>
                <dt>{t.pCloseMemo}</dt>
                <dd>{memo ?? <span className="lfp__muted">{t.noMemo}</span>}</dd>
              </>
            ) : null}
          </dl>

          {!active && item.handlingPhotos.length ? (
            <>
              <div className="lfp__sec">{t.pResPhotos}</div>
              <Gallery urls={item.handlingPhotos} />
            </>
          ) : null}
        </div>

        <div className="panel__foot lfp__foot">
          {active ? (
            <>
              <button type="button" className="btn btn--pri lfp__main" onClick={() => onAction("return", item.id)}>
                {t.actReturn}
              </button>
              <div className="lfp__two">
                <button type="button" className="btn lfp__soft" onClick={() => onAction("extend", item.id)}>
                  {t.actExtend}
                </button>
                <button type="button" className="btn lfp__gray" onClick={() => onAction("dispose", item.id)}>
                  {t.actDispose}
                </button>
              </div>
              <button type="button" className="lfp__link" onClick={() => onAction("correct", item.id)}>
                <RotateCcw aria-hidden="true" />
                {t.actCorrect}
              </button>
            </>
          ) : (
            <>
              <span className="lfp__exc">{t.exceptionT}</span>
              <button type="button" className="btn lfp__gray lfp__restore" onClick={() => onAction("restore", item.id)}>
                <RotateCcw aria-hidden="true" />
                {t.mrsConfirm}
              </button>
              <span className="lfp__note">{t.restoreNote}</span>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
