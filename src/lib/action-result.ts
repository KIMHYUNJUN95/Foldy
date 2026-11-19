/**
 * 누르는 서버 액션(저장 · 켜기/끄기 · 지금 보내기)의 예외를 결과 모양으로 바꾼다(2026-11-19).
 * 네트워크 끊김 · 서버 오류로 액션이 던지면 `useTransition` 이 그 오류를 오류 경계로 올려 화면 전체가 「문제가 발생했어요」로
 * 바뀌고 초안이 사라진다. 결과가 실패일 때와 같은 길(같은 문구 · 햅틱 · 초안 유지)로 보내려고 `{ ok: false, error: fallback }` 을 돌려준다.
 */
export async function actionResult<T, E extends string>(call: () => Promise<T>, fallback: E): Promise<T | { ok: false; error: E }> {
  try {
    return await call();
  } catch (error) {
    console.warn("[action] threw — treated as failure", { fallback, name: error instanceof Error ? error.name : typeof error });
    return { error: fallback, ok: false };
  }
}
