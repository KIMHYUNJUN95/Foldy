"use client";

import { useSession } from "@/components/providers/session-provider";
import { AdminShell } from "@/components/shell/admin-shell";
import type { opsNavId } from "@/lib/ops-admin";
import { getDictionary } from "@/lib/i18n";
import { FoldyLoader } from "@/components/shared/foldy-loader";

/**
 * 매출 · 가동률 · 비교 화면의 로딩(2026-10-08 속도 · 2026-10-14 공용 막대 로더로 교체) — 누르자마자 셸 + 화면 모양이 뜬다. 서버가 예약 1만 행 넘게 읽는 동안
 * 클릭이 먹지 않은 것처럼 멈춰 있던 것. 셸은 브라우저 쪽 세션으로 그려서 서버를 기다리지 않는다(사이드바가 깜빡이지 않게).
 */
export function OpsMetricsLoading({ activeItem, page }: { activeItem: ReturnType<typeof opsNavId>; page?: "occupancy" | "revenue" }) {
  const { session } = useSession();
  const dictionary = getDictionary(session?.user.preferredLanguage ?? "ko");
  // 가동률 · 매출은 화이트 리디자인에서 머리 제목이 화면 이름이다(2026-10-15) — 로딩 중에도 같은 제목.
  const title = page === "occupancy" ? dictionary.opsOccupancy.title : page === "revenue" ? dictionary.opsRevenue.title : dictionary.opsAdmin.areaName;
  return (
    <AdminShell activeItem={activeItem} title={title}>
      <FoldyLoader />
    </AdminShell>
  );
}
