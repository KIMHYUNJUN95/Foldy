"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

// 설정 패널의 「복사」 아이콘(2026-11-12 — 조직 주소 이름). 성공하면 잠깐 체크로 바뀌고, 결과는 읽어 주기 칸으로 알린다.
export function CopyTextButton({
  text,
  labels,
}: {
  text: string;
  labels: { copy: string; copied: string; failed: string };
}) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <>
      <button
        type="button"
        className={`stw-icon${state === "ok" ? " is-green" : ""}`}
        aria-label={labels.copy}
        title={labels.copy}
        onClick={async () => setState((await copyTextToClipboard(text)) ? "ok" : "fail")}
      >
        {state === "ok" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </button>
      <span className={`stw-copy-msg${state === "fail" ? " is-red" : ""}`} role="status">
        {state === "ok" ? labels.copied : state === "fail" ? labels.failed : ""}
      </span>
    </>
  );
}
