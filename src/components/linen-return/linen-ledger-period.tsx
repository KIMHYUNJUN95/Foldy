"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  DateRangeCalendar,
  type DateRangeValue,
} from "@/components/requests/date-range-calendar";
import type { Dictionary, Locale } from "@/lib/i18n";

type LinenLedgerPeriodProps = {
  building: string;
  canGoNext: boolean;
  copy: Dictionary["linenReturn"];
  label: string;
  locale: Locale;
  /** 이전/다음 화살표가 쓰는 기준 월. */
  month: number;
  range: DateRangeValue;
  year: number;
};

function shiftMonth(year: number, month: number, delta: number) {
  const base = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1 };
}

export function LinenLedgerPeriod({
  building,
  canGoNext,
  copy,
  label,
  locale,
  month,
  range,
  year,
}: LinenLedgerPeriodProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const buildingParam = encodeURIComponent(building);

  function goMonth(delta: number) {
    const next = shiftMonth(year, month, delta);
    router.push(
      `/mobile/linen-return/ledger?building=${buildingParam}&year=${next.year}&month=${next.month}`,
    );
  }

  function applyRange(value: DateRangeValue) {
    setOpen(false);
    if (!value.startDate) {
      router.push(`/mobile/linen-return/ledger?building=${buildingParam}`);
      return;
    }
    const end = value.endDate ?? value.startDate;
    router.push(
      `/mobile/linen-return/ledger?building=${buildingParam}&startDate=${value.startDate}&endDate=${end}`,
    );
  }

  function resetToMonth() {
    setOpen(false);
    router.push(`/mobile/linen-return/ledger?building=${buildingParam}`);
  }

  return (
    <div className="lnw-period">
      <button aria-label={copy.rangePreviousMonth} className="lnw-navb" onClick={() => goMonth(-1)} type="button">
        <ChevronLeft aria-hidden="true" />
      </button>
      <button className="lnw-period__label" onClick={() => setOpen(true)} type="button">
        {label}
      </button>
      <button aria-label={copy.rangeNextMonth} className="lnw-navb" disabled={!canGoNext} onClick={() => goMonth(1)} type="button">
        <ChevronRight aria-hidden="true" />
      </button>
      <DateRangeCalendar
        labels={{
          apply: copy.rangeApply,
          clear: copy.rangeClear,
          close: copy.rangeClose,
          previousMonth: copy.rangePreviousMonth,
          nextMonth: copy.rangeNextMonth,
          selectEnd: copy.rangeHintEnd,
          selectStart: copy.rangeHintStart,
          title: copy.rangeTitle,
        }}
        locale={locale}
        onApply={applyRange}
        onClear={resetToMonth}
        onClose={() => setOpen(false)}
        open={open}
        value={range}
      />
    </div>
  );
}
