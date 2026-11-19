"use client";

import { useEffect, useRef } from "react";
import {
  composerDrafts,
  decideDraftAction,
  draftScope,
  notifyDraftSent,
  shouldEmptyRestoredField,
  subscribeDraftSent,
} from "@/lib/guest-messages/composer-draft";

const SAVE_DELAY_MS = 400;

/**
 * 답장 칸 글을 대화마다 탭 세션에 보관한다(보이는 것은 하나도 안 바뀐다).
 * - 열릴 때(효과 안 — 서버 그림과 어긋나지 않게) 보관된 글이 있으면 `onRestore` 로 한 번 돌려준다. 포커스는 건드리지 않는다.
 * - 글이 바뀌면 400ms 뒤 저장, 비면 바로 지운다(보내기 성공 · 직접 지움 모두 「글이 비었다」로 한 곳에서 처리).
 *   보내기 실패는 글이 그대로라 보관도 그대로.
 * - 대화를 바꾸거나 닫을 때 · 탭이 숨겨질 때(pagehide · visibilitychange) 밀린 저장을 바로 쓴다.
 * - `enabled` 가 false(내부 메모 칸)면 글을 쓰지 않는다 — 메모는 보관 대상이 아니다.
 */
export function useComposerDraft({
  organizationId,
  conversationId,
  text,
  enabled,
  isUntouchedAuto,
  onRestore,
  onSentElsewhere,
}: {
  organizationId: string;
  conversationId: string;
  text: string;
  enabled: boolean;
  /** 직원이 아직 손대지 않은 자동 글(「해결됐어요」 · AI 초안)인가 — 그런 글은 보관하지 않는다. */
  isUntouchedAuto: (text: string) => boolean;
  onRestore: (saved: string) => void;
  /** 보내는 중 나갔다 다시 연 화면 — 다른 화면에서 같은 글이 보내졌고 이 칸은 되살린 그대로면 비운다. */
  onSentElsewhere: () => void;
}) {
  const scope = draftScope(organizationId, conversationId);
  const latest = useRef({ scope, text, enabled, isUntouchedAuto, onRestore, onSentElsewhere });
  /** 되살린 글이 칸에 들어오기 전의 낡은 글로 보관을 지우지 않게 — 되살리는 중에는 저장을 건너뛴다. */
  const restoring = useRef<string | null>(null);
  /** 되살린 글(고치지 않았는지 비교용) · 이 화면을 알리는 표식(자기 알림을 건너뛰기). */
  const restoredText = useRef<string | null>(null);
  const self = useRef({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latest.current = { scope, text, enabled, isUntouchedAuto, onRestore, onSentElsewhere };
  });

  useEffect(() => {
    const saved = composerDrafts.get(scope);
    restoredText.current = saved;
    const unsubscribe = subscribeDraftSent(scope, (sentText, source) => {
      if (source === self.current) return;
      const cur = latest.current;
      if (shouldEmptyRestoredField({ restoredText: restoredText.current, currentText: cur.text, sentText })) {
        restoredText.current = null;
        cur.onSentElsewhere();
      }
    });
    if (saved) {
      restoring.current = saved;
      latest.current.onRestore(saved);
    }
    const flush = () => {
      const cur = latest.current;
      const action = decideDraftAction({
        text: cur.text,
        enabled: cur.enabled,
        restoring: restoring.current !== null,
        untouchedAuto: cur.isUntouchedAuto(cur.text),
      });
      if (action !== "save") return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      composerDrafts.set(cur.scope, cur.text);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [scope]);

  useEffect(() => {
    if (restoring.current !== null && text === restoring.current) restoring.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const action = decideDraftAction({
      text,
      enabled,
      restoring: restoring.current !== null,
      untouchedAuto: latest.current.isUntouchedAuto(text),
    });
    if (action === "clear") composerDrafts.clear(scope);
    if (action !== "save") return;
    timer.current = setTimeout(() => {
      timer.current = null;
      composerDrafts.set(scope, text);
    }, SAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [scope, text, enabled]);

  /** 보내기가 받아들여졌을 때 — 화면이 이미 닫혔어도(상태로 못 비움) 저장소에서 바로 지운다. 밀린 저장도 취소. */
  return {
    clearDraft: (sentText: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      composerDrafts.clear(scope);
      notifyDraftSent(scope, sentText, self.current);
    },
    /** 내부 메모를 보냈을 때 — 저장된 답장 글이 방금 보낸 메모와 같을 때만 지운다(다른 글이면 둔다). */
    clearReplyDraftIfSame: (sentText: string) => {
      composerDrafts.clearIfSame(scope, sentText);
    },
  };
}
