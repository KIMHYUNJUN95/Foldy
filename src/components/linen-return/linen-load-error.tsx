import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import "@/components/linen-return/linen-mobile.css";

/** 조회가 실패했을 때 「기록 없음」으로 보이지 않도록 화면 안에 보이는 안내 + 다시 시도 링크. */
export function LinenLoadError({ copy, retryHref }: { copy: Dictionary["linenReturn"]; retryHref: string }) {
  return (
    <div className="lnw">
      <div className="lnw-empty-state" role="alert">
        <b>{copy.loadFailedTitle}</b>
        <span>{copy.loadFailedSub}</span>
        <Link className="lnw-link" href={retryHref}>
          {copy.loadRetry}
        </Link>
      </div>
    </div>
  );
}
