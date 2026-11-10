"use client";

// Admin 주문·비품 console — 처리 창 8종(승인/거절/주문 처리/배송일 수정/다시 열기/상태 정정/요청 수정/삭제).
// 화이트 리디자인(2026-10-14, 시안 OrderAct-PC · OrderEdit-PC): 분실물 처리 창(.lfm)과 같은 껍데기 — 제목 ·
// 「제목 · 건물 · 품목 n · 총 m개」 · 설명 한 줄 → 칸 → [취소][확인]. × 없음, 닫기는 「취소」 하나(Esc · 바깥 누르기도 취소).
// 승인 · 다시 열기 창의 메모 칸은 서버가 받지 않아 뺐다(예전엔 입력해도 버려졌다). 주문 처리 창의 메모도 같은 이유로 뺐다.
// 배송일(주문 처리 · 배송일 수정)은 하루/기간 토글 + 공용 달력 — 하루는 `AdminDatePicker`, 기간은 `AdminDateRangePicker`
// (CLAUDE.md 4a, 2026-11-10: 예전엔 창 안에 달력을 따로 그렸다).
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AdminDatePicker } from "@/components/admin/shared/admin-date-picker";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { AdminOrderVM } from "@/lib/admin-orders";
import { ORDER_ITEM_LIMITS } from "@/lib/order-item-rules";
import { LIST_STATUS, STATUS, tpl, type OrderStatus } from "./orders-console-data";
import { copyOf, localeTagOf, type OrdersCopy } from "./orders-console-shared";
import type { OrdActionKind } from "./orders-detail-panel";

export type OrdActionPayload = {
  memo?: string;
  mode?: "point" | "range";
  date?: string;
  start?: string;
  end?: string;
  newStatus?: OrderStatus;
  title?: string;
  urgency?: "high" | "normal";
  reason?: string;
  items?: { name: string; qty: string; link: string; memo: string }[];
  /** 요청 수정 — 창을 연 때 본 주문의 `updated_at`(그 사이 바뀌었으면 서버가 stale). */
  expectedUpdatedAt?: string;
};

type ActionModalProps = {
  kind: OrdActionKind;
  order: AdminOrderVM;
  t: OrdersCopy;
  locale: Locale;
  todayKey: string;
  /** 공용 달력 문구(`dictionary.admin.shared`). */
  shared: Dictionary["admin"]["shared"];
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (kind: OrdActionKind, id: string, payload: OrdActionPayload) => void;
  onValidationError: (message: string) => void;
};

const KIND_META: Record<OrdActionKind, { title: string; body: string; confirm: string; tone: "pri" | "danger" }> = {
  approve: { title: "actApprove", body: "wApproveBody", confirm: "actApprove", tone: "pri" },
  reject: { title: "actReject", body: "wRejectBody", confirm: "actReject", tone: "danger" },
  process: { title: "actProcess", body: "wProcessBody", confirm: "actProcess", tone: "pri" },
  editdeliv: { title: "actEditDeliv", body: "wEditDelivBody", confirm: "meConfirm", tone: "pri" },
  reopen: { title: "wReopen", body: "wReopenBody", confirm: "wReopen", tone: "pri" },
  correct: { title: "actCorrect", body: "wCorrectBody", confirm: "mcConfirm", tone: "pri" },
  edit: { title: "actEdit", body: "", confirm: "wSave", tone: "pri" },
  delete: { title: "del", body: "wDeleteBody", confirm: "del", tone: "danger" },
};

export function OrdersActionModal({
  kind,
  order,
  t,
  locale,
  todayKey,
  shared,
  pending,
  onCancel,
  onConfirm,
  onValidationError,
}: ActionModalProps) {
  const meta = KIND_META[kind];
  const isDeliv = kind === "process" || kind === "editdeliv";

  const [memo, setMemo] = useState("");
  const [mode, setMode] = useState<"point" | "range">(
    kind === "editdeliv" && order.deliv?.mode === "range" ? "range" : "point",
  );
  const [date, setDate] = useState<string | null>(() => {
    if (kind === "process") return todayKey;
    if (kind === "editdeliv") return order.deliv?.mode === "point" ? order.deliv.date : order.deliv ? null : todayKey;
    return null;
  });
  const [start, setStart] = useState<string | null>(
    kind === "editdeliv" && order.deliv?.mode === "range" ? order.deliv.start : null,
  );
  const [end, setEnd] = useState<string | null>(
    kind === "editdeliv" && order.deliv?.mode === "range" ? order.deliv.end : null,
  );
  const [newStatus, setNewStatus] = useState<OrderStatus>(order.status);
  const [title, setTitle] = useState(order.title);
  const [urgency, setUrgency] = useState<"high" | "normal">(order.urgency);
  const [reason, setReason] = useState(order.reason);
  const [items, setItems] = useState(() => order.items.map((it) => ({ name: it.name, qty: it.qty, link: it.link, memo: it.memo })));

  const modalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || pending) return;
      // 날짜 피커(하루 `.adp__pop` · 기간 `.calpop`)가 열려 있으면 Esc 는 피커만 닫는다 — 피커가 document 에서 받아 닫으므로 창은
      // 그대로 둔다. 캡처 단계(window)라 피커가 닫히기 전에 열려 있는지 볼 수 있다(2026-11-10).
      if (modalRef.current?.querySelector(".adp__pop, .calpop")) return;
      onCancel();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, pending]);

  function updateItem(index: number, key: "name" | "qty" | "link" | "memo", value: string) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [key]: value } : it)));
  }

  function handleConfirm() {
    if (kind === "reject" || kind === "correct") {
      if (kind === "reject") onConfirm(kind, order.id, { memo });
      else onConfirm(kind, order.id, { newStatus, memo });
      return;
    }
    if (kind === "edit") {
      const cleaned = items.filter((it) => it.name.trim().length > 0);
      if (cleaned.length === 0) {
        onValidationError(t.edNeedItem);
        return;
      }
      onConfirm(kind, order.id, { title, urgency, reason, items: cleaned, expectedUpdatedAt: order.updatedAt });
      return;
    }
    if (isDeliv) {
      if (mode === "range" ? !start || !end : !date) {
        onValidationError(t.mpNeedDate);
        return;
      }
      onConfirm(kind, order.id, {
        mode,
        date: date ?? undefined,
        start: start ?? undefined,
        end: end ?? undefined,
      });
      return;
    }
    onConfirm(kind, order.id, {});
  }

  const sub =
    kind === "edit"
      ? `${order.title} · ${order.buildingLabel} · ${order.reporterName}`
      : tpl(t.wModalSub, { title: order.title, bld: order.buildingLabel, n: order.items.length, q: order.totalQty });

  return (
    <>
      <div className="modal-scrim on" onClick={pending ? undefined : onCancel} />
      <div
        ref={modalRef}
        className={`modal on lfm owm${isDeliv ? " owm--deliv" : ""}${kind === "edit" ? " owm--edit" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="owm-title"
      >
        <div className="lfm__h">
          <h2 id="owm-title">{copyOf(t, meta.title)}</h2>
          <span>{sub}</span>
        </div>
        {meta.body ? <p className="lfm__body">{copyOf(t, meta.body)}</p> : null}

        {isDeliv ? (
          <>
            <div className="owm-row">
              <span className="lfm__lbl owm-lbl">{t.wDelivDate}</span>
              <div className="lfm__seg owm-seg" role="radiogroup" aria-label={t.wDelivDate}>
                {(["point", "range"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                    {m === "point" ? t.wDay : t.wRange}
                  </button>
                ))}
              </div>
            </div>
            <div className="lfm__nf lfm__nf--date owm-date">
              <span className="lfm__nl">{mode === "point" ? t.wDateField : t.wRange}</span>
              {mode === "point" ? (
                <AdminDatePicker
                  value={date ?? ""}
                  onChange={(value) => setDate(value || null)}
                  localeTag={localeTagOf(locale)}
                  ariaLabel={t.wDateField}
                  placeholder={t.wDateField}
                  labels={{ prevMonth: shared.datePrevMonth, nextMonth: shared.dateNextMonth, today: shared.dateToday }}
                />
              ) : (
                <AdminDateRangePicker
                  from={start ?? ""}
                  to={end ?? ""}
                  onChange={(from, to) => {
                    setStart(from || null);
                    setEnd(to || null);
                  }}
                  localeTag={localeTagOf(locale)}
                  ariaLabel={t.wRange}
                  emptyLabel={t.wRange}
                  labels={{
                    prevMonth: shared.datePrevMonth,
                    nextMonth: shared.dateNextMonth,
                    thisMonth: shared.dateThisMonth,
                    reset: shared.dateReset,
                    apply: shared.dateApply,
                    pickYear: shared.datePickYear,
                    pickMonth: shared.datePickMonth,
                    typeStart: shared.dateTypeStart,
                    typeEnd: shared.dateTypeEnd,
                  }}
                />
              )}
            </div>
          </>
        ) : null}

        {kind === "reject" ? (
          <label className="lfm__nf">
            <span className="lfm__nl">{t.mrReason}</span>
            <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t.mrReasonPh} />
          </label>
        ) : null}

        {kind === "correct" ? (
          <>
            <div className="lfm__lbl">{t.mcStatus}</div>
            <div className="lfm__seg owm-seg4" role="radiogroup" aria-label={t.mcStatus}>
              {LIST_STATUS.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={newStatus === s} className={newStatus === s ? "on" : ""} onClick={() => setNewStatus(s)}>
                  {s === "closed" ? t.wStClosed : copyOf(t, STATUS[s].key)}
                </button>
              ))}
            </div>
            <label className="lfm__nf">
              <span className="lfm__nl">{t.mcMemo}</span>
              <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t.mcMemoPh} />
            </label>
          </>
        ) : null}

        {kind === "edit" ? (
          <>
            <div className="owm-row">
              <label className="lfm__nf owm-grow">
                <span className="lfm__nl">{t.edTitle}</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <div className="lfm__seg owm-seg" role="radiogroup" aria-label={t.edUrgency}>
                {(["normal", "high"] as const).map((u) => (
                  <button key={u} type="button" role="radio" aria-checked={urgency === u} className={urgency === u ? "on" : ""} onClick={() => setUrgency(u)}>
                    {u === "normal" ? t.normal : t.urgent}
                  </button>
                ))}
              </div>
            </div>
            <div className="owm-items">
              <div className="owm-items__h">
                <b>{t.wItems}</b>
                <span className="num">{tpl(t.wPhotosKept, { n: items.length, max: ORDER_ITEM_LIMITS.maxItems })}</span>
              </div>
              {items.map((it, i) => (
                <div className="owm-item" key={i}>
                  <div className="owm-item__top">
                    <label className="lfm__nf">
                      <span className="lfm__nl">{t.wItemName}</span>
                      <input value={it.name} onChange={(e) => updateItem(i, "name", e.target.value)} placeholder={t.edNamePh} />
                    </label>
                    <label className="lfm__nf owm-qty">
                      <span className="lfm__nl">{t.wQty}</span>
                      <input inputMode="numeric" value={it.qty} onChange={(e) => updateItem(i, "qty", e.target.value)} placeholder={t.edQtyPh} />
                    </label>
                    <button
                      type="button"
                      className="owm-rm"
                      aria-label={t.wRemoveItem}
                      title={t.wRemoveItem}
                      onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                  <div className="owm-item__sub">
                    <label className="lfm__nf">
                      <span className="lfm__nl">{t.wLink}</span>
                      <input value={it.link} onChange={(e) => updateItem(i, "link", e.target.value)} placeholder={t.edLinkPh} />
                    </label>
                    <label className="lfm__nf">
                      <span className="lfm__nl">{t.wMemo}</span>
                      <input value={it.memo} onChange={(e) => updateItem(i, "memo", e.target.value)} placeholder={t.edMemoPh} />
                    </label>
                  </div>
                </div>
              ))}
              {items.length < ORDER_ITEM_LIMITS.maxItems ? (
                <button
                  type="button"
                  className="owm-add"
                  onClick={() => setItems((prev) => [...prev, { name: "", qty: "1", link: "", memo: "" }])}
                >
                  <Plus aria-hidden="true" />
                  {t.edAddItem}
                </button>
              ) : null}
            </div>
            <label className="lfm__nf">
              <span className="lfm__nl">{t.wReasonOpt}</span>
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.edReasonPh} />
            </label>
          </>
        ) : null}

        <div className="lfm__foot">
          <button type="button" className="btn lfm__cancel" onClick={onCancel} disabled={pending}>
            {t.cfCancel}
          </button>
          <button type="button" className={`btn lfm__ok is-${meta.tone}`} disabled={pending} onClick={handleConfirm}>
            {copyOf(t, meta.confirm)}
          </button>
        </div>
      </div>
    </>
  );
}
