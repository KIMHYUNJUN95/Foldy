/**
 * 실제 급여 엑셀 두 개 → 데모 근태 · 급여용 JSON(`.env.demo-real-payroll.json`, git 제외 — 실제 이름 · 금액이 들어 있다).
 * seed-attendance-demo.js 가 이 파일이 있으면 가짜 시급 직원 대신 이 사람들을 「Foldy Demo」 조직에 넣는다.
 * docs/engineering/07-environment-setup.md 「Sample data — 근태 · 급여 데모」.
 *
 * 사용:
 *   node scripts/dev/extract-real-payroll-demo.js <新アルバイト給与管理.xlsx> [<그다음 달분 アルバイト給与一覧(税理士用).xlsx>] [--same "세무사용 이름=급여 엑셀 이름" ...]
 *
 * 2026-10-27 사용자 지시로 **지금 데모는 급여 엑셀 하나만** 넣는다(지금은 `新アルバイト給与管理20261009` — 9월분 · 10/9 지급) — 세무사용은 빼고 돌린다.
 * 근무 달은 엑셀의 設定 시트 「支給年月」에서 읽는다.
 * 세무사용을 주면 아래처럼 9월분도 만든다(금액만 있어 시간 · 시급을 추정하므로 쓰지 않음).
 *
 * - 급여 엑셀: 사람별 시급 ① · ② 와 분 단위 시간 · 조정분 · 잔업 · 교통비 · 일수 · 지급 방식 · 甲乙丙(備考2).
 *   시급 ② 는 달 끝에 오른 시급으로 본다(데모는 마지막 며칠을 새 시급으로).
 * - 그다음 달분 세무사용: 금액만 있다 — 課税対象額 ÷ 시급(급여 엑셀의 마지막 시급, 없으면 1350엔) 으로 분을 정하고,
 *   분 단위로 떨어지지 않는 끝돈은 「前月調整」(課税)으로 넣어 課税対象額이 원본과 같게 한다.
 * - 세무사용 이름 표기가 급여 엑셀과 다른 사람은 --same 으로 같은 사람이라고 알려 준다(가타카나는 세무사용 표기를 쓴다).
 */
const ExcelJS = require("exceljs");
const crypto = require("crypto");
const fs = require("fs");

const OUT = ".env.demo-real-payroll.json";
const DEFAULT_RATE = 1350;
const CLASS = { 甲: "kou", 乙: "otsu", 丙: "hei" };

// 수식 칸은 저장된 결과만 쓴다(다른 파일을 VLOOKUP 하는 칸은 결과가 비어 있을 수 있다 → 빈칸). 오류 값도 빈칸.
const val = (c) => {
  let v = c.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("formula" in v || "sharedFormula" in v) v = v.result ?? null;
    else if ("richText" in v) v = v.richText.map((t) => t.text).join("");
    if (v && typeof v === "object" && !(v instanceof Date) && "error" in v) v = null;
  }
  return v === "" ? null : v ?? null;
};
// 엑셀 시간(1899-12-30 기준 날짜 · 그 ISO 문자열 · 일 단위 숫자) → 분.
const minutesOf = (v) => {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) v = new Date(v);
  return v instanceof Date ? Math.round((v.getTime() - Date.UTC(1899, 11, 30)) / 60000) : typeof v === "number" ? Math.round(v * 1440) : null;
};
const norm = (s) => String(s).normalize("NFKC").replace(/[\s　]+/g, " ").trim();
const keyOf = (s) => norm(s).replace(/ /g, "");
const ceilPay = (rate, minutes) => Math.ceil((rate * minutes) / 60 - 1e-9);

async function main() {
  const [bookPath, taxPath] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--same");
  if (!bookPath) throw new Error("사용: node scripts/dev/extract-real-payroll-demo.js <급여 엑셀> [<세무사용 엑셀>] [--same \"세무사용=급여 엑셀\"]");
  const same = new Map();
  process.argv.forEach((a, i, all) => {
    if (a !== "--same") return;
    const [sep, aug] = String(all[i + 1] ?? "").split("=");
    if (sep && aug) same.set(keyOf(sep), keyOf(aug));
  });

  // ── 급여 엑셀 ──
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(bookPath);
  // 근무 달 = 設定 시트 「支給年月」(예 「2026年 9月分」). 세무사용은 그다음 달분, 조정분은 그 앞 달분으로 본다.
  const ymText = String(val(book.getWorksheet("設定")?.getCell("B4") ?? { value: null }) ?? "");
  const ymMatch = ymText.match(/(\d{4})年\s*(\d{1,2})月/);
  if (!ymMatch) throw new Error(`設定 B4 에서 근무 달을 못 읽었다: 「${ymText}」`);
  const bookYm = `${ymMatch[1]}-${ymMatch[2].padStart(2, "0")}`;
  const shiftYm = (ym, n) => {
    const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  };
  const taxYm = shiftYm(bookYm, 1);
  const aug = [];
  for (const [sheet, method] of [["現金入力_50名", "cash"], ["振込入力_50名", "transfer"]]) {
    const ws = book.getWorksheet(sheet);
    if (!ws) throw new Error(`시트 ${sheet} 가 없다`);
    for (let r = 3; r <= ws.rowCount; r++) {
      const g = (col) => val(ws.getCell(`${col}${r}`));
      if (!g("B") && !g("C")) continue;
      aug.push({
        ko: g("B") ? norm(g("B")) : null, kana: g("C") ? norm(g("C")) : null, method,
        rate1: g("D"), min1: minutesOf(g("E")), pay1: g("F"), rate2: g("G"), min2: minutesOf(g("H")),
        // J 調整分 · K 残業手当 · L 休日出勤(→ 주말수당) · M 住宅補助/深夜残業(→ 특별수당) · N 通勤課税(Foldy 에 손 입력 칸 없음 — 있으면 멈춘다).
        adjust: g("J") ?? 0, overtime: g("K") ?? 0, weekend: g("L") ?? 0, special: g("M") ?? 0, commuteTaxable: g("N") ?? 0,
        commute: g("O") ?? 0, withholding: g("W"), days: g("AC"),
        // 구분 칸이 비었는데 원천세가 있으면 甲 — 엑셀 수식이 빈칸을 甲 표로 계산한다(2026-10-09 지급분).
        cls: CLASS[g("AM")] ?? (typeof g("W") === "number" && g("W") > 0 ? "kou" : null),
      });
    }
  }

  // ── 9월분 세무사용(있을 때만) ──
  const sep = [];
  const ws = taxPath ? await new ExcelJS.Workbook().xlsx.readFile(taxPath).then((wb) => wb.worksheets[0]) : null;
  let cls = null;
  for (let r = 1; ws && r <= ws.rowCount; r++) {
    const a = val(ws.getCell(`A${r}`));
    if (typeof a === "string" && a.includes("欄")) {
      cls = CLASS[a[0]] ?? null;
      continue;
    }
    if (!a || a === "氏名" || a === "合計") continue;
    const n = (c) => Number(val(ws.getCell(`${c}${r}`)) ?? 0);
    // 원본 B(支給額)는 교통비 포함 — 課税対象額 = B − C.
    sep.push({ kana: norm(a), cls, taxable: n("B") - n("C"), commute: n("C"), days: n("G") });
  }

  // ── 사람 단위로 합치기 ──
  const people = new Map();
  for (const a of aug) {
    if (a.commuteTaxable) throw new Error(`${a.ko ?? a.kana}: 通勤課税 ${a.commuteTaxable} — Foldy 데모에 넣을 칸이 없다`);
    const k = keyOf(a.kana ?? a.ko);
    const rateSegs = [];
    let adjust = a.adjust;
    let min1 = a.min1;
    if (min1 == null && a.rate1 && a.pay1) {
      // 시간 칸이 비고 금액만 있는 줄 — 금액에서 분을 거꾸로 내고 끝돈은 조정분.
      min1 = Math.floor((a.pay1 * 60) / a.rate1);
      adjust += a.pay1 - ceilPay(a.rate1, min1);
    }
    if (a.rate1 && min1) rateSegs.push({ rate: a.rate1, minutes: min1 });
    if (a.rate2 && a.min2) rateSegs.push({ rate: a.rate2, minutes: a.min2 });
    const total = rateSegs.reduce((s, x) => s + x.minutes, 0);
    people.set(k, {
      ko: a.ko, kana: a.kana, method: a.method, cls: a.cls,
      months: {
        [bookYm]: {
          segments: rateSegs, days: a.days ?? Math.max(1, Math.round(total / 420)), commute: a.commute, overtime: a.overtime,
          weekend: a.weekend, special: a.special,
          adjust, adjustMonth: shiftYm(bookYm, -1), cls: a.cls, withholding: a.withholding,
        },
      },
    });
  }
  for (const s of sep) {
    const k = same.get(keyOf(s.kana)) ?? keyOf(s.kana);
    const p = people.get(k) ?? { ko: null, kana: s.kana, method: "cash", cls: null, months: {} };
    const last = p.months[bookYm]?.segments.at(-1)?.rate ?? DEFAULT_RATE;
    const minutes = Math.floor((s.taxable * 60) / last);
    p.kana = s.kana;
    p.cls = s.cls;
    p.months[taxYm] = {
      segments: minutes > 0 ? [{ rate: last, minutes }] : [], days: s.days, commute: s.commute, overtime: 0,
      adjust: s.taxable - ceilPay(last, minutes), adjustMonth: bookYm, cls: s.cls, expectTaxable: s.taxable,
    };
    people.set(k, p);
  }

  const out = [...people.values()].map((p) => {
    const id = crypto.createHash("sha1").update(keyOf(p.ko ?? p.kana)).digest("hex").slice(0, 8);
    const augM = p.months[bookYm];
    // 세무사용 달 구분이 지금 설정 — 급여 엑셀 달 구분이 다르면 그 달은 원본 원천세를 직접 입력으로 남긴다.
    if (augM && augM.cls !== p.cls) {
      augM.withholdingOverride = augM.withholding ?? 0;
      augM.withholdingReason = augM.cls ? `${bookYm} 은 ${augM.cls === "hei" ? "병" : augM.cls === "otsu" ? "을" : "갑"}(실제 급여 엑셀)` : `${bookYm} 원천세 구분 없음(실제 급여 엑셀)`;
    }
    return { id, ko: p.ko, kana: p.kana, method: p.method, cls: p.cls, months: p.months };
  });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), { mode: 0o600 });
  const augCount = out.filter((p) => p.months[bookYm]).length;
  const sepCount = out.filter((p) => p.months[taxYm]).length;
  console.log(`${OUT} — ${out.length}명 (급여 엑셀 ${bookYm}분 ${augCount} · 세무사용 ${taxYm}분 ${sepCount})`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
