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

export const MAX_FACE_VIDEO_BYTES = 4 * 1024 * 1024;

const VIDEO_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "qt  "]);

/** MP4 · 3GP · MOV 는 4~8번째 바이트가 「ftyp」, 8~12번째가 허용 브랜드. 이름 · Content-Type 은 믿지 않는다(HEIC · AVIF · M4A 는 거절). */
export function sniffVideoType(bytes: Uint8Array): "video/mp4" | null {
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp") return null;
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  return VIDEO_BRANDS.has(brand) || brand.startsWith("3gp") ? "video/mp4" : null;
}
