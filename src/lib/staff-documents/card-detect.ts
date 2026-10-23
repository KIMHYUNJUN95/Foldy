/**
 * 카드가 촬영 틀에 맞춰졌는지 — 자동 촬영용 가벼운 판정(2026-10-23 사용자 「틀에 카드가 맞춰지면 자동으로 찍히게」).
 *
 * 기계학습 없이 밝기만 본다. 틀보다 조금 넓게 잘라 작게 줄인 흑백 그림에서:
 * - **네 변**: 틀 가장자리 근처 띠 안에서 가장 센 세로/가로 경계선 — 카드 테두리가 틀과 겹치면 그 자리에 강한 선이 생긴다.
 *   네 변 중 셋 이상이 주변보다 뚜렷하면 「맞춤」(손가락이 한 변을 가려도 되게).
 * - **선명함**: 가운데(글자 있는 곳) 평균 경계 세기 — 흔들리거나 초점이 안 맞으면 낮다.
 * 흔들림(앞 장면과의 차이)은 부르는 쪽이 `frameDifference` 로 따로 본다.
 * 흰 카드를 흰 책상에 두면 경계가 약해 못 찾을 수 있다 — 그래서 셔터는 늘 함께 둔다.
 */

export type GrayFrame = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

/** RGBA → 흑백(0~255). */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayFrame {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j += 1) {
    out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return { data: out, width, height };
}

/** 잘라 낸 그림에서 틀이 차지하는 비율 — 틀보다 `pad` 만큼 넓게 자르면 틀 변은 pad/(1+2·pad) 자리에 있다. */
export const DETECT_PAD = 0.1;

export type CardFit = {
  fits: boolean;
  /** 뚜렷한 변 수(0~4). */
  sides: number;
  sharpness: number;
};

const SIDE_RATIO = 2.0;
const SIDE_MIN = 14;
const SHARP_MIN = 5;

function at(f: GrayFrame, x: number, y: number) {
  return f.data[y * f.width + x];
}

/** x 열의 세로 경계 세기(행 범위 평균). */
function columnEdge(f: GrayFrame, x: number, y0: number, y1: number) {
  let sum = 0;
  for (let y = y0; y < y1; y += 1) sum += Math.abs(at(f, x + 1, y) - at(f, x - 1, y));
  return sum / Math.max(1, y1 - y0);
}

/** y 행의 가로 경계 세기(열 범위 평균). */
function rowEdge(f: GrayFrame, y: number, x0: number, x1: number) {
  let sum = 0;
  for (let x = x0; x < x1; x += 1) sum += Math.abs(at(f, x, y + 1) - at(f, x, y - 1));
  return sum / Math.max(1, x1 - x0);
}

export function assessCardFit(f: GrayFrame): CardFit {
  const { width: w, height: h } = f;
  if (w < 20 || h < 20) return { fits: false, sides: 0, sharpness: 0 };
  const edge = DETECT_PAD / (1 + 2 * DETECT_PAD);
  const band = 0.07;
  const span = (lo: number, hi: number, n: number) => [Math.max(1, Math.round(lo * n)), Math.min(n - 2, Math.round(hi * n))];

  // 선명함 — 가운데 영역의 평균 경계 세기(배경 기준이기도 하다).
  const [cx0, cx1] = span(0.3, 0.7, w);
  const [cy0, cy1] = span(0.3, 0.7, h);
  let total = 0;
  let count = 0;
  for (let y = cy0; y < cy1; y += 1) {
    for (let x = cx0; x < cx1; x += 1) {
      total += Math.abs(at(f, x + 1, y) - at(f, x - 1, y)) + Math.abs(at(f, x, y + 1) - at(f, x, y - 1));
      count += 1;
    }
  }
  const sharpness = count ? total / count / 2 : 0;

  // 변 근처 띠 안의 가장 센 선 vs 띠 전체 평균.
  const rowsMid = span(0.25, 0.75, h);
  const colsMid = span(0.25, 0.75, w);
  const sideScore = (values: number[]) => {
    if (values.length === 0) return false;
    const peak = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return peak >= SIDE_MIN && peak >= mean * SIDE_RATIO;
  };
  const cols = (center: number) => {
    const [a, b] = span(center - band, center + band, w);
    const out: number[] = [];
    for (let x = a; x <= b; x += 1) out.push(columnEdge(f, x, rowsMid[0], rowsMid[1]));
    return out;
  };
  const rows = (center: number) => {
    const [a, b] = span(center - band, center + band, h);
    const out: number[] = [];
    for (let y = a; y <= b; y += 1) out.push(rowEdge(f, y, colsMid[0], colsMid[1]));
    return out;
  };
  const sides = [cols(edge), cols(1 - edge), rows(edge), rows(1 - edge)].filter(sideScore).length;
  return { fits: sides >= 3 && sharpness >= SHARP_MIN, sides, sharpness };
}

/** 두 장면의 평균 밝기 차이 — 손이 흔들리는 중이면 크다. 크기가 다르면 큰 값. */
export function frameDifference(a: GrayFrame | null, b: GrayFrame): number {
  if (!a || a.width !== b.width || a.height !== b.height) return 255;
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 1) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / a.data.length;
}

/** 이 정도 이하면 「멈춰 있다」. */
export const STILL_DIFF = 7;
