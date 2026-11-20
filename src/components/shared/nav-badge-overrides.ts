"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createNavBadgeMerger, createNavBadgeOverrideStore, type NavBadges } from "@/lib/nav-badge-overrides";

/** 문서(창) 하나에 하나 — 태블릿 칸(iframe)은 따로다. 규칙은 `src/lib/nav-badge-overrides.ts`. */
const store = createNavBadgeOverrideStore();

const EMPTY: NavBadges = {};

/**
 * 서버 렌더 숫자 + 그 뒤 화면이 알린 더 새 숫자. 관리자 메뉴(`AdminNavBadgesProvider`) · 모바일 셸이 쓴다.
 * 서버가 숫자 묶음을 주지 않은 화면(내 계정 등)은 덮지 않는다 — 알린 숫자 하나만 혼자 뜨지 않게.
 */
export function useNavBadges(server: NavBadges | undefined): NavBadges {
  const overrides = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [merge] = useState(createNavBadgeMerger);
  useEffect(() => {
    if (server) store.stamp(server);
  }, [server]);
  if (!server) return EMPTY;
  return merge(server, store.stampOf(server), overrides);
}

/** 메뉴 숫자를 읽기 시작한다 — 요청을 보내기 **전에** 부르고, 받은 번호를 `reportNavBadge` 에 넘긴다. */
export function beginNavBadgeRead(): number {
  return store.begin();
}

/** 서버 액션으로 읽은 메뉴 숫자를 알린다(손님 메시지 읽기의 `navAwaitingCount`). 숫자가 없으면(못 셈) 아무것도 안 한다. */
export function reportNavBadge(id: string, count: number | undefined, at: number) {
  if (count !== undefined) store.report(id, count, at);
}
