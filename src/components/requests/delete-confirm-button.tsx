"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";

type DeleteConfirmLabels = {
  confirmTitle: string;
  confirmBody: string;
  deletePermanently: string;
  cancel: string;
  deleteFailed: string;
  deleteRecord: string;
  permissionDeniedMessage: string;
};

type DeleteConfirmButtonProps = {
  deleteAction: () => Promise<{ ok: boolean; error?: string }>;
  labels: DeleteConfirmLabels;
  redirectTo: string;
  title: string;
};

export function DeleteConfirmButton({
  deleteAction,
  labels,
  redirectTo,
  title,
}: DeleteConfirmButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast, dismiss } = useAdminToast();

  async function handleConfirm(close: () => void) {
    if (isDeleting) return;
    setIsDeleting(true);
    setError(null);

    const result = await deleteAction();
    setIsDeleting(false);

    if (!result.ok) {
      haptic("error");
      if (result.error === "unauthorized") {
        close();
        showToast(labels.permissionDeniedMessage, true);
        return;
      }
      setError(labels.deleteFailed);
      return;
    }

    haptic("light");
    router.push(redirectTo);
  }

  return (
    <>
      <button
        aria-label={labels.deleteRecord}
        className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm font-bold text-destructive transition-colors hover:bg-destructive/15"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {labels.deleteRecord}
      </button>

      {open ? (
        <BottomSheet
          ariaLabel={labels.confirmTitle}
          header={
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-red-50 text-red-500 ring-1 ring-red-200/70">
                <AlertTriangle className="size-7" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-lg font-black tracking-tight text-foreground">
                  {labels.confirmTitle}
                </h3>
                <p className="mt-1 text-[13px] font-semibold text-muted-foreground">
                  {labels.confirmBody}
                </p>
              </div>
            </div>
          }
          onClose={() => {
            setOpen(false);
            setError(null);
          }}
        >
          {({ close }) => (
            <>
              <div className="mt-3 w-full rounded-2xl border border-border/60 bg-muted/40 px-3 py-2.5">
                <p className="truncate text-sm font-black text-foreground">{title}</p>
              </div>
              {error ? (
                <p className="mt-3 text-center text-xs font-semibold text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-background/70 text-sm font-bold text-foreground transition-colors hover:bg-muted/70 disabled:opacity-40"
                  disabled={isDeleting}
                  onClick={() => {
                    if (isDeleting) return;
                    setError(null);
                    close();
                  }}
                  type="button"
                >
                  {labels.cancel}
                </button>
                <button
                  className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-red-500 text-sm font-black text-white transition-colors hover:bg-red-600 disabled:opacity-40"
                  disabled={isDeleting}
                  onClick={() => handleConfirm(close)}
                  type="button"
                >
                  {isDeleting ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                  {labels.deletePermanently}
                </button>
              </div>
            </>
          )}
        </BottomSheet>
      ) : null}

      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </>
  );
}
