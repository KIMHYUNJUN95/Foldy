import { AdminRouteLoading } from "@/components/shared/admin-route-loading";

// PC 모든 화면 공용 로딩(2026-10-14) — 화면에 따로 loading.tsx 가 없으면 이게 뜬다. 0.3초 넘게 걸릴 때만 보인다.
export default function Loading() {
  return <AdminRouteLoading />;
}
