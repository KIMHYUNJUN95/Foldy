"use client";

/**
 * 예약 패널 「출입 번호」 — PC 오른쪽 예약 패널 · 모바일 예약 정보 시트 공용. docs/product/47 §5-14 · §6-3 · Q9
 *
 * - 볼 수 있는 사람(서버가 준 참/거짓)에게만 그린다 — 부르는 쪽이 `canSee` 가 거짓이면 이 묶음을 아예 넣지 않는다.
 * - 번호는 「번호 보기」를 누를 때만 서버 액션으로 받는다(화면 처음 데이터에는 없음). 숨긴 동안은 번호 모양도 보이지 않는다.
 *   다시 누르면 숨기고 받은 번호를 버린다. 대화 · 건물 · 방이 바뀌면(부르는 쪽 `key`) 숨긴 상태로 처음부터.
 * - 권한 없음(`forbidden`)은 다시 시도 없이 안내만, 나머지 실패는 다시 시도. 복사는 공용 `copyText`(클립보드 안 되면 대체 복사).
 * - 줄마다 라벨 · 번호(고정폭 숫자) · 복사 단추. 복사 알림은 그 화면의 알림(PC `AdminToast` · 폰 `TaskToast`)으로.
 */

import { Copy, Lock } from "lucide-react";
import { useEffect, useId, useReducer, useRef } from "react";
import { getConversationAccessCodes } from "@/actions/guest-messages-access-codes";
import { fill, type GmCopy } from "@/components/guest-messages/gm-format";
import { accessCodesReducer, type ConversationAccessCode } from "@/lib/guest-messages/access-codes";
import { copyText } from "@/lib/copy-text";
import { haptic } from "@/lib/haptics";

export function AccessCodesSection({
  conversationId,
  copy,
  notify,
}: {
  conversationId: string;
  copy: GmCopy;
  /** 그 화면 알림 — 글만 넘긴다(PC `showToast` 둘째 값 · 폰 `show` 둘째 값은 뜻이 달라 넘기지 않는다). */
  notify: (message: string) => void;
}) {
  // 늦게 온 답 규칙은 `accessCodesReducer`(번호를 올려 맞지 않는 답은 버림 — 숨긴 뒤 번호가 다시 펴지지 않는다).
  const [view, dispatch] = useReducer(accessCodesReducer, { status: "hidden", request: 0 });
  // 상태의 `request` 와 같은 규칙(보기 · 숨기기마다 +1)으로 이벤트 안에서 올리는 거울 — 답이 지금 것인지 본다.
  const latest = useRef(0);
  const mounted = useRef(true);
  const bodyId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = async () => {
    const mine = ++latest.current;
    dispatch({ type: "start" });
    const result = await getConversationAccessCodes(conversationId).catch(() => null);
    if (!mounted.current) return;
    if (!result?.ok && mine === latest.current) haptic("error");
    dispatch({ type: "settle", request: mine, result });
  };

  const open = view.status !== "hidden";
  const toggle = () => {
    haptic("light");
    if (open) {
      latest.current += 1;
      dispatch({ type: "hide" });
      return;
    }
    void load();
  };

  const copyCode = async (code: ConversationAccessCode) => {
    try {
      await copyText(code.code);
      haptic("light");
      notify(copy.accessCodeCopied);
    } catch {
      haptic("error");
      notify(copy.accessCodeCopyFailed);
    }
  };

  return (
    <section className="gm-codes" aria-label={copy.accessCodesTitle}>
      <div className="gm-codes__head">
        <h3 className="gm-codes__title">
          <Lock size={13} strokeWidth={2} aria-hidden="true" />
          {copy.accessCodesTitle}
        </h3>
        <button type="button" className="gm-link gm-codes__toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          {open ? copy.accessCodesHide : copy.accessCodesShow}
        </button>
      </div>
      <p className="gm-hint gm-codes__hint">{copy.accessCodesHint}</p>
      {open ? null : (
        <p className="gm-codes__mask" aria-hidden="true">
          ••••••
        </p>
      )}
      {/* 알림 칸은 늘 그려 둔다 — 숨김(hidden) 칸 안의 aria-live 는 바뀌어도 읽히지 않는다. 안의 내용만 바뀐다. */}
      <div id={bodyId} aria-live="polite" aria-busy={view.status === "loading"}>
        {view.status === "loading" ? (
          <p className="gm-hint gm-codes__state">
            {copy.loading}
          </p>
        ) : view.status === "forbidden" ? (
          <p className="gm-hint gm-codes__state" role="alert">
            {copy.forbidden}
          </p>
        ) : view.status === "failed" ? (
          <p className="gm-hint gm-codes__state" role="alert">
            {copy.accessCodesFailed}{" "}
            <button type="button" className="gm-link gm-codes__retry" onClick={() => void load()}>
              {copy.retryLoad}
            </button>
          </p>
        ) : view.status === "shown" ? (
          view.codes.length === 0 ? (
            <p className="gm-hint gm-codes__state">{copy.accessCodesEmpty}</p>
          ) : (
            <ul className="gm-codes__list">
              {view.codes.map((code, index) => (
                <li key={`${code.kind}:${index}`} className="gm-codes__row">
                  <span className="gm-codes__label">{code.label}</span>
                  <span className="gm-codes__value">{code.code}</span>
                  <button
                    type="button"
                    className="gm-iconbtn-sm gm-codes__copy"
                    aria-label={fill(copy.accessCodeCopyAria, { label: code.label })}
                    onClick={() => void copyCode(code)}
                  >
                    <Copy size={16} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </section>
  );
}
