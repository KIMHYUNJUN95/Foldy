import Image, { type ImageProps } from "next/image";
import { requestImageSrc } from "@/lib/request-image-src";

/**
 * request-images 사진용 `next/image`. 저장된 주소를 `/api/request-images/…` 로 바꿔 그리고,
 * 그 경로는 302 로 서명 URL 에 넘어가 최적화기가 따라가지 못하므로 그때만 `unoptimized`.
 */
export function RequestImage({ src, ...rest }: Omit<ImageProps, "src"> & { src: string }) {
  const resolved = requestImageSrc(src);
  // eslint-disable-next-line jsx-a11y/alt-text -- alt 는 호출부가 넘긴다
  return <Image {...rest} src={resolved} unoptimized={rest.unoptimized ?? resolved.startsWith("/api/request-images/")} />;
}
