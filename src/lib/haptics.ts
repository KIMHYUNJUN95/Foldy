/**
 * 가벼운 햅틱 피드백.
 *
 * - **iOS · Android 앱(Capacitor):** `@capacitor/haptics` — iOS 는 Taptic Engine, Android 는 시스템 햅틱
 *     모터(2026-10-09, 네이티브 품질 N15). 이게 없으면 iOS 앱에는 햅틱이 전혀 없었다.
 * - **브라우저 / PWA:** 있는 곳에서는 Vibration API(Android Chrome). iOS Safari /
 *     설치된 iOS PWA 에서는 안전한 no-op — `navigator.vibrate` 를 노출하지 않는다.
 *
 * 호출부는 기능 여부를 확인하지 않는다 — `haptic()` 은 어떤 상호작용 핸들러에서든 호출할 수 있다.
 * 설치된 앱이 햅틱 플러그인보다 오래됐다면(`hasNativePlugin`) Vibration API 로 대체한다.
 *
 * **어느 진동을 쓰나 — 공용 규칙 (2026-10-22 네이티브급 움직임 점검).** 같은 일엔 어느 화면이든 같은 진동.
 * - `success` — 기록이 남는 일이 **서버 확인 뒤** 끝났을 때(저장 · 제출 · 신청 · 완료 · 승인). 누른 순간이 아니라 결과가 왔을 때.
 *   누르자마자 반영(`useOptimistic`)이면 그 순간에.
 * - `error` — 서버가 거절했거나 실패했을 때(오류 문구와 같이). 입력 검증으로 버튼이 막힌 건 진동 없음.
 * - `warning` — 일부만 됐을 때 · 되돌릴 수 없는 일을 꾹 눌러 확정하기 직전.
 * - `light` — 가벼운 조작: 고르기 · 토글 · 탭 전환 · 시트/토스트/메뉴를 밀어 치움 · 삭제 완료(지우기는 「성공」이 아니다) · 댓글 보냄.
 * - `medium` — 꾹 눌러 집기(끌어 옮기기 시작).
 * - 저장한 뒤 서버가 다른 화면으로 보내는 폼(`redirect`)은 진동 없이 화면 이동이 피드백이다.
 * 상세 docs/product/16-mobile-navigation.md 「햅틱 — 공용 규칙」.
 */
import { hasNativePlugin } from "@/lib/native-app";

export type HapticKind = "light" | "medium" | "success" | "warning" | "error";

const PATTERNS: Record<HapticKind, number | number[]> = {
  light: 8,
  medium: 14,
  success: [10, 40, 12],
  warning: [16, 60, 16],
  error: [24, 40, 24, 40, 24],
};

let nativeHaptics: Promise<typeof import("@capacitor/haptics")> | null = null;

function nativeHaptic(kind: HapticKind) {
  nativeHaptics ??= import("@capacitor/haptics");
  void nativeHaptics
    .then(({ Haptics, ImpactStyle, NotificationType }) => {
      switch (kind) {
        case "light":
          return Haptics.impact({ style: ImpactStyle.Light });
        case "medium":
          return Haptics.impact({ style: ImpactStyle.Medium });
        case "success":
          return Haptics.notification({ type: NotificationType.Success });
        case "warning":
          return Haptics.notification({ type: NotificationType.Warning });
        case "error":
          return Haptics.notification({ type: NotificationType.Error });
      }
    })
    .catch(() => undefined);
}

export function haptic(kind: HapticKind = "light"): void {
  if (typeof navigator === "undefined") return;
  if (hasNativePlugin("Haptics")) {
    nativeHaptic(kind);
    return;
  }
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return; // iOS Safari / 독립 실행: 미지원 — no-op.
  try {
    vibrate(PATTERNS[kind]);
  } catch {
    /* 일부 브라우저는 사용자 제스처 밖에서 호출하면 예외를 던진다 — 무시 */
  }
}
