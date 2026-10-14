"use client";

// Admin 주문·비품 console — 우측 상세 패널. 화이트 리디자인(2026-10-14, 시안 Order-PC · OrderAll-PC):
// 위 한 줄(긴급 · 상태) + 삭제(빨간 휴지통) · 닫기 → 제목 → 「건물 · 요청자 · 요청 시각」 → 품목(사진 · 이름 ·
// 상품 링크 · 메모 · 수량) → 사유 · 거절 사유 · 배송 예정. 아래: 승인 대기 = [거절][승인], 주문 대기 = [거절][주문 처리],
// 주문 처리됨 = [배송일 수정], 거절 = 「관리자 예외 개입」 [다시 열기]. 모두 아래에 요청 수정 · 상태 정정 글자 버튼.
// 상자 · 칩 · 진행 막대 없음(상태는 위 글자가 이미 말한다 — hallmark 위계 점검).
import Image from "next/image";
import { ExternalLink, ImageIcon, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import type { Locale } from "@/lib/i18n";
import type { AdminOrderVM, OrderItemVM } from "@/lib/admin-orders";
import { STATUS, dateToNum, fmtDateTime, tpl } from "./orders-console-data";
import { copyOf, type OrdersCopy } from "./orders-console-shared";

export type OrdActionKind = "approve" | "reject" | "process" | "editdeliv" | "reopen" | "correct" | "edit" | "delete";

type PanelProps = {
  order: AdminOrderVM | null;
  t: OrdersCopy;
  locale: Locale;
  todayKey: string;
  onClose: () => void;
  onAction: (kind: OrdActionKind, id: string) => void;
  disabled?: boolean;
};

function linkHost(link: string): string {
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, "");
    return host === "ikea.com" && u.pathname.startsWith("/jp") ? "ikea.com/jp" : host;
  } catch {
    return link;
  }
}

function isHttp(link: string): boolean {
  try {
    const u = new URL(link);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function dayLabel(key: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(
    new Date(dateToNum(key) * 86400000),
  );
}

function ItemRow({ it }: { it: OrderItemVM }) {
  const thumb = it.photoUrls[0];
  return (
    <div className="ow-item">
      {thumb ? (
        <a className="ow-item__ph" href={thumb} target="_blank" rel="noreferrer">
          <Image alt="" src={thumb} fill sizes="40px" />
          {it.photoUrls.length > 1 ? <span className="ow-item__phn num">{it.photoUrls.length}</span> : null}
        </a>
      ) : (
        <span className="ow-item__ph is-none" aria-hidden="true">
          <ImageIcon />
        </span>
      )}
      <span className="ow-item__b">
        <span className="ow-item__n">{it.name}</span>
        {it.link || it.memo ? (
          <span className="ow-item__s">
            {it.link && isHttp(it.link) ? (
              <a href={it.link} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                {linkHost(it.link)}
              </a>
            ) : null}
            {it.memo ? <span className="ow-item__m">{it.memo}</span> : null}
          </span>
        ) : null}
      </span>
      <span className="ow-item__q num">× {it.qty}</span>
    </div>
  );
}

export function OrdersDetailPanel({ order, t, locale, onClose, onAction, disabled }: PanelProps) {
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled });
  if (!order) return null;

  const statusText = order.status === "closed" ? t.wStClosed : copyOf(t, STATUS[order.status].key);
  const deliv = order.deliv
    ? order.deliv.mode === "range"
      ? `${dayLabel(order.deliv.start, locale)} – ${dayLabel(order.deliv.end, locale)}`
      : dayLabel(order.deliv.date, locale)
    : null;

  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside ref={panelRef} className="panel on lfp owp" role="dialog" aria-label={t.pKicker} tabIndex={-1}>
        <div className="panel__h">
          <div className="panel__top">
            <span className="lfp__kick">
              {order.urgency === "high" ? <span className="lfp__flag">{t.urgent}</span> : null}
              <span>{statusText}</span>
            </span>
            <span className="lfp__acts">
              <button type="button" className="lfp__del" title={t.del} aria-label={t.del} onClick={() => onAction("delete", order.id)}>
                <Trash2 aria-hidden="true" />
              </button>
              <button type="button" className="panel__x" onClick={onClose} aria-label={t.close}>
                <X />
              </button>
            </span>
          </div>
          <div className="lfp__title">{order.title}</div>
          <div className="lfp__sub">
            {order.buildingLabel}
            {order.room ? ` · ${order.room}` : ""} · {order.reporterName} · {fmtDateTime(order.reqAt, locale)}
          </div>
        </div>

        <div className="panel__body lfp__body">
          <div className="ow-items">
            <div className="ow-items__h">
              <b>{t.wItems}</b>
              <span className="num">{tpl(t.wItemCount, { n: order.items.length })}</span>
            </div>
            {order.items.map((it, i) => (
              <ItemRow key={`${it.name}-${i}`} it={it} />
            ))}
          </div>

          <dl className="lfp__dl">
            {order.reason ? (
              <>
                <dt>{t.wReason}</dt>
                <dd>{order.reason}</dd>
              </>
            ) : null}
            {order.status === "closed" && order.closedMemo ? (
              <>
                <dt>{t.mrReason}</dt>
                <dd>{order.closedMemo}</dd>
              </>
            ) : null}
            {order.status !== "closed" ? (
              <>
                <dt>{t.wDelivLabel}</dt>
                <dd className={deliv ? "" : "lfp__muted"}>{deliv ?? t.wDelivTbd}</dd>
              </>
            ) : null}
          </dl>
        </div>

        <div className="panel__foot lfp__foot">
          {order.status === "requested" || order.status === "approved" ? (
            <div className="lfp__two ow-two">
              <button type="button" className="btn lfp__gray" onClick={() => onAction("reject", order.id)}>
                {t.actReject}
              </button>
              <button
                type="button"
                className="btn btn--pri lfp__main"
                onClick={() => onAction(order.status === "requested" ? "approve" : "process", order.id)}
              >
                {order.status === "requested" ? t.actApprove : t.actProcess}
              </button>
            </div>
          ) : null}
          {order.status === "ordered" ? (
            <button type="button" className="btn lfp__soft lfp__restore" onClick={() => onAction("editdeliv", order.id)}>
              {t.actEditDeliv}
            </button>
          ) : null}
          {order.status === "closed" ? (
            <>
              <span className="lfp__exc">{t.wExcT}</span>
              <button type="button" className="btn lfp__gray lfp__restore" onClick={() => onAction("reopen", order.id)}>
                <RotateCcw aria-hidden="true" />
                {t.wReopen}
              </button>
              <span className="lfp__note ow-note">{t.wReopenNote}</span>
            </>
          ) : null}
          <div className="ow-links">
            <button type="button" className="lfp__link" onClick={() => onAction("edit", order.id)}>
              <Pencil aria-hidden="true" />
              {t.actEdit}
            </button>
            <button type="button" className="lfp__link" onClick={() => onAction("correct", order.id)}>
              <RotateCcw aria-hidden="true" />
              {t.actCorrect}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
