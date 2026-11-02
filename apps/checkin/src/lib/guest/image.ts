// 올린 파일이 정말 이미지인지 앞 바이트로 본다(이름 · Content-Type 은 믿지 않는다). 44 FR-W05: 이미지만 · 10MB.
export const MAX_PASSPORT_BYTES = 10 * 1024 * 1024;

export function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export const EXTENSION = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
