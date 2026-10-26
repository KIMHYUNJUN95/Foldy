"use client";

import { useEffect, useState } from "react";

type AdminToastState = { id: number; message: string; sticky?: boolean } | null;

/**
 * 관리자 콘솔 하단 중앙 토스트(admin-console.css 의 `.adm-toast`)의
 * 공용 상태/동작. `sticky` 가 아니면 1.8초 뒤 자동으로 사라지고, 클릭해도 닫힌다.
 */
export function useAdminToast() {
  const [toast, setToast] = useState<AdminToastState>(null);

  const showToast = (message: string, sticky = false) =>
    setToast({ id: Date.now(), message, sticky });
  const dismiss = () => setToast(null);

  useEffect(() => {
    if (!toast || toast.sticky) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  return { toast, showToast, dismiss };
}

export function AdminToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="adm-toast" onClick={onDismiss} role="status">
      {message}
    </div>
  );
}
