import { describe, expect, it } from "vitest";
import { DETECT_PAD, assessCardFit, frameDifference, type GrayFrame } from "@/lib/staff-documents/card-detect";

const W = 160;
const H = Math.round((W * 54) / 85.6);

/** 어두운 바닥 위 밝은 카드(안에 글자 줄) — inset 은 카드가 틀 변에서 얼마나 안쪽인지(비율). */
function scene({ inset = 0, card = true, text = true }: { inset?: number; card?: boolean; text?: boolean }): GrayFrame {
  const data = new Uint8ClampedArray(W * H).fill(40);
  const e = DETECT_PAD / (1 + 2 * DETECT_PAD);
  const x0 = Math.round((e + inset) * W);
  const x1 = Math.round((1 - e - inset) * W);
  const y0 = Math.round((e + inset) * H);
  const y1 = Math.round((1 - e - inset) * H);
  if (card) {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const line = text && y % 6 < 2 && x % 9 < 6 && y > y0 + 6 && y < y1 - 6 && x > x0 + 6 && x < x1 - 6;
        data[y * W + x] = line ? 70 : 220;
      }
    }
  }
  return { data, width: W, height: H };
}

describe("card auto-capture detection", () => {
  it("틀에 맞춘 선명한 카드는 맞춤", () => {
    const fit = assessCardFit(scene({}));
    expect(fit.sides).toBe(4);
    expect(fit.fits).toBe(true);
  });

  it("카드가 없거나 · 너무 작게(멀리) 있으면 아님", () => {
    expect(assessCardFit(scene({ card: false })).fits).toBe(false);
    expect(assessCardFit(scene({ inset: 0.2 })).fits).toBe(false);
  });

  it("글자가 안 보이면(흐림) 아님", () => {
    expect(assessCardFit(scene({ text: false })).fits).toBe(false);
  });

  it("흔들림 — 같은 장면은 0, 크기가 다르면 큰 값", () => {
    const a = scene({});
    expect(frameDifference(a, scene({}))).toBe(0);
    expect(frameDifference(null, a)).toBe(255);
  });
});
