"use client";

// 게스트 피드백 콘솔 — 보기바(화이트 리디자인 2026-10-14, 시안 FB-PC · FBManual-PC · FBRooms-PC).
// 콘솔 상태는 전부 쿼리스트링이라, 고르기는 주소만 바꾸고 서버 렌더가 나머지를 한다.
// 날짜는 공용 AdminDateRangePicker, 고르기는 공용 AdmDropdown(CLAUDE.md §4a) — 전용 컨트롤을 만들지 않는다.
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdmDropdown, type AdmOption } from "@/components/admin/shared/adm-dropdown";
import {
  AdminDateRangePicker,
  type AdminDateRangePickerLabels,
} from "@/components/admin/shared/admin-date-range-picker";

export type ViewbarTab = { id: string; label: string; count?: number; href: string };

export type ViewbarSelect = {
  /** 바꿀 쿼리 키. 값이 "all" 이면 키를 지운다. */
  param: string;
  value: string;
  options: AdmOption[];
  ariaLabel: string;
  /** 이 고르기를 바꿀 때 함께 지울 키(예: 건물을 바꾸면 객실). */
  resets?: string[];
};

type Props = {
  tabs: ViewbarTab[];
  activeTab: string;
  /** 현재 쿼리(키 → 값). 고르기가 이걸 바탕으로 다음 주소를 만든다. */
  query: Record<string, string>;
  range: { from: string; to: string } | null;
  rangeLabels: AdminDateRangePickerLabels;
  rangeAria: string;
  localeTag: string;
  selects: ViewbarSelect[];
  /** 오른쪽 끝 — 지금 가져오기 · 컴플레인 등록 같은 동작(서버/클라이언트 어느 쪽이든). */
  trailing?: React.ReactNode;
};

function hrefOf(query: Record<string, string>, patch: Record<string, string | null>): string {
  const next = new URLSearchParams();
  const merged: Record<string, string | null> = { ...query, ...patch };
  for (const [key, value] of Object.entries(merged)) {
    if (value && value !== "all") next.set(key, value);
  }
  const text = next.toString();
  return `/admin/complaints${text ? `?${text}` : ""}`;
}

export function ComplaintsViewbar({
  tabs,
  activeTab,
  query,
  range,
  rangeLabels,
  rangeAria,
  localeTag,
  selects,
  trailing,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const go = (patch: Record<string, string | null>) =>
    startTransition(() => router.push(hrefOf(query, { ...patch, review: null, complaint: null, tr: null }), { scroll: false }));

  return (
    <div className="cviewbar cxw-viewbar">
      <div className="lviews" style={{ margin: 0 }}>
        {tabs.map((tab) => (
          <Link key={tab.id} href={tab.href} className={activeTab === tab.id ? "on" : ""} scroll={false}>
            {tab.label}
            {tab.count ? <b className="cxw-tabn">{tab.count}</b> : null}
          </Link>
        ))}
      </div>
      {range ? (
        <AdminDateRangePicker
          from={range.from}
          to={range.to}
          onChange={(from, to) => go({ from, to })}
          localeTag={localeTag}
          ariaLabel={rangeAria}
          labels={rangeLabels}
        />
      ) : null}
      <span className="cxw-viewbar__sp" />
      {selects.map((select) => (
        <AdmDropdown
          key={select.param}
          size="sm"
          value={select.value}
          ariaLabel={select.ariaLabel}
          options={select.options}
          onChange={(value) => {
            const patch: Record<string, string | null> = { [select.param]: value };
            for (const key of select.resets ?? []) patch[key] = null;
            go(patch);
          }}
        />
      ))}
      {trailing}
    </div>
  );
}
