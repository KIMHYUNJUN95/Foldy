"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { haptic } from "@/lib/haptics";

// 설정 화면의 확인 창(2026-10-15 화이트 리디자인) — QR 다시 발급 · 현장 삭제 · 조직 삭제.
// 「그대로 두기 / 실행」 두 버튼, 첫 초점은 「그대로 두기」(Enter 한 번에 되돌리기 어려운 일이 일어나지 않게).
// 실행은 서버 액션 폼 제출이라 확인 뒤 흐름(redirect · 결과 한 줄)은 기존 그대로다.

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  trigger: string;
  triggerClassName: string;
  title: string;
  body: string;
  keep: string;
  ok: string;
  danger?: boolean;
};

function OkButton({ label, danger }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`stw-btn ${danger ? "is-danger" : "is-pri"}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

export function SettingsConfirm({ action, fields, trigger, triggerClassName, title, body, keep, ok, danger }: Props) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 한 프레임 뒤에 .on — 공용 .modal 전환(살짝 아래에서 떠오름)이 보이게.
    const raf = requestAnimationFrame(() => setShown(true));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
      setShown(false);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => {
          haptic("light");
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      {open ? (
        <>
          <div className={`modal-scrim stw-scrim${shown ? " on" : ""}`} onClick={() => setOpen(false)} />
          <div className={`modal stw-modal${shown ? " on" : ""}`} role="alertdialog" aria-modal="true" aria-label={title}>
            <h2>{title}</h2>
            <p>{body}</p>
            <form action={action} className="stw-modal__f">
              {Object.entries(fields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <button type="button" className="stw-btn is-gray" onClick={() => setOpen(false)} autoFocus>
                {keep}
              </button>
              <OkButton label={ok} danger={danger} />
            </form>
          </div>
        </>
      ) : null}
    </>
  );
}
