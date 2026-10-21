import { MobileShellPlaceholder } from "@/components/shell/mobile-shell-placeholder";

// 모바일 모든 화면 공용 로딩(2026-10-14 로더 → 2026-10-21 셸 자리 로딩). 화면 데이터가 오기 전에 탭바 · 위 줄을 그대로 둔 채
// 본문 칸이 먼저 밀려 들어오고, 0.3초 넘게 걸리면 그 자리에 로더가 보인다. 섹션 안 이동(목록 → 상세 · 새로 쓰기)도 같은
// 로딩을 보이도록 하위 화면이 있는 폴더마다 이 파일을 다시 내보낸다(`docs/product/16-mobile-navigation.md` 「화면 전환」).
export default function Loading() {
  return <MobileShellPlaceholder />;
}
