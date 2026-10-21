import { describe, expect, it } from "vitest";
import {
  isMissedWebhookChange,
  MISSED_WEBHOOK_GRACE_MS,
  orderNetCandidates,
} from "@/lib/beds24/property-rates-state";

/**
 * 요금 안전망 — 건물을 나눠 돌고, 웹훅이 놓친 변경만 알린다 (2026-10-21).
 *
 * 9건물을 한 번에 읽던 안전망이 Beds24 연결 지연으로 60초를 넘겨 504 로 실패했다. 이제 가장 오래
 * 안 읽힌 건물부터 몇 곳만 읽는다. 웹훅이 정상이면 안전망이 찾는 변경은 0 이어야 한다.
 */
describe("orderNetCandidates", () => {
  it("한 번도 안 읽힌 건물이 먼저, 그다음 오래된 순", () => {
    const ordered = orderNetCandidates([
      { externalPropertyId: "176430", lastFullReadAt: "2026-10-21T00:05:00Z", organizationId: "o" },
      { externalPropertyId: "343112", lastFullReadAt: "2026-10-20T23:10:00Z", organizationId: "o" },
      { externalPropertyId: "294552", lastFullReadAt: null, organizationId: "o" },
    ]);
    expect(ordered.map((c) => c.externalPropertyId)).toEqual(["294552", "343112", "176430"]);
  });

  it("시각이 같으면 건물 번호 순 — 결과가 흔들리지 않는다", () => {
    const ordered = orderNetCandidates([
      { externalPropertyId: "211056", lastFullReadAt: null, organizationId: "o" },
      { externalPropertyId: "205165", lastFullReadAt: null, organizationId: "o" },
    ]);
    expect(ordered.map((c) => c.externalPropertyId)).toEqual(["205165", "211056"]);
  });
});

describe("isMissedWebhookChange", () => {
  const now = Date.parse("2026-10-21T01:00:00Z");

  it("변경이 없으면 놓친 게 없다", () => {
    expect(isMissedWebhookChange({ deferredPending: false, externalPriceChanges: 0, lastWebhookAt: null, now })).toBe(false);
  });

  it("변경이 있고 웹훅이 오래전이면 놓쳤다", () => {
    const lastWebhookAt = new Date(now - MISSED_WEBHOOK_GRACE_MS - 1_000).toISOString();
    expect(isMissedWebhookChange({ deferredPending: false, externalPriceChanges: 4, lastWebhookAt, now })).toBe(true);
  });

  it("웹훅이 한 번도 안 왔는데 변경이 있으면 놓쳤다", () => {
    expect(isMissedWebhookChange({ deferredPending: false, externalPriceChanges: 1, lastWebhookAt: null, now })).toBe(true);
  });

  it("웹훅이 방금 왔으면 아직 읽는 중일 수 있다 — 놓친 게 아니다", () => {
    const lastWebhookAt = new Date(now - 30_000).toISOString();
    expect(isMissedWebhookChange({ deferredPending: false, externalPriceChanges: 4, lastWebhookAt, now })).toBe(false);
  });

  it("재조회가 미뤄져 있으면(쿨다운 · 작업 · 실패) 배달은 왔다 — 놓친 게 아니다", () => {
    expect(isMissedWebhookChange({ deferredPending: true, externalPriceChanges: 4, lastWebhookAt: null, now })).toBe(false);
  });
});
