import { describe, expect, it } from "vitest";

import {
  ASSIST_PLACEHOLDER_LABELS,
  MASK,
  assistTextOf,
  assistTopicFlags,
  costMicroUsd,
  fakeEmbedding,
  fillAssistPlaceholders,
  filterChecks,
  guestEntryCodeFor,
  hasUnfilledPlaceholder,
  maskNames,
  maskPastReply,
  maskQuestion,
  needsReplyMessage,
  normalizeForCompare,
  pairQuestions,
  pickAssistQuestion,
  sentKindFor,
  toVectorLiteral,
  tokyoMonthBounds,
  tokyoMonthsAgoStart,
  stripWifiLabelBeforeToken,
  validateDraftOutput,
  type ThreadMessage,
} from "@/lib/guest-messages/ai-assist-model";

/** AI 답장 도우미 — 순수 함수(고르기 · 가리기 · 자리 표시 · 모델 출력 검사 · 비용). docs/product/49 §4 · §8 */

const msg = (id: string, direction: string, body: string, sent_at: string): ThreadMessage => ({ id, direction, body, sent_at });

describe("질문 고르기", () => {
  it("짧은 인사 · 사진만 · 우리 말은 답 필요 없음", () => {
    expect(needsReplyMessage({ direction: "guest", body: "Thanks!" })).toBe(false);
    expect(needsReplyMessage({ direction: "host", body: "What time can we check in tomorrow?" })).toBe(false);
    expect(needsReplyMessage({ direction: "guest", body: "What time can we check in tomorrow?" })).toBe(true);
  });

  it("마지막 손님 메시지 — 그 뒤 우리 답이 있으면 none", () => {
    const q = msg("q", "guest", "Can we leave our luggage after check-out?", "2026-11-18T01:00:00Z");
    expect(pickAssistQuestion([q])?.id).toBe("q");
    expect(pickAssistQuestion([q, msg("h", "host", "Sure", "2026-11-18T02:00:00Z")])).toBeNull();
    expect(pickAssistQuestion([q, msg("s", "system", "x", "2026-11-18T02:00:00Z")])?.id).toBe("q");
  });

  it("메일 인용 부분은 잘라 읽는다", () => {
    expect(assistTextOf("Is parking available near the house?\n\nOn Mon, Nov 17 2026 Host wrote:\n> old")).toBe(
      "Is parking available near the house?",
    );
  });

  it("짝 맞추기 — 12시간 안 첫 우리 답만", () => {
    const pairs = pairQuestions([
      msg("q1", "guest", "Is there a hair dryer in the room?", "2026-11-01T00:00:00Z"),
      msg("h1", "host", "Yes, in the drawer.", "2026-11-01T01:00:00Z"),
      msg("q2", "guest", "Where can we throw away the trash?", "2026-11-02T00:00:00Z"),
      msg("h2", "host", "Late answer", "2026-11-02T13:00:00Z"),
    ]);
    expect(pairs.map((p) => [p.question.id, p.reply?.id ?? null])).toEqual([
      ["q1", "h1"],
      ["q2", null],
    ]);
  });

  it("짝 맞추기 — 사이에 다른 질문이 오면 앞 질문은 답 없음(마지막 질문에만)", () => {
    const pairs = pairQuestions([
      msg("q1", "guest", "Is there a hair dryer in the room?", "2026-11-01T00:00:00Z"),
      msg("q2", "guest", "Where can we throw away the trash?", "2026-11-01T00:10:00Z"),
      msg("h1", "host", "Trash goes in the blue box.", "2026-11-01T01:00:00Z"),
    ]);
    expect(pairs.map((p) => [p.question.id, p.reply?.id ?? null])).toEqual([
      ["q1", null],
      ["q2", "h1"],
    ]);
  });
});

describe("도쿄 기준 N달 전", () => {
  it("말일은 그 달 끝으로 · 결과는 도쿄 자정", () => {
    expect(tokyoMonthsAgoStart(new Date("2026-03-31T03:00:00Z"), 1)).toBe("2026-02-28T00:00:00+09:00");
    // UTC 로는 3/31 저녁이지만 도쿄는 4/1 — 한 달 전은 3/1.
    expect(tokyoMonthsAgoStart(new Date("2026-03-31T16:00:00Z"), 1)).toBe("2026-03-01T00:00:00+09:00");
    expect(tokyoMonthsAgoStart(new Date("2026-01-15T03:00:00Z"), 12)).toBe("2025-01-15T00:00:00+09:00");
  });
});

describe("가리기", () => {
  it("라틴 이름은 낱말 경계로만", () => {
    expect(maskNames("Hi Ann, you can check in", ["Ann Lee"])).toBe(`Hi ${MASK}, you can check in`);
    expect(maskNames("Annual pass", ["Ann"])).toBe("Annual pass");
  });

  it("질문 — 코드 · 이름 · 연락처", () => {
    const out = maskQuestion("Emma here, code 4821 not working, call +81-90-1234-5678", ["4821"], ["Emma Stone"]);
    expect(out).not.toContain("4821");
    expect(out).not.toContain("Emma");
    expect(out).not.toContain("1234");
  });

  it("과거 답 — 금액 · 방 번호 · 숫자 묶음 · URL 까지", () => {
    const out = maskPastReply("Room 201 costs ¥3,000. Code 7788#. See https://x.example/a", ["7788#"], []);
    expect(out).not.toMatch(/201|3,000|7788|https/);
    expect(out).toContain(MASK);
  });
});

describe("자리 표시", () => {
  it("값이 있으면 채우고, 없으면 보는 직원 언어 자리 표시를 남긴다", () => {
    const filled = fillAssistPlaceholders("Code: {entry_code_room} / {wifi}", { entryCode: "1234", wifi: null }, "ko");
    expect(filled.text).toBe(`Code: 1234 / ${ASSIST_PLACEHOLDER_LABELS.wifi.ko}`);
    expect(filled.placeholders).toEqual([ASSIST_PLACEHOLDER_LABELS.wifi.ko]);
  });

  it("모델이 만든 다른 토큰 이름도 잡는다", () => {
    const filled = fillAssistPlaceholders("{door_code} {wifi_password}", { entryCode: null, wifi: null }, "en");
    expect(filled.text).toBe(`${ASSIST_PLACEHOLDER_LABELS.entryCode.en} ${ASSIST_PLACEHOLDER_LABELS.wifi.en}`);
  });

  it("남은 자리 표시 · 날것 토큰이면 보내기 막음", () => {
    expect(hasUnfilledPlaceholder("Your code is [Door code]", ["[Door code]"])).toBe(true);
    expect(hasUnfilledPlaceholder("Your code is {entry_code_room}", [])).toBe(true);
    expect(hasUnfilledPlaceholder("Your code is 1234", ["[Door code]"])).toBe(false);
  });
});

describe("이 방 손님용 출입 코드", () => {
  const building = {
    sharedAccess: [
      { labelKey: "storagePassword", code: "9999" },
      { labelKey: "doorPassword", code: "1111" },
    ],
    roomAccess: [
      { roomLabel: "201", code: "2010" },
      { roomLabel: "202", code: "2020" },
    ],
  };

  it("지금 방 번호만 — 다른 방 · 직원용은 고르지 않는다", () => {
    expect(guestEntryCodeFor(building, "202")).toBe("2020");
    expect(guestEntryCodeFor(building, "아라키초A 201")).toBe("2010");
    expect(guestEntryCodeFor(building, "301")).toBeNull();
    expect(guestEntryCodeFor(building, null)).toBeNull();
  });

  it("방 코드가 없는 건물은 손님용 공용 번호 하나일 때만", () => {
    expect(guestEntryCodeFor({ sharedAccess: building.sharedAccess, roomAccess: [] }, "1")).toBe("1111");
    expect(guestEntryCodeFor({ sharedAccess: [{ labelKey: "storagePassword", code: "9" }], roomAccess: [] }, "1")).toBeNull();
    expect(
      guestEntryCodeFor(
        {
          sharedAccess: [
            { labelKey: "doorPassword", code: "1" },
            { labelKey: "roomPassword", code: "2" },
          ],
          roomAccess: [],
        },
        "1",
      ),
    ).toBeNull();
    expect(guestEntryCodeFor(null, "1")).toBeNull();
  });
});

describe("주제 안전망", () => {
  it("취소 · 환불 · 늦은 체크아웃은 사람 판단", () => {
    expect(assistTopicFlags("Can I get a refund?").sensitive).toBe(true);
    expect(assistTopicFlags("체크아웃을 늦게 해도 될까요?").dayDependent).toBe(true);
    expect(assistTopicFlags("Where is the nearest convenience store?")).toEqual({ sensitive: false, dayDependent: false });
  });
});

describe("모델 출력 검사", () => {
  it("확인 필요는 초안 안 정확한 부분 문자열만 · 최대 4개", () => {
    const text = "A. B. C. D. E.";
    const checks = ["A.", "B.", "X", "C.", "D.", "E.", "A."].map((t) => ({ text: t, why: "w" }));
    expect(filterChecks(text, checks).map((c) => c.text)).toEqual(["A.", "B.", "C.", "D."]);
  });

  it("모양이 틀리면 null · direct 는 사람 판단", () => {
    expect(validateDraftOutput(null)).toBeNull();
    expect(validateDraftOutput({ kind: "draft", text: "", checks: [], needsHuman: false, reason: "" })).toBeNull();
    expect(validateDraftOutput({ kind: "draft", text: "가".repeat(4001), checks: [], needsHuman: false, reason: "" })).toBeNull();
    expect(validateDraftOutput({ kind: "direct", text: "x", checks: [], needsHuman: false, reason: "live" })).toEqual({
      kind: "direct",
      text: "",
      checks: [],
      needsHuman: true,
      reason: "live",
    });
    expect(validateDraftOutput({ kind: "draft", text: "Hello there.", checks: [{ text: "nope", why: "w" }], needsHuman: false, reason: "" })).toEqual({
      kind: "draft",
      text: "Hello there.",
      checks: [],
      needsHuman: false,
      reason: null,
    });
  });
});

describe("비교 · 달 · 비용 · 숫자", () => {
  it("공백만 다르면 그대로 보냄", () => {
    expect(normalizeForCompare("  a \n\n b ")).toBe("a b");
    expect(sentKindFor("h", "h")).toBe("sent_as_is");
    expect(sentKindFor("h", "x")).toBe("sent_edited");
    expect(sentKindFor(null, "x")).toBe("sent_edited");
  });

  it("이번 달은 도쿄 기준 — UTC 말일 밤은 다음 달", () => {
    expect(tokyoMonthBounds(new Date("2026-11-30T16:00:00Z"))).toEqual({
      start: "2026-12-01T00:00:00+09:00",
      endExclusive: "2027-01-01T00:00:00+09:00",
    });
    expect(tokyoMonthBounds(new Date("2026-11-30T14:59:00Z")).start).toBe("2026-11-01T00:00:00+09:00");
  });

  it("비용은 micro USD — 캐시 쓰기 · 읽기 따로", () => {
    expect(
      costMicroUsd(
        { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 },
        { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
      ),
    ).toBe(3000 + 3000 + 375 + 300);
  });

  it("가짜 숫자 — 같은 글은 같고, 길이 1", () => {
    const a = fakeEmbedding("check-in time", 64);
    expect(a).toEqual(fakeEmbedding("check-in time", 64));
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
    expect(toVectorLiteral([0.5, 1, Number.NaN])).toBe("[0.5,1,0]");
  });
});

describe("{wifi} 앞 이름표 떼기", () => {
  it("줄 맨 앞 이름표만 뗀다(ko · ja · en)", () => {
    expect(stripWifiLabelBeforeToken("Hi\nWi-Fi: {wifi}\nBye")).toBe("Hi\n{wifi}\nBye");
    expect(stripWifiLabelBeforeToken("와이파이 정보: {wifi}")).toBe("{wifi}");
    expect(stripWifiLabelBeforeToken("Wi-Fi情報：{wifi}")).toBe("{wifi}");
    expect(stripWifiLabelBeforeToken("  WiFi details : {wifi}")).toBe("  {wifi}");
    expect(stripWifiLabelBeforeToken("Please use the Wi-Fi below.\n{wifi}")).toBe("Please use the Wi-Fi below.\n{wifi}");
  });
});
