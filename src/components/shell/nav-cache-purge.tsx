"use client";

import { useEffect } from "react";

/**
 * 로그인 화면이 뜨면 서비스 워커의 화면 저장본(`stayops-nav-*`, public/sw.js)을 지운다.
 *
 * 저장본은 로그인한 사람의 화면(급여 · 직원 정보 등)을 그대로 담고 있어서, 공용 기기에서 로그아웃한 뒤
 * 다음 사람이 같은 주소를 열면 앞사람 화면이 먼저 그려질 수 있었다(2026-10-28 보안 점검).
 * 로그아웃은 어느 버튼이든 로그인 화면으로 끝나므로 여기 한 곳에서 비운다.
 */
export function NavCachePurge() {
  useEffect(() => {
    if (typeof caches === "undefined") return;
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("stayops-nav")).map((k) => caches.delete(k))))
      .catch(() => {});
  }, []);
  return null;
}
