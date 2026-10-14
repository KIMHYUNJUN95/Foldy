"use client";

// Admin 주문·비품 console — 처리 창 8종(승인/거절/주문 처리/배송일 수정/다시 열기/상태 정정/요청 수정/삭제).
// 화이트 리디자인(2026-10-14, 시안 OrderAct-PC · OrderEdit-PC): 분실물 처리 창(.lfm)과 같은 껍데기 — 제목 ·
// 「제목 · 건물 · 품목 n · 총 m개」 · 설명 한 줄 → 칸 → [취소][확인]. × 없음, 닫기는 「취소」 하나(Esc · 바깥 누르기도 취소).
// 승인 · 다시 열기 창의 메모 칸은 서버가 받지 않아 뺐다(예전엔 입력해도 버려졌다). 주문 처리 창의 메모도 같은 이유로 뺐다.
// 배송일(주문 처리 · 배송일 수정)은 CLAUDE.md 4a 의 예외 — 하루/기간 토글이 필요해 창 안에 달력을 직접 그린다
// (공용 .calpop 과 같은 칸 크기 · 오늘 점 · 보라 선택). 달 이동은 shiftMonthKey().
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { AdminOrderVM } from "@/lib/admin-orders";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { LIST_STATUS, STATUS, dateToNum, fmtMonth, iso, tpl, WD, type OrderStatus } from "./orders-console-data";
import { copyOf, type OrdersCopy } from "./orders-console-shared";
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
};

type ActionModalProps = {
  kind: OrdActionKind;
  order: AdminOrderVM;
  t: OrdersCopy;
  locale: Locale;
  todayKey: string;
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

type CalMonth = { y: number; m: number };

function monthOf(key: string): CalMonth {
  return { y: +key.slice(0, 4), m: +key.slice(5, 7) - 1 };
}

function dayLabel(key: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(
    new Date(dateToNum(key) * 86400000),
  );
}

function DeliveryCalendar({
  t,
  locale,
  todayKey,
  mode,
  date,
  start,
  end,
  onPick,
}: {
  t: OrdersCopy;
  locale: Locale;
  todayKey: string;
  mode: "point" | "range";
  date: string | null;
  start: string | null;
  end: string | null;
  onPick: (key: string) => void;
}) {
  const [month, setMonth] = useState<CalMonth>(() => monthOf((mode === "range" ? start : date) ?? todayKey));
  const days = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const first = (new Date(Date.UTC(month.y, month.m, 1)).getUTCDay() + 6) % 7; // Mon = 0
  const wd = Array.from({ length: 7 }, (_, i) => WD[locale][(i + 1) % 7]);
  const mk = `${month.y}-${String(month.m + 1).padStart(2, "0")}`;
  const move = (delta: number) => setMonth(monthOf(`${shiftMonthKey(mk, delta)}-01`));

  return (
    <div className="owm-cal">
      <div className="owm-cal__h">
        <button type="button" className="ow-navb" aria-label={t.wPrevMonth} onClick={() => move(-1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <b className="num">{fmtMonth(month.y, month.m, locale)}</b>
        <button type="button" className="ow-navb" aria-label={t.wNextMonth} onClick={() => move(1)}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className="owm-cal__g owm-cal__wd">
        {wd.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="owm-cal__g">
        {Array.from({ length: first }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const key = iso(month.y, month.m, i + 1);
          const isEnd = mode === "point" ? key === date : key === start || key === end;
          const inRange = mode === "range" && start && end && key > start && key < end;
          return (
            <button
              key={key}
              type="button"
              className={`owm-day${isEnd ? " is-sel" : ""}${inRange ? " is-in" : ""}${key === todayKey ? " is-today" : ""}`}
              aria-pressed={isEnd}
              onClick={() => onPick(key)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function OrdersActionModal({
  kind,
  order,
  t,
  locale,
  todayKey,
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, pending]);

  function handlePick(key: string) {
    if (mode === "point") {
      setDate(key);
      return;
    }
    if (!start || (start && end)) {
      setStart(key);
      setEnd(null);
    } else if (key < start) {
      setEnd(start);
      setStart(key);
    } else {
      setEnd(key);
    }
  }

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
      onConfirm(kind, order.id, { title, urgency, reason, items: cleaned });
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

  const delivText =
    mode === "point"
      ? date
        ? dayLabel(date, locale)
        : ""
      : start
        ? end
          ? `${dayLabel(start, locale)} – ${dayLabel(end, locale)}`
          : `${dayLabel(start, locale)} – ${t.wPickEnd}`
        : "";

  const sub =
    kind === "edit"
      ? `${order.title} · ${order.buildingLabel} · ${order.reporterName}`
      : tpl(t.wModalSub, { title: order.title, bld: order.buildingLabel, n: order.items.length, q: order.totalQty });

  return (
    <>
      <div className="modal-scrim on" onClick={pending ? undefined : onCancel} />
      <div
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
            <label className="lfm__nf">
              <span className="lfm__nl">{mode === "point" ? t.wDateField : t.wRange}</span>
              <input readOnly value={delivText} />
            </label>
            <DeliveryCalendar t={t} locale={locale} todayKey={todayKey} mode={mode} date={date} start={start} end={end} onPick={handlePick} />
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
                <span className="num">{tpl(t.wPhotosKept, { n: items.length })}</span>
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
              {items.length < 40 ? (
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
