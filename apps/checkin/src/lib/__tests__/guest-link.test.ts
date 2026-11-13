import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guestLinkOpen, maskPassportNumber } from "../guest/link";
import { hashGuestToken } from "../guest/token";
import { fakeCheckinDb } from "./fake-checkin-db";

vi.mock("server-only", () => ({}));

import { loadStayByToken } from "../guest/store";

describe("개인 링크 기간 — 체크아웃 다음 날(도쿄)까지", () => {
  it("체크아웃 다음 날 도쿄 23:59 까지 열리고 그다음 날 0시부터 닫힌다", () => {
    // 체크아웃 11/15 → 11/16 까지 열림. 도쿄 11/17 00:00 = UTC 11/16 15:00.
    expect(guestLinkOpen("2026-11-15", new Date("2026-11-16T14:59:00Z"))).toBe(true);
    expect(guestLinkOpen("2026-11-15", new Date("2026-11-16T15:00:00Z"))).toBe(false);
  });

  it("UTC 날짜가 아니라 도쿄 날짜로 판단한다", () => {
    // UTC 11/16 16:00 은 UTC 날짜로는 아직 11/16 이지만 도쿄는 11/17 01:00.
    expect(guestLinkOpen("2026-11-15", new Date("2026-11-16T16:00:00Z"))).toBe(false);
  });
});

describe("여권 번호 가리기", () => {
  it("앞 4 · 뒤 2 만 보이고, 짧으면 전부 가린다", () => {
    expect(maskPassportNumber("18AB12342")).toBe("18AB•••42");
    expect(maskPassportNumber("AB1234")).toBe("••••••");
    expect(maskPassportNumber(null)).toBeNull();
  });
});

describe("loadStayByToken — 기간 · 체크인 뒤 가리기", () => {
  const RAW = "A".repeat(43);
  const seed = (status: string, checkOutDate = "2026-11-15") =>
    fakeCheckinDb({
      stay_tokens: [{ token_hash: hashGuestToken(RAW), stay_id: "stay-1" }],
      stays: [
        {
          id: "stay-1", organization_id: "org-1", property_key: "stay_ari", check_in_date: "2026-11-13", check_out_date: checkOutDate,
          guest_count_expected: 1, party_size: 1, status, checkin_code: "123456", checked_in_at: null, retain_until: null,
        },
      ],
      guests: [
        {
          id: "g1", stay_id: "stay-1", is_representative: true, guest_type: "adult", name_roman: "TANAKA YUKI", has_japan_address: false,
          nationality: "USA", passport_number: "18AB1234542", age: 30, gender: "female", contact: "+1-415-555-0142",
          no_passport_reason: null, address: "USA, Boston", prev_stay: "Osaka", next_dest: "Kyoto", source: "guest", created_at: "2026-11-10T00:00:00Z",
        },
      ],
      guest_documents: [{ guest_id: "g1", kind: "passport", replaced_by: null }],
      consents: [{ id: "c1", stay_id: "stay-1" }],
      stay_rooms: [{ stay_id: "stay-1", room_label: "201" }],
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T03:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("체크인 전에는 여권 번호를 그대로 준다(손님이 고친다)", async () => {
    const stay = await loadStayByToken(seed("pending") as never, RAW);
    expect(stay?.guests[0].passport_number).toBe("18AB1234542");
  });

  it("체크인 뒤에는 여권 번호를 가리고, 사진은 있다는 표시만 남긴다", async () => {
    const stay = await loadStayByToken(seed("checked_in") as never, RAW);
    expect(stay?.editable).toBe(false);
    expect(stay?.guests[0].passport_number).toBe("18AB•••••42");
    expect(stay?.guests[0].hasPassportPhoto).toBe(true);
    expect(stay?.guests[0].missing).toEqual([]);
  });

  it("체크아웃 다음 날이 지나면 체크인 끝난 예약도 링크가 닫힌다", async () => {
    vi.setSystemTime(new Date("2026-11-16T15:00:00Z"));
    expect(await loadStayByToken(seed("checked_in") as never, RAW)).toBeNull();
    expect(await loadStayByToken(seed("pending") as never, RAW)).toBeNull();
  });
});
