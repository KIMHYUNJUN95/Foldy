/**
 * AI 답장 도우미 — 서버 액션 ↔ 화면 공용 모양(서버 · 화면 둘 다 import). docs/product/49-guest-message-ai-reply-assist.md §8
 *
 * 순수 타입 · 상수만. 서버 전용 코드는 `ai-assist-server.ts`, 액션은 `src/actions/guest-messages-assist.ts`.
 */

import type { GuestLang } from "@/lib/guest-messages/guest-info-model";

/** 정해 둔 문구 추천 하나 — 넣을 글은 기존 넣기 목록과 같은 모양(언어마다, 변수 채운 뒤). */
export type AssistSuggestion = {
  savedReplyId: string;
  title: string;
  /** 0~1 유사도(화면은 순서만 쓴다). */
  score: number;
};

/** 비슷한 과거 대화 하나(가리기 뒤 · 다른 손님 개인 정보 없음). */
export type AssistSimilar = {
  conversationId: string;
  /** 정본(ko) 건물 이름 — 화면이 `useBuildingName()` 으로 바꿔 그린다. */
  propertyName: string | null;
  askedAt: string;
  question: string;
  reply: string | null;
};

export type AssistOverview =
  /** 답이 필요 없는 마지막 메시지(짧은 인사 · 사진만 · 시스템) — 도우미 줄 숨김. */
  | { kind: "none" }
  /** 키 없음 · 외부 실패 · 권한 없음 — 도우미 줄 숨김(메시지함은 그대로). */
  | { kind: "unavailable" }
  | {
      kind: "ready";
      /** 이 묶음이 가리키는 손님 메시지(바뀌면 화면이 다시 부른다). */
      messageId: string;
      suggestions: AssistSuggestion[];
      similar: AssistSimilar[];
      /** 이번 달 한도에 닿음 — 「초안 만들기」 대신 한도 안내. 문구 추천은 계속. */
      capReached: boolean;
    };

/** 초안의 「확인 필요」 한 곳 — 초안 글 안의 정확한 부분 문자열. */
export type AssistCheck = { text: string; why: string };

export type AssistDraftResult =
  | {
      ok: true;
      kind: "draft";
      draftId: string;
      /** 보는 직원 언어(§8 결정). 비밀번호는 채웠거나 자리 표시(`placeholders` 에 남은 것)가 남아 있다. */
      text: string;
      lang: GuestLang;
      checks: AssistCheck[];
      /** 사람 판단 필요(취소 · 환불 · 결제 · 날짜/인원 변경 · 소음 · 보안 · 고장 · 청결 · 분실물 · 하루 상황 따라 다른 요청). */
      needsHuman: boolean;
      /** 화면에 보일 짧은 이유(보는 직원 언어). */
      reason: string | null;
      /** 초안에 남은 자리 표시 글(예: 「[출입 비밀번호]」) — 남아 있으면 보내기를 막는다. */
      placeholders: string[];
    }
  /** 그 예약에만 해당하는 질문 — 초안 없이 「직접 확인이 필요해요」. */
  | { ok: true; kind: "direct"; draftId: string; reason: string | null }
  | { ok: false; errorKey: "forbidden" | "invalid" | "not_found" | "cap" | "unavailable" | "failed" };

export const ASSIST_WRONG_REASONS = ["fact", "tone", "missing", "other"] as const;
export type AssistWrongReason = (typeof ASSIST_WRONG_REASONS)[number];

export type AssistEventKind = "pending" | "draft" | "direct" | "failed" | "wrong" | "sent_as_is" | "sent_edited" | "discarded";

export const ASSIST_LIMITS = { suggestions: 3, similar: 3, checks: 4, minScore: 0.55 } as const;
