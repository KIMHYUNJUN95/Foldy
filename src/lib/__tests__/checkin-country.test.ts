import { describe, expect, it } from "vitest";

import { checkinNationalityName } from "@/lib/checkin/country";

describe("명부 국적 이름", () => {
  it("alpha-3 코드를 보는 사람 언어의 나라 이름으로", () => {
    expect(checkinNationalityName("ESP", "ko")).toBe("스페인");
    expect(checkinNationalityName("ESP", "ja")).toBe("スペイン");
    expect(checkinNationalityName("ESP", "en")).toBe("Spain");
    expect(checkinNationalityName("fra", "en")).toBe("France");
    expect(checkinNationalityName("D", "en")).toBe("Germany");
  });

  it("모르는 코드는 코드 그대로, 비어 있으면 null", () => {
    expect(checkinNationalityName("ZZZ", "ko")).toBe("ZZZ");
    expect(checkinNationalityName("xx", "en")).toBe("XX");
    expect(checkinNationalityName(null, "ko")).toBeNull();
    expect(checkinNationalityName("", "ko")).toBeNull();
  });
});
