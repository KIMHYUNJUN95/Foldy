"use client";

import { createContext, useContext, type ReactNode } from "react";

/** 관리자 사이드바 메뉴 숫자(메뉴 id → 개수). 레이아웃(서버)이 계산해 내려 준다 — 권한 없는 사람은 빈 객체. */
const AdminNavBadgesContext = createContext<Partial<Record<string, number>>>({});

export function AdminNavBadgesProvider({ badges, children }: { badges: Partial<Record<string, number>>; children: ReactNode }) {
  return <AdminNavBadgesContext.Provider value={badges}>{children}</AdminNavBadgesContext.Provider>;
}

export function useAdminNavBadges() {
  return useContext(AdminNavBadgesContext);
}
