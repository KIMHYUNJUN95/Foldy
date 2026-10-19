"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { startCleaningSession } from "@/app/mobile/cleaning/actions";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/shell/bottom-sheet";

export type SettingTargetSheetItem = {
  arrivingPax: number | null;
  arrivingGuestName: string;
  roomLabel: string;
  roomTitle: string;
};

type SettingTargetsSheetProps = {
  closeLabel: string;
  count: number;
  description: string;
  emptyMessage: string;
  items: SettingTargetSheetItem[];
  paxUnit: string;
  startLabel: string;
  title: string;
};

function subscribeHydration(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const id = window.requestAnimationFrame(() => callback());

  return () => window.cancelAnimationFrame(id);
}

export function SettingTargetsSheet({
  closeLabel,
  count,
  description,
  emptyMessage,
  items,
  paxUnit,
  startLabel,
  title,
}: SettingTargetsSheetProps) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const titleId = useId();
  const isHydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);

  return (
    <>
      <button
        aria-controls={open ? dialogId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="cursor-pointer rounded-full bg-transparent p-0 focus:outline-none focus:ring-2 focus:ring-slate-300/70"
        onClick={() => setOpen(true)}
        type="button"
      >
        {/* HIG 2차(2026-10-19): 밑줄 대신 회색 › — 숫자를 누르면 목록이 열린다는 표시 */}
        <span className="inline-flex items-center gap-0.5">
          {count}
          <ChevronRight className="size-4 text-[#b4b1bf]" strokeWidth={2.4} aria-hidden="true" />
        </span>
      </button>

      {isHydrated && open ? (
        <BottomSheet
          ariaLabel={closeLabel}
          className="max-h-[84dvh] flex flex-col"
          header={
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {title}
              </p>
              <p id={titleId} className="mt-1 text-lg font-black">
                {description}
              </p>
            </div>
          }
          onClose={() => setOpen(false)}
        >
          {() => (
            <div className="overflow-y-auto pt-2">
              {items.length > 0 ? (
                items.map((item, idx) => (
                  <div
                    className={`flex items-start justify-between gap-3 py-3.5 ${idx < items.length - 1 ? "border-b-[0.5px] border-[var(--separator)]" : ""}`}
                    key={item.roomLabel}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-bold leading-tight text-foreground">
                        {item.roomTitle}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-muted-foreground">
                        {item.arrivingGuestName}
                        {item.arrivingPax !== null ? ` · ${item.arrivingPax}${paxUnit}` : ""}
                      </p>
                    </div>
                    <form action={startCleaningSession}>
                      <input name="roomLabel" type="hidden" value={item.roomLabel} />
                      <input name="taskKey" type="hidden" value="simple" />
                      <Button
                        className="h-9 rounded-full border border-border bg-background px-3.5 text-xs font-black text-slate-800 shadow-none"
                        type="submit"
                      >
                        {startLabel}
                      </Button>
                    </form>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-background p-4 text-sm font-semibold text-muted-foreground">
                  {emptyMessage}
                </div>
              )}
            </div>
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}
