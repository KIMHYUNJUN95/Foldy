"use client";

// Admin 분실물 console — 처리 창 6종(반환 · 폐기 · 보관 연장 · 상태 정정 · 복원 · 삭제). 화이트 리디자인(2026-10-14,
// 시안 LFAct-PC): 제목 · 품목 한 줄, 설명 한 줄, 이름표 칸(송장번호 · 메모 · 새 예정일), 아래 [취소][확인] 두 개.
// 닫기는 「취소」 하나뿐(× 없음) · Esc · 바깥 누르기도 취소.
import { useEffect, useState } from "react";
import { AdminDatePicker } from "@/components/admin/shared/admin-date-picker";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { AdminLostItemVM } from "@/lib/admin-lost-found";
import type { LostItemStatus, LostReturnMethod } from "@/lib/lost-found-constants";
import { tokyoToday } from "@/lib/tokyo-date";
import { BOARD_ORDER, LOST_STATUS } from "./lost-found-console-data";
import { copyOf, localeTagOf, type LFCopy } from "./lost-found-console-shared";
import type { LFActionKind } from "./lost-found-detail-panel";

export type LFActionPayload = {
  memo?: string;
  method?: LostReturnMethod;
  tracking?: string;
  dueDate?: string;
  status?: LostItemStatus;
};

type ActionModalProps = {
  kind: LFActionKind;
  item: AdminLostItemVM;
  t: LFCopy;
  locale: Locale;
  sharedLabels?: Dictionary["admin"]["shared"];
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (kind: LFActionKind, id: string, payload: LFActionPayload) => void;
};

const KIND_META = {
  return: { title: "actReturn", body: "mrBody", confirm: "mrConfirm", memo: "cfMemo", ph: "cfMemoPh", tone: "pri" },
  dispose: { title: "actDispose", body: "mdBody", confirm: "mdConfirm", memo: "mdMemo", ph: "mdMemoPh", tone: "danger" },
  extend: { title: "actExtend", body: "meBody", confirm: "meConfirm", memo: "meMemo", ph: "meMemoPh", tone: "pri" },
  correct: { title: "actCorrect", body: "mcBody", confirm: "mcConfirm", memo: "mcMemo", ph: "mcMemoPh", tone: "pri" },
  restore: { title: "actRestore", body: "mrsBody", confirm: "mrsConfirm", memo: "mrsMemo", ph: "mrsMemoPh", tone: "pri" },
  delete: { title: "del", body: "mxBody", confirm: "mxConfirm", memo: null, ph: null, tone: "danger" },
} as const;

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function LostFoundActionModal({ kind, item, t, locale, sharedLabels, pending, onCancel, onConfirm }: ActionModalProps) {
  const meta = KIND_META[kind];
  const [memo, setMemo] = useState("");
  const [method, setMethod] = useState<LostReturnMethod>("pickup");
  const [tracking, setTracking] = useState("");
  // 기본값은 「기한 + 14일」, 단 오늘 이전이면 내일(서버는 오늘 이후만 받는다).
  const [dueDate, setDueDate] = useState(() => {
    const next = addDaysISO(item.dueDate, 14);
    const tomorrow = addDaysISO(tokyoToday(), 1);
    return next < tomorrow ? tomorrow : next;
  });
  const [status, setStatus] = useState<LostItemStatus>(
    item.status === "returned" || item.status === "disposed" ? "registered" : item.status,
  );
  // 업무 날짜는 도쿄 기준 — `toISOString()` 은 UTC 라 JST 새벽에 하루 이르다(CLAUDE.md → Tokyo timezone).
  const tomorrowKey = addDaysISO(tokyoToday(), 1);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, pending]);

  function handleConfirm() {
    if (kind === "return") onConfirm(kind, item.id, { method, tracking: method === "delivery" ? tracking : "", memo });
    else if (kind === "extend") onConfirm(kind, item.id, { dueDate, memo });
    else if (kind === "correct") onConfirm(kind, item.id, { status, memo });
    else onConfirm(kind, item.id, { memo });
  }

  return (
    <>
      <div className="modal-scrim on" onClick={pending ? undefined : onCancel} />
      <div className="modal on lfm" role="dialog" aria-modal="true" aria-labelledby="lfm-title">
        <div className="lfm__h">
          <h2 id="lfm-title">{copyOf(t, meta.title)}</h2>
          <span>
            {item.itemName} · {item.room ?? t.buildingWhole}
          </span>
        </div>
        <p className="lfm__body">{copyOf(t, meta.body)}</p>

        {kind === "return" ? (
          <>
            <div className="lfm__lbl">{t.mrMethod}</div>
            <div className="lfm__seg" role="radiogroup" aria-label={t.mrMethod}>
              {(["pickup", "delivery"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  className={method === m ? "on" : ""}
                  onClick={() => setMethod(m)}
                >
                  {m === "pickup" ? t.mrPickup : t.mrDelivery}
                </button>
              ))}
            </div>
            {method === "delivery" ? (
              <label className="lfm__nf lfm__reveal">
                <span className="lfm__nl">{t.mrTracking}</span>
                <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder={t.mrTrackingPh} />
              </label>
            ) : null}
          </>
        ) : null}

        {kind === "extend" ? (
          <div className="lfm__nf lfm__nf--date">
            <span className="lfm__nl">{t.meDue}</span>
            <AdminDatePicker
              value={dueDate}
              onChange={setDueDate}
              min={tomorrowKey}
              localeTag={localeTagOf(locale)}
              ariaLabel={t.meDue}
              labels={{
                prevMonth: sharedLabels?.datePrevMonth ?? "",
                nextMonth: sharedLabels?.dateNextMonth ?? "",
                today: sharedLabels?.dateToday ?? "",
              }}
            />
          </div>
        ) : null}

        {kind === "correct" ? (
          <>
            <div className="lfm__lbl">{t.mcStatus}</div>
            <div className="lfm__seg lfm__seg--3" role="radiogroup" aria-label={t.mcStatus}>
              {BOARD_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  className={status === s ? "on" : ""}
                  onClick={() => setStatus(s)}
                >
                  {copyOf(t, LOST_STATUS[s].key)}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {meta.memo ? (
          <label className="lfm__nf">
            <span className="lfm__nl">{copyOf(t, meta.memo)}</span>
            <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={copyOf(t, meta.ph ?? "")} />
          </label>
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
