import type { GuestMessageErrorKey } from "@/actions/guest-messages";

type WriteResult = { ok: true } | { ok: false; errorKey: GuestMessageErrorKey };

/**
 * 손님 메시지 쓰기를 늘 결과로 끝낸다 — 서버 액션이 던지면(네트워크 오류 · 서버 오류) `failed` 실패로 바꾼다.
 * 화면은 실패 결과로만 접은 줄을 다시 펴고(PC `leaving` · 칸 `tellList(null)`) 오류 토스트를 띄운다(47 §5-10 「줄 접힘」).
 */
export async function settleWrite<R extends WriteResult>(work: () => Promise<R>): Promise<R | { ok: false; errorKey: "failed" }> {
  try {
    return await work();
  } catch {
    return { ok: false, errorKey: "failed" };
  }
}
