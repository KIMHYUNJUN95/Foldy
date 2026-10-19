import { describe, expect, it } from "vitest";
import { isAllowedResumeSourceUrl } from "@/lib/recruit/resume-source";

const PROJECT = "haru-recruit";
const ok = (bucket: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/resumes%2F1771454517895_a.pdf?alt=media&token=x`;

describe("isAllowedResumeSourceUrl", () => {
  it("채용 사이트 버킷의 Firebase 다운로드 URL 만 허용한다", () => {
    expect(isAllowedResumeSourceUrl(ok("haru-recruit.firebasestorage.app"), PROJECT)).toBe(true);
    expect(isAllowedResumeSourceUrl(ok("haru-recruit.appspot.com"), PROJECT)).toBe(true);
  });

  it("다른 버킷 · 다른 호스트 · http 는 거부한다", () => {
    expect(isAllowedResumeSourceUrl(ok("evil.appspot.com"), PROJECT)).toBe(false);
    expect(isAllowedResumeSourceUrl(ok("haru-recruit.firebasestorage.app").replace("https:", "http:"), PROJECT)).toBe(false);
    expect(isAllowedResumeSourceUrl("https://169.254.169.254/latest/meta-data/", PROJECT)).toBe(false);
    expect(isAllowedResumeSourceUrl("https://firebasestorage.googleapis.com.evil.com/v0/b/haru-recruit.appspot.com/o/x", PROJECT)).toBe(false);
    expect(isAllowedResumeSourceUrl("https://localhost/v0/b/haru-recruit.appspot.com/o/x", PROJECT)).toBe(false);
  });

  it("포트 · 계정 정보 · 경로 우회 · 깨진 값은 거부한다", () => {
    expect(isAllowedResumeSourceUrl("https://firebasestorage.googleapis.com:8443/v0/b/haru-recruit.appspot.com/o/x", PROJECT)).toBe(false);
    expect(isAllowedResumeSourceUrl("https://u:p@firebasestorage.googleapis.com/v0/b/haru-recruit.appspot.com/o/x", PROJECT)).toBe(false);
    expect(isAllowedResumeSourceUrl("https://firebasestorage.googleapis.com/v0/b/haru-recruit.appspot.com/o/../../../v0/b/evil/o/x", PROJECT)).toBe(false);
    expect(isAllowedResumeSourceUrl("https://firebasestorage.googleapis.com/v0/b/haru-recruit.appspot.com/o/", PROJECT)).toBe(false);
    expect(isAllowedResumeSourceUrl("file:///etc/passwd", PROJECT)).toBe(false);
    expect(isAllowedResumeSourceUrl("not a url", PROJECT)).toBe(false);
  });
});
