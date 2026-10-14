import { FoldyLoader } from "@/components/shared/foldy-loader";

// 모바일 모든 화면 공용 로딩(2026-10-14, 시안 Motion-B-Loading-Phone) — 화면에 따로 loading.tsx 가 없으면 이게 뜬다.
// 모바일 셸은 페이지마다 그려서 여기선 화면 가운데 로더만(틀은 다음 단계). 0.3초 넘게 걸릴 때만 보인다.
export default function Loading() {
  return <FoldyLoader fill />;
}
