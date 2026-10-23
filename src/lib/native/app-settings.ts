/**
 * 이 앱의 OS 설정 화면 열기 (2026-10-23, docs/product/41 §10).
 *
 * 카메라 권한을 거부하면 다시 묻지 않으므로(iOS · Android 「다시 묻지 않음」) 사용자가 설정에서 직접 켜야 한다.
 * - iOS: `app-settings:` 주소(UIApplication.openSettingsURLString). Capacitor 가 앱 밖 주소를 OS 로 넘겨 설정 앱의 이 앱 화면이 열린다
 *   — 플러그인 불필요.
 * - Android: 앱 안 플러그인 `AppSettings`(android/app/.../AppSettingsPlugin.java)가 「앱 정보」 화면을 연다. 이 플러그인이 없는
 *   옛 앱 빌드에서는 열 수 없다고 답한다(버튼을 그리지 않는다).
 * - 브라우저 · PWA: 열 수 없다(브라우저 설정은 웹이 열 수 없다).
 */

import { hasNativePlugin, nativePlatform } from "@/lib/native-app";

export function canOpenAppSettings(): boolean {
  const platform = nativePlatform();
  if (platform === "ios") return true;
  if (platform === "android") return hasNativePlugin("AppSettings");
  return false;
}

export async function openAppSettings(): Promise<boolean> {
  const platform = nativePlatform();
  if (platform === "ios") {
    window.location.href = "app-settings:";
    return true;
  }
  if (platform === "android" && hasNativePlugin("AppSettings")) {
    try {
      const { registerPlugin } = await import("@capacitor/core");
      const plugin = registerPlugin<{ open: () => Promise<void> }>("AppSettings");
      await plugin.open();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
