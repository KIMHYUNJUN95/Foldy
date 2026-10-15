"use client";

import { useEffect, useRef } from "react";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { cn } from "@/lib/utils";

export type UrgencyTone = "low" | "normal" | "high" | "urgent";

type SummaryRow = { label: string; value: string };

type MaintenanceConfirmModalProps = {
  open: boolean;
  pending: boolean;
  title: string;
  description: string;
  rows: SummaryRow[];
  urgencyLabel: string;
  urgencyValue: string;
  urgencyTone: UrgencyTone;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 요약 아래 · 버튼 위(사진 올리기 진행 줄). */
  children?: React.ReactNode;
};

const URGENCY_TONE_CLASSES: Record<UrgencyTone, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-primary/10 text-primary",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-destructive/10 text-destructive",
};

export function MaintenanceConfirmModal({
  open,
  pending,
  title,
  description,
  rows,
  urgencyLabel,
  urgencyValue,
  urgencyTone,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  children,
}: MaintenanceConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <BottomSheet
      ariaLabel={title}
      header={
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
            <ClipboardCheck className="size-6" aria-hidden="true" />
          </div>
          <h3 className="text-xl font-black tracking-tight text-foreground">
            {title}
          </h3>
          <p className="mt-1.5 text-sm font-medium leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      }
      onClose={onCancel}
    >
      {({ close }) => (
        <>
          <div className="px-0 py-3">
            <div className="divide-y divide-border/70 rounded-2xl border border-white/45 bg-background/55 shadow-[inset_0_1px_1px_rgba(255,255,255,0.62)] backdrop-blur-sm">
              {rows.map((row) => (
                <div
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                  key={row.label}
                >
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {row.label}
                  </span>
                  <span className="truncate text-right text-sm font-semibold text-foreground">
                    {row.value || "—"}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {urgencyLabel}
                </span>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-bold",
                    URGENCY_TONE_CLASSES[urgencyTone],
                  )}
                >
                  {urgencyValue}
                </span>
              </div>
            </div>
          </div>

          {children}
          <div className="flex flex-col gap-2 pt-1">
            <button
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-black text-primary-foreground shadow-glass transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
              disabled={pending}
              onClick={onConfirm}
              ref={confirmRef}
              type="button"
            >
              {confirmLabel}
            </button>
            <Button
              className="h-12 w-full rounded-xl font-bold"
              disabled={pending}
              onClick={close}
              type="button"
              variant="ghost"
            >
              {cancelLabel}
            </Button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
