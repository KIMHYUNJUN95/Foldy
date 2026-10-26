"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type { Dictionary } from "@/lib/i18n";
import type { ShareableUser } from "@/lib/tasks";
import { cn } from "@/lib/utils";

type Copy = Dictionary["tasks"];

export function SharePicker({
  copy,
  initialSelected,
  onApply,
  onClose,
  users,
}: {
  copy: Copy;
  initialSelected: string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
  users: ShareableUser[];
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = q ? users.filter((u) => u.name.toLowerCase().includes(q)) : users;

  // 시트의 종료 애니메이션이 먼저 돌고, 끝나면 BottomSheet 가 onClose 를 호출한다. 여기서
  // 갈라서 "적용"도 선택을 확정하기 전에 시트를 아래로 내리게 한다.
  const applyingRef = useRef(false);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const handleClose = useCallback(() => {
    if (applyingRef.current) onApply(selectedRef.current);
    else onClose();
  }, [onApply, onClose]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <BottomSheet
      ariaLabel={copy.shareTitle}
      className="flex max-h-[82dvh] flex-col"
      header={
        <div className="mb-3">
          <p className="text-[16px] font-black text-foreground">{copy.shareTitle}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{copy.shareSub}</p>
        </div>
      }
      onClose={handleClose}
    >
      {({ close }) => (
        <>
          <div className="relative mb-2 flex items-center">
            <Search className="pointer-events-none absolute left-3.5 size-4 text-slate-400" aria-hidden="true" />
            <input
              className="h-11 w-full rounded-2xl border border-border bg-background/60 pl-10 pr-3 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary"
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="search"
              onChange={(e) => setQuery(e.target.value)}
              placeholder={copy.shareSearch}
              type="search"
              value={query}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {list.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">{copy.shareNoResult}</p>
            ) : (
              <div className="flex flex-col gap-1">
                {list.map((u) => {
                  const on = selected.includes(u.id);
                  return (
                    <button
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors",
                        on ? "border-primary bg-primary/[0.06]" : "border-transparent hover:bg-slate-50",
                      )}
                      key={u.id}
                      onClick={() => toggle(u.id)}
                      type="button"
                    >
                      <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-extrabold text-primary">
                        {u.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-foreground">{u.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{u.role}</span>
                      </span>
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full border",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-slate-300",
                        )}
                      >
                        {on ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            className={cn(
              "mt-3 h-[52px] w-full rounded-2xl text-[15px] font-extrabold transition-colors",
              selected.length
                ? "bg-primary text-primary-foreground"
                : "bg-slate-100 text-slate-400",
            )}
            /* 처음부터 0명이면 할 게 없어 비활성, 하지만 기존 선택을 전원 해제한 경우엔 "없음"으로 적용 가능. */
            disabled={selected.length === 0 && initialSelected.length === 0}
            onClick={() => {
              applyingRef.current = true;
              close();
            }}
            type="button"
          >
            {selected.length
              ? copy.shareApply.replace("{count}", String(selected.length))
              : copy.sharePrompt}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
