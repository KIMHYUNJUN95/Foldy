/**
 * 화면에서 서버 액션을 부를 때 던짐을 결과로 바꾼다(2026-11-11). 네트워크가 끊기거나 서버가 죽으면 액션은 결과 대신
 * 던진다 — 그대로 두면 `startTransition` 안에서 조용히 사라지거나 「바쁨」 표시가 풀리지 않는다. 부르는 쪽은 `thrown` 이면
 * error 햅틱 + 실패 문구를 보인다.
 */
export async function settleAction<T>(
  fn: () => Promise<T>,
): Promise<{ thrown: false; value: T } | { thrown: true }> {
  try {
    return { thrown: false, value: await fn() };
  } catch (error) {
    console.warn("[settleAction] server action threw", error);
    return { thrown: true };
  }
}
