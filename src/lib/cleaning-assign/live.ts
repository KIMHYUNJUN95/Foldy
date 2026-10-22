import "server-only";

import { signalBeds24Change } from "@/lib/beds24/live-signal";

/**
 * 「배정 · 신청이 바뀌었다」 신호 — 열려 있는 배정 화면(PC)과 내 시프트 · 오늘 내 방(모바일)이 새로고침 없이 다시 읽는다.
 * Beds24 실시간과 같은 조직 private 채널에 종류 `cleaning_assign` 으로 보낸다(데이터 없음, 신호만). 받는 화면은
 * `<Beds24LiveRefresh kinds={["cleaning_assign"]} />`. 배정 설정(담당마다 따로)은 남에게 보낼 일이 없어서 보내지 않는다.
 * docs/product/37-cleaning-shift-assignment.md 「실시간」
 */
export async function signalCleaningAssignChange(organizationId: string): Promise<void> {
  await signalBeds24Change(organizationId, "cleaning_assign");
}
