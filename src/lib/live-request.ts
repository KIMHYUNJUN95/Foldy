/**
 * 조용한 갱신(폴링)의 서버 액션 시간 제한(2026-11-18).
 *
 * Next 16 은 서버 액션을 한 줄로 처리한다(`app-router-instance.js` 의 액션 줄). 액션이 진행 중일 때 화면 이동(NAVIGATE)이
 * 끼어들면 그 액션은 버려지고, 그사이 줄 끝에 붙은 액션은 **영영 보내지지도 끝나지도 않을 수 있다**(줄의 `last` 가 버려진
 * 액션을 가리킨 채 남음). 「받는 중이면 건너뜀」 잠금을 쓰는 폴링은 그 약속 하나에 묶여 다시는 읽지 않는다.
 * 시간 제한이 지나면 실패로 보고 잠금을 푼다 — 다음 주기의 새 액션은 줄이 비어 있으면 바로 나간다.
 */

/** 폴링 간격(10~30초)보다 길고, 느린 7일 읽기보다 넉넉하게. */
export const LIVE_REQUEST_TIMEOUT_MS = 20_000;

export class LiveRequestTimeout extends Error {
  constructor() {
    super("live request timed out");
    this.name = "LiveRequestTimeout";
  }
}

/** `ms` 안에 끝나지 않으면 `LiveRequestTimeout` 으로 실패한다. 늦게 온 원래 결과는 버린다. */
export function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LiveRequestTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
