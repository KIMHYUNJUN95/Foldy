import { describe, expect, it } from "vitest";
import {
  actorLines,
  barCaption,
  pauseSummaryLine,
  windowHeadLine,
  chartLines,
  creditDisplay,
  creditPollMs,
  creditRefreshResult,
  isNewerResponse,
  showCreditLoadError,
  creditTexts,
  creditView,
  fillCopy,
  formatCountdown,
  formatDurationWords,
  sharePercent,
  shouldRefreshCredit,
  stateOfRemaining,
} from "@/lib/beds24-credit-view";
import type { Beds24CreditSnapshot } from "@/lib/beds24/credit-usage-types";
import { getDictionary } from "@/lib/i18n";

/**
 * Beds24 크레딧 게이지가 보이는 상태 · 숫자 · 카운트다운 규칙(2026-11-18).
 * 도메인 계약: docs/product/36-automation-control.md 「Beds24 크레딧」.
 */

const NOW = 1_800_000_000_000;
const snap = (over: Partial<Beds24CreditSnapshot> = {}): Beds24CreditSnapshot => ({
  state: "ok",
  remaining: 120,
  limit: 200,
  resetsAt: NOW + 90_000,
  pausedUntil: null,
  recordedAt: NOW - 10_000,
  ...over,
});

describe("stateOfRemaining — 50 아래 주의, 10 아래 멈춤", () => {
  it.each([
    [200, "ok"],
    [50, "ok"],
    [49, "warn"],
    [10, "warn"],
    [9, "stop"],
    [0, "stop"],
  ])("%i → %s", (remaining, state) => {
    expect(stateOfRemaining(remaining)).toBe(state);
  });
});

describe("creditView", () => {
  it("기록이 없으면 모름 — 숫자 · 막대 · 카운트다운 없음", () => {
    expect(creditView(null, NOW)).toEqual({ state: "unknown", remaining: null, limit: 200, percent: 0, countdownTo: null, stale: false });
  });

  it("넉넉 — 남은 양 · 비율 · 다시 가득 차는 시각", () => {
    expect(creditView(snap(), NOW)).toEqual({ state: "ok", remaining: 120, limit: 200, percent: 60, countdownTo: NOW + 90_000, stale: false });
  });

  it("주의 — 남은 양 30", () => {
    expect(creditView(snap({ remaining: 30 }), NOW).state).toBe("warn");
  });

  it("리셋 시각이 지났으면 다음 기록을 기다리지 않고 가득 참", () => {
    const view = creditView(snap({ remaining: 5, resetsAt: NOW - 1 }), NOW);
    expect(view).toMatchObject({ state: "ok", remaining: 200, percent: 100, countdownTo: null });
  });

  it("쉬는 중이면 남은 양이 많아도 멈춤 — 카운트다운은 풀리는 때", () => {
    const view = creditView(snap({ remaining: 150, pausedUntil: NOW + 160_000 }), NOW);
    expect(view.state).toBe("stop");
    expect(view.countdownTo).toBe(NOW + 160_000);
  });

  it("쉬는 시각이 지났으면 멈춤이 풀린다", () => {
    expect(creditView(snap({ pausedUntil: NOW - 1 }), NOW).state).toBe("ok");
  });

  it("서버가 모름이라고 하면 숫자를 지운다", () => {
    expect(creditView(snap({ state: "unknown" }), NOW)).toMatchObject({ state: "unknown", remaining: null, percent: 0 });
  });
});

describe("creditView — 갱신이 실패하는 동안(낡은 값)", () => {
  it("갱신이 잘 되면 옛 값 그대로 — 실패 0번", () => {
    expect(creditView(snap({ resetsAt: NOW - 1 }), NOW, 0)).toMatchObject({ state: "ok", remaining: 200, stale: false });
  });

  it("실패 중 + 리셋 시각이 지났으면 가득 참으로 보이지 않고 모름", () => {
    const view = creditView(snap({ remaining: 5, resetsAt: NOW - 1 }), NOW, 1);
    expect(view).toMatchObject({ state: "unknown", remaining: null, percent: 0, countdownTo: null, stale: true });
  });

  it("실패 중 + 쉬는 시각이 지났어도 모름", () => {
    expect(creditView(snap({ pausedUntil: NOW - 1 }), NOW, 1)).toMatchObject({ state: "unknown", stale: true });
  });

  it("실패 1~2번은 아직 유효한 값을 그대로, 3번 이어지면 모름", () => {
    expect(creditView(snap(), NOW, 2)).toMatchObject({ state: "ok", remaining: 120, stale: false });
    expect(creditView(snap(), NOW, 3)).toMatchObject({ state: "unknown", remaining: null, stale: true });
  });

  it("낡은 모름은 문구가 「기록 없음」이 아니라 「확인 못 함」", () => {
    const copy = getDictionary("ko").beds24Credit;
    const stale = creditTexts(creditDisplay(creditView(snap(), NOW, 3), NOW), copy);
    expect(stale.sub).toBe(copy.staleBody);
    expect(stale.gauge.value).toBe(copy.staleShort);
    expect(stale.aria).toBe(copy.ariaStale);
    expect(stale.note).toBeNull();
  });
});

describe("시간 글자", () => {
  it("formatCountdown — m:ss, 1시간 넘으면 h:mm:ss, 음수는 0", () => {
    expect(formatCountdown(160_000)).toBe("2:40");
    expect(formatCountdown(5_000)).toBe("0:05");
    expect(formatCountdown(3_725_000)).toBe("1:02:05");
    expect(formatCountdown(-3_000)).toBe("0:00");
    // 남은 0.4초는 1초로 올린다 — 0:00 이 일찍 보이지 않게.
    expect(formatCountdown(400)).toBe("0:01");
  });

  it("formatDurationWords — 세 언어 사전", () => {
    const ko = getDictionary("ko").beds24Credit;
    const en = getDictionary("en").beds24Credit;
    const ja = getDictionary("ja").beds24Credit;
    for (const copy of [ko, en, ja]) {
      expect(formatDurationWords(160_000, copy)).not.toMatch(/[{}]/);
      expect(formatDurationWords(3_725_000, copy)).not.toMatch(/[{}]/);
    }
    expect(formatDurationWords(160_000, ko)).toBe(fillCopy(ko.durMinSec, { m: 2, s: 40 }));
    expect(formatDurationWords(120_000, ko)).toBe(fillCopy(ko.durMin, { m: 2 }));
    expect(formatDurationWords(40_000, ko)).toBe(fillCopy(ko.durSec, { s: 40 }));
    expect(formatDurationWords(3_725_000, ko)).toBe(fillCopy(ko.durHourMin, { h: 1, m: 2 }));
  });
});

describe("작은 규칙", () => {
  it("sharePercent — 합이 0 이면 0, 반올림", () => {
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(5, 0)).toBe(0);
    expect(sharePercent(10, 5)).toBe(100);
  });

  it("shouldRefreshCredit — 보일 때 · 간격이 지났을 때만", () => {
    expect(shouldRefreshCredit({ visible: true, lastFetchedAt: 0, now: 6_000, minGapMs: 5_000 })).toBe(true);
    expect(shouldRefreshCredit({ visible: true, lastFetchedAt: 2_000, now: 6_000, minGapMs: 5_000 })).toBe(false);
    expect(shouldRefreshCredit({ visible: false, lastFetchedAt: 0, now: 60_000, minGapMs: 5_000 })).toBe(false);
  });

  it("fillCopy — 같은 자리 표시가 여러 번이어도 모두", () => {
    expect(fillCopy("{n}/{limit} · {n}", { n: 3, limit: 200 })).toBe("3/200 · 3");
  });

  it("actorLines — 자동 · 밖은 사전 글자, 사람은 첫 글자", () => {
    const copy = getDictionary("ko").beds24Credit;
    expect(actorLines({ key: "auto", kind: "auto", name: "", topFeatures: ["rates_read"], credits: 3 }, copy)).toEqual({
      name: copy.auto,
      sub: copy.feature.rates_read,
      initial: "",
    });
    expect(actorLines({ key: "outside", kind: "outside", name: "", topFeatures: [], credits: 3 }, copy).sub).toBe(copy.outsideHint);
    expect(actorLines({ key: "user:1", kind: "user", name: "김하나", topFeatures: [], credits: 3 }, copy).initial).toBe("김");
  });
});

/**
 * 한 판정 → 모든 화면(2026-11-18 검사 3번). 게이지 · 요약 창 · 관제실 칸 · 모바일 한 줄 · 시트가 `creditTexts()` 하나만 쓴다.
 * 쉬는 중이면 숫자 대신 풀리는 시각 카운트다운, 막대는 비운다 — 리셋이 지나 남은 양이 200 이어도.
 */
describe("creditDisplay · creditTexts — 상태 × 화면", () => {
  const copy = getDictionary("ko").beds24Credit;
  const at = (over: Partial<Beds24CreditSnapshot>, now: number | null = NOW) =>
    creditTexts(creditDisplay(creditView(snap(over), now ?? NOW), now), copy);

  it("넉넉", () => {
    const t = at({ remaining: 120 });
    expect(t.fill).toBe(0.6);
    expect(t.gauge).toEqual({ label: copy.name, value: "120", suffix: "/ 200" });
    expect(t.big).toEqual({ value: "120", suffix: fillCopy(copy.leftOf, { limit: 200 }) });
    expect(t.sub).toBe(fillCopy(copy.refillIn, { time: formatDurationWords(90_000, copy) }));
    expect(t.aria).toBe(fillCopy(copy.ariaOk, { n: 120, limit: 200 }));
    expect(t.note).toBeNull();
  });

  it("주의 — 한 줄이 생긴다", () => {
    const t = at({ remaining: 30 });
    expect(t.fill).toBe(0.15);
    expect(t.aria).toBe(fillCopy(copy.ariaWarn, { n: 30, limit: 200 }));
    expect(t.note).toEqual({ label: copy.noteWarn, value: fillCopy(copy.noteValue, { n: 30, limit: 200 }) });
  });

  it("쉬는 중 — 숫자 대신 카운트다운, 막대 비움", () => {
    const t = at({ remaining: 4, pausedUntil: NOW + 160_000 });
    expect(t.fill).toBe(0);
    expect(t.gauge).toEqual({ label: copy.paused, value: "2:40", suffix: "" });
    expect(t.big).toEqual({ value: "2:40", suffix: copy.resumeSuffix });
    expect(t.sub).toBe(fillCopy(copy.pausedFor, { time: formatDurationWords(160_000, copy) }));
    expect(t.note).toEqual({ label: copy.noteStop, value: fillCopy(copy.noteResumesIn, { time: "2:40" }) });
  });

  it("리셋은 지났는데 쉬는 시간이 남음 — 200 · 꽉 찬 막대로 보이지 않는다", () => {
    const t = at({ remaining: 4, resetsAt: NOW - 1, pausedUntil: NOW + 30_000 });
    expect(t.fill).toBe(0);
    expect(t.gauge.value).toBe("0:30");
    expect(t.big.value).toBe("0:30");
    expect(t.big.value).not.toBe("200");
  });

  it("10 미만인데 다시 가득 찰 시각도 모름 — 「곧」", () => {
    const t = at({ remaining: 3, resetsAt: null });
    expect(t.fill).toBe(0);
    expect(t.gauge.value).toBe("");
    expect(t.big.value).toBe("—");
    expect(t.sub).toBe(copy.pausedSoon);
    expect(t.note?.value).toBe(copy.noteResumesSoon);
  });

  it("쉬는 중인데 아직 시각을 모름(붙기 전) — 카운트다운 자리를 비운다(곧 → 2:40 으로 바뀌어 흔들리지 않게)", () => {
    const t = at({ remaining: 4, pausedUntil: NOW + 160_000 }, null);
    expect(t.gauge.value).toBe("");
    expect(t.note?.value).toBe("");
    expect(t.aria).toBe(copy.ariaStopNoTime);
  });

  it("모름", () => {
    const t = creditTexts(creditDisplay(creditView(null, NOW), NOW), copy);
    expect(t.fill).toBe(0);
    expect(t.gauge).toEqual({ label: copy.name, value: copy.unknownShort, suffix: "" });
    expect(t.big.value).toBe("—");
    expect(t.sub).toBe(copy.unknownBody);
    expect(t.aria).toBe(copy.ariaUnknown);
    expect(t.note).toBeNull();
  });

  it("세 언어 모두 자리 표시가 남지 않는다", () => {
    for (const locale of ["ko", "ja", "en"] as const) {
      const c = getDictionary(locale).beds24Credit;
      for (const over of [{ remaining: 120 }, { remaining: 30 }, { remaining: 4, pausedUntil: NOW + 160_000 }, { remaining: 3, resetsAt: null }]) {
        const t = creditTexts(creditDisplay(creditView(snap(over), NOW), NOW), c);
        expect(JSON.stringify(t)).not.toMatch(/\{[a-z]+\}/);
      }
    }
  });
});

describe("chartLines — 점선 숫자는 상수에서", () => {
  it("한도 200 → 190(모두 쉼) · 150(리뷰 멈춤)", () => {
    const copy = getDictionary("en").beds24Credit;
    expect(chartLines(200, copy)).toEqual([
      { used: 190, label: fillCopy(copy.line190, { n: 190 }) },
      { used: 150, label: fillCopy(copy.line150, { n: 150 }) },
    ]);
    expect(copy.line190).toContain("{n}");
    expect(copy.line150).toContain("{n}");
  });
});

describe("barCaption — 막대 위 숫자", () => {
  it("0 은 그리지 않는다 · 주의 · 멈춤 · 지금 막대만", () => {
    expect(barCaption({ used: 0, level: "ok" }, true)).toBeNull();
    expect(barCaption({ used: 12, level: "ok" }, false)).toBeNull();
    expect(barCaption({ used: 12, level: "ok" }, true)).toEqual({ cls: "now", text: "12" });
    expect(barCaption({ used: 160, level: "warn" }, false)).toEqual({ cls: "warn", text: "160" });
    expect(barCaption({ used: 0, level: "stop" }, false)).toBeNull();
  });
});

describe("pauseSummaryLine — 오늘 쉰 횟수", () => {
  const copy = getDictionary("ko").beds24Credit;
  const hm = () => "14:05";
  it("없으면 null, 0 번이면 「쉬지 않음」", () => {
    expect(pauseSummaryLine(undefined, hm, copy)).toBeNull();
    expect(pauseSummaryLine({ count: 0, lastAt: null, lastSeconds: null }, hm, copy)).toBe(copy.pausesNone);
  });
  it("길이를 알면 시각 + 길이", () => {
    expect(pauseSummaryLine({ count: 2, lastAt: 1, lastSeconds: 160 }, hm, copy)).toBe(
      fillCopy(copy.pausesToday, { n: 2, time: "14:05", dur: "2분 40초" }),
    );
  });
  it("길이를 모르면(헤더 없는 429) 「0초」가 아니라 길이를 뺀다", () => {
    const line = pauseSummaryLine({ count: 1, lastAt: 1, lastSeconds: null }, hm, copy);
    expect(line).toBe(fillCopy(copy.pausesTodayNoDur, { n: 1, time: "14:05" }));
    expect(line).not.toMatch(/0초|\{/);
  });
  it("마지막 시각이 없으면 횟수만", () => {
    expect(pauseSummaryLine({ count: 3, lastAt: null, lastSeconds: null }, hm, copy)).toBe(fillCopy(copy.pausesTodayNoLast, { n: 3 }));
  });
  it("세 언어 모두 길이 없는 문구에 남은 자리 표시가 없다", () => {
    for (const locale of ["ko", "ja", "en"] as const) {
      const c = getDictionary(locale).beds24Credit;
      expect(pauseSummaryLine({ count: 1, lastAt: 1, lastSeconds: null }, hm, c)).not.toMatch(/\{\w+\}/);
    }
  });
});

describe("windowHeadLine — 지금 5분 머리글", () => {
  it("쓴 양이 있으면 합계를 붙인다", () => {
    const copy = getDictionary("ko").beds24Credit;
    expect(windowHeadLine(50, copy)).toBe(fillCopy(copy.windowHead, { n: "50" }));
  });
  it("0(모름 · 기록 없음 포함)이면 「· 0」 없이 — 아래 빈 문구가 이미 말한다", () => {
    for (const locale of ["ko", "ja", "en"] as const) {
      const c = getDictionary(locale).beds24Credit;
      const line = windowHeadLine(0, c);
      expect(line).toBe(c.windowHeadPlain);
      expect(line).not.toMatch(/0|\{/);
    }
  });
});

describe("자동 갱신 간격 · 응답 순번 · 오류 띠", () => {
  it("7일만 60초, 나머지는 10초", () => {
    expect(["5m", "1h", "today"].map((r) => creditPollMs(r as "5m"))).toEqual([10_000, 10_000, 10_000]);
    expect(creditPollMs("7d")).toBe(60_000);
  });

  it("나중에 보낸 요청의 응답이 이긴다 — 늦게 도착한 옛 요청은 못 덮는다", () => {
    expect(isNewerResponse(5, 4)).toBe(true);
    expect(isNewerResponse(4, 5)).toBe(false);
    expect(isNewerResponse(5, 5)).toBe(false);
  });

  it("오류 띠 — 누른 요청 실패는 바로, 조용한 갱신은 낡은 값 기준(3번)부터", () => {
    expect(showCreditLoadError(true, 0)).toBe(true);
    expect(showCreditLoadError(false, 2)).toBe(false);
    expect(showCreditLoadError(false, 3)).toBe(true);
  });
});

describe("creditRefreshResult — 순번에 밀린 응답은 성공 · 실패로 세지 않는다", () => {
  it.each([
    [true, true, "ok"],
    [false, true, "failed"],
    [true, false, "dropped"],
    [false, false, "dropped"],
  ] as const)("ok=%s newer=%s → %s", (ok, newer, expected) => {
    expect(creditRefreshResult(ok, newer)).toBe(expected);
  });
});
