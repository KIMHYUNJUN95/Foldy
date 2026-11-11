import { describe, expect, it } from "vitest";
import { countText } from "@/lib/count-text";

describe("countText", () => {
  it("picks the singular form for 1 when the template has two forms", () => {
    expect(countText("{n} day|{n} days", 1)).toBe("1 day");
    expect(countText("{n} day|{n} days", 0)).toBe("0 days");
    expect(countText("{n} day|{n} days", 3)).toBe("3 days");
  });
  it("leaves single-form templates (ko / ja) alone", () => {
    expect(countText("{n}일", 1)).toBe("1일");
    expect(countText("{n}名", 12)).toBe("12名");
  });
  it("accepts string counts", () => {
    expect(countText("{n} use|{n} uses", "1")).toBe("1 use");
    expect(countText("{n} use|{n} uses", "2")).toBe("2 uses");
  });
});
