"use client";

import { useId, useState } from "react";
import { haptic } from "@/lib/haptics";

/**
 * 금액 칸 — 위 왼쪽에 걸친 이름 · 48px · 오른쪽 정렬 숫자. 포커스를 떠나거나 Enter 면 바뀐 값만 저장한다.
 * `signed` 면 왼쪽에 44px −/+ 버튼(지난달 조정 · 연말정산처럼 빼기도 하는 칸). 저장하는 동안은 입력한 값을 그대로 보여 준다.
 */
export function PayrollMoneyField({
  label,
  value,
  onCommit,
  signed = false,
  readOnly = false,
  hint,
  signLabel,
  describedBy,
}: {
  label: string;
  value: number;
  /** 저장이 끝나면 true, 실패하면 false — 실패하면 칸이 원래 값으로 돌아온다. */
  onCommit: (next: number) => Promise<boolean>;
  signed?: boolean;
  readOnly?: boolean;
  hint?: string;
  signLabel: string;
  describedBy?: string;
}) {
  const id = useId();
  const hintId = `${id}-h`;
  const [draft, setDraft] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<number | null>(null);
  const [seen, setSeen] = useState(value);
  const [negChoice, setNegChoice] = useState<boolean | null>(null);
  if (seen !== value) {
    setSeen(value);
    setOptimistic(null);
  }

  const shown = optimistic ?? value;
  const negative = negChoice ?? shown < 0;
  const abs = Math.abs(shown);

  const commit = async (signedValue: number) => {
    if (signedValue === shown) return;
    setOptimistic(signedValue);
    const ok = await onCommit(signedValue);
    if (!ok) setOptimistic(null);
    else if (signedValue !== 0) setNegChoice(null);
  };

  const finish = () => {
    if (draft === null) return;
    const digits = draft.replace(/\D/g, "");
    const n = digits === "" ? 0 : Math.min(Number(digits), 10_000_000);
    setDraft(null);
    void commit(signed && negative ? -n : n);
  };

  const display = draft ?? abs.toLocaleString("en-US");

  return (
    <span className="mpp-fl">
      <label htmlFor={id}>{label}</label>
      {signed && !readOnly ? (
        <button
          type="button"
          className="mpp-fl__sign"
          aria-label={`${label} · ${signLabel}`}
          // 입력 중에 눌러도 포커스가 안 떠나게 — 떠나면 옛 부호로 한 번 더 저장된다.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            haptic("light");
            const nextNegative = !negative;
            setNegChoice(nextNegative);
            if (draft === null && shown !== 0) void commit(-shown);
          }}
        >
          {negative ? "−" : "+"}
        </button>
      ) : null}
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="done"
        readOnly={readOnly}
        className={signed && !readOnly ? "has-sign" : undefined}
        value={display}
        aria-describedby={[hint ? hintId : null, describedBy ?? null].filter(Boolean).join(" ") || undefined}
        onFocus={(event) => {
          if (readOnly) return;
          setDraft(abs === 0 ? "" : String(abs));
          const el = event.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 8))}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {hint ? (
        <small id={hintId}>{hint}</small>
      ) : null}
    </span>
  );
}
