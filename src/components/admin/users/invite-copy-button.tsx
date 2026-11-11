"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { haptic } from "@/lib/haptics";

type InviteCopyButtonProps = {
  code: string;
  labels: { copy: string; copied: string; failed: string };
};

/**
 * 초대코드 복사 — 화이트 리디자인(2026-10-14, 시안 Invite-PC): 아이콘 버튼(툴팁 · aria-label).
 * 복사되면 그 자리가 「✓ 복사됨」(체크 그리기)으로 1.6초 바뀐다. 대체 복사(execCommand)는 `copyTextToClipboard` 공용.
 */
export function InviteCopyButton({ code, labels }: InviteCopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    const ok = await copyTextToClipboard(code);
    haptic(ok ? "success" : "error");
    setState(ok ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 1600);
  }

  if (state !== "idle") {
    return (
      <span className="usi-copied" role="status" style={state === "failed" ? { color: "#c5282e" } : undefined}>
        {state === "copied" ? <Check aria-hidden="true" strokeWidth={2.4} /> : null}
        {state === "copied" ? labels.copied : labels.failed}
      </span>
    );
  }
  return (
    <button type="button" className="usi-ib" onClick={copy} aria-label={labels.copy} title={labels.copy}>
      <Copy aria-hidden="true" />
    </button>
  );
}
