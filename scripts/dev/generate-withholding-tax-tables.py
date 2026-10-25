"""
국세청 「給与所得の源泉徴収税額表」 엑셀 → src/lib/withholding-tax/table-<year>.ts (docs/product/39 §3-D · §4-B).

  python3 -m venv /tmp/wt && /tmp/wt/bin/pip install xlrd==2.0.1 openpyxl==3.1.5
  /tmp/wt/bin/python scripts/dev/generate-withholding-tax-tables.py 2026 月額表.xls 日額表.xls

받는 곳: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo<year>/01.htm
  月額表 = data/01-07.xls(x) · 日額表 = data/08-14.xls(x)

표의 숫자 줄만 옮긴다. 표 끝(月額表 740,000円 ~ · 日額表 24,000円 ~)의 산식 구간은 표 아래 글로만 있어서
`src/lib/withholding-tax/index.ts` 의 `TIERS` 에 손으로 옮겼다 — 새해 표를 넣을 때 그것도 같이 확인한다.
"""

import sys

import openpyxl
import xlrd


def read_rows(path):
    if path.endswith(".xls"):
        sheet = xlrd.open_workbook(path).sheets()[0]
        return [[sheet.cell_value(r, c) for c in range(sheet.ncols)] for r in range(sheet.nrows)]
    sheet = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    return [list(r) for r in sheet.iter_rows(values_only=True)]


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def table_rows(rows, columns):
    """`以上 · 未満` 이 둘 다 숫자인 줄 = 표 본문. columns 는 세액 열 번호."""
    out = []
    for r in rows:
        if len(r) > max(columns) and num(r[1]) and num(r[2]):
            out.append([int(r[1]), int(r[2])] + [int(r[c]) for c in columns])
    for prev, cur in zip(out, out[1:]):
        if prev[1] != cur[0]:
            raise SystemExit(f"구간이 이어지지 않음: {prev[:2]} → {cur[:2]}")
    return out


def first_row_amount(rows):
    """표 첫 줄 위 「N円未満」 줄의 N — 甲은 0, 乙은 3.063% 구간 끝."""
    for r in rows:
        if num(r[1]) and r[2] == "円未満":
            return int(r[1])
    raise SystemExit("「円未満」 줄이 없음")


def ts_rows(rows):
    return "\n".join(f"  [{', '.join(str(v) for v in row)}]," for row in rows)


def main():
    year, monthly_path, daily_path = sys.argv[1], sys.argv[2], sys.argv[3]
    monthly = read_rows(monthly_path)
    daily = read_rows(daily_path)
    # 月額表: 以上 · 未満 · 甲 0~7人 · 乙  /  日額表: 以上 · 未満 · 丙
    monthly_rows = table_rows(monthly, list(range(3, 12)))
    daily_rows = table_rows(daily, [12])
    otsu_flat_below = first_row_amount(monthly)
    if monthly_rows[0][0] != otsu_flat_below:
        raise SystemExit("月額表 첫 줄이 「円未満」 금액과 다름")

    print(f"""// 생성 파일 — 손으로 고치지 말 것. scripts/dev/generate-withholding-tax-tables.py {year}
// 출처: 国税庁「給与所得の源泉徴収税額表（令和{int(year) - 2018}年分）」 https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo{year}/01.htm

import type {{ WithholdingTable }} from "./types";

/** 月額表: [以上, 未満, 甲 0人 … 7人, 乙] */
const MONTHLY: WithholdingTable["monthly"] = [
{ts_rows(monthly_rows)}
];

/** 日額表 丙欄: [以上, 未満, 丙] */
const DAILY_HEI: WithholdingTable["dailyHei"] = [
{ts_rows(daily_rows)}
];

export const TABLE_{year}: WithholdingTable = {{
  year: {year},
  monthly: MONTHLY,
  otsuFlatBelow: {otsu_flat_below},
  dailyHei: DAILY_HEI,
}};""")


main()
