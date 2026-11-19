import { describe, expect, it } from "vitest";

import { maskPastReply } from "@/lib/guest-messages/ai-assist-model";
import {
  anySecretLike,
  CANDIDATE_RULES,
  centroidOf,
  containsSecretLike,
  detectLang,
  greedyClusters,
  isRemembered,
  eachLimited,
  mentionsSecretWord,
  mergeOptions,
  scrubSecretSentences,
  validateGuestInfoOutput,
  validateSavedReplyOutput,
  valueHashesOf,
} from "@/lib/guest-messages/reply-candidates-model";

const L = (text: string) => ({ ko: text, ja: text, en: text });

describe("비밀 걸러내기 — 출입 · 와이파이 비밀번호 · 문 코드는 후보가 되지 않는다", () => {
  it("조직 비밀 값이 그대로(띄어쓰기 · 하이픈 섞여도) 들어 있으면 걸린다", () => {
    expect(containsSecretLike("현관에서 4 8-2 7 을 누르세요", ["4827"])).toBe(true);
    expect(containsSecretLike("Network: StayNet-201 is in the room", ["StayNet-201"])).toBe(true);
  });

  it("비밀 낱말 + 숫자 · 가린 자리가 한 문장에 있으면 걸린다(세 언어)", () => {
    expect(containsSecretLike("현관 비밀번호는 1234# 입니다.", [])).toBe(true);
    expect(containsSecretLike("The door code is 5 5 1 2.", [])).toBe(true);
    expect(containsSecretLike("暗証番号は[…]です。", [])).toBe(true);
    expect(containsSecretLike("キーボックスは 0-0-9-1 で開きます", [])).toBe(true);
  });

  it("와이파이는 wifi 옵션일 때 낱말 + 숫자도 걸린다", () => {
    expect(containsSecretLike("Wi-Fi: 88776655", [], { wifi: true })).toBe(true);
    expect(containsSecretLike("와이파이 비번 98765432", [])).toBe(true);
  });

  it("비밀 없이 시각 · 안내만 있는 문장은 통과한다", () => {
    expect(containsSecretLike("체크아웃은 11시입니다. 짐은 1층에 두세요.", ["4827"], { wifi: true })).toBe(false);
    expect(containsSecretLike("Check-in is from 15:00.", [], { wifi: true })).toBe(false);
    expect(containsSecretLike("비밀번호는 체크인 당일 따로 보내 드려요.", [])).toBe(false);
  });

  it("비밀 낱말 줄 바로 다음 줄에 띄어 쓴 숫자가 와도 걸린다(「Door code:\\n12 34」)", () => {
    expect(containsSecretLike("Door code:\n12 34", [])).toBe(true);
    expect(containsSecretLike("현관 비밀번호\n48 27 입니다", [])).toBe(true);
    expect(containsSecretLike("暗証番号:\n0 9 1 2", [])).toBe(true);
    // 비밀 낱말 없는 두 줄 · 두 줄 넘어 떨어진 숫자는 그대로
    expect(containsSecretLike("Check-in:\n15 00 onward", [])).toBe(false);
  });

  it("빈 줄 · 마침표로 끊어도 비밀 낱말 다음 조각은 걸린다(「Door code:\\n\\n12 34」 · 「Door code.\\n12 34」)", () => {
    expect(containsSecretLike("Door code:\n\n12 34", [])).toBe(true);
    expect(containsSecretLike("Door code.\n12 34", [])).toBe(true);
    expect(containsSecretLike("현관 비밀번호\n\n48 27 입니다", [])).toBe(true);
    expect(containsSecretLike("현관 비밀번호입니다.\n48 27", [])).toBe(true);
    expect(containsSecretLike("暗証番号:\n\n0 9 1 2", [])).toBe(true);
    expect(containsSecretLike("暗証番号です。\n0 9 1 2", [])).toBe(true);
    expect(scrubSecretSentences("Door code:\n\n12 34\nEnjoy your stay!", [])).not.toMatch(/12 34/);
    expect(scrubSecretSentences("Door code.\n12 34", [])).not.toMatch(/12 34/);
    // 비밀 낱말 없는 줄은 빈 줄을 건너도 그대로
    expect(containsSecretLike("Check-in:\n\n15 00 onward", [])).toBe(false);
  });

  it("근거 글 — 비밀 낱말 줄 다음 줄도 통째로 가린다", () => {
    const out = scrubSecretSentences("Door code:\n12 34\nEnjoy your stay!", []);
    expect(out).not.toMatch(/12 34/);
    expect(out).toContain("Enjoy your stay!");
  });

  it("짧은(3자 미만) 비밀 값으로는 잘못 걸지 않는다", () => {
    expect(containsSecretLike("2층입니다", ["2"])).toBe(false);
  });

  it("여러 글 중 하나라도 걸리면 걸린다", () => {
    expect(anySecretLike(["안녕하세요", null, "door code 7788"], [])).toBe(true);
    expect(anySecretLike(["안녕하세요", undefined], [])).toBe(false);
  });
});

describe("최신이 이긴다 — 값이 섞이면 마지막으로 쓴 날이 늦은 쪽이 앞", () => {
  const at = (day: number) => ({ id: `r${day}`, at: `2026-${String(day).padStart(2, "0")}-01T03:00:00.000Z` });

  it("예전에 많이 쓴 값보다 최근에 쓴 값이 첫째(미리 골라 둔 값)", () => {
    const options = mergeOptions([
      { value: L("10:00"), support: [at(1), at(2), at(3), at(4), at(5)] },
      { value: L("11:00"), support: [at(7), at(8), at(9)] },
    ]);
    expect(options.map((o) => o.value.ko)).toEqual(["11:00", "10:00"]);
    expect(options[0]).toMatchObject({ count: 3, firstAt: at(7).at, lastAt: at(9).at });
  });

  it("같은 값(띄어쓰기 · 구두점만 다름)은 합치고, 근거가 적은 값은 버리고, 최대 2개", () => {
    const options = mergeOptions([
      { value: L("오전 11시"), support: [at(1), at(2)] },
      { value: L("오전11시."), support: [at(3)] },
      { value: L("오후 3시"), support: [at(9), at(10)] },
      { value: L("정오"), support: [at(4), at(5), at(6)] },
      { value: L("오전 10시"), support: [at(1), at(2), at(3)] },
    ]);
    expect(options).toHaveLength(CANDIDATE_RULES.maxOptions);
    expect(options[0].value.ko).toBe("정오");
    expect(options[1]).toMatchObject({ count: 3, value: { ko: "오전 11시" } });
    expect(options.some((o) => o.value.ko === "오후 3시")).toBe(false);
  });
});

describe("묶음 · 기억", () => {
  const unit = (x: number, y: number) => {
    const len = Math.hypot(x, y);
    return [x / len, y / len, 0];
  };

  it("가까운 질문끼리 큰 묶음부터, 작은 묶음은 버린다", () => {
    const vectors = [unit(1, 0), unit(1, 0.05), unit(1, -0.05), unit(1, 0.02), unit(0, 1), unit(0.05, 1), [0, 0, 1]];
    const clusters = greedyClusters(vectors, { maxDistance: 0.1, minSize: 2, max: 10 });
    expect(clusters).toHaveLength(2);
    expect(clusters[0].members.sort()).toEqual([0, 1, 2, 3]);
    expect(clusters[1].members.sort()).toEqual([4, 5]);
  });

  it("넣은 · 뺀 묶음과 가까우면 다시 띄우지 않는다(빼기는 영영)", () => {
    const centroid = centroidOf([unit(1, 0), unit(1, 0.1)]);
    expect(isRemembered(centroid, [unit(1, 0.02)], CANDIDATE_RULES.rememberSimilarity)).toBe(true);
    expect(isRemembered(centroid, [unit(0, 1)], CANDIDATE_RULES.rememberSimilarity)).toBe(false);
  });

  it("값 지문은 언어별로 — 한 언어만 같아도 같은 값", () => {
    expect(valueHashesOf({ ko: "11시", ja: "", en: "11 AM" })).toEqual(["ko:11시", "en:11am"]);
  });
});

describe("모델 출력 확인", () => {
  it("문구 후보 — 모르는 자리표시 · 빈 언어 · 범위 밖 번호는 버린다", () => {
    const drafts = validateSavedReplyOutput(
      {
        candidates: [
          { index: 0, skip: false, title: L("짐 보관"), question: L("짐 맡길 수 있나요?"), body: L("{guest_name}님, 가능합니다."), note: L("") },
          { index: 1, skip: false, title: L("나쁨"), question: L("?"), body: L("{door_code} 입니다"), note: L("") },
          { index: 2, skip: false, title: { ko: "제목", ja: "", en: "Title" }, question: L("?"), body: L("본문"), note: L("") },
          { index: 3, skip: true, title: L(""), question: L(""), body: L(""), note: L("") },
          { index: 9, skip: false, title: L("범위 밖"), question: L("?"), body: L("본문"), note: L("") },
        ],
      },
      4,
    );
    expect(drafts.map((d) => [d.index, d.skip])).toEqual([
      [0, false],
      [3, true],
    ]);
  });

  it("건물 칸 — 고를 수 있는 칸만, 근거 번호는 답장 수 안에서만", () => {
    const fields = validateGuestInfoOutput(
      {
        fields: [
          { field: "checkOut", options: [{ value: L("11:00"), support: [0, 1, 1, 99, -1] }] },
          { field: "parking", options: [{ value: L("없음"), support: [0] }] },
          { field: "wifi", options: [{ value: L("x"), support: [0] }] },
        ],
      },
      3,
      ["checkOut"],
    );
    expect(fields).toEqual([{ field: "checkOut", options: [{ value: L("11:00"), support: [0, 1] }] }]);
  });

  it("근거 언어 표시", () => {
    expect(detectLang("체크아웃은 11시")).toBe("ko");
    expect(detectLang("チェックアウトは11時")).toBe("ja");
    expect(detectLang("Check-out at 11")).toBe("en");
  });
});

describe("점검 고치기 — 비밀 낱말 · 근거 글 · 근거 세기 · 묶기", () => {
  it("건물 값 — 숫자가 없어도 비밀 낱말이 있으면 걸린다(세 언어)", () => {
    expect(mentionsSecretWord("비밀번호는 sakura 예요")).toBe(true);
    expect(mentionsSecretWord("와이파이 비번은 객실 카드에 있어요")).toBe(true);
    expect(mentionsSecretWord("パスワードは部屋のカードにあります")).toBe(true);
    expect(mentionsSecretWord("The PIN is on the card")).toBe(true);
    expect(mentionsSecretWord("暗証番号はメールでお送りします")).toBe(true);
    expect(mentionsSecretWord("Check-out is by 11 AM.")).toBe(false);
    expect(mentionsSecretWord("Wi-Fi is free in every room.")).toBe(false);
  });

  it("과거 답 가리기 — 비밀 문장 안의 띄어쓰기 · 하이픈 섞인 숫자도 가린다", () => {
    const out = maskPastReply("Door code 12-34, or PIN 1 2 3 4. Check-out by 11 AM.", [], []);
    expect(out).not.toMatch(/12-34|1 2 3 4/);
    expect(out).toContain("11 AM");
  });

  it("근거 글 — 비밀 문장은 통째로 […]", () => {
    const out = scrubSecretSentences("Check-out is by 11 AM. Wi-Fi password: […]. See you!", []);
    expect(out).toContain("Check-out is by 11 AM.");
    expect(out).toContain("See you!");
    expect(out).not.toMatch(/password/i);
    expect(scrubSecretSentences("문 코드는 4827 이에요. 체크아웃은 11시.", ["4827"])).not.toContain("4827");
  });

  it("근거 세기는 답장 id 로 — 같은 시각 다른 답장 둘은 둘", () => {
    const at = "2026-10-01T03:00:00.000Z";
    const out = mergeOptions([{ value: L("11시"), support: [{ id: "a", at }, { id: "b", at }, { id: "a", at }] }], { minOptionSupport: 1, maxOptions: 3 });
    expect(out[0].count).toBe(2);
  });

  it("묶기 — 길이가 달라도 방향이 같으면 한 묶음(정규화 한 번)", () => {
    const clusters = greedyClusters([[2, 0], [1, 0.01], [0, 5], [10, 0]], { maxDistance: 0.05, minSize: 2, max: 5 });
    expect(clusters).toEqual([{ seed: 0, members: [0, 1, 3] }]);
  });
});

describe("재검사 고치기 — 시간 · 거리 숫자는 남기고, 비밀 문장 숫자만 가림", () => {
  it("비밀 낱말 없는 문장의 하이픈 · 빈칸 숫자는 그대로", () => {
    expect(maskPastReply("Check-in 15:00-22:00", [])).toBe("Check-in 15:00-22:00");
    expect(maskPastReply("10-15 minutes walk", [])).toBe("10-15 minutes walk");
    expect(maskPastReply("徒歩10分", [])).toBe("徒歩10分");
    expect(maskPastReply("역에서 10 15분", [])).toBe("역에서 10 15분");
  });
  it("비밀 낱말 문장 안의 나눠 쓴 숫자는 가림", () => {
    expect(maskPastReply("The door code is 12-34.", [])).not.toMatch(/12|34/);
    expect(maskPastReply("비밀번호는 1 2 3 4 입니다", [])).not.toMatch(/1 2 3 4|\d/);
    // 같은 글 다른 문장의 시간은 남는다
    const mixed = maskPastReply("Check-in is 15:00-22:00. The door code is 12-34.", []);
    expect(mixed).toContain("15:00-22:00");
    expect(mixed).not.toContain("12-34");
  });
});

describe("재검사 고치기 — eachLimited 는 실패해도 모든 작업자가 끝난 뒤 거부", () => {
  it("실패 뒤 새 작업을 잡지 않고, 돌던 작업이 끝난 뒤에야 거부된다", async () => {
    const started: number[] = [];
    const finished: number[] = [];
    let settledAt = -1;
    const run = eachLimited([0, 1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      started.push(item);
      if (item === 0) throw new Error("boom");
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished.push(item);
    });
    await expect(run.finally(() => (settledAt = finished.length))).rejects.toThrow("boom");
    // 돌던 1 · 2 는 끝까지 갔고(그 비용도 이미 더해짐), 실패 뒤로는 새 작업 없음
    expect(started.sort()).toEqual([0, 1, 2]);
    expect(finished.sort()).toEqual([1, 2]);
    expect(settledAt).toBe(2);
  });
  it("실패가 없으면 모두 돈다", async () => {
    const seen: number[] = [];
    await eachLimited([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
