"use client";

/**
 * 업무 상세의 「손님 메시지에서」 링크(6단계, 2026-11-13). docs/product/47-guest-messaging.md §6-4
 *
 * 수리 · 점검 / 분실물 / 할 일 / 게스트 피드백 상세(PC 패널 · 모바일 화면)에 한 줄. 그 업무가 손님 메시지에서 만들어졌고
 * 보는 사람이 `guest_messages.view` 를 가졌을 때만 그린다 — 서버 액션이 권한을 보고, 아니면 아무것도 그리지 않는다.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { getGuestMessageLinkForTarget } from "@/actions/guest-message-tasks";
import { getDictionary } from "@/lib/i18n";
import { conversationHref, type LinkSurface, type LinkTargetType } from "@/lib/guest-messages/task-link-model";
import "@/components/guest-messages/guest-messages.css";

export function GuestMessageBackLink({
  targetType,
  targetId,
  surface,
  locale,
}: {
  targetType: LinkTargetType;
  targetId: string;
  surface: LinkSurface;
  locale: string;
}) {
  const [found, setFound] = useState<{ id: string; conversationId: string; guestName: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getGuestMessageLinkForTarget(targetType, targetId).then((result) => {
      if (!cancelled) setFound(result.ok ? { id: targetId, conversationId: result.conversationId, guestName: result.guestName } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [targetType, targetId]);
  if (!found || found.id !== targetId) return null;
  const copy = getDictionary(locale === "ja" || locale === "en" ? locale : "ko").guestMessages;
  return (
    <Link className="gm-backlink" href={conversationHref(found.conversationId, surface)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
      {found.guestName ? copy.backLinkWith.replace("{name}", found.guestName) : copy.backLinkLabel}
    </Link>
  );
}
