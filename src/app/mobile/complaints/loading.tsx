import { FoldyLoader } from "@/components/shared/foldy-loader";

/**
 * 컴플레인 목록 로딩 — 2026-10-14 공용 막대 로더로 교체(예전 카드 골격).
 * 서버에서 필터 · 페이지 · 집계를 끝내고 내려오므로 첫 페인트까지 왕복이 한 번 있다. 빈 화면이면 «데이터가 없다» 와 구분되지 않아
 * «오는 중»임을 알린다. 0.3초 안에 끝나면 보이지 않는다.
 */
export default function Loading() {
  return <FoldyLoader fill />;
}
