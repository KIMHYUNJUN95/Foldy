/**
 * Lightweight haptic feedback.
 *
 * - **iOS · Android app (Capacitor):** `@capacitor/haptics` — the Taptic Engine on iOS, the system haptic
 *   motor on Android (2026-10-09, native quality N15). Without this the iOS app had no haptics at all.
 * - **Browser / PWA:** the Vibration API where it exists (Android Chrome). A safe no-op on iOS Safari /
 *   installed iOS PWAs, which do NOT expose `navigator.vibrate`.
 *
 * Call sites never check capability — `haptic()` can be called from any interaction handler. If the
 * installed app predates the haptics plugin (`hasNativePlugin`), it falls back to the Vibration API.
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
  if (!vibrate) return; // iOS Safari / standalone: unsupported — no-op.
  try {
    vibrate(PATTERNS[kind]);
  } catch {
    /* some browsers throw if called outside a user gesture — ignore */
  }
}
