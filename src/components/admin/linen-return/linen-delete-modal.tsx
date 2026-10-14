"use client";

// Admin 린넨 반품 콘솔 — 삭제 확인 창. 화이트 리디자인(2026-10-14): 분실물 · 주문 처리 창(.lfm)과 같은 껍데기 —
// 제목 · 「요약 · 건물 · 시각 · 등록자」 · 범위 안내(그날 제출 전체가 함께 지워짐) · 되돌릴 수 없음 → [그대로 두기][삭제].
// × 없음, 닫기는 「그대로 두기」 하나(Esc · 바깥 누르기도). 삭제는 MVP hard delete — CLAUDE.md §9 확인 UX 유지.
import { useEffect } from "react";
import type { AdminLinenRecordVM } from "@/lib/admin-linen-returns";
import { fmtDateTime, summaryFullOf, tpl } from "./linen-console-data";
import type { LinenCopy } from "./linen-record-list";

type Props = {
  record: AdminLinenRecordVM;
  t: LinenCopy["console"];
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function LinenDeleteModal({ record, t, pending, onCancel, onConfirm }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, pending]);

  return (
    <>
      <div className="modal-scrim on" onClick={pending ? undefined : onCancel} />
      <div aria-labelledby="lnd-title" aria-modal="true" className="modal on lfm" role="dialog">
        <div className="lfm__h">
          <h2 id="lnd-title">{t.dKicker}</h2>
          <span>
            {summaryFullOf(record)} · {record.buildingLabel} · {fmtDateTime(record.registeredAt)} · {record.registrantName || "—"}
          </span>
        </div>
        <p className="lfm__body">{tpl(t.dSub, { kinds: record.lines.length, qty: record.totalQuantity })}</p>
        <p className="lfm__body">{t.dScopeNote}</p>
        <p className="lfm__body lnm-warn">{t.dWarnS}</p>
        <div className="lfm__foot">
          <button className="btn lfm__cancel" disabled={pending} onClick={onCancel} type="button">
            {t.wKeepIt}
          </button>
          <button className="btn lfm__ok is-danger" disabled={pending} onClick={onConfirm} type="button">
            {t.delete}
          </button>
        </div>
      </div>
    </>
  );
}
