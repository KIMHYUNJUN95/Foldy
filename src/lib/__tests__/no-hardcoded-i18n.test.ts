import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

// i18n 하드코딩 문자열 가드.
//
// 목표: `src/lib/i18n.ts` 의 사전을 거치지 않고 앱/컴포넌트 소스에 직접 쓰인,
// 새로 들어온 사용자 노출 한국어/일본어 문자열을 잡아낸다.
// dictionary in `src/lib/i18n.ts`.
//
// CJK 만 보는 이유: 한글, 가나, 한자는 코드 식별자, 클래스 이름, 라우트 세그먼트, DB 필드 이름,
// 로그 문자열에 정당하게 나타나는 일이 거의 없다.
// JSX/TSX 의 CJK 리터럴은 거의 항상 번역 누락이다.
// 여기서 영어 리터럴까지 잡으면 너무 시끄럽다(className 문자열,
// aria 값, 기술적 기본값). 그래서 영어는 일부러 코드 리뷰와
// 사전 우선 관례에 맡긴다. 덕분에 신호는 높게 유지되고
// 오탐률은 0 에 가깝다.
//
// 범위(의도적으로 제한): `src/app` 과 `src/components` 의
// (`.ts` / `.tsx`) 만. 하드코딩된 CJK
// 리터럴이 거의 확실히 번역 누락인 사용자 노출 영역이다. `src/lib` 은 일부러
// 제외한다 — 사전 자체(`i18n.ts`, 설계상 전부 CJK)와
// 정식 도메인 상수(건물 이름)가 있어 오탐이 되기 때문이다.
// 이 가드는 저장소 전체를 강제하는 것이 아니다. 신호가 높은 UI 그물로 취급한다.
//
// 허용(걸리지 않음):
//   1. 주석 (한 줄, 블록, JSX 주석 형태).
//   2. 완전한 `LocalizedText` 리터럴 — 한 줄에 `ko:`, `ja:`,
//      `en:` 키가 모두 있는 경우 (예: `{ ko: "..", ja: "..", en: ".." }`).
//      이는 완전히 현지화된 데이터이지 단일 언어 하드코딩 문구가 아니다.
//   3. 정식 건물 라벨 상수 같은 도메인 데이터를 위한
//      명시적 탈출구 지시어 (아래 참고).
//
// 탈출구 (정당화하는 주석과 함께 아껴서 쓸 것). 각 지시어는
// 주석 안에 쓰였을 때만 인식된다 — 한 줄(`//`), 블록(`/* */`),
// 또는 JSX(`{/* */}`). 문자열 리터럴이나 일반 코드에 같은 텍스트가 있어도
// 스캔을 억제하지 않는다.
//   - `i18n-ignore`            -> 그것이 나온 한 줄을 무시.
//   - `i18n-ignore-start` / `i18n-ignore-end` -> 둘러싼 블록을 무시.
//   - `i18n-ignore-file`       -> 파일 전체를 무시.
//
// 가드가 진짜 문자열을 잡으면: 문구를 `src/lib/i18n.ts` 로 옮기고
// (ko/ja/en 함께) 사전에서 읽어 쓴다.

const SCAN_ROOTS = ["src/app", "src/components"];

// 한글 음절, 히라가나, 가타카나, CJK 통합 한자(한자).
const CJK = /[぀-ヿ一-鿿가-힣]/;

function isLocalizedTextLine(line: string): boolean {
  const hasKo = /["']?ko["']?\s*:/.test(line);
  const hasJa = /["']?ja["']?\s*:/.test(line);
  const hasEn = /["']?en["']?\s*:/.test(line);
  return hasKo && hasJa && hasEn;
}

// 줄 번호가 정확하도록 줄바꿈은 유지한 채 블록 주석 문자를 공백으로
// 바꾼다. JSX 주석의 안쪽 부분도 포함한다.
function blankBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
}

// `rawLine` 끝의 줄 주석 텍스트를 반환하고, 줄 주석이 없으면 null.
// `://` 는 그대로 두어 URL 스킴이 주석 시작으로 취급되지 않게 한다.
// 인덱스 스캔을 쓰므로 주석 본문의 특이한 문자가
// `//` 마커 탐색을 방해하지 못한다.
function getLineCommentText(rawLine: string): string | null {
  for (let i = 0; i < rawLine.length - 1; i += 1) {
    if (rawLine[i] === "/" && rawLine[i + 1] === "/") {
      if (i > 0 && rawLine[i - 1] === ":") continue; // `://` 의 일부
      return rawLine.slice(i + 2);
    }
  }
  return null;
}

// `rawLine` 에서 줄 끝 주석 앞의 부분을 반환한다.
// `://` 는 그대로 둔다. CJK 스캔 전에 주석 부분을 제거하는 데 쓴다.
function stripLineComment(rawLine: string): string {
  for (let i = 0; i < rawLine.length - 1; i += 1) {
    if (rawLine[i] === "/" && rawLine[i + 1] === "/") {
      if (i > 0 && rawLine[i - 1] === ":") continue; // `://` 의 일부
      return rawLine.slice(0, i);
    }
  }
  return rawLine;
}

// `token` 이 이 소스 한 줄의 주석 안에 있으면 true 를 반환한다.
//
// 인식하는 주석 형태:
//   - 한 줄 블록 주석:   /* ... token ... */  ({/* */} JSX 형태 포함)
//   - 줄 끝 주석:       // ... token ...
//
// 문자열 리터럴, 템플릿 리터럴, 일반 코드에 같은 토큰이 있어도 이 함수는
// true 를 반환하지 않는다. 주석의 텍스트 내용만 검사한다. 참고: 여러 줄 블록 주석
// (한 줄에 /*, 다른 줄에 */)은 여기서 인식되지 않으므로
// 지시어는 한 줄로 끝나게 쓴다.
function lineHasDirective(rawLine: string, token: string): boolean {
  // 한 줄 블록 주석, 예: `/* token */` 또는 `{/* token */}`.
  // 같은 rawLine 에서 열리고 닫히는 /* ... */ 쌍에 매치되는 정규식.
  const blockMatches = rawLine.match(/\/\*[\s\S]*?\*\//g) ?? [];
  if (blockMatches.some((c) => c.includes(token))) return true;

  // 줄 끝 주석: `//` 뒤의 텍스트 (`://` 제외).
  const lineText = getLineCommentText(rawLine);
  if (lineText !== null && lineText.includes(token)) return true;

  return false;
}

// `i18n-ignore-file` 이 `source` 어디든 주석 안에 있으면 true 를 반환한다.
// 여러 줄 블록 주석과 줄 주석을 모두 처리한다.
function sourceHasFileDirective(source: string): boolean {
  const token = "i18n-ignore-file";

  // 블록 주석 (여러 줄에 걸칠 수 있음).
  const blockMatches = source.match(/\/\*[\s\S]*?\*\//g) ?? [];
  if (blockMatches.some((c) => c.includes(token))) return true;

  // 줄 주석 — 모든 줄을 스캔한다.
  for (const line of source.split("\n")) {
    const lineText = getLineCommentText(line);
    if (lineText !== null && lineText.includes(token)) return true;
  }

  return false;
}

type SourceViolation = { line: number; text: string };
type Violation = SourceViolation & { file: string };

// 소스 문자열에 대한 순수 스캐너. 1부터 시작하는 줄 위반을 반환한다.
//
// 지시어와 CJK 내용이 각각 알맞은 곳에서 읽히도록 소스의 두 가지
// 병렬 뷰를 쓴다:
//   - `rawLines` 는 지시어 감지(lineHasDirective / sourceHasFileDirective)를 맡고
//     위반 텍스트를 제공한다. 지시어는 실제 주석 내용에 대해 검사되므로
//     문자열 리터럴이나 코드로는 발동되지 않는다.
//   - `blankedLines` (블록 주석을 공백으로 바꾸되 줄바꿈은 유지해
//     인덱스가 rawLines 와 1:1 이 됨)는 CJK 내용 감지를 맡으므로, 주석 안에만
//     있는 CJK 는 위반을 일으키지 않는다.
function scanSource(source: string): SourceViolation[] {
  if (sourceHasFileDirective(source)) return [];

  const rawLines = source.split("\n");
  const blankedLines = blankBlockComments(source).split("\n");
  const violations: SourceViolation[] = [];
  let ignoring = false;

  rawLines.forEach((rawLine, idx) => {
    if (lineHasDirective(rawLine, "i18n-ignore-start")) {
      ignoring = true;
      return;
    }
    if (lineHasDirective(rawLine, "i18n-ignore-end")) {
      ignoring = false;
      return;
    }
    if (ignoring) return;
    if (lineHasDirective(rawLine, "i18n-ignore")) return;

    const line = stripLineComment(blankedLines[idx]);
    if (!CJK.test(line)) return;
    if (isLocalizedTextLine(line)) return;

    violations.push({ line: idx + 1, text: rawLine.trim() });
  });

  return violations;
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function scanFile(absPath: string, repoRoot: string): Violation[] {
  const raw = readFileSync(absPath, "utf-8");
  const file = relative(repoRoot, absPath).replace(/\\/g, "/");
  return scanSource(raw).map((v) => ({ ...v, file }));
}

describe("i18n hardcoded-string guard", () => {
  it("has no untracked Korean/Japanese literals in app/component source", () => {
    const repoRoot = resolve(process.cwd());
    const violations: Violation[] = [];

    for (const root of SCAN_ROOTS) {
      const abs = resolve(repoRoot, root);
      for (const file of listSourceFiles(abs)) {
        violations.push(...scanFile(file, repoRoot));
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line}  →  ${v.text}`)
        .join("\n");
      throw new Error(
        `Found ${violations.length} hardcoded CJK string(s) in app/component source.\n` +
          `Move the copy into src/lib/i18n.ts (ko/ja/en) and read it from the dictionary,\n` +
          `or add an i18n-ignore directive with justification for legitimate domain data.\n\n` +
          report,
      );
    }

    expect(violations).toHaveLength(0);
  });
});

describe("i18n guard scanner (directive handling)", () => {
  // ── 기본 CJK 감지 ──

  it("flags a bare CJK literal", () => {
    const v = scanSource(`const label = "안녕하세요";`);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
  });

  it("ignores CJK inside a line comment", () => {
    expect(scanSource(`const x = 1; // 한국어 주석`)).toHaveLength(0);
  });

  it("ignores CJK inside a block comment", () => {
    expect(scanSource(`/*\n  한국어 블록 주석\n*/\nconst x = 1;`)).toHaveLength(0);
  });

  it("does not flag a complete LocalizedText literal", () => {
    expect(
      scanSource(`const t = { ko: "안녕", ja: "こんにちは", en: "Hello" };`),
    ).toHaveLength(0);
  });

  it("reports accurate 1-based line numbers", () => {
    const src = ["const a = 1;", "const b = 2;", 'const label = "환영합니다";'].join("\n");
    const v = scanSource(src);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(3);
  });

  // ── 한 줄 i18n-ignore 지시어 ──

  it("honors i18n-ignore in a line comment", () => {
    expect(
      scanSource(`const label = "안녕"; // i18n-ignore: dynamic domain value`),
    ).toHaveLength(0);
  });

  it("honors i18n-ignore in a block comment", () => {
    expect(
      scanSource(`const label = "안녕"; /* i18n-ignore: domain value */`),
    ).toHaveLength(0);
  });

  it("honors i18n-ignore in a JSX comment", () => {
    expect(
      scanSource(`const label = "안녕"; {/* i18n-ignore: domain value */}`),
    ).toHaveLength(0);
  });

  // ── i18n-ignore-start / i18n-ignore-end ──

  it("honors i18n-ignore-start/end written as line comments", () => {
    const src = [
      "// i18n-ignore-start: canonical domain keys",
      'const BUILDINGS = ["아라키초A", "가부키초"];',
      "// i18n-ignore-end",
    ].join("\n");
    expect(scanSource(src)).toHaveLength(0);
  });

  it("honors i18n-ignore-start/end written as block comments", () => {
    const src = [
      "/* i18n-ignore-start: canonical domain keys */",
      'const BUILDINGS = ["아라키초A", "가부키초"];',
      "/* i18n-ignore-end */",
    ].join("\n");
    expect(scanSource(src)).toHaveLength(0);
  });

  it("honors i18n-ignore-start/end written as JSX comments", () => {
    const src = [
      "{/* i18n-ignore-start: canonical domain keys */}",
      'const BUILDINGS = ["아라키초A", "가부키초"];',
      "{/* i18n-ignore-end */}",
    ].join("\n");
    expect(scanSource(src)).toHaveLength(0);
  });

  // ── i18n-ignore-file ──

  it("honors i18n-ignore-file in a line comment", () => {
    expect(
      scanSource(`// i18n-ignore-file\nconst label = "안녕";`),
    ).toHaveLength(0);
  });

  it("honors i18n-ignore-file in a block comment", () => {
    expect(
      scanSource(`/* i18n-ignore-file */\nconst label = "안녕";`),
    ).toHaveLength(0);
  });

  it("honors i18n-ignore-file in a multiline block comment", () => {
    expect(
      scanSource(`/*\n * i18n-ignore-file\n */\nconst label = "안녕";`),
    ).toHaveLength(0);
  });

  // ── 주석이 아닌 문맥의 지시어는 스캔을 억제하면 안 됨 ──

  it("does not suppress a line when i18n-ignore appears only in a string literal", () => {
    // 토큰이 주석이 아니라 문자열 값 안에 있다 — 스캔이 억제되면 안 된다.
    // 같은 줄의 CJK 는 여전히 잡혀야 한다.
    const src = `const label = "안녕"; const t = "i18n-ignore";`;
    expect(scanSource(src)).toHaveLength(1);
  });

  it("does not enable block-ignore mode when i18n-ignore-start appears only in a string literal", () => {
    // 0번째 줄 문자열 안의 토큰이 ignoring=true 를 세팅하면 안 된다.
    // 1번째 줄의 CJK 는 여전히 잡혀야 한다.
    const src = [
      'const token = "i18n-ignore-start";',
      'const label = "안녕";',
    ].join("\n");
    expect(scanSource(src)).toHaveLength(1);
  });

  it("does not suppress the whole file when i18n-ignore-file appears only in a string literal", () => {
    const src = `const t = "i18n-ignore-file";\nconst label = "안녕";`;
    expect(scanSource(src)).toHaveLength(1);
  });

  it("does not suppress scanning when directive-like text appears as a code token", () => {
    // 지시어를 그대로 쓴 객체 키가 같은 줄의 CJK 를 억제하면 안 된다.
    const src = `const cfg = { "i18n-ignore": true }; const label = "안녕";`;
    expect(scanSource(src)).toHaveLength(1);
  });
});
