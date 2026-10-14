"use client";

// 공용 로딩(2026-10-14, 시안 Motion-B-Loading-Phone · Motion-B-Loading-PC) — 회색 깜빡이 상자 대신 로고 세 막대가 모였다 흩어지며 숨 쉰다.
// 로딩이 걸리는 모든 화면(모바일 · PC)이 이 하나를 쓴다. 0.3초 안에 끝나면 보이지 않는다(CSS 지연 등장 — 빠른 이동에서 깜빡임 없음).
// 글자는 브라우저 쪽 세션의 언어로 고른다(서버를 기다리지 않게).
import { useSession } from "@/components/providers/session-provider";
import { getDictionary } from "@/lib/i18n";
import "./foldy-loader.css";

export function FoldyLoader({ fill = false }: { fill?: boolean }) {
  const { session } = useSession();
  const label = getDictionary(session?.user.preferredLanguage ?? "ko").opsRevenue.loading;
  return (
    <div className={`fldr${fill ? " fldr--fill" : ""}`} role="status" aria-busy="true" aria-label={label}>
      <div className="fldr__in">
        <span className="fldr__bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="fldr__t">{label}</span>
      </div>
    </div>
  );
}
