"use client";

/**
 * localStorage 에 저장되는 SSR 안전한 불리언 토글.
 * 첫 렌더는 항상 `defaultValue` 를 반환해 서버/클라이언트
 * HTML 이 일치한다(하이드레이션 불일치 없음). 그다음 useEffect 가
 * 저장된 선호를 읽어 클라이언트에서만 상태를 갱신한다.
 *
 * 탭 간 동기화: "storage" 이벤트를 들어서 다른 탭이
 * 페이지 새로고침 없이 변경을 즉시 반영한다.
 */

import { useCallback, useEffect, useState } from "react";

function readStorage(key: string): boolean | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return raw === "1";
  } catch {
    // Safari 비공개 모드이거나 저장 용량 초과 — 조용히 대체한다.
    return null;
  }
}

function writeStorage(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // 쓰기 실패는 무시한다.
  }
}

export function usePersistentToggle(
  storageKey: string,
  defaultValue: boolean,
): [boolean, () => void] {
  // SSR 과 첫 클라이언트 렌더가 일치하도록 항상 defaultValue 로 시작한다.
  const [value, setValue] = useState(defaultValue);

  // 마운트 후 localStorage 에서 복원한다.
  // setState 를 마이크로태스크에서 호출해 effect 본문에서 동기적으로 실행되지 않게 한다
  // (react-hooks/set-state-in-effect 만족); 그래도 페인트 전에 실행되므로 깜빡임은 없다.
  useEffect(() => {
    const stored = readStorage(storageKey);
    if (stored !== null) queueMicrotask(() => setValue(stored));
  }, [storageKey]);

  // 같은 브라우저에서 열린 탭들 사이에서 동기화한다.
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== storageKey) return;
      const stored = readStorage(storageKey);
      if (stored !== null) setValue(stored);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [storageKey]);

  const toggle = useCallback(() => {
    setValue((prev) => {
      const next = !prev;
      writeStorage(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return [value, toggle];
}
