"use client";

import { useState } from "react";
import { unblockBoardUser } from "@/app/mobile/board/moderation-actions";

/** 계정 → 보안 「차단한 사용자」 — 게시판 차단 해제(2026-10-06). */
export function BlockedUsersList({
  users,
  copy,
  bare = false,
}: {
  users: { id: string; name: string }[];
  copy: { title: string; body: string; empty: string; unblock: string; unknown: string };
  /** 모바일 계정 화이트 리디자인 — 공용 BottomSheet 안에 넣을 때: 바깥 상자 · 제목 없이, 버튼은 옅은 회색. */
  bare?: boolean;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function onUnblock(id: string) {
    setPendingId(id);
    try {
      await unblockBoardUser(id); // 액션이 /account 를 revalidate — refresh 중복 금지
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className={bare ? "" : "rounded-xl border border-border px-4 py-3"}>
      {bare ? null : <p className="text-sm font-bold">{copy.title}</p>}
      <p className={bare ? "text-[13px] leading-5 text-[#8b8898]" : "mt-0.5 text-xs text-muted-foreground"}>{copy.body}</p>
      {users.length === 0 ? (
        <p className={bare ? "py-6 text-center text-[13px] text-[#8b8898]" : "mt-2 text-[13px] font-semibold text-muted-foreground"}>{copy.empty}</p>
      ) : (
        <ul className={bare ? "mt-2 divide-y divide-[#f3f3f6]" : "mt-2 divide-y divide-border/70"}>
          {users.map((u) => (
            <li className={bare ? "flex min-h-[56px] items-center justify-between gap-3 py-2" : "flex items-center justify-between gap-3 py-2"} key={u.id}>
              <span className="truncate text-sm font-semibold">{u.name || copy.unknown}</span>
              <button
                className={
                  bare
                    ? "h-10 shrink-0 rounded-full bg-[#f4f4f7] px-4 text-[13px] font-semibold text-[#5a30cf] transition-transform active:scale-[.97] disabled:opacity-50"
                    : "shrink-0 rounded-full border border-border px-3 py-1 text-[12.5px] font-bold text-primary disabled:opacity-50"
                }
                disabled={pendingId === u.id}
                onClick={() => onUnblock(u.id)}
                type="button"
              >
                {copy.unblock}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
