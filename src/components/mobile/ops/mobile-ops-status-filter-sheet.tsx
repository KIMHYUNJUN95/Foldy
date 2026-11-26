"use client";

/**
 * 모바일 판매 캘린더 「예약 표시」 시트(2026-11-26 — 예전 「취소 보기」 칩 자리).
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 표시 필터」 · PC 는 `OpsStatusFilter`.
 * 공용 `BottomSheet`(태블릿에선 가운데 카드). 줄은 48px 진짜 체크박스, 바꾸면 바로 서버가 다시 그린다(시트는 열린 채).
 */

import { useId } from "react";

import {
  opsStatusLabel,
  toggleStatusKey,
  useStatusFilterDraft,
  type OpsStatusFilterCopy,
} from "@/components/admin/ops/ops-status-filter";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import {
  DEFAULT_OPS_STATUS_FILTER,
  OPS_STATUS_FILTER_KEYS,
  isDefaultOpsStatusFilter,
  opsStatusFilterHref,
  type OpsStatusFilterKey,
} from "@/lib/ops-calendar-status-filter";
import type { OpsBarKind } from "@/lib/ops-reservation-kind";

export function MobileOpsStatusFilterSheet({
  baseHref,
  copy,
  counts,
  filter,
  onClose,
  onNavigate,
}: {
  baseHref: string;
  copy: OpsStatusFilterCopy;
  counts: Record<OpsBarKind, number>;
  filter: readonly OpsStatusFilterKey[];
  onClose: () => void;
  /** 고른 값으로 이동 — 부모가 「받는 중」 흐림과 `router.push` 를 같이 한다. */
  onNavigate: (href: string) => void;
}) {
  const [draft, setDraft] = useStatusFilterDraft(filter);
  const titleId = useId();
  const noteId = useId();

  const apply = (next: readonly OpsStatusFilterKey[]) => {
    haptic("light");
    setDraft(next);
    onNavigate(opsStatusFilterHref(baseHref, next));
  };

  return (
    <BottomSheet ariaLabelledBy={titleId} onClose={onClose}>
      <div className="px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-1">
        <fieldset aria-describedby={noteId}>
          <legend className="pb-2 text-[17px] font-semibold text-slate-900" id={titleId}>
            {copy.statusFilter}
          </legend>
          <ul className="divide-y divide-[#E4E3E9]">
            {OPS_STATUS_FILTER_KEYS.map((key) => {
              const on = draft.includes(key);
              return (
                <li key={key}>
                  <label className="flex min-h-12 items-center gap-3 py-1 text-[16px] text-slate-900">
                    <input
                      checked={on}
                      className="size-5 shrink-0 accent-[var(--primary)]"
                      onChange={(event) => apply(toggleStatusKey(draft, key, event.target.checked))}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1">{opsStatusLabel(key, copy)}</span>
                    <span className="tabular-nums text-[15px] text-slate-500">{counts[key]}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <p className="mt-3 text-[13px] leading-5 text-slate-600" id={noteId}>
          {copy.statusFilterNote}
        </p>
        <button
          className="mt-4 min-h-12 w-full rounded-[14px] bg-slate-100 text-[15px] font-semibold text-slate-800 disabled:opacity-40"
          disabled={isDefaultOpsStatusFilter(draft)}
          onClick={() => apply(DEFAULT_OPS_STATUS_FILTER)}
          type="button"
        >
          {copy.statusFilterReset}
        </button>
      </div>
    </BottomSheet>
  );
}
