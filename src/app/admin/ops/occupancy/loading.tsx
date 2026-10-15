import { OpsMetricsLoading } from "@/components/admin/ops/ops-metrics-loading";
import { opsNavId } from "@/lib/ops-admin";

// 누르자마자 셸 + 화면 골격 — 서버가 예약을 읽는 동안 멈춘 것처럼 보이지 않게(2026-10-08).
export default function Loading() {
  return <OpsMetricsLoading activeItem={opsNavId("occupancy")} page="occupancy" />;
}
