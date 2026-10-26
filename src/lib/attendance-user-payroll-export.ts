import "server-only";

import ExcelJS from "exceljs";
export { reconcileDailyPaysToTotal } from "@/lib/attendance-pay-calculation";
import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
} from "@/lib/room-label-normalization";

export type UserPayrollExportRow = {
  date: string;
  clockIn: string;
  clockOut: string;
  location: string; // 근무 장소 — 직접 입력 텍스트(현장 외) 또는 등록된 현장 이름
  workMinutes: number;
  dailyPay: number; // 그날의 기본급
  allowanceRegular: number; // 추가수당 applied that day
  allowanceSpecial: number; // 특별수당 applied that day
  transport: number;
  cleaningRooms: string;
  cleaningNotes: string;
};

export type UserPayrollExportData = {
  userName: string;
  monthLabel: string;
  orgName: string;
  generatedLabel: string;
  rows: UserPayrollExportRow[];
};

export type UserPayrollExportLabels = {
  title: string;
  printLabel: string;
  colDate: string;
  colClockIn: string;
  colClockOut: string;
  colLocation: string;
  colWorkHours: string;
  colDailyPay: string;
  colAllowance: string;
  colSpecialAllowance: string;
  colTransport: string;
  colCleaningRooms: string;
  colCleaningNotes: string;
  totalLabel: string;
  totalWorkDays: string;
  totalPayout: string;
};

const TITLE_FILL = "FFB6D7A8";
const HEADER_FILL = "FFD9EAD3";
const TOTAL_FILL = "FFE2F0D9";
const INK = "FF000000";
const LINE = "FF000000";
const TEMPLATE_ROWS = 31;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CLEANING_EXPORT_RULES: {
  canonical: string;
  summary: string;
  aliases: string[];
  keepRaw?: boolean;
}[] = [
  { canonical: "아라키초A", summary: "AA", aliases: ["아라키초A", "Arakicho A", "荒木町A"] },
  { canonical: "아라키초B", summary: "AB", aliases: ["아라키초B", "아리키초B", "Arakicho B", "荒木町B"] },
  { canonical: "가부키초", summary: "KK", aliases: ["가부키초", "Kabukicho", "歌舞伎町"] },
  { canonical: "다카다노바바", summary: "T2", aliases: ["다카다노바바", "Takadanobaba", "高田馬場"] },
  { canonical: "오쿠보A", summary: "", aliases: ["오쿠보A", "Okubo A", "大久保A"], keepRaw: true },
  { canonical: "오쿠보B", summary: "", aliases: ["오쿠보B", "Okubo B", "大久保B"], keepRaw: true },
  { canonical: "오쿠보C", summary: "", aliases: ["오쿠보C", "Okubo C", "大久保C"], keepRaw: true },
  { canonical: "스카이", summary: "", aliases: ["스카이", "Sky"], keepRaw: true },
];

export function summarizeCleaningRoomLabel(raw: string): string {
  const label = raw.trim().replace(/\s+/g, " ");
  if (!label) return "";

  const canonicalProperty = getCanonicalPropertyName(label);
  const rule =
    CLEANING_EXPORT_RULES.find((item) => item.canonical === canonicalProperty) ??
    CLEANING_EXPORT_RULES.find((item) => item.aliases.some((alias) => label.startsWith(alias)));

  if (!rule) return label;
  if (rule.keepRaw) return label;

  for (const alias of rule.aliases) {
    if (!label.startsWith(alias)) continue;

    let room = label
      .slice(alias.length)
      .replace(/^[\s·:|/_-]+/, "")
      .trim();

    if (rule.summary) {
      room = room.replace(new RegExp(`^${escapeRegex(rule.summary)}(?=[a-z]?\\d)`, "i"), "");
    }

    const canonicalRoom = getCanonicalRoomLabel(rule.canonical, room || label);
    const displayRoom = getDisplayRoomLabel(rule.canonical, canonicalRoom);
    return `${rule.summary}${displayRoom}`;
  }

  return label;
}

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hoursLabel(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

const thin = { style: "thin" as const, color: { argb: LINE } };
function box() {
  return { top: thin, bottom: thin, left: thin, right: thin };
}

function moneyFont() {
  return { name: "Meiryo", size: 9, bold: true, color: { argb: INK } };
}

export async function buildUserPayrollWorkbookBase64(
  data: UserPayrollExportData,
  labels: UserPayrollExportLabels,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Foldy";
  wb.created = new Date();

  const ws = wb.addWorksheet(data.userName.slice(0, 31), {
    views: [{ showGridLines: true }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.45, right: 0.45, top: 0.55, bottom: 0.55, header: 0.25, footer: 0.25 },
    },
  });
  ws.properties.defaultRowHeight = 18;
  ws.pageSetup.printArea = `A1:K${TEMPLATE_ROWS + 4}`;

  const cols: { width: number; align: "center"; numFmt?: string }[] = [
    { width: 12, align: "center" }, // 날짜
    { width: 10, align: "center" }, // 출근
    { width: 10, align: "center" }, // 퇴근
    { width: 16, align: "center" }, // 장소 (직접 입력 텍스트 또는 현장 이름)
    { width: 13, align: "center" }, // 근무 시간
    { width: 14, align: "center", numFmt: "¥#,##0" }, // 기본급
    { width: 12, align: "center", numFmt: "¥#,##0" }, // 추가수당
    { width: 12, align: "center", numFmt: "¥#,##0" }, // 특별수당
    { width: 12, align: "center", numFmt: "¥#,##0" }, // 교통비
    { width: 26, align: "center" }, // 청소 객실
    { width: 24, align: "center" }, // 청소 메모
  ];
  ws.columns = cols.map((c) => ({ width: c.width }));
  const LAST = cols.length;

  ws.mergeCells(1, 1, 1, LAST);
  const title = ws.getCell("A1");
  title.value = `${data.monthLabel} ${data.userName} ${labels.title}`;
  title.font = { name: "Meiryo", bold: true, size: 12, color: { argb: INK } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
  title.alignment = { vertical: "middle", horizontal: "center" };
  title.border = box();
  ws.getRow(1).height = 22;

  const headerLabels = [
    labels.colDate,
    labels.colClockIn,
    labels.colClockOut,
    labels.colLocation,
    labels.colWorkHours,
    labels.colDailyPay,
    labels.colAllowance,
    labels.colSpecialAllowance,
    labels.colTransport,
    labels.colCleaningRooms,
    labels.colCleaningNotes,
  ];
  const header = ws.getRow(2);
  header.height = 22;
  headerLabels.forEach((label, i) => {
    const cell = header.getCell(i + 1);
    cell.value = label;
    cell.font = { name: "Meiryo", bold: true, color: { argb: INK }, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", shrinkToFit: true };
    cell.border = box();
  });

  const firstDataRow = 3;
  const templateRows = Math.max(TEMPLATE_ROWS, data.rows.length);
  for (let i = 0; i < templateRows; i++) {
    const r = data.rows[i];
    const row = ws.getRow(firstDataRow + i);
    row.height = 18;
    const values: (string | number)[] = r
      ? [
          r.date,
          r.clockIn,
          r.clockOut,
          r.location,
          hoursLabel(r.workMinutes),
          r.dailyPay,
          r.allowanceRegular,
          r.allowanceSpecial,
          r.transport,
          r.cleaningRooms,
          r.cleaningNotes,
        ]
      : ["", "", "", "", "", "", "", "", "", "", ""];
    values.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      cell.font =
        ci >= 5 && ci <= 8
          ? moneyFont()
          : { name: "Meiryo", size: 9, color: { argb: INK } };
      cell.alignment = { vertical: "middle", horizontal: cols[ci].align, shrinkToFit: ci === 3 || ci >= 9 };
      cell.border = box();
      if (cols[ci].numFmt && typeof v === "number") cell.numFmt = cols[ci].numFmt!;
    });
  }

  const lastDataRow = firstDataRow + templateRows - 1;
  const totalRowIdx = lastDataRow + 1;
  const total = ws.getRow(totalRowIdx);
  total.height = 20;
  const totalMinutes = data.rows.reduce((sum, r) => sum + r.workMinutes, 0);
  const workDays = data.rows.filter((r) => r.workMinutes > 0).length;
  total.getCell(1).value = labels.totalLabel;
  total.getCell(2).value = labels.totalWorkDays;
  total.getCell(3).value = workDays;
  total.getCell(5).value = hoursLabel(totalMinutes);
  total.getCell(6).value = { formula: `SUM(F${firstDataRow}:F${lastDataRow})` };
  total.getCell(7).value = { formula: `SUM(G${firstDataRow}:G${lastDataRow})` };
  total.getCell(8).value = { formula: `SUM(H${firstDataRow}:H${lastDataRow})` };
  total.getCell(9).value = { formula: `SUM(I${firstDataRow}:I${lastDataRow})` };
  total.getCell(10).value = { formula: `SUM(F${firstDataRow}:I${lastDataRow})` };
  total.getCell(6).numFmt = "¥#,##0";
  total.getCell(7).numFmt = "¥#,##0";
  total.getCell(8).numFmt = "¥#,##0";
  total.getCell(9).numFmt = "¥#,##0";
  total.getCell(10).numFmt = `"${labels.totalPayout} "¥#,##0`;
  for (let ci = 1; ci <= LAST; ci++) {
    const cell = total.getCell(ci);
    cell.font =
      ci >= 6 && ci <= 10
        ? moneyFont()
        : { name: "Meiryo", bold: true, size: 9, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = box();
  }

  ws.getCell(`A${totalRowIdx + 2}`).value = `${data.orgName} / ${data.generatedLabel}`;
  ws.getCell(`A${totalRowIdx + 2}`).font = { name: "Meiryo", size: 8, color: { argb: INK } };
  ws.getCell(`A${totalRowIdx + 2}`).alignment = { vertical: "middle", horizontal: "center" };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}

export function buildUserPayrollReportHtml(
  data: UserPayrollExportData,
  labels: UserPayrollExportLabels,
  localeTag: string,
): string {
  const nf = new Intl.NumberFormat(localeTag);
  const yen = (n: number) => `¥${nf.format(Math.round(n))}`;
  const totalMinutes = data.rows.reduce((sum, r) => sum + r.workMinutes, 0);
  const workDays = data.rows.filter((r) => r.workMinutes > 0).length;
  const totalPay = data.rows.reduce((sum, r) => sum + r.dailyPay, 0);
  const totalAllowance = data.rows.reduce((sum, r) => sum + r.allowanceRegular, 0);
  const totalSpecial = data.rows.reduce((sum, r) => sum + r.allowanceSpecial, 0);
  const totalTransport = data.rows.reduce((sum, r) => sum + r.transport, 0);
  const rows = data.rows
    .map(
      (r, i) => `<tr${i % 2 ? ' class=z' : ""}>
        <td>${esc(r.date)}</td>
        <td class=c>${esc(r.clockIn)}</td>
        <td class=c>${esc(r.clockOut)}</td>
        <td class=r>${esc(r.location || "-")}</td>
        <td class=r>${hoursLabel(r.workMinutes)}</td>
        <td class="r money">${yen(r.dailyPay)}</td>
        <td class="r money">${r.allowanceRegular > 0 ? yen(r.allowanceRegular) : "-"}</td>
        <td class="r money">${r.allowanceSpecial > 0 ? yen(r.allowanceSpecial) : "-"}</td>
        <td class="r money">${yen(r.transport)}</td>
        <td class=r>${esc(r.cleaningRooms || "-")}</td>
        <td class=r>${esc(r.cleaningNotes || "-")}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="${esc(localeTag.slice(0, 2))}">
<head>
<meta charset="utf-8" />
<title>${esc(data.userName)} · ${esc(data.monthLabel)} ${esc(labels.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Meiryo','Malgun Gothic','Apple SD Gothic Neo',sans-serif; color: #000; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 18px; }
  .toolbar { position: fixed; top: 14px; right: 14px; z-index: 10; }
  .printbtn { border: none; background: #2f3b5c; color: #fff; font-size: 13px; font-weight: 700;
    padding: 9px 16px; border-radius: 8px; cursor: pointer; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  .title { background: #b6d7a8; border: 1px solid #000; font-size: 17px; font-weight: 800; padding: 6px 8px; text-align: center; }
  .meta { margin: 8px 0 10px; font-size: 10px; text-align: center; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 0; }
  th, td { border: 1px solid #000; padding: 5px 7px; font-size: 11px; height: 24px; text-align: center; }
  th { background: #d9ead3; font-weight: 800; text-align: center; white-space: nowrap; }
  td.c { text-align: center; }
  td.r { text-align: center; font-variant-numeric: tabular-nums; }
  td.money { color: #000; font-weight: 700; }
  tr.z td { background: #fbfcf8; }
  tr.tot td { background: #e2f0d9; font-weight: 800; }
  @media print { .noprint { display: none !important; } }
</style>
</head>
<body>
  <div class="toolbar noprint"><button type="button" class="printbtn" onclick="window.print()">${esc(labels.printLabel)}</button></div>
  <div class="wrap">
    <div class="title">${esc(data.monthLabel)} ${esc(data.userName)} ${esc(labels.title)}</div>
    <table>
      <thead><tr>
        <th style="width: 9%">${esc(labels.colDate)}</th>
        <th style="width: 7%">${esc(labels.colClockIn)}</th>
        <th style="width: 7%">${esc(labels.colClockOut)}</th>
        <th style="width: 12%">${esc(labels.colLocation)}</th>
        <th style="width: 9%">${esc(labels.colWorkHours)}</th>
        <th class="money" style="width: 9%">${esc(labels.colDailyPay)}</th>
        <th class="money" style="width: 8%">${esc(labels.colAllowance)}</th>
        <th class="money" style="width: 8%">${esc(labels.colSpecialAllowance)}</th>
        <th class="money" style="width: 8%">${esc(labels.colTransport)}</th>
        <th style="width: 12%">${esc(labels.colCleaningRooms)}</th>
        <th style="width: 11%">${esc(labels.colCleaningNotes)}</th>
      </tr></thead>
      <tbody>
        ${rows}
        <tr class="tot">
          <td>${esc(labels.totalLabel)}</td>
          <td class="r">${esc(labels.totalWorkDays)}</td>
          <td class="r">${workDays}</td>
          <td class="r"></td>
          <td class="r">${hoursLabel(totalMinutes)}</td>
          <td class="r money">${yen(totalPay)}</td>
          <td class="r money">${yen(totalAllowance)}</td>
          <td class="r money">${yen(totalSpecial)}</td>
          <td class="r money">${yen(totalTransport)}</td>
          <td class="r money">${esc(labels.totalPayout)} ${yen(totalPay + totalAllowance + totalSpecial + totalTransport)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
    <div class="meta">${esc(data.orgName)} / ${esc(data.generatedLabel)}</div>
  </div>
</body>
</html>`;
}
