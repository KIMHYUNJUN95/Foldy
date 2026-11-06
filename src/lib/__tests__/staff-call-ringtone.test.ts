import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 첫 입력에서 소리를 푸는 규칙 — 풀린 것을 확인한 뒤에만 리스너를 지운다. docs/product/46 §6.
type Listener = () => void;

function fakeWindow(resumeResult: () => "running" | "suspended") {
  const listeners = new Map<string, Set<Listener>>();
  const instances: { state: string; resume: () => Promise<void> }[] = [];
  class FakeAudioContext {
    state = "suspended";
    resume = vi.fn(async () => {
      this.state = resumeResult();
    });
    constructor() {
      instances.push(this);
    }
  }
  return {
    instances,
    listenerCount: (name: string) => listeners.get(name)?.size ?? 0,
    fire: (name: string) => [...(listeners.get(name) ?? [])].forEach((listener) => listener()),
    win: {
      AudioContext: FakeAudioContext,
      addEventListener: (name: string, listener: Listener) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)?.add(listener);
      },
      removeEventListener: (name: string, listener: Listener) => listeners.get(name)?.delete(listener),
    },
  };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("벨 잠금 풀기", () => {
  it("풀리지 않았으면 리스너를 남겨 다음 입력에서 다시 시도한다", async () => {
    const fake = fakeWindow(() => "suspended");
    vi.stubGlobal("window", fake.win);
    const { armRingtoneUnlock } = await import("@/components/checkin-call/ringtone");
    armRingtoneUnlock();
    fake.fire("pointerdown");
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.listenerCount("pointerdown")).toBe(1);
    expect(fake.listenerCount("touchend")).toBe(1);
    fake.fire("touchend");
    expect(fake.instances[0].resume).toHaveBeenCalledTimes(2);
  });

  it("running 을 확인하면 모든 리스너를 지운다", async () => {
    const fake = fakeWindow(() => "running");
    vi.stubGlobal("window", fake.win);
    const { armRingtoneUnlock } = await import("@/components/checkin-call/ringtone");
    armRingtoneUnlock();
    fake.fire("touchend");
    await Promise.resolve();
    await Promise.resolve();
    for (const name of ["pointerdown", "keydown", "touchend"]) expect(fake.listenerCount(name)).toBe(0);
  });

  it("받기 탭에서 부르면 await 없이 바로 resume 한다", async () => {
    const fake = fakeWindow(() => "running");
    vi.stubGlobal("window", fake.win);
    const { unlockCallAudio } = await import("@/components/checkin-call/ringtone");
    unlockCallAudio();
    expect(fake.instances[0].resume).toHaveBeenCalledTimes(1);
  });
});
