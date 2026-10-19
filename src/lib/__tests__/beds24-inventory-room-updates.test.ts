import { describe, expect, it, vi } from "vitest";
import { inventoryWebhookSyncLockName, planInventoryRoomUpdates } from "@/lib/beds24/inventory-sync";

vi.mock("server-only", () => ({}));

/**
 * 웹훅 최소숙박 동기화는 **실제로 바뀐 방만** 쓴다 (2026-10-19).
 *
 * 예전엔 값이 같아도 웹훅마다 그 건물 방 전부를 UPDATE 해서 rooms 96행에 49만 번 갱신이 쌓였다.
 */
describe("planInventoryRoomUpdates", () => {
  it("값과 상태가 같은 방은 쓰지 않는다", () => {
    const plan = planInventoryRoomUpdates(new Map([["101", 1]]), [
      { external_room_id: "101", external_minimum_stay: 1, status: "active" },
    ]);
    expect(plan).toEqual({ matchedRooms: 1, updates: [] });
  });

  it("최소숙박이 바뀌면 상태를 다시 계산해 쓴다", () => {
    const plan = planInventoryRoomUpdates(new Map([["101", 50]]), [
      { external_room_id: "101", external_minimum_stay: 1, status: "active" },
    ]);
    expect(plan.updates).toEqual([{ externalRoomId: "101", minimumStay: 50, status: "inactive" }]);
  });

  it("최소숙박이 비어 있던 방(웹훅으로 막 생긴 방)은 쓴다", () => {
    const plan = planInventoryRoomUpdates(new Map([["101", 2]]), [
      { external_room_id: "101", external_minimum_stay: null, status: "active" },
    ]);
    expect(plan.updates).toHaveLength(1);
  });

  it("값은 같은데 상태만 어긋난 방도 쓴다", () => {
    const plan = planInventoryRoomUpdates(new Map([["101", 2]]), [
      { external_room_id: "101", external_minimum_stay: 2, status: "inactive" },
    ]);
    expect(plan.updates).toEqual([{ externalRoomId: "101", minimumStay: 2, status: "active" }]);
  });

  it("우리 표에 없는 방은 매칭에도 갱신에도 넣지 않는다", () => {
    const plan = planInventoryRoomUpdates(new Map([["999", 1]]), []);
    expect(plan).toEqual({ matchedRooms: 0, updates: [] });
  });

  it("같은 방 번호 행이 여럿이면 하나라도 다르면 쓴다", () => {
    const plan = planInventoryRoomUpdates(new Map([["101", 3]]), [
      { external_room_id: "101", external_minimum_stay: 3, status: "active" },
      { external_room_id: "101", external_minimum_stay: 1, status: "active" },
    ]);
    expect(plan.matchedRooms).toBe(1);
    expect(plan.updates).toHaveLength(1);
  });
});

describe("inventoryWebhookSyncLockName", () => {
  it("조직 · 건물마다 다른 이름이다", () => {
    expect(inventoryWebhookSyncLockName("org-a", "176431")).not.toBe(inventoryWebhookSyncLockName("org-b", "176431"));
    expect(inventoryWebhookSyncLockName("org-a", "176431")).toBe("inventory_min_stay:org-a:176431");
  });
});
