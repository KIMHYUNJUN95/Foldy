// 목록 한 줄 요약 — PC · 모바일 같은 모양: 「첫 품목 외 N종」.
export function summarizeLinenLines(lines: ReadonlyArray<{ name: string }>, moreLabel: string, kindsUnit: string): string {
  if (lines.length === 0) return "—";
  if (lines.length === 1) return lines[0].name;
  return `${lines[0].name} ${moreLabel} ${lines.length - 1}${kindsUnit}`;
}

// 사진 장수 — 영어는 1장일 때 단수(「1 photo」), 0장이면 빈 문자열.
export function linenPhotoCount(n: number, copy: { wPhotoN: string; wPhotoOne: string }): string {
  if (n <= 0) return "";
  return n === 1 ? copy.wPhotoOne : copy.wPhotoN.replace("{n}", String(n));
}
