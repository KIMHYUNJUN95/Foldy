import { describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

function fakeDoc(execResult: boolean | "throw") {
  const area = {
    value: "",
    style: {} as Record<string, string>,
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    setAttribute: vi.fn(),
  };
  const active = { focus: vi.fn() };
  const body = { appendChild: vi.fn(), removeChild: vi.fn() };
  return {
    area,
    body,
    active,
    doc: {
      activeElement: active,
      createElement: () => area,
      body,
      execCommand: () => {
        if (execResult === "throw") throw new Error("nope");
        return execResult;
      },
    },
  };
}

describe("copyTextToClipboard", () => {
  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { doc } = fakeDoc(false);
    expect(await copyTextToClipboard("abc", { clipboard: { writeText }, doc })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("falls back to execCommand without a clipboard API (insecure context)", async () => {
    const { doc, area, body } = fakeDoc(true);
    expect(await copyTextToClipboard("abc", { clipboard: undefined, doc })).toBe(true);
    expect(area.value).toBe("abc");
    expect(body.removeChild).toHaveBeenCalled();
  });

  it("falls back to execCommand when the clipboard API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const { doc } = fakeDoc(true);
    expect(await copyTextToClipboard("abc", { clipboard: { writeText }, doc })).toBe(true);
  });

  it("makes the textarea readonly, selects for iOS and restores focus", async () => {
    const { doc, area, active } = fakeDoc(true);
    await copyTextToClipboard("abc", { clipboard: undefined, doc });
    expect(area.setAttribute).toHaveBeenCalledWith("readonly", "");
    expect(area.setSelectionRange).toHaveBeenCalledWith(0, 3);
    expect(active.focus).toHaveBeenCalled();
  });

  it("returns false when both paths fail", async () => {
    const { doc } = fakeDoc("throw");
    expect(await copyTextToClipboard("abc", { clipboard: undefined, doc })).toBe(false);
  });
});
