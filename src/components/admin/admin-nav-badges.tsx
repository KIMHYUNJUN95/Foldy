"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useNavBadges } from "@/components/shared/nav-badge-overrides";

/** 관리자 사이드바 메뉴 숫자(메뉴 id → 개수). 레이아웃(서버)이 계산해 내려 준다 — 권한 없는 사람은 빈 객체. */
const AdminNavBadgesContext = createContext<Partial<Record<string, number>>>({});

/** 레이아웃은 앱 안 이동 때 다시 그려지지 않는다 — 그 뒤 화면이 서버 액션으로 읽은 더 새 숫자를 덮는다(`reportNavBadge`). */
export function AdminNavBadgesProvider({ badges, children }: { badges: Partial<Record<string, number>>; children: ReactNode }) {
  const shown = useNavBadges(badges);
  return <AdminNavBadgesContext.Provider value={shown}>{children}</AdminNavBadgesContext.Provider>;
}

export function useAdminNavBadges() {
  return useContext(AdminNavBadgesContext);
}
