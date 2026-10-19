"use client";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/shell/bottom-sheet";

type SummaryRow = { label: string; value: string };

type LostFoundConfirmModalProps = {
  open: boolean;
  pending: boolean;
  title: string;
  description: string;
  rows: SummaryRow[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 요약 아래 · 버튼 위(사진 올리기 진행 줄). */
  children?: React.ReactNode;
};

export function LostFoundConfirmModal({
  open,
  pending,
  title,
  description,
  rows,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  children,
}: LostFoundConfirmModalProps) {
  if (!open) return null;

  const requestCancel = () => {
    if (pending) return;
    onCancel();
  };

  return (
    <BottomSheet
      ariaLabel={title}
      header={
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
            <ClipboardCheck className="size-6" aria-hidden="true" />
          </div>
          <h3
            className="text-xl font-black tracking-tight text-foreground"
            id="lostfound-confirm-title"
          >
            {title}
          </h3>
          <p className="mt-1.5 text-sm font-medium leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      }
      onClose={requestCancel}
    >
      {() => (
        <>
          <div className="py-3">
            <div className="divide-y-[0.5px] divide-[var(--separator)] rounded-2xl border border-white/45 bg-background/55 shadow-[inset_0_1px_1px_rgba(255,255,255,0.62)] backdrop-blur-sm">
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
            </div>
          </div>

          {children}
          <div className="flex flex-col gap-2 pt-1">
            <button
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-black text-primary-foreground shadow-glass transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
              disabled={pending}
              onClick={onConfirm}
              type="button"
            >
              {confirmLabel}
            </button>
            <Button
              className="h-12 w-full rounded-xl font-bold"
              disabled={pending}
              onClick={requestCancel}
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
