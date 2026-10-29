"use client";

import { ChevronDown, X } from "lucide-react";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import {
  countOpsVacantGaps,
  filterOpsVacantGaps,
  opsVacantGapUrgency,
  sortOpsVacantGaps,
  type OpsVacantGap,
  type OpsVacantGapLength,
  type OpsVacantGapSort,
} from "@/lib/ops-vacant-gaps";
import "./ops-calendar-tools-white.css";

/**
 * 빈 구간 목록 — 오른쪽 사이드 패널(PC) · 하단 시트(모바일, `.mops-side` 안).
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「빈 구간 목록」 (2026-10-29)
 * 시안: 판매 캘린더 빈 구간 목록 캔버스(R · 제안 PC 1440 · 폰 시트 · 폴드 · 태블릿)
 *
 * 보고 있는 기간의 팔 수 있는 빈 밤을 방마다 이어진 구간으로 한 줄씩 — 맨 앞 큰 숫자가 몇 박, 그 옆 객실 · 날짜,
 * 오른쪽 1박 평균 가격. 색은 급한 것(오늘 · 내일 밤부터)에만. 줄을 고르면 부르는 쪽이 그 칸들을 골라 가격 수정을 연다.
 * 길이 탭 · 정렬은 부르는 쪽이 들고 있다 — 가격 수정에서 「빈 구간」으로 돌아와도 고른 그대로다.
 */

export type VacantGapsCopy = {
  vgTitle: string;
  vgCount: string;
  vgNightsTotal: string;
  vgNightUnit: string;
  vgNightUnitOne: string;
  vgLenAll: string;
  vgLen1: string;
  vgLen2: string;
  vgLen3: string;
  vgSortNear: string;
  vgSortLong: string;
  vgSortProperty: string;
  vgSortChange: string;
  vgTonight: string;
  vgTomorrow: string;
  vgShort: string;
  vgOpenEnd: string;
  vgNote: string;
  vgEmpty: string;
  rcClose: string;
};

const SORTS: OpsVacantGapSort[] = ["near", "long", "property"];
const money = (value: number) => `¥${Math.round(value).toLocaleString()}`;
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export function OpsVacantGapsPanel({
  copy,
  gaps,
  length,
  localeTag,
  onClose,
  onLength,
  onPick,
  onSort,
  propertyOf,
  roomKeys,
  roomTitle,
  sort,
  today,
  windowLabel,
}: {
  copy: VacantGapsCopy;
  gaps: readonly OpsVacantGap[];
  length: OpsVacantGapLength;
  localeTag: string;
  onClose: () => void;
  onLength: (next: OpsVacantGapLength) => void;
  onPick: (gap: OpsVacantGap) => void;
  onSort: (next: OpsVacantGapSort) => void;
  /** 건물별 머리글 — 이미 보는 사람 언어로. */
  propertyOf: (roomKey: string) => string;
  /** 격자 줄 순서 — 건물별 정렬이 따른다. */
  roomKeys: readonly string[];
  /** 「아라키초A 201」 — 이미 보는 사람 언어로. */
  roomTitle: (roomKey: string) => string;
  sort: OpsVacantGapSort;
  today: string;
  /** 보고 있는 창(「10/29–11/27」). */
  windowLabel: string;
}) {
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { quietRestore: true });
  const counts = countOpsVacantGaps(gaps);
  const list = sortOpsVacantGaps(filterOpsVacantGaps(gaps, length), sort, roomKeys);
  const range = new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "long", timeZone: "UTC", weekday: "short" });
  const sortLabel = { long: copy.vgSortLong, near: copy.vgSortNear, property: copy.vgSortProperty }[sort];
  const tabs: { value: OpsVacantGapLength; label: string; n: number }[] = [
    { label: copy.vgLenAll, n: counts.all, value: "all" },
    { label: copy.vgLen1, n: counts.n1, value: "n1" },
    { label: copy.vgLen2, n: counts.n2, value: "n2" },
    { label: copy.vgLen3, n: counts.n3, value: "n3" },
  ];

  // 건물별 정렬일 때 건물이 바뀌는 줄에 머리글.
  const heads = list.map((gap, index) =>
    sort === "property" && (index === 0 || propertyOf(list[index - 1].roomKey) !== propertyOf(gap.roomKey))
      ? propertyOf(gap.roomKey)
      : null,
  );
  return (
    <>
      <div className="panel-scrim" onClick={onClose} />
      <aside aria-label={copy.vgTitle} aria-modal="true" className="panel stw-panel stw-vg" ref={panelRef} role="dialog" tabIndex={-1}>
        <div className="panel__h stw-h">
          <div className="stw-h__row">
            <div className="stw-h__txt">
              <span className="stw-h__kicker">{windowLabel}</span>
              <b className="stw-h__title">
                {copy.vgCount.replace("{n}", String(counts.all))}
                <span className="stw-vg__total">{copy.vgNightsTotal.replace("{n}", String(counts.nights))}</span>
              </b>
            </div>
            <button aria-label={copy.rcClose} className="panel__x stw-x" onClick={onClose} type="button">
              <X />
            </button>
          </div>
          <div className="stw-vg__bar">
            <div aria-label={copy.vgTitle} className="stw-vg__tabs" role="tablist">
              {tabs.map((tab) => (
                <button
                  aria-selected={tab.value === length}
                  className={tab.value === length ? "on" : undefined}
                  key={tab.value}
                  onClick={() => onLength(tab.value)}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                  <span>{tab.n}</span>
                </button>
              ))}
            </div>
            <button
              aria-label={`${copy.vgSortChange}: ${sortLabel}`}
              className="stw-vg__sort"
              onClick={() => onSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length])}
              type="button"
            >
              {sortLabel}
              <ChevronDown aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="panel__body stw-body">
          {list.length === 0 ? (
            <p className="stw-empty">{copy.vgEmpty}</p>
          ) : (
            <ul className="stw-list stw-vg__list">
              {list.map((gap, index) => {
                const head = heads[index];
                const urgency = opsVacantGapUrgency(gap, today);
                const notes = [
                  gap.minStay != null && gap.nights < gap.minStay ? copy.vgShort.replace("{n}", String(gap.minStay)) : null,
                  gap.openEnded ? copy.vgOpenEnd : null,
                ].filter(Boolean);
                return (
                  <li className={`stw-item is-row${head ? " is-first" : ""}`} key={`${gap.roomKey}|${gap.start}`} style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
                    {head && <span className="stw-vg__head">{head}</span>}
                    <button className="stw-row stw-vg__row" onClick={() => onPick(gap)} type="button">
                      <span className="stw-vg__n">
                        <b>{gap.nights}</b>
                        <span>{gap.nights === 1 ? copy.vgNightUnitOne : copy.vgNightUnit}</span>
                      </span>
                      <span className="stw-row__l">
                        <b className="stw-row__name">{roomTitle(gap.roomKey)}</b>
                        <span className="stw-row__sub">{range.formatRange(utc(gap.start), utc(gap.checkOut))}</span>
                        {urgency && <span className="stw-vg__urg">{urgency === "tonight" ? copy.vgTonight : copy.vgTomorrow}</span>}
                        {notes.length > 0 && <span className="stw-vg__note">{notes.join(" · ")}</span>}
                      </span>
                      <span className="stw-vg__price">{gap.averagePrice != null ? money(gap.averagePrice) : "—"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="stw-note">{copy.vgNote}</p>
        </div>
      </aside>
    </>
  );
}
