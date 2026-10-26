"use client";

// 공용 admin 콘솔 월 선택 프리미티브.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { shiftMonthKey } from "./admin-month-key";

export type AdminMonthPickerLabels = {
  prevMonth: string;
  nextMonth: string;
  prevYear: string;
  nextYear: string;
  open: string;
  thisMonth: string;
};

type AdminMonthPickerProps = {
  /** 현재 월, "YYYY-MM". */
  ym: string;
  localeTag: string;
  /** ?ym= 쿼리가 덧붙는 경로(예: "/admin/attendance/payroll"). */
  basePath: string;
  /** 월을 바꿀 때 유지되는 월 외 쿼리 키(선택, 예: 선택된 사용자/패널). */
  preserveQueryKeys?: string[];
  labels: AdminMonthPickerLabels;
  /**
   * 주면 주소를 바꾸지 않고 이 함수를 부른다(2026-10-08 — 매출 비교처럼 한 화면에 달 선택기가 둘이라 `?ym=` 하나로
   * 안 되는 곳). 없으면 예전처럼 `basePath?ym=` 로 간다.
   */
  onSelect?: (ym: string) => void;
};


export function AdminMonthPicker({
  ym,
  localeTag,
  basePath,
  preserveQueryKeys = [],
  labels,
  onSelect,
}: AdminMonthPickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [selY, selM] = ym.split("-").map(Number);
  const [viewYear, setViewYear] = useState(selY);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long" }).format(
        new Date(`${ym}-01T00:00:00`),
      ),
    [localeTag, ym],
  );
  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) =>
        new Intl.DateTimeFormat(localeTag, { month: "short" }).format(new Date(2021, i, 1)),
      ),
    [localeTag],
  );

  function toggle() {
    if (!open) setViewYear(selY);
    setOpen((o) => !o);
  }
  function go(targetYm: string) {
    setOpen(false);
    if (onSelect) {
      onSelect(targetYm);
      return;
    }
    const next = new URLSearchParams();
    next.set("ym", targetYm);
    // 반복 키(`?property=A&property=B`)도 **전부** 옮긴다 — 첫 값만 옮기면 다중 선택이 달을 넘길 때
    // 하나로 줄어든다(2026-09-30). 값이 하나뿐인 키는 예전과 똑같다.
    for (const key of preserveQueryKeys) {
      for (const value of searchParams.getAll(key)) {
        if (value) next.append(key, value);
      }
    }
    router.push(`${basePath}?${next.toString()}`);
  }
  function goThisMonth() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === "year")?.value ?? "1970";
    const month = parts.find((p) => p.type === "month")?.value ?? "01";
    go(`${year}-${month}`);
  }

  return (
    <div className="amp" ref={rootRef}>
      <button
        type="button"
        className="chipbtn amp__arw"
        aria-label={labels.prevMonth}
        onClick={() => go(shiftMonthKey(ym, -1))}
      >
        <span className="ic">
          <ChevronLeft />
        </span>
      </button>
      <button
        type="button"
        className="amp__label"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={labels.open}
        onClick={toggle}
      >
        {monthLabel}
      </button>
      <button
        type="button"
        className="chipbtn amp__arw"
        aria-label={labels.nextMonth}
        onClick={() => go(shiftMonthKey(ym, 1))}
      >
        <span className="ic">
          <ChevronRight />
        </span>
      </button>

      {open ? (
        <div className="amp__pop" role="dialog" aria-label={labels.open}>
          <div className="amp__hd">
            <button
              type="button"
              className="adp__nav"
              aria-label={labels.prevYear}
              onClick={() => setViewYear((y) => y - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <span className="amp__yr">{viewYear}</span>
            <button
              type="button"
              className="adp__nav"
              aria-label={labels.nextYear}
              onClick={() => setViewYear((y) => y + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div className="amp__grid">
            {monthNames.map((name, i) => {
              const m = i + 1;
              const isSel = viewYear === selY && m === selM;
              const targetYm = `${viewYear}-${String(m).padStart(2, "0")}`;
              return (
                <button
                  key={m}
                  type="button"
                  className={`amp__m${isSel ? " sel" : ""}`}
                  onClick={() => go(targetYm)}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <button type="button" className="amp__today" onClick={goThisMonth}>
            {labels.thisMonth}
          </button>
        </div>
      ) : null}
    </div>
  );
}
