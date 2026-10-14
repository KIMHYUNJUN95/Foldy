"use client";

// 린넨 반품 — 처음 쓸 때(마지막 건물이 없을 때)의 건물 고르기. 화이트 리디자인(2026-10-14): 카드 그리드 대신
// 건물 바꾸기 시트와 같은 한 줄 목록(이름 · 이번 달 건수). 고르면 그 건물을 기억해 다음부터 바로 그 목록이 열린다.
import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { rememberLinenBuilding } from "@/components/linen-return/linen-building-switch";
import "@/components/linen-return/linen-mobile.css";
import type { Dictionary, Locale } from "@/lib/i18n";
import { localizePropertyName } from "@/lib/room-label-normalization";

type BuildingStat = { count: number; lastAt: string | null };

type BuildingPickerProps = {
  buildingLabels: Record<string, string>;
  buildings: string[];
  copy: Dictionary["linenReturn"];
  locale: Locale;
  stats: Record<string, BuildingStat>;
};

export function BuildingPicker({ buildingLabels, buildings, copy, stats }: BuildingPickerProps) {
  const localized = useMemo(
    () =>
      buildings
        .map((name) => ({ name, label: localizePropertyName(name, buildingLabels) }))
        // 어드민 린넨 콘솔의 건물 선택지와 같은 규칙 — 표시 라벨 기준으로 정렬한다.
        .sort((a, b) => a.label.localeCompare(b.label, "ko")),
    [buildings, buildingLabels],
  );

  return (
    <div className="lnw">
      <div className="lnw-head">
        <span className="lnw-kick">{copy.eyebrow}</span>
        <h1 className="lnw-title">{copy.pickerTitle}</h1>
        <p className="lnw-sub">{copy.pickerSubtitle}</p>
      </div>

      {buildings.length === 0 ? (
        <div className="lnw-empty-state">
          <b>{copy.noBuildings}</b>
          <span>{copy.noBuildingsSub}</span>
        </div>
      ) : (
        <div className="lnw-blist is-page">
          {localized.map((b) => {
            const n = stats[b.name]?.count ?? 0;
            return (
              <Link
                href={`/mobile/linen-return/list?building=${encodeURIComponent(b.name)}`}
                key={b.name}
                onClick={() => rememberLinenBuilding(b.name)}
              >
                <span>{b.label}</span>
                <em>{n > 0 ? copy.wMonthCount.replace("{n}", String(n)) : copy.noRecordYet}</em>
                <ChevronRight aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
