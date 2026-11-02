"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// 「이 사람은 안 와요」(43 §8) — 한 번 더 묻고 뺀다. guestId 가 없으면 명부의 빈 자리 하나를 뺀다.
// 뺀 사람의 입력 · 여권 사진은 지워진다(되돌릴 수 없음 → 확인을 받는다).

type Props = {
  token: string;
  guestId: string | null;
  label: string;
  confirm: string;
  remove: string;
  cancel: string;
  error: string;
  afterHref?: string;
  className?: string;
};

export function SeatRemover({ token, guestId, label, confirm, remove, cancel, error, afterHref, className }: Props) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function run() {
    setFailed(false);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/guest/${token}/guests`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ guestId }),
        });
        if (!response.ok) throw new Error(String(response.status));
        setAsking(false);
        if (afterHref) router.replace(afterHref);
        router.refresh();
      } catch {
        setFailed(true);
      }
    });
  }

  if (!asking) {
    return (
      <button type="button" className={className ?? "w-link text-[15px]"} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="rounded-md border border-[var(--line-strong)] bg-[var(--surface)] p-4" role="group" aria-label={label}>
      <p className="text-[15px]">{confirm}</p>
      {failed ? (
        <p role="alert" className="mt-2 text-[14px] text-[var(--error)]">
          {error}
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="w-ghost" onClick={() => setAsking(false)} disabled={pending}>
          {cancel}
        </button>
        <button type="button" className="w-ghost text-[var(--error)]" onClick={run} disabled={pending}>
          {remove}
        </button>
      </div>
    </div>
  );
}
