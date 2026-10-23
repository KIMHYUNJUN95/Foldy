/**
 * OS 문서 스캐너로 카드 한 면 찍기 (2026-10-23, docs/product/41 §10 · docs/planning/17).
 *
 * 앱(iOS · Android)에서만. 카드 네 모서리를 OS 가 찾아 저절로 찍고 기울기를 펴 준다.
 * - iOS: VisionKit `VNDocumentCameraViewController`(iOS 13+). 여러 장을 찍을 수 있는 화면이라 **첫 장만** 쓴다.
 *   쪽수 제한(`maxNumDocuments`) · 찍은 뒤 미리보기(`letUserAdjustCrop` · `reviewCapturedDocument`)는 이 플러그인이 VisionKit 비공개
 *   클래스를 바꿔치기(swizzle)해서 구현하므로 **넘기지 않는다** — 넘기지 않으면 공개 API 만 쓴다(App Store 2.5.2).
 * - Android: Google ML Kit Document Scanner(Google Play 서비스 안에서 돈다 — 앱 카메라 권한 불필요). `maxNumDocuments: 1` 은
 *   ML Kit 공식 `setPageLimit(1)`. Play 서비스가 없거나(일부 기기) 에뮬레이터면 실패로 답한다 → 웹 카메라로.
 * - 브라우저 · PWA · 플러그인이 없는 옛 앱 빌드: `canUseDocumentScanner()` 가 false — 웹 카메라(getUserMedia)를 쓴다.
 *
 * 플러그인: `@capgo/capacitor-document-scanner`(Capacitor 8). 결과는 base64 JPEG — 원격 주소로 띄운 웹(`server.url`)에서
 * 파일 경로를 읽는 것보다 확실하다. 받는 쪽(`IdCardCamera`)이 긴 변 2000px · 품질 0.92 JPEG 로 다시 만든다.
 */

import { hasNativePlugin, nativePlatform } from "@/lib/native-app";

export type CardScanResult = { kind: "image"; blob: Blob } | { kind: "cancel" } | { kind: "error" };

export function canUseDocumentScanner(): boolean {
  return nativePlatform() !== null && hasNativePlugin("DocumentScanner");
}

let inflight: Promise<CardScanResult> | null = null;

async function run(): Promise<CardScanResult> {
  try {
    const { DocumentScanner, ResponseType, ScanDocumentResponseStatus, ScannerMode } = await import(
      "@capgo/capacitor-document-scanner"
    );
    const result = await DocumentScanner.scanDocument(
      nativePlatform() === "android"
        ? {
            responseType: ResponseType.Base64,
            maxNumDocuments: 1,
            // 필터 · 얼룩 지우기 없이(사진 · 홀로그램이 그대로 보여야 한다). 자르기 · 돌리기는 늘 있다.
            scannerMode: ScannerMode.Base,
            croppedImageQuality: 95,
          }
        : {
            responseType: ResponseType.Base64,
            croppedImageQuality: 95,
            letUserAdjustCrop: false,
            reviewCapturedDocument: false,
          },
    );
    if (result.status === ScanDocumentResponseStatus.Cancel) return { kind: "cancel" };
    const first = result.scannedImages?.[0];
    if (!first) return { kind: "cancel" };
    const src = first.startsWith("data:") ? first : `data:image/jpeg;base64,${first}`;
    const blob = await (await fetch(src)).blob();
    return blob.size > 0 ? { kind: "image", blob } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/** 스캐너를 연다. 이미 열려 있으면 같은 결과를 기다린다(두 번 열지 않는다). */
export function scanCardSide(): Promise<CardScanResult> {
  inflight ??= run().finally(() => {
    inflight = null;
  });
  return inflight;
}
