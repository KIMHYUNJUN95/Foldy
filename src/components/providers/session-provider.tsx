"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppMode } from "@/config/routes";
import { hasAdminWebAccess } from "@/config/capabilities";
import type { AppSession } from "@/lib/session";

type SessionContextValue = {
  canAccessAdmin: boolean;
  canSwitchMode: boolean;
  mode: AppMode;
  session: AppSession | null;
  setMode: (mode: AppMode) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

type SessionProviderProps = {
  children: ReactNode;
  initialSession: AppSession | null;
};

export function SessionProvider({
  children,
  initialSession,
}: SessionProviderProps) {
  const [mode, setModeState] = useState<AppMode>(
    initialSession?.user.preferredMode ?? "mobile",
  );

  const value = useMemo<SessionContextValue>(() => {
    // 관리자 웹 · 모드 전환 = 권한 키 `admin_web.access`(2026-10-21) — 관리자 웹에 못 들어가면 전환할 곳도 없다.
    const canAccessAdmin = hasAdminWebAccess(initialSession);
    const canSwitchMode = canAccessAdmin;

    return {
      canAccessAdmin,
      canSwitchMode,
      mode,
      session: initialSession,
      setMode(nextMode) {
        if (nextMode === "admin" && !canAccessAdmin) {
          return;
        }

        if (nextMode === "mobile" && !canSwitchMode) {
          return;
        }

        setModeState(nextMode);
      },
    };
  }, [initialSession, mode]);

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }

  return context;
}
