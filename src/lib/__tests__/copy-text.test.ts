import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "@/lib/copy-text";

/** 공용 복사 — 클립보드가 없거나 거절하면 숨은 글 칸 + execCommand 로. 값은 가짜만. */
class FakeElement {
  isConnected = true;
  focus = vi.fn();
}

function fakeDocument(execResult: boolean, activeElement: unknown = null) {
  const textarea = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  const doc = {
    activeElement,
    createElement: vi.fn(() => textarea),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
    execCommand: vi.fn(() => execResult),
  };
  vi.stubGlobal("document", doc);
  return { doc, textarea };
}

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("클립보드가 되면 클립보드만 쓴다", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { doc } = fakeDocument(true);
    await copyText("fake-value");
    expect(writeText).toHaveBeenCalledWith("fake-value");
    expect(doc.execCommand).not.toHaveBeenCalled();
  });

  it("클립보드가 거절하면 대체 복사", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    const { doc, textarea } = fakeDocument(true);
    await copyText("fake-value");
    expect(doc.execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.value).toBe("fake-value");
    expect(doc.body.removeChild).toHaveBeenCalledWith(textarea);
  });

  it("클립보드가 없으면 대체 복사", async () => {
    vi.stubGlobal("navigator", {});
    const { doc } = fakeDocument(true);
    await copyText("fake-value");
    expect(doc.execCommand).toHaveBeenCalledWith("copy");
  });

  it("대체 복사도 안 되면 던진다(값은 오류 글에 없음) · 글 칸은 치운다", async () => {
    vi.stubGlobal("navigator", {});
    const { doc, textarea } = fakeDocument(false);
    const error = await copyText("fake-value").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain("fake-value");
    expect(doc.body.removeChild).toHaveBeenCalledWith(textarea);
  });

  it("대체 복사 뒤 포커스가 원래 요소로 돌아온다 · iOS 고르기도 부른다", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("HTMLElement", FakeElement);
    const button = new FakeElement();
    const { textarea } = fakeDocument(true, button);
    await copyText("fake-value");
    expect(textarea.setSelectionRange).toHaveBeenCalledWith(0, "fake-value".length);
    expect(button.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("원래 요소가 문서에서 빠졌으면 포커스를 돌리지 않는다", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("HTMLElement", FakeElement);
    const button = new FakeElement();
    button.isConnected = false;
    fakeDocument(true, button);
    await copyText("fake-value");
    expect(button.focus).not.toHaveBeenCalled();
  });

  it("document 가 없으면 던진다", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", undefined);
    await expect(copyText("fake-value")).rejects.toThrow("clipboard_unavailable");
  });
});
