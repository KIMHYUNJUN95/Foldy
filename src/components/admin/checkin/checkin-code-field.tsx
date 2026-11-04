"use client";

// 체크인 코드 칸(시안 S1c · S1d) — 평소엔 가림 → 「코드 보기」 → 큰 글자 → 「가리기」 · 5분 뒤 자동으로 가림.
// 코드는 이 컴포넌트의 상태에만 산다. 부모가 `key={stayId}` 로 그려서 다른 줄로 옮기면 상태째 사라진다.
// 직원이 대신 체크인을 끝내는 기능은 없다 — 코드를 말로 알려 주면 손님이 태블릿 「코드로 찾기」로 스스로 끝낸다.
import { useEffect, useReducer } from "react";
import { revealCheckinCode } from "@/actions/checkin/stays";
import type { CheckinStayStatus } from "@/lib/checkin/model";
import {
  CODE_INITIAL_STATE,
  codeAvailability,
  codeReducer,
  formatCheckinCode,
  toCodeErrorKey,
} from "@/lib/checkin/staff-view";
import { codeErrorMessage, type CheckinCopy } from "./checkin-copy";

export function CheckinCodeField({ stayId, status, copy }: { stayId: string; status: CheckinStayStatus; copy: CheckinCopy }) {
  const [state, dispatch] = useReducer(codeReducer, CODE_INITIAL_STATE);
  const availability = codeAvailability(status);

  // 보이는 동안만 1초마다 5분이 지났는지 본다.
  const shown = state.kind === "shown";
  useEffect(() => {
    if (!shown) return;
    const timer = window.setInterval(() => dispatch({ type: "tick", now: Date.now() }), 1000);
    return () => window.clearInterval(timer);
  }, [shown]);

  async function reveal() {
    if (state.kind === "loading" || state.kind === "shown") return;
    dispatch({ type: "request" });
    try {
      const result = await revealCheckinCode(stayId);
      if (result.ok) dispatch({ type: "success", code: result.code, now: Date.now() });
      else dispatch({ type: "failure", errorKey: toCodeErrorKey(result.errorKey) });
    } catch {
      dispatch({ type: "failure", errorKey: "failed" });
    }
  }

  // 끝남 · 기간 지남 · 취소는 서버를 부르지 않고 사유만 보여 준다.
  if (availability !== "available") {
    return (
      <section className="ck-sec" aria-label={copy.codeLabel}>
        <span className="ck-k">{copy.codeLabel}</span>
        <p className="ck-code__why">{codeErrorMessage(availability, copy)}</p>
      </section>
    );
  }

  return (
    <section className="ck-sec" aria-label={copy.codeLabel}>
      <div className="ck-code">
        <div className="ck-code__v">
          <span className="ck-k">{copy.codeLabel}</span>
          {state.kind === "shown" ? (
            <span className="ck-code__n is-shown" aria-label={state.code.split("").join(" ")}>
              {formatCheckinCode(state.code)}
            </span>
          ) : (
            <span className="ck-code__n is-hidden" aria-hidden="true">
              ••• •••
            </span>
          )}
        </div>
        {state.kind === "shown" ? (
          <button type="button" className="ck-btn is-sm" onClick={() => dispatch({ type: "hide" })}>
            {copy.codeHide}
          </button>
        ) : (
          <button type="button" className="ck-btn is-sm" onClick={() => void reveal()} disabled={state.kind === "loading"} aria-busy={state.kind === "loading"}>
            {state.kind === "loading" ? copy.codeChecking : copy.codeShow}
          </button>
        )}
      </div>
      <p className={`ck-soft${state.kind === "error" ? " is-red" : ""}`} role={state.kind === "error" ? "alert" : undefined} aria-live="polite">
        {state.kind === "error" ? codeErrorMessage(state.errorKey, copy) : state.kind === "shown" ? copy.codeHintShown : copy.codeHintHidden}
      </p>
    </section>
  );
}
