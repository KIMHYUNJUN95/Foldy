import { describe, expect, it } from "vitest";
import {
  claimEmojiHeal,
  emojiHealCandidateIds,
  emojiHealCapReached,
  isEmojiRepairFailure,
  EMOJI_HEAL_DAILY_MAX_REQUESTS,
  EMOJI_HEAL_RECENT_MS,
  emojiMaskMatches,
  parseEmojiRepairSince,
  readEmojiHealState,
  settleEmojiHeal,
  hasNonBmp,
  maskNonBmp,
  pickRepairConversations,
  planEmojiHeals,
} from "@/lib/guest-messages/emoji-heal";

describe("maskNonBmp", () => {
  it("BMP 밖 글자 하나마다 ? 하나", () => {
    expect(maskNonBmp("謝謝🙏🏻")).toBe("謝謝??");
    expect(maskNonBmp("안녕")).toBe("안녕");
  });
});

describe("emojiMaskMatches", () => {
  it("이모지 하나", () => {
    expect(emojiMaskMatches("Thanks ?", "Thanks 😊")).toBe(true);
  });

  it("피부색 붙은 이모지 = 두 글자", () => {
    expect(emojiMaskMatches("??", "🙏🏻")).toBe(true);
    expect(emojiMaskMatches("?", "🙏🏻")).toBe(false);
  });

  it("국기 = 지역 표시 두 글자", () => {
    expect(emojiMaskMatches("from ??", "from 🇯🇵")).toBe(true);
  });

  it("ZWJ 가족 — ZWJ 가 남아도 · ? 로 바뀌어도 · 빠져도 맞음", () => {
    const api = "👨‍👩‍👧";
    expect(emojiMaskMatches("?‍?‍?", api)).toBe(true);
    expect(emojiMaskMatches("?????", api)).toBe(true);
    expect(emojiMaskMatches("???", api)).toBe(true);
    expect(emojiMaskMatches("??", api)).toBe(false);
    expect(emojiMaskMatches("??????", api)).toBe(false);
  });

  it("변형 선택자(FE0F) 붙은 이모지", () => {
    // ❤️ = U+2764(BMP) + U+FE0F — 둘 다 BMP 라 가려지지 않는다. 👍️ = 비BMP + FE0F.
    expect(emojiMaskMatches("?️ ok", "👍️ ok")).toBe(true);
    expect(emojiMaskMatches("? ok", "👍️ ok")).toBe(true);
    expect(emojiMaskMatches("?? ok", "👍️ ok")).toBe(true);
  });

  it("손님이 정말 ?? 를 쓴 경우 — API 도 ?? 라 고치지 않는다", () => {
    expect(emojiMaskMatches("really??", "really??")).toBe(false);
  });

  it("중국어 · 일본어 섞인 글", () => {
    expect(emojiMaskMatches("謝謝??明天見", "謝謝🙏🏻明天見")).toBe(true);
    expect(emojiMaskMatches("ありがとう?", "ありがとう😊")).toBe(true);
  });

  it("다른 글자가 하나라도 다르면 아님", () => {
    expect(emojiMaskMatches("謝謝??明天", "謝謝🙏🏻明天見")).toBe(false);
    expect(emojiMaskMatches("Thanks !", "Thanks 😊")).toBe(false);
    expect(emojiMaskMatches("thanks ?", "Thanks 😊")).toBe(false);
  });

  it("바뀐 것 없음 · API 에 이모지 없음 → 아님", () => {
    expect(emojiMaskMatches("Thanks 😊", "Thanks 😊")).toBe(false);
    expect(emojiMaskMatches("Is it ok?", "Is it ok!")).toBe(false);
    expect(emojiMaskMatches("a?b", "a‍b")).toBe(false);
  });

  it("되돌아가는 방향은 절대 아님 — 저장된 쪽이 진짜 이모지면", () => {
    expect(emojiMaskMatches("Thanks 😊", "Thanks ?")).toBe(false);
  });
});

describe("hasNonBmp", () => {
  it("BMP 밖 글자가 있나", () => {
    expect(hasNonBmp("ok 😊")).toBe(true);
    expect(hasNonBmp("❤️")).toBe(false);
    expect(hasNonBmp("")).toBe(false);
  });
});

describe("emojiHealCandidateIds", () => {
  it("BMP 밖 글자가 있는 메시지 번호만, 중복 없이", () => {
    expect(
      emojiHealCandidateIds([
        { externalId: "1", body: "hi 😊" },
        { externalId: "2", body: "hi ?" },
        { externalId: "1", body: "hi 😊" },
        { externalId: "3", body: "🇯🇵" },
      ]),
    ).toEqual(["1", "3"]);
  });
});

describe("planEmojiHeals", () => {
  const existing = [
    { id: "m1", external_id: "1", body: "謝謝??", direction: "guest" as const },
    { id: "m2", external_id: "2", body: "really??", direction: "guest" as const },
    { id: "m3", external_id: "3", body: "Sure ?", direction: "host" as const },
    { id: "m4", external_id: "4", body: "fine ?", direction: "guest" as const },
  ];

  it("가려진 줄만 고치고, 손님 말은 번역도 지운다", () => {
    const plan = planEmojiHeals(
      [
        { externalId: "1", body: "謝謝🙏🏻" },
        { externalId: "2", body: "really??" },
        { externalId: "3", body: "Sure 👍" },
        { externalId: "4", body: "fine 😊 thanks" },
        { externalId: "9", body: "new 😊" },
      ],
      existing,
    );
    expect(plan).toEqual([
      { id: "m1", externalId: "1", body: "謝謝🙏🏻", previousBody: "謝謝??", clearTranslation: true },
      { id: "m3", externalId: "3", body: "Sure 👍", previousBody: "Sure ?", clearTranslation: false },
    ]);
  });

  it("같은 번호가 두 번 와도 한 번만", () => {
    const plan = planEmojiHeals(
      [
        { externalId: "1", body: "謝謝🙏🏻" },
        { externalId: "1", body: "謝謝🙏🏻" },
      ],
      existing,
    );
    expect(plan).toHaveLength(1);
  });

  it("아무것도 안 맞으면 빈 목록", () => {
    expect(planEmojiHeals([{ externalId: "2", body: "really??" }], existing)).toEqual([]);
  });
});

describe("pickRepairConversations", () => {
  const rows = [
    { id: "r1", conversation_id: "c1", created_at: "2026-11-13T01:00:00Z" },
    { id: "r2", conversation_id: "c2", created_at: "2026-11-13T02:00:00Z" },
    { id: "r3", conversation_id: "c1", created_at: "2026-11-13T03:00:00Z" },
    { id: "r4", conversation_id: "c3", created_at: "2026-11-13T04:00:00Z" },
    { id: "r5", conversation_id: "c4", created_at: "2026-11-13T05:00:00Z" },
  ];

  it("오래된 순서로 대화 N개, 다음 커서는 그다음 대화의 첫 줄(시각 + id)", () => {
    expect(pickRepairConversations(rows, 2, { scanLimit: 500 })).toEqual({
      conversationIds: ["c1", "c2"],
      nextCursor: { createdAt: "2026-11-13T04:00:00Z", id: "r4" },
    });
  });

  it("다 담으면 커서 없음(끝)", () => {
    expect(pickRepairConversations(rows, 10, { scanLimit: 500 })).toEqual({
      conversationIds: ["c1", "c2", "c3", "c4"],
      nextCursor: null,
    });
  });

  it("상한보다 한 줄 더 읽혔으면 그 줄이 다음 커서 — 그 줄의 대화는 이번에 안 고른다", () => {
    expect(pickRepairConversations(rows, 10, { scanLimit: 4 })).toEqual({
      conversationIds: ["c1", "c2", "c3"],
      nextCursor: { createdAt: "2026-11-13T05:00:00Z", id: "r5" },
    });
    // 딱 상한만큼이면 끝.
    expect(pickRepairConversations(rows, 10, { scanLimit: 5 }).nextCursor).toBeNull();
  });

  it("같은 시각 줄이 몰려 있어도 커서는 id 로 앞으로 간다", () => {
    const tied = ["a", "b", "c"].map((id) => ({ id, conversation_id: `c-${id}`, created_at: "2026-11-13T01:00:00Z" }));
    expect(pickRepairConversations(tied, 1, { scanLimit: 500 }).nextCursor).toEqual({ createdAt: "2026-11-13T01:00:00Z", id: "b" });
  });
});

describe("웹훅 뒤 다시 읽기 몫 (settings.emojiHeal)", () => {
  const nowMs = Date.parse("2026-11-27T03:00:00.000Z");
  const nowIso = new Date(nowMs).toISOString();
  const insertedAt = "2026-11-27T02:59:59.000Z";

  it("이상한 값은 빈 상태로", () => {
    expect(readEmojiHealState(null)).toEqual({ day: null, used: 0, recent: {} });
    expect(readEmojiHealState({ emojiHeal: { day: 3, used: "x", recent: [1], cursor: "2026-11-27T00:00:00.000Z" } })).toEqual({
      day: null,
      used: 0,
      recent: {},
    });
  });

  it("몫을 잡으면 그날 사용량 +1 · 그 예약 읽은 시각 기록", () => {
    const claim = claimEmojiHeal(readEmojiHealState(null), { providerBookingId: "5001", insertedAt, nowMs });
    expect(claim).toEqual({ claimed: true, reason: null, state: { day: "2026-11-27", used: 1, recent: { "5001": nowIso } } });
  });

  it("그날 상한을 다 썼으면 못 잡는다 — 도쿄 날짜가 바뀌면 0부터", () => {
    const full = { day: "2026-11-27", used: EMOJI_HEAL_DAILY_MAX_REQUESTS, recent: {} };
    expect(claimEmojiHeal(full, { providerBookingId: "5001", insertedAt, nowMs })).toMatchObject({ claimed: false, reason: "daily_cap" });
    // 2026-11-27T15:00Z = 도쿄 11-28 0시.
    const next = claimEmojiHeal(full, { providerBookingId: "5001", insertedAt, nowMs: Date.parse("2026-11-27T15:00:00.000Z") });
    expect(next).toMatchObject({ claimed: true, state: { day: "2026-11-28", used: 1 } });
  });

  it("같은 예약을 이 줄이 들어간 뒤에 이미 읽기 시작했으면 건너뛴다(연달아 온 배달)", () => {
    const state = { day: "2026-11-27", used: 3, recent: { "5001": "2026-11-27T02:59:59.500Z" } };
    expect(claimEmojiHeal(state, { providerBookingId: "5001", insertedAt, nowMs })).toMatchObject({ claimed: false, reason: "recent" });
    // 앞 읽기가 이 줄이 들어가기 전이면 이 줄을 못 봤다 — 다시 읽는다.
    const before = { day: "2026-11-27", used: 3, recent: { "5001": "2026-11-27T02:59:58.000Z" } };
    expect(claimEmojiHeal(before, { providerBookingId: "5001", insertedAt, nowMs })).toMatchObject({ claimed: true });
  });

  it("읽은 시각 기록은 1분 지난 것부터 버린다", () => {
    const state = { day: "2026-11-27", used: 3, recent: { old: "2026-11-27T02:58:00.000Z", fresh: "2026-11-27T02:59:30.000Z" } };
    const claim = claimEmojiHeal(state, { providerBookingId: "5001", insertedAt, nowMs });
    expect(Object.keys(claim.state.recent).sort()).toEqual(["5001", "fresh"]);
    expect(EMOJI_HEAL_RECENT_MS).toBe(60_000);
  });

  it("끝나면 실제 요청 수로 맞춘다 — 못 불렀으면 돌려주고, 필터 무시면 그날 멈춤", () => {
    const state = { day: "2026-11-27", used: 5, recent: {} };
    const base = { providerBookingId: "5001", nowMs, forget: false };
    expect(settleEmojiHeal(state, { ...base, requests: 3, haltForDay: false }).used).toBe(7);
    expect(settleEmojiHeal(state, { ...base, requests: 0, haltForDay: false }).used).toBe(4);
    expect(settleEmojiHeal(state, { ...base, requests: 1, haltForDay: true }).used).toBe(EMOJI_HEAL_DAILY_MAX_REQUESTS);
  });

  it("읽기가 끝나지 못했으면 그 예약의 읽은 시각을 지운다 — 다음 배달이 건너뛰지 않게", () => {
    const state = { day: "2026-11-27", used: 5, recent: { "5001": nowIso, "5002": nowIso } };
    const forgot = settleEmojiHeal(state, { providerBookingId: "5001", requests: 1, nowMs, haltForDay: false, forget: true });
    expect(forgot.recent).toEqual({ "5002": nowIso });
    const kept = settleEmojiHeal(state, { providerBookingId: "5001", requests: 1, nowMs, haltForDay: false, forget: false });
    expect(kept.recent).toEqual({ "5001": nowIso, "5002": nowIso });
  });

  it("상한에 처음 닿은 때만 참 — 이미 닿아 있었으면 거짓, 날이 바뀐 뒤는 새로", () => {
    const after = { day: "2026-11-27", used: EMOJI_HEAL_DAILY_MAX_REQUESTS, recent: {} };
    expect(emojiHealCapReached({ day: "2026-11-27", used: EMOJI_HEAL_DAILY_MAX_REQUESTS - 1, recent: {} }, after)).toBe(true);
    expect(emojiHealCapReached(after, after)).toBe(false);
    expect(emojiHealCapReached({ day: "2026-11-26", used: EMOJI_HEAL_DAILY_MAX_REQUESTS, recent: {} }, after)).toBe(true);
    expect(emojiHealCapReached({ day: "2026-11-27", used: 3, recent: {} }, { ...after, used: 4 })).toBe(false);
  });
});

describe("isEmojiRepairFailure (되살리기 모드 — 207 이면 반복 멈춤)", () => {
  it("시간 · 요청 예산으로 멈춘 것과 할 일 없음은 정상", () => {
    expect(isEmojiRepairFailure({ skipped: null, stoppedEarly: null })).toBe(false);
    expect(isEmojiRepairFailure({ skipped: null, stoppedEarly: "time_budget" })).toBe(false);
    expect(isEmojiRepairFailure({ skipped: null, stoppedEarly: "request_budget" })).toBe(false);
  });
  it("건너뜀 · 다른 멈춤은 모두 실패(멈춤 · 쿨다운 · 크레딧 · 429 포함)", () => {
    for (const skipped of ["paused", "cooldown", "low_credit", "missing_env", "token"] as const) {
      expect(isEmojiRepairFailure({ skipped, stoppedEarly: null })).toBe(true);
    }
    for (const stop of ["rate_limited", "low_credit", "http_error", "request_error", "filter_ignored"] as const) {
      expect(isEmojiRepairFailure({ skipped: null, stoppedEarly: stop })).toBe(true);
    }
  });
});

describe("parseEmojiRepairSince (되살리기 모드 since)", () => {
  it("날짜는 도쿄 그날 0시", () => {
    expect(parseEmojiRepairSince("2026-11-13")).toBe("2026-11-12T15:00:00.000Z");
  });
  it("달력에 없는 날짜 · 모양이 다른 값은 거부", () => {
    expect(parseEmojiRepairSince("2026-11-31")).toBeNull();
    expect(parseEmojiRepairSince("2026-02-30T00:00:00Z")).toBeNull();
    expect(parseEmojiRepairSince("2026/11/13")).toBeNull();
    expect(parseEmojiRepairSince("")).toBeNull();
    expect(parseEmojiRepairSince(null)).toBeNull();
  });
  it("시각은 시간대가 있어야 한다(없으면 서버 시간대로 읽혀 어긋난다)", () => {
    expect(parseEmojiRepairSince("2026-11-13T00:00")).toBeNull();
    expect(parseEmojiRepairSince("2026-11-13T01:02:03.456Z")).toBe("2026-11-13T01:02:03.456Z");
  });
  it("주소에서 「+」가 공백이 된 커서도 받는다", () => {
    expect(parseEmojiRepairSince("2026-11-13T10:00:00 09:00")).toBe("2026-11-13T01:00:00.000Z");
  });
});
