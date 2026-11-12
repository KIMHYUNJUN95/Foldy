"use client";

/**
 * 목록 위 「받는 통로 멈춤」 경고 줄 — `guest_messages.manage` 만, 마지막 웹훅 뒤 `stall_hours` 가 지났을 때만(시안 States).
 * 「지금 확인하기」 = 보정 조회 한 번(`checkGuestMessagesNow`, 크레딧 판단은 보정 조회가 한다). PC · 모바일 공용. docs/product/47 §6-2
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { checkGuestMessagesNow } from "@/actions/guest-messages-settings";
import { fill, formatWhen, reasonText, type GmCopy } from "@/components/guest-messages/gm-format";
import { haptic } from "@/lib/haptics";
import type { StallNotice } from "@/lib/guest-messages/channel-overview-server";

export function StallNoticeLine({
  notice,
  copy,
  locale,
  notify,
}: {
  notice: StallNotice | null;
  copy: GmCopy;
  locale: string;
  notify: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!notice?.stalled) return null;

  const check = () => {
    startTransition(async () => {
      const result = await checkGuestMessagesNow();
      if (result.ok) {
        haptic(result.pages > 0 ? "success" : "warning");
        notify(
          result.pages === 0 && (result.skipped ?? result.stoppedEarly)
            ? fill(copy.checkNowSkipped, { reason: reasonText(result.skipped ?? result.stoppedEarly, copy) })
            : fill(copy.checkNowDone, { n: result.added }),
        );
        router.refresh();
      } else {
        haptic("error");
        notify(result.errorKey === "too_soon" ? copy.checkNowTooSoon : result.errorKey === "forbidden" ? copy.forbidden : copy.checkNowFailed);
      }
    });
  };

  return (
    <div className="gm-stall" role="status">
      <span className="gm-stall__text">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
        {notice.never ? copy.stallLineNever : fill(copy.stallLine, { h: notice.stallHours })}
      </span>
      <span className="gm-stall__row">
        <span className="gm-hint">
          {notice.lastReconcileAt ? fill(copy.stallLineChecked, { time: formatWhen(notice.lastReconcileAt, locale, new Date()) }) : null}
        </span>
        <button type="button" className="gm-btn gm-btn--sm" disabled={pending} onClick={check}>
          {pending ? copy.checkingNow : copy.checkNow}
        </button>
      </span>
    </div>
  );
}
