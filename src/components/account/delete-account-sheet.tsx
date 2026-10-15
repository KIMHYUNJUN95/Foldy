"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { SubmitButton } from "@/components/ui/submit-button";
import { deleteAccount } from "@/app/account/actions";

type Copy = {
  cancel: string;
  deleteAccount: string;
  deleteAccountTitle: string;
  deleteAccountDesc: string;
  deleteAccountWarning: string;
  deleteAccountConfirm: string;
};

export function DeleteAccountSheet({ copy, triggerClassName }: { copy: Copy; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className={triggerClassName ?? "text-sm font-semibold text-destructive hover:underline"}
        onClick={() => setOpen(true)}
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
              <form action={deleteAccount} className="mt-4 space-y-2">
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
