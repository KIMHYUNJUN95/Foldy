// 여권 아래 두 줄(ICAO 9303 TD3 — 44자 × 2줄)을 서버가 직접 읽는다. 태블릿 `Mrz.kt` 가 보내는 `raw` 는 「줄1\n줄2」다.
// 본인 확인에는 태블릿이 보낸 이름 · 검사 결과가 아니라 이 함수의 결과만 쓴다. 검사 숫자 계산은 `Mrz.kt` 와 같은 규칙.
// 서버가 못 하는 것: 인쇄된 띠 자체가 진짜인지(검사 숫자만 맞춘 위조 띠는 통과한다).

const LEN = 44;
const WEIGHTS = [7, 3, 1];

function check(field: string): string {
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const c = field[i];
    const value = c >= "0" && c <= "9" ? c.charCodeAt(0) - 48 : c >= "A" && c <= "Z" ? c.charCodeAt(0) - 55 : 0;
    sum += value * WEIGHTS[i % 3];
  }
  return String(sum % 10);
}

function letters(value: string): string {
  return value.replace(/</g, " ").replace(/0/g, "O").replace(/\s+/g, " ").trim();
}

/** 두 줄이 모양 · 검사 숫자(번호 · 생년월일 · 만료일 · 선택 칸 · 합계) 모두 맞을 때만 성 · 이름. 아니면 null. */
export function parseMrzStrip(raw: unknown): { surname: string; givenNames: string } | null {
  if (typeof raw !== "string") return null;
  const lines = raw.split("\n");
  if (lines.length !== 2) return null;
  const [line1, line2] = lines;
  if (line1.length !== LEN || line2.length !== LEN || line1[0] !== "P") return null;
  if (!/^[A-Z0-9<]+$/.test(line1) || !/^[A-Z0-9<]+$/.test(line2)) return null;

  const read = line2.substring(0, 9);
  const number = [read, read.replace(/O/g, "0"), read.replace(/0/g, "O")].find((candidate) => check(candidate) === line2[9]);
  if (number === undefined) return null;
  if (check(line2.substring(13, 19)) !== line2[19]) return null;
  if (check(line2.substring(21, 27)) !== line2[27]) return null;
  const optional = line2.substring(28, 42);
  const optionalOk = (line2[42] === "<" && /^<+$/.test(optional)) || check(optional) === line2[42];
  if (!optionalOk) return null;
  if (check(number + line2[9] + line2.substring(13, 20) + line2.substring(21, 43)) !== line2[43]) return null;

  const names = line1.substring(5).replace(/<+$/, "");
  const split = names.indexOf("<<");
  const surname = letters(split >= 0 ? names.substring(0, split) : names);
  const givenNames = letters(split >= 0 ? names.substring(split + 2) : "");
  return surname ? { surname, givenNames } : null;
}
