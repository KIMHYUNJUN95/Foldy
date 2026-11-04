"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { UserPlus } from "lucide-react";
import type { CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";

/**
 * 인원 · 하루 몫 초과 확인 창(문서 45 L6) — 사람 넣기 · 방 추가 · 교체가 같은 창을 쓴다. 막지 않고 확인만 받는다.
 * Esc 는 이 창만 닫는다(아래 창의 입력을 잃지 않게). Enter 로 바로 넣을 수 있게 확인 버튼에 처음 포커스.
 */
export function OverfillConfirm({
  copy,
  title,
  body,
  hints,
  confirmLabel,
  busy,
  onKeep,
  onConfirm,
  children,
}: {
  copy: CleaningAssignCopy;
  title: string;
  body: string;
  hints: readonly string[];
  confirmLabel: string;
  busy: boolean;
  onKeep: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const latestKeep = useRef(onKeep);
  useEffect(() => {
    latestKeep.current = onKeep;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      latestKeep.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <>
      <div className="modal-scrim on" onClick={onKeep} />
      <div className="modal on cas-modal cas-over" role="alertdialog" aria-modal="true" aria-labelledby="cas-over-t" aria-describedby="cas-over-d">
        <div className="cas-over__h">
          <span className="cas-over__ic" aria-hidden="true">
            <UserPlus />
          </span>
          <h3 id="cas-over-t">{title}</h3>
        </div>
        <p id="cas-over-d" className="cas-over__body">
          {body}
        </p>
        {children}
        {hints.map((hint) => (
          <p key={hint} className="cas-over__hint">
            {hint}
          </p>
        ))}
        <div className="cas-modal__f is-even">
          <button type="button" className="cas-btn is-gray" onClick={onKeep}>
            {copy.overKeep}
          </button>
          <button type="button" className="cas-btn is-pri" autoFocus disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
        <span className="cas-over__keys">{copy.overKeys}</span>
      </div>
    </>
  );
}
