import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n";
import { reviewReservationNo } from "@/lib/review-reservation-no";

/** 게스트 피드백 10순위 unslop — 목록 줄 예약번호 · 짧은 필터 라벨 · 마침표 정리 · 굵기 상한(2026-11-18). */

describe("외부 리뷰 줄 예약번호", () => {
  it("채널 번호(Airbnb HM… · Booking 번호)를 그대로 보여 준다", () => {
    expect(reviewReservationNo({ sourceReservationId: "HMRWNK5RQW" })).toBe("HMRWNK5RQW");
    expect(reviewReservationNo({ sourceReservationId: "4281936550" })).toBe("4281936550");
  });
  it("객실 꼬리표가 붙은 저장값은 원래 번호만", () => {
    expect(reviewReservationNo({ sourceReservationId: "HM8Q3ZT4AB::room::301" })).toBe("HM8Q3ZT4AB");
  });
  it("번호가 없으면 null — 내부 UUID 를 대신 보여 주지 않는다", () => {
    expect(reviewReservationNo({ sourceReservationId: null })).toBeNull();
    expect(reviewReservationNo({ sourceReservationId: "  " })).toBeNull();
    const withUuid = { reservationId: "00000000-0000-4000-a000-000000000001", sourceReservationId: null };
    expect(reviewReservationNo(withUuid)).toBeNull();
  });
});

const LOCALES = ["ko", "ja", "en"] as const;

describe("게스트 피드백 문구", () => {
  it("폰 필터 첫 칸용 짧은 플랫폼 라벨이 세 언어에 있다", () => {
    for (const locale of LOCALES) {
      const copy = dictionaries[locale].complaints as Record<string, unknown>;
      const short = copy.wDdAllPlatformsShort;
      expect(typeof short, locale).toBe("string");
      expect((short as string).length, locale).toBeLessThanOrEqual(8);
    }
  });

  it("짧은 한 문장 안내는 끝 마침표가 없다(두 문장 이상은 그대로)", () => {
    const keys = ["syncErrForbidden", "syncErrPaused", "syncErrBusy", "wDeleteWarn", "listLoadFailedSub", "noDescription"];
    for (const locale of LOCALES) {
      const copy = dictionaries[locale].complaints as unknown as Record<string, string>;
      for (const key of keys) expect(copy[key], `${locale}.${key}`).not.toMatch(/[.。]$/);
    }
  });
});

describe("게스트 피드백 CSS 규칙", () => {
  const files = [
    "src/components/admin/complaints/complaints-console.css",
    "src/components/complaints/complaints.css",
    "src/components/complaints/feedback-mobile.css",
  ];
  it("굵기는 600 이하 · 보라 값을 직접 적지 않는다", () => {
    for (const file of files) {
      const css = readFileSync(file, "utf8");
      expect(css, file).not.toMatch(/font-weight:\s*[789]00/);
      expect(css, file).not.toMatch(/#7a52e6|#5a30cf|#f4f1fd|#eee8fc/i);
    }
  });
});
