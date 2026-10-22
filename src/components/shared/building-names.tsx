"use client";

import { createContext, useCallback, useContext } from "react";
import { localizeBuildingName } from "@/lib/room-label-normalization";

/**
 * 건물 이름을 보는 사람 언어로 — 클라이언트 컴포넌트용(2026-10-22 모바일 다국어 점검).
 *
 * 예약 · 요금 · 가동률 · 매출 데이터는 건물을 한국어 정규 명칭(`아라키초A`)으로 들고 다닌다. 키 · 필터 · 주소에는
 * 그 이름을 그대로 쓰고, **화면에 그릴 때만** `useBuildingName()` 으로 바꾼다. 모바일 레이아웃이 보는 사람의
 * `dictionary.cleaning.buildingLabels` 를 한 번 내려 준다 — 컴포넌트마다 사전을 따로 받지 않아도 된다.
 * 공급자 밖(어드민 등)에서는 이름을 그대로 돌려준다.
 */
const BuildingLabelsContext = createContext<Record<string, string> | null>(null);

export function BuildingNamesProvider({
  labels,
  children,
}: {
  labels: Record<string, string>;
  children: React.ReactNode;
}) {
  return <BuildingLabelsContext.Provider value={labels}>{children}</BuildingLabelsContext.Provider>;
}

export function useBuildingName(): (rawPropertyName: string) => string {
  const labels = useContext(BuildingLabelsContext);
  return useCallback(
    (rawPropertyName: string) => (labels && rawPropertyName ? localizeBuildingName(rawPropertyName, labels) : rawPropertyName),
    [labels],
  );
}
