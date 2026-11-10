import { describe, expect, it, vi } from "vitest";

/**
 * 리뷰 수집 — 2026-11-10 점검 수정.
 * - 다시 수집할 때 새로 못 찾은(null) 객실 · 예약 연결은 저장된 값을 지키고 덮어쓰지 않는다(재연결이 채운 값이 지워졌다).
 * - 척도를 벗어난 점수(→ unrated)는 점수를 버린다 — `external_reviews_unrated_has_no_score` 위반으로 쪽 전체 upsert 가 실패했다.
 */
vi.mock("server-only", () => ({}));

import { keepStoredReviewLinks, parseAirbnbReview, parseBookingReview } from "@/lib/beds24/reviews-sync";

describe("keepStoredReviewLinks", () => {
  const stored = { room_id: "room-1", room_label: "301", reservation_id: "res-1" };

  it("새로 계산한 값이 null 이면 저장된 연결을 지킨다", () => {
    expect(keepStoredReviewLinks({ room_id: null, room_label: null, reservation_id: null }, stored)).toEqual(stored);
  });
  it("새 값이 있으면 새 값", () => {
    expect(keepStoredReviewLinks({ room_id: "room-2", room_label: "302", reservation_id: "res-2" }, stored)).toEqual({
      room_id: "room-2",
      room_label: "302",
      reservation_id: "res-2",
    });
  });
  it("객실은 라벨과 짝으로 — 새 객실 id 만 있고 라벨이 없을 일은 없지만, 객실만 null 이면 객실 · 라벨 둘 다 저장값", () => {
    expect(keepStoredReviewLinks({ room_id: null, room_label: null, reservation_id: "res-9" }, stored)).toEqual({
      room_id: "room-1",
      room_label: "301",
      reservation_id: "res-9",
    });
  });
  it("저장된 줄이 없으면 그대로", () => {
    const fresh = { room_id: null, room_label: null, reservation_id: null };
    expect(keepStoredReviewLinks(fresh, undefined)).toEqual(fresh);
  });
});

describe("척도 밖 점수 → 점수 없이 저장", () => {
  it("Airbnb 7점(5점 만점)은 unrated + 점수 null", () => {
    const review = parseAirbnbReview({ id: "a1", overall_rating: 7, reviewer_role: "guest" });
    expect(review?.riskLevel).toBe("unrated");
    expect(review?.ratingValue).toBeNull();
  });
  it("Booking 12점은 unrated + 점수 null", () => {
    const review = parseBookingReview({ review_id: "b1", scoring: { review_score: 12 } });
    expect(review?.riskLevel).toBe("unrated");
    expect(review?.ratingValue).toBeNull();
  });
  it("정상 점수는 그대로", () => {
    expect(parseBookingReview({ review_id: "b2", scoring: { review_score: 6.5 } })?.ratingValue).toBe(6.5);
  });
});
