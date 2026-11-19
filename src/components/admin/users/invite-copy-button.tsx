"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { haptic } from "@/lib/haptics";

type InviteCopyButtonProps = {
  code: string;
  labels: { copy: string; copied: string; failed: string };
};

/**
 * 초대코드 복사 — 아이콘 단추(툴팁 · aria-label).
 * 2026-11-19: 복사되면 **같은 40×40 단추 안에서** 아이콘만 체크(실패면 ✕)로 1.6초 바뀐다. 예전엔 「✓ 복사됨」 글자 칩으로
 * 바뀌어 단추 묶음이 넓어지고 기한 칸 글자를 덮었다(ja 「コピーしました」 126px). 글자는 화면에 그리지 않고 숨김 상태 글
 * (`role="status"`)과 단추 `aria-label` 로만 알린다. 대체 복사(execCommand)는 `copyTextToClipboard` 공용.
 */
export function InviteCopyButton({ code, labels }: InviteCopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  async function copy() {
    const ok = await copyTextToClipboard(code);
    haptic(ok ? "success" : "error");
    setState(ok ? "copied" : "failed");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  }

  const label = state === "copied" ? labels.copied : state === "failed" ? labels.failed : labels.copy;
  return (
    <button
      type="button"
      className={`usi-ib usi-copy${state === "idle" ? "" : ` is-${state}`}`}
      onClick={copy}
      aria-label={label}
      title={labels.copy}
    >
      {state === "copied" ? (
        <Check key="ok" aria-hidden="true" strokeWidth={2.4} />
      ) : state === "failed" ? (
        <X key="bad" aria-hidden="true" strokeWidth={2.4} />
      ) : (
        <Copy key="idle" aria-hidden="true" />
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? labels.copied : state === "failed" ? labels.failed : ""}
      </span>
    </button>
  );
}
