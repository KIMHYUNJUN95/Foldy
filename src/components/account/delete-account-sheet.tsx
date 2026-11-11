"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { SubmitButton } from "@/components/ui/submit-button";
import { deleteAccount } from "@/app/account/actions";
import { haptic } from "@/lib/haptics";

type Copy = {
  cancel: string;
  deleteAccount: string;
  deleteAccountTitle: string;
  deleteAccountDesc: string;
  deleteAccountWarning: string;
  deleteAccountConfirm: string;
  /** 마지막 활성 대표라 탈퇴할 수 없을 때(서버 코드 `last_owner`). */
  lastOwner: string;
  /** 그 밖의 실패 · 네트워크 끊김. */
  failed: string;
};

/** 서버가 에러 코드를 돌려주는 경우(대표 보호). 성공이면 서버가 redirect 하므로 돌아오지 않는다. */
type DeleteResult = { error?: string } | void | undefined;

export function DeleteAccountSheet({ copy, triggerClassName }: { copy: Copy; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setError(null);
    try {
      const result = (await deleteAccount()) as unknown as DeleteResult;
      if (result && result.error) {
        haptic("error");
        setError(result.error === "last_owner" ? copy.lastOwner : copy.failed);
      }
    } catch {
      haptic("error");
      setError(copy.failed);
    }
  }

  return (
    <>
      <button
        className={triggerClassName ?? "text-sm font-semibold text-destructive hover:underline"}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        type="button"
      >
        {copy.deleteAccount}
      </button>

      {open ? (
        <BottomSheet
          ariaLabel={copy.deleteAccountTitle}
          header={
            <h3 className="text-xl font-black">{copy.deleteAccountTitle}</h3>
          }
          onClose={() => setOpen(false)}
        >
          {({ close }) => (
            <>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {copy.deleteAccountDesc}
              </p>
              <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm font-semibold text-destructive">
                {copy.deleteAccountWarning}
              </div>
              {error ? (
                <p className="mt-3 text-sm font-semibold text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <form action={onDelete} className="mt-4 space-y-2">
                <SubmitButton
                  className="h-12 w-full rounded-xl font-black"
                  variant="destructive"
                >
                  {copy.deleteAccountConfirm}
                </SubmitButton>
                <Button
                  className="h-12 w-full rounded-xl"
                  onClick={close}
                  type="button"
                  variant="secondary"
                >
                  {copy.cancel}
                </Button>
              </form>
            </>
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}
