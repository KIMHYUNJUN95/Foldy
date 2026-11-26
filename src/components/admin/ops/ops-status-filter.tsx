"use client";

/**
 * 판매 캘린더 「예약 표시」 필터 — PC 도구 줄(2026-11-26, 예전 「취소만 보기」 자리).
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 표시 필터」
 * 시안: 캔버스 MM33d93w… v11
 *
 * - 확정 · 문의 · 예약 요청 · 취소를 진짜 체크박스로 고른다(기본 = 확정만). 항목마다 지금 보는 범위의 건수.
 * - 바꾸면 바로 서버가 다시 그린다(`show=` 주소 — 사람마다 저장, `ops-calendar-status-filter-preference.ts`).
 * - 기본과 다르면 버튼에 「+N」(기본과 다른 항목 수).
 * - Esc · 바깥 클릭으로 닫고, Esc 는 버튼으로 초점을 돌려준다.
 */

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { useOpsNavigate } from "@/components/admin/ops/ops-nav";
import {
  DEFAULT_OPS_STATUS_FILTER,
  OPS_STATUS_FILTER_KEYS,
  isDefaultOpsStatusFilter,
  opsStatusFilterBadgeCount,
  opsStatusFilterHref,
  type OpsStatusFilterKey,
} from "@/lib/ops-calendar-status-filter";
import type { OpsBarKind } from "@/lib/ops-reservation-kind";

export type OpsStatusFilterCopy = {
  statusFilter: string;
  statusFilterLegend: string;
  statusFilterReset: string;
  statusFilterNote: string;
  statusFilterChanged: string;
  statusConfirmed: string;
  statusInquiry: string;
  statusRequest: string;
  statusCancelled: string;
};

export function opsStatusLabel(key: OpsStatusFilterKey, copy: OpsStatusFilterCopy): string {
  if (key === "confirmed") return copy.statusConfirmed;
  if (key === "inquiry") return copy.statusInquiry;
  if (key === "request") return copy.statusRequest;
  return copy.statusCancelled;
}

/** 서버 값이 바뀌면 고르던 값을 버리고 서버 값을 따른다(렌더 중 비교 — 「이전 값 저장」 패턴). */
export function useStatusFilterDraft(filter: readonly OpsStatusFilterKey[]) {
  const [state, setState] = useState({ seen: filter, draft: filter });
  let draft = state.draft;
  if (state.seen !== filter) {
    draft = filter;
    setState({ seen: filter, draft: filter });
  }
  const setDraft = (next: readonly OpsStatusFilterKey[]) => setState({ seen: filter, draft: next });
  return [draft, setDraft] as const;
}

export function toggleStatusKey(
  current: readonly OpsStatusFilterKey[],
  key: OpsStatusFilterKey,
  on: boolean,
): OpsStatusFilterKey[] {
  const set = new Set(current);
  if (on) set.add(key);
  else set.delete(key);
  return OPS_STATUS_FILTER_KEYS.filter((item) => set.has(item));
}

export function OpsStatusFilter({
  baseHref,
  copy,
  counts,
  filter,
}: {
  /** `show=` 를 뺀 지금 주소 — 고른 값은 `opsStatusFilterHref` 가 붙인다. */
  baseHref: string;
  copy: OpsStatusFilterCopy;
  counts: Record<OpsBarKind, number>;
  filter: readonly OpsStatusFilterKey[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useStatusFilterDraft(filter);
  const { navigate } = useOpsNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popId = useId();
  const noteId = useId();
  const badge = opsStatusFilterBadgeCount(draft);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const apply = (next: readonly OpsStatusFilterKey[]) => {
    setDraft(next);
    navigate(opsStatusFilterHref(baseHref, next));
  };

  return (
    <div className="scw-menu scw-sf" ref={rootRef}>
      <button
        aria-controls={open ? popId : undefined}
        aria-expanded={open}
        className={`scw-tb is-filter${badge > 0 ? " on" : ""}${open ? " is-open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        ref={buttonRef}
        type="button"
      >
        {copy.statusFilter}
        {badge > 0 && (
          <b className="scw-tb__n">
            <span aria-hidden="true">+{badge}</span>
            <span className="sr-only">{copy.statusFilterChanged.replace("{n}", String(badge))}</span>
          </b>
        )}
        <ChevronDown aria-hidden="true" className="scw-menu__chev" strokeWidth={2} />
      </button>
      {open && (
        <div className="scw-menu__pop scw-sf__pop" id={popId}>
          <fieldset aria-describedby={noteId} className="scw-sf__set">
            <legend className="scw-sf__legend">{copy.statusFilterLegend}</legend>
            {OPS_STATUS_FILTER_KEYS.map((key) => {
              const on = draft.includes(key);
              return (
                <label className={`scw-menu__row scw-sf__row${on ? " on" : ""}`} key={key}>
                  <input
                    checked={on}
                    className="scw-sf__input"
                    onChange={(event) => apply(toggleStatusKey(draft, key, event.target.checked))}
                    type="checkbox"
                  />
                  <span className="scw-menu__name">{opsStatusLabel(key, copy)}</span>
                  <span className="scw-sf__n">{counts[key]}</span>
                </label>
              );
            })}
          </fieldset>
          <p className="scw-sf__note" id={noteId}>
            {copy.statusFilterNote}
          </p>
          <div className="scw-pp__foot">
            <button
              className="scw-pp__done"
              disabled={isDefaultOpsStatusFilter(draft)}
              onClick={() => apply(DEFAULT_OPS_STATUS_FILTER)}
              type="button"
            >
              {copy.statusFilterReset}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
