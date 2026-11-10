"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncReviewsNowStep, type ReviewSyncStepResult } from "@/app/mobile/complaints/review-sync-actions";

/**
 * 외부 리뷰 **「지금 가져오기」** — 대시보드(`/admin/complaints`) · 모바일(`/mobile/complaints`) 공용 (2026-10-02).
 *
 * 도메인 계약: `docs/product/25-complaint-workflow.md` → 「지금 가져오기 (수동 수집)」
 *
 * 한 바퀴(약 70곳)가 60초 함수 상한에 안 들어가, 조각(약 12곳)마다 서버 액션을 **이어 부른다** — 진행률을
 * 「가져오는 중 24/71」로 보여 주고, 끝나면 목록을 다시 받는다. 끝난 뒤 10분은 잠근다(크레딧 보호 — 아침 정기
 * 수집도 포함). 잠금 · 권한 · Beds24 쿨다운은 서버가 다시 본다 — 여기 비활성화는 편의일 뿐이다.
 */
export type ReviewSyncButtonLabels = {
  button: string;
  /** `{done}` / `{total}` */
  running: string;
  /** `{time}` */
  last: string;
  never: string;
  /** `{time}` — 다시 누를 수 있는 시각 */
  availableAt: string;
  done: string;
  errForbidden: string;
  errPaused: string;
  errCooldown: string;
  errBusy: string;
  errLost: string;
  errCredits: string;
  errFailed: string;
};

type Props = {
  variant: "admin" | "mobile";
  lastSyncedAt: string | null;
  availableAt: string | null;
  running: boolean;
  localeTag: string;
  labels: ReviewSyncButtonLabels;
};

/** 시각 → 「10/1 10:58」(도쿄). 고정된 시각이라 서버 · 클라이언트가 같게 그린다. */
function tokyoShort(iso: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

export function ReviewSyncButton({ variant, lastSyncedAt, availableAt, running, localeTag, labels }: Props) {
  const router = useRouter();
  const [last, setLast] = useState(lastSyncedAt);
  const [lockedUntil, setLockedUntil] = useState<string | null>(availableAt);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const busyRef = useRef(false);

  // 서버가 새 상태를 내려 주면(새로고침 · 다른 사람이 돌림) 따라간다 — 렌더 중 이전 값과 비교(React 권장 방식).
  const [seenProps, setSeenProps] = useState({ availableAt, lastSyncedAt });
  if (seenProps.lastSyncedAt !== lastSyncedAt || seenProps.availableAt !== availableAt) {
    setSeenProps({ availableAt, lastSyncedAt });
    setLast(lastSyncedAt);
    setLockedUntil(availableAt);
  }

  // 잠금이 풀리는 시각에 버튼을 다시 연다 — 렌더 중에는 시계를 읽지 않는다.
  useEffect(() => {
    if (!lockedUntil) return;
    const wait = Math.max(0, new Date(lockedUntil).getTime() - Date.now());
    const timer = window.setTimeout(() => setLockedUntil(null), Math.min(wait + 500, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [lockedUntil]);

  const errorText = (result: Extract<ReviewSyncStepResult, { ok: false }>) => {
    switch (result.error) {
      case "forbidden":
        return labels.errForbidden;
      case "paused":
        return labels.errPaused;
      case "cooldown":
        return labels.errCooldown;
      case "too_soon":
        return labels.availableAt.replace("{time}", result.retryAt ? tokyoShort(result.retryAt, localeTag) : "");
      case "busy":
        return labels.errBusy;
      case "lost":
        return labels.errLost;
      case "credits":
        return labels.errCredits;
      default:
        return labels.errFailed;
    }
  };

  const run = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setMessage(null);
    setProgress({ done: 0, total: 0 });
    let runId: string | null = null;
    try {
      // 조각 수 상한 — 서버가 커서를 못 넘기는 일이 생겨도 무한히 돌지 않는다(대상 70곳 / 12 ≈ 6).
      for (let step = 0; step < 40; step += 1) {
        const result = await syncReviewsNowStep({ runId });
        if (!result.ok) {
          if (result.error === "too_soon" && result.retryAt) setLockedUntil(result.retryAt);
          setMessage({ bad: true, text: errorText(result) });
          if (result.error === "credits") router.refresh(); // 받은 만큼은 보여 준다
          return;
        }
        runId = result.runId;
        setProgress({ done: result.processed, total: result.total });
        if (result.done) {
          // 마지막 수집 시각은 서버가 정한다 — 새로 받은 값이 props 로 내려오면 위에서 따라간다(기기 시계로 계산하지 않는다).
          setMessage({ bad: false, text: labels.done });
          // 다시 누를 수 있는 시각은 서버가 같이 준다 — 새로고침 전에 눌러도 too_soon 이 나지 않게 바로 잠근다.
          if (result.availableAt) setLockedUntil(result.availableAt);
          router.refresh();
          return;
        }
      }
      setMessage({ bad: true, text: labels.errFailed });
    } catch {
      setMessage({ bad: true, text: labels.errFailed });
    } finally {
      busyRef.current = false;
      setProgress(null);
    }
  };

  const disabled = progress !== null || running || lockedUntil !== null;
  const buttonText = progress
    ? labels.running.replace("{done}", String(progress.done)).replace("{total}", progress.total ? String(progress.total) : "…")
    : labels.button;
  // 「마지막 수집 10/2 9:12」 + 잠겨 있으면 「· 9:22 이후 다시 가능」. 방금 누른 결과가 있으면 그것이 먼저.
  const lastText = last ? labels.last.replace("{time}", tokyoShort(last, localeTag)) : labels.never;
  const statusText = message
    ? message.text
    : lockedUntil
      ? `${lastText} · ${labels.availableAt.replace("{time}", tokyoShort(lockedUntil, localeTag))}`
      : lastText;
  const statusClass = message?.bad ? " is-bad" : "";

  if (variant === "admin") {
    return (
      <div className="cxsync">
        <button className="chipbtn" disabled={disabled} onClick={run} type="button">
          <RefreshCw aria-hidden="true" className={`ic${progress ? " cxsync__spin" : ""}`} />
          {buttonText}
        </button>
        <span className={`cxsync__s${statusClass}`} role="status">
          {statusText}
        </span>
      </div>
    );
  }

  return (
    <div className="cx-sync">
      <span className={`cx-sync__s${statusClass}`} role="status">
        {statusText}
      </span>
      <button className="cx-sync__btn" disabled={disabled} onClick={run} type="button">
        <RefreshCw aria-hidden="true" className={progress ? "cx-sync__spin" : undefined} size={14} />
        {buttonText}
      </button>
    </div>
  );
}
