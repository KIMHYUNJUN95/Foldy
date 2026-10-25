/** 한 해의 국세청 源泉徴収税額表 — 생성 파일(`table-<year>.ts`)이 채운다. */
export type WithholdingTable = {
  year: number;
  /** 月額表 [以上, 未満, 甲 0人 … 7人, 乙] — 구간이 빈틈 없이 이어진다. */
  monthly: readonly (readonly number[])[];
  /** 이 금액 미만이면 甲 0엔 · 乙 = 금액 × 3.063%(표 첫 줄의 「以上」). */
  otsuFlatBelow: number;
  /** 日額表 丙欄 [以上, 未満, 丙]. */
  dailyHei: readonly (readonly number[])[];
};
