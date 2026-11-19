"use client";

import { type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadAutomationLive } from "@/actions/ops-automation";
import type { AutomationLiveData, AutomationPageData } from "@/lib/automation/console-data";
import {
  AUTOMATION_MIN_GAP_MS,
  AUTOMATION_POLL_MS,
  draftSubmitOf,
  draftSyncOf,
  draftVersionOf,
  editDraft,
  holdDraft,
  judgeLivePoll,
  liveRefreshDue,
  pickLiveData,
  reconcileDraft,
  releaseDraft,
  settleDraft,
  type DraftSubmit,
  type DraftSync,
  type LivePolled,
} from "@/lib/automation/live-view";
import { LIVE_REQUEST_TIMEOUT_MS, settleWithin } from "@/lib/live-request";

/**
 * 자동화 관제실 실시간(PC · 모바일 공용, 2026-11-18). 서버 그림(props)을 받아 탭이 보일 때 15초마다 · 탭 · 창 복귀 때
 * 우리 DB 만 다시 읽는다(`loadAutomationLive` — Beds24 · 크레딧 없음). 실패는 조용히 지금 값 유지.
 * 판정: `src/lib/automation/live-view.ts` · 문서 36 「실시간(2026-11-18)」.
 */
export function useAutomationLive(props: AutomationPageData): AutomationPageData {
  const [polled, setPolled] = useState<LivePolled<AutomationPageData, AutomationLiveData> | null>(null);
  const shown = useMemo(() => pickLiveData(props, polled), [props, polled]);

  // 요청 순번 — 나중에 보낸 요청의 응답만 값을 바꾼다. 요청을 보낸 뒤 서버 그림이 새로 왔으면 그쪽이 이긴다.
  const issued = useRef(0);
  const applied = useRef(0);
  const inFlight = useRef(false);
  const lastFetchedAt = useRef(0);
  const propsRef = useRef(props);
  const shownRef = useRef<AutomationPageData>(shown);
  useEffect(() => {
    propsRef.current = props;
    shownRef.current = shown;
  }, [props, shown]);

  const refresh = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastFetchedAt.current = Date.now();
    const token = ++issued.current;
    const basedOn = propsRef.current;
    // 끝나지 않는 액션(Next 액션 줄에서 잃어버린 요청)에 잠금이 묶이지 않게 시간 제한 — 지나면 실패와 같다(조용히 지금 값).
    settleWithin(loadAutomationLive(), LIVE_REQUEST_TIMEOUT_MS)
      .then((result) => {
        if (!result.ok) return;
        const verdict = judgeLivePoll({
          appliedToken: applied.current,
          basedOn,
          currentProps: propsRef.current,
          next: result.data,
          shown: shownRef.current,
          token,
        });
        if (verdict === "stale" || verdict === "superseded") return;
        applied.current = token;
        if (verdict === "apply") setPolled({ basedOn, data: result.data });
      })
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
      });
  }, []);

  useEffect(() => {
    // 서버가 막 그린 값이 있으니 그 시각부터 센다.
    lastFetchedAt.current = Date.now();
    const tryRefresh = () => {
      if (
        liveRefreshDue({
          inFlight: inFlight.current,
          lastFetchedAt: lastFetchedAt.current,
          minGapMs: AUTOMATION_MIN_GAP_MS,
          now: Date.now(),
          visible: document.visibilityState === "visible",
        })
      ) {
        refresh();
      }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, AUTOMATION_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tryRefresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tryRefresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", tryRefresh);
    };
  }, [refresh]);

  return shown;
}

/**
 * 설정 초안 — 서버 값(폴링 · 저장 뒤 새 그림)이 바뀌어 들어와도 손대던 중이면 덮지 않는다. `version` 은 그 그림의
 * 설정 줄 버전(`job.version`). 저장할 때 `submit()` 표를 받고(그때부터 들어온 그림은 미뤄 둠), 성공하면
 * `settle(표, 결과.version, 결과.saved)`, 실패 · 예외면 `release()` — 판정은 `live-view.ts` 의 `alignDraft` 하나.
 */
export function useAutomationDraft<T>(original: T, version: string | null) {
  const originalVersion = draftVersionOf(version);
  const [state, setState] = useState<DraftSync<T>>(() => draftSyncOf(original, originalVersion));
  let current = state;
  const next = reconcileDraft(state, original, originalVersion);
  if (next !== state) {
    current = next;
    setState(next);
  }
  const setDraft = useCallback(
    (update: SetStateAction<T>) =>
      setState((s) => editDraft(s, (value) => (typeof update === "function" ? (update as (value: T) => T)(value) : update))),
    [],
  );
  const submit = () => {
    const ticket = draftSubmitOf(current);
    setState((s) => holdDraft(s));
    return ticket;
  };
  const settle = useCallback(
    (ticket: DraftSubmit, savedVersion: string, saved: T) => setState((s) => settleDraft(s, ticket, draftVersionOf(savedVersion), saved)),
    [],
  );
  const release = useCallback(() => setState((s) => releaseDraft(s)), []);
  return { dirty: JSON.stringify(current.draft) !== current.base, draft: current.draft, release, setDraft, settle, submit };
}
