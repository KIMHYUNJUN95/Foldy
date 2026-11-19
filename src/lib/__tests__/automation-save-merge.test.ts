import { describe, expect, it } from "vitest";
import { draftSubmitOf, draftSyncOf, editDraft, reconcileDraft } from "@/lib/automation/live-view";
import { mergeAutomationSave, parseSaveFields, type AutomationSaveFields } from "@/lib/automation/save-merge";

/**
 * 자동화 설정 저장 — 내가 바꾼 칸만 반영, 안 건드린 칸은 저장 때 DB 값(2026-11-19).
 * 칸 = 발송 시각 · 재시도 마감 · 요일(통째) · 설정 안쪽 잎 하나하나(채널 · 뺄 건물은 목록 통째) · 받는 곳은 채널마다.
 * 같은 칸을 둘 다 바꿨으면 나중 저장(나)이 이긴다.
 */
const fields = (over: Partial<AutomationSaveFields> = {}): AutomationSaveFields => ({
  destinations: [{ channelKey: "OPS", locales: ["ko"] }],
  retryUntil: "10:00",
  sendTime: "08:00",
  settings: { channels: ["airbnb", "booking"], excludedProperties: [], resend: { debounceMinutes: 10, enabled: true, maxPerDay: 3, until: "18:00" } },
  weekdays: [1, 2, 3, 4, 5],
  ...over,
});

describe("mergeAutomationSave", () => {
  it("상대가 A(재시도 마감)를 바꾼 뒤 내가 B(발송 시각)만 저장 → A 는 상대 값, B 는 내 값", () => {
    const base = fields();
    const current = fields({ retryUntil: "11:30" });
    const draft = fields({ sendTime: "07:00" });
    expect(mergeAutomationSave({ base, current, draft })).toEqual(fields({ retryUntil: "11:30", sendTime: "07:00" }));
  });

  it("같은 칸을 둘 다 바꿨으면 내 값(나중 저장이 이긴다)", () => {
    expect(mergeAutomationSave({ base: fields(), current: fields({ sendTime: "09:00" }), draft: fields({ sendTime: "07:00" }) }).sendTime).toBe("07:00");
  });

  it("설정 안쪽은 잎마다 — 내가 재발송 켜기만, 상대가 마감 시각만 바꿨으면 둘 다 남는다", () => {
    const base = fields();
    const current = fields({ settings: { ...base.settings, resend: { ...base.settings.resend, until: "20:00" } } });
    const draft = fields({ settings: { ...base.settings, resend: { ...base.settings.resend, enabled: false } } });
    expect(mergeAutomationSave({ base, current, draft }).settings.resend).toEqual({ debounceMinutes: 10, enabled: false, maxPerDay: 3, until: "20:00" });
  });

  it("목록 칸(요일 · 채널)은 통째로 한 칸", () => {
    const base = fields();
    const merged = mergeAutomationSave({ base, current: fields({ weekdays: [1, 2] }), draft: fields({ weekdays: [1, 2, 3, 4, 5, 6] }) });
    expect(merged.weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mergeAutomationSave({ base, current: fields({ weekdays: [1, 2] }), draft: base }).weekdays).toEqual([1, 2]);
  });

  it("받는 곳은 채널마다 — 상대가 추가한 채널은 남고, 내가 추가한 채널도 들어간다", () => {
    const base = fields();
    const current = fields({ destinations: [{ channelKey: "OPS", locales: ["ko"] }, { channelKey: "STAFF", locales: ["ja"] }] });
    const draft = fields({ destinations: [{ channelKey: "ALERT", locales: ["en"] }, { channelKey: "OPS", locales: ["ko"] }] });
    expect(mergeAutomationSave({ base, current, draft }).destinations).toEqual([
      { channelKey: "ALERT", locales: ["en"] },
      { channelKey: "OPS", locales: ["ko"] },
      { channelKey: "STAFF", locales: ["ja"] },
    ]);
  });

  it("받는 곳 — 내가 뺀 채널은 빠지고, 상대가 뺀 채널은(내가 안 건드렸으면) 빠진 채", () => {
    const base = fields({ destinations: [{ channelKey: "OPS", locales: ["ko"] }, { channelKey: "STAFF", locales: ["ja"] }] });
    const current = fields({ destinations: [{ channelKey: "STAFF", locales: ["ja"] }] });
    const draft = fields({ destinations: [{ channelKey: "OPS", locales: ["ko"] }] });
    expect(mergeAutomationSave({ base, current, draft }).destinations).toEqual([]);
  });

  it("받는 곳 언어 — 상대가 언어를 바꾼 채널을 내가 안 건드렸으면 상대 값, 내가 바꿨으면 내 값", () => {
    const base = fields({ destinations: [{ channelKey: "OPS", locales: ["ko"] }, { channelKey: "STAFF", locales: ["ja"] }] });
    const current = fields({ destinations: [{ channelKey: "OPS", locales: ["ko", "ja"] }, { channelKey: "STAFF", locales: ["ja", "en"] }] });
    const draft = fields({ destinations: [{ channelKey: "OPS", locales: ["en"] }, { channelKey: "STAFF", locales: ["ja"] }] });
    expect(mergeAutomationSave({ base, current, draft }).destinations).toEqual([
      { channelKey: "OPS", locales: ["en"] },
      { channelKey: "STAFF", locales: ["ja", "en"] },
    ]);
  });

  it("아무것도 안 바꿨으면 지금 DB 값 그대로", () => {
    const current = fields({ retryUntil: "12:00", weekdays: [6, 7] });
    expect(mergeAutomationSave({ base: fields(), current, draft: fields() })).toEqual(current);
  });
});

describe("parseSaveFields — 클라이언트가 보낸 값(초안 · 기준)은 믿지 않는다", () => {
  const known = new Set(["OPS", "STAFF"]);
  it("정상 값은 정리해서 돌려준다(받는 곳 채널 이름순 · 언어 없는 채널 뺌)", () => {
    expect(
      parseSaveFields(
        { ...fields(), destinations: [{ channelKey: "STAFF", locales: ["ja"] }, { channelKey: "OPS", locales: ["ko"] }, { channelKey: "OPS2", locales: [] }] },
        null,
      ),
    ).toEqual({ ...fields(), destinations: [{ channelKey: "OPS", locales: ["ko"] }, { channelKey: "STAFF", locales: ["ja"] }] });
  });
  it("시각이 틀리면 null", () => {
    expect(parseSaveFields({ ...fields(), sendTime: "8시" }, null)).toBeNull();
    expect(parseSaveFields(null, null)).toBeNull();
    expect(parseSaveFields("x", null)).toBeNull();
  });
  it("채널 키 모양이 틀리면 null, 연결된 채널 목록을 주면 그 밖의 채널도 null", () => {
    expect(parseSaveFields({ ...fields(), destinations: [{ channelKey: "bad key", locales: ["ko"] }] }, null)).toBeNull();
    expect(parseSaveFields({ ...fields(), destinations: [{ channelKey: "OTHER", locales: ["ko"] }] }, known)).toBeNull();
    expect(parseSaveFields({ ...fields(), destinations: [{ channelKey: "OTHER", locales: ["ko"] }] }, null)).not.toBeNull();
  });
  it("같은 채널이 두 번이면 null", () => {
    expect(parseSaveFields({ ...fields(), destinations: [{ channelKey: "OPS", locales: ["ko"] }, { channelKey: "OPS", locales: ["ja"] }] }, null)).toBeNull();
  });
});

describe("편집 → 폴링 → 저장 — 화면 합치기와 서버 합치기가 같은 칸 규칙(받는 곳은 채널마다)", () => {
  /** 화면: 첫 그림 → 내 편집 → 폴링(상대 변경) → 저장 표. 서버: 표의 초안 · 기준을 저장 때 DB 값과 합친다. */
  const run = (first: AutomationSaveFields, edit: (d: AutomationSaveFields) => AutomationSaveFields, polled: AutomationSaveFields) => {
    let s = draftSyncOf(first, 1);
    s = editDraft(s, edit);
    s = reconcileDraft(s, polled, 2);
    const shown = s.draft;
    const ticket = draftSubmitOf(s);
    const saved = mergeAutomationSave({
      base: parseSaveFields(JSON.parse(ticket.base), null)!,
      current: polled,
      draft: parseSaveFields(JSON.parse(ticket.draft), null)!,
    });
    return { saved, shown };
  };
  const dest = (...list: Array<[string, string[]]>) => list.map(([channelKey, locales]) => ({ channelKey, locales: locales as never }));

  it("채널 추가 — 내가 ALERT 추가, 폴링이 상대의 STAFF 추가를 가져옴 → 화면 · 저장 모두 ALERT · OPS · STAFF", () => {
    const { saved, shown } = run(
      fields({ destinations: dest(["OPS", ["ko"]]) }),
      (d) => ({ ...d, destinations: [...d.destinations, ...dest(["ALERT", ["en"]])] }),
      fields({ destinations: dest(["OPS", ["ko"]], ["STAFF", ["ja"]]) }),
    );
    expect(shown.destinations.map((item) => item.channelKey).sort()).toEqual(["ALERT", "OPS", "STAFF"]);
    expect(saved.destinations).toEqual(dest(["ALERT", ["en"]], ["OPS", ["ko"]], ["STAFF", ["ja"]]));
  });
  it("채널 빼기 — 내가 OPS 를 빼고, 상대는 STAFF 를 뺌 → 둘 다 빠짐 / 상대가 넣은 것은 남음", () => {
    const first = fields({ destinations: dest(["OPS", ["ko"]], ["STAFF", ["ja"]]) });
    const removeOps = (d: AutomationSaveFields) => ({ ...d, destinations: d.destinations.filter((item) => item.channelKey !== "OPS") });
    expect(run(first, removeOps, fields({ destinations: dest(["OPS", ["ko"]]) })).saved.destinations).toEqual([]);
    expect(run(first, removeOps, fields({ destinations: dest(["ALERT", ["en"]], ["OPS", ["ko"]], ["STAFF", ["ja"]]) })).saved.destinations).toEqual(
      dest(["ALERT", ["en"]], ["STAFF", ["ja"]]),
    );
  });
  it("언어 변경 — 내가 OPS 언어를, 상대가 STAFF 언어를 바꿈 → 둘 다 남음", () => {
    const { saved, shown } = run(
      fields({ destinations: dest(["OPS", ["ko"]], ["STAFF", ["ja"]]) }),
      (d) => ({ ...d, destinations: d.destinations.map((item) => (item.channelKey === "OPS" ? { ...item, locales: ["en"] as never } : item)) }),
      fields({ destinations: dest(["OPS", ["ko"]], ["STAFF", ["ja", "en"]]) }),
    );
    expect(shown.destinations).toEqual(dest(["OPS", ["en"]], ["STAFF", ["ja", "en"]]));
    expect(saved.destinations).toEqual(dest(["OPS", ["en"]], ["STAFF", ["ja", "en"]]));
  });
  it("설정 칸 — 내가 재발송 끄기, 상대가 재발송 마감 · 요일 바꿈 → 둘 다 남음", () => {
    const first = fields();
    const { saved, shown } = run(
      first,
      (d) => ({ ...d, settings: { ...d.settings, resend: { ...d.settings.resend, enabled: false } } }),
      fields({ settings: { ...first.settings, resend: { ...first.settings.resend, until: "20:00" } }, weekdays: [6, 7] }),
    );
    expect(shown).toEqual(saved);
    expect(saved.settings.resend).toMatchObject({ enabled: false, until: "20:00" });
    expect(saved.weekdays).toEqual([6, 7]);
  });
  it("목록 칸(채널) — 내가 채널 목록을, 상대가 뺄 건물을 바꿈 → 둘 다 남음", () => {
    const first = fields();
    const { saved } = run(
      first,
      (d) => ({ ...d, settings: { ...d.settings, channels: ["airbnb"] as never } }),
      fields({ settings: { ...first.settings, excludedProperties: ["X"] } }),
    );
    expect(saved.settings).toMatchObject({ channels: ["airbnb"], excludedProperties: ["X"] });
  });
});
