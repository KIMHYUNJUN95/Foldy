import { describe, expect, it } from "vitest";
import { appendAdminRestoreMemo, localizeLostFoundMemo } from "@/lib/lost-found-memo";

describe("lost-found system memo localization", () => {
  it("stores an admin restore entry without a viewer-language sentence", () => {
    expect(appendAdminRestoreMemo("existing note", "wrong item")).toBe(
      "existing note\n[stayops:admin_restore] wrong item",
    );
  });

  it("renders the stored marker with the viewer's label", () => {
    expect(localizeLostFoundMemo("[stayops:admin_restore] wrong item", "Admin restore")).toBe(
      "Admin restore: wrong item",
    );
  });

  it("localizes legacy Korean restore entries", () => {
    expect(localizeLostFoundMemo("\uAD00\uB9AC\uC790 \uBCF5\uC6D0: wrong item", "管理者による復元")).toBe(
      "管理者による復元: wrong item",
    );
  });

  it("localizes the Korean memo the daily auto-dispose DB function writes", () => {
    const stored = "\uBCF4\uAD00\uAE30\uAC04 \uB9CC\uB8CC \uC790\uB3D9 \uD3D0\uAE30";
    expect(localizeLostFoundMemo(stored, "Admin restore", "Auto-disposed — holding period expired")).toBe(
      "Auto-disposed — holding period expired",
    );
    expect(localizeLostFoundMemo(`${stored}\n[stayops:admin_restore] mistake`, "管理者による復元", "保管期間満了による自動廃棄")).toBe(
      "保管期間満了による自動廃棄\n管理者による復元: mistake",
    );
  });

  it("leaves human-written memos untouched", () => {
    expect(localizeLostFoundMemo("손님에게 연락함", "Admin restore", "Auto-disposed")).toBe("손님에게 연락함");
  });
});
