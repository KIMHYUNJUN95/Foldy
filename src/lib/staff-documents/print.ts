/* i18n-ignore-file -- A4 신분 서류 사본은 화면 언어와 무관한 일본어 고정 양식(공문서 사본 성격, docs/product/41 §3-4). 화면 조작 글(버튼 · 오류)은 i18n.ts. */

/**
 * 신분 서류 A4 인쇄(재류카드 R3) — 순수 도우미. 칸 모양 만들기 · 일본어 표기 · 주소 파라미터 읽기.
 * 서버 페이지(`src/app/account/id-card/print/page.tsx`)가 쓰고, 테스트 `staff-document-print.test.ts` 가 지킨다.
 *
 * - 마이넘버 카드는 앞면만 · 재류 칸 없음 · **개인번호는 어떤 경우에도 싣지 않는다**(card_number 를 아예 읽지 않는다).
 * - 확인 전(확인 대기 · 다시 요청) 서류도 뽑을 수 있지만 確認日 · 確認者 는 「未確認」, 「원본과 같음」 문장은 빠진다.
 */

import type { ExtraActivity, IdDocumentKind, WorkRestriction } from "@/lib/staff-documents/fields";
import { tokyoDateOf } from "@/lib/tokyo-date";

/** 카드에 적힌 그대로의 문구(출입국재류관리청 양식). */
export const WORK_RESTRICTION_JA: Record<WorkRestriction, string> = {
  none: "就労制限なし",
  status_based: "在留資格に基づく就労活動のみ可",
  designated_org: "指定書記載機関での在留資格に基づく就労活動のみ可",
  designated: "指定書により指定された就労活動のみ可",
  not_allowed: "就労不可",
};

export const EXTRA_ACTIVITY_JA: Record<ExtraActivity, string> = {
  none: "—",
  weekly_28h: "許可：原則週28時間以内・風俗営業等の従事を除く",
  per_certificate: "許可：資格外活動許可書に記載された範囲内の活動",
};

export const UNCONFIRMED_JA = "未確認";
const EMPTY = "—";

/** 한 번에 뽑는 최대 인원 — 서명 URL · 사진이 많아지면 인쇄 미리보기가 느려진다. */
export const MAX_PRINT_PEOPLE = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?u=a,b,c` → 중복 없는 uuid 목록(소문자, 순서 유지, 최대 50). 모양이 틀린 값은 버린다. */
export function parsePrintUserIds(raw: string | string[] | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw ?? ""]).flatMap((value) => value.split(","));
  const out: string[] = [];
  for (const part of parts) {
    const id = part.trim().toLowerCase();
    if (!UUID.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_PRINT_PEOPLE) break;
  }
  return out;
}

/** 2026-10-22 → 2026年10月22日. 모양이 틀리면 "—". */
export function formatJaDate(dateKey: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey ?? "");
  if (!m) return EMPTY;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

/** timestamptz → 도쿄 「2026年10月22日 15:40」. */
export function formatJaDateTime(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return EMPTY;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}年${Number(get("month"))}月${Number(get("day"))}日 ${get("hour")}:${get("minute")}`;
}

/** ISO 나라 코드 → 일본어 나라 이름(「韓国」). 모르면 대신 적힌 글(카드의 국적 칸)이나 "—". */
export function nationalityJa(code: string | null | undefined, fallbackText?: string | null): string {
  const c = (code ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(c)) {
    try {
      const name = new Intl.DisplayNames(["ja"], { type: "region" }).of(c);
      if (name && name !== c) return name;
    } catch {
      // 모르는 코드 — 아래로.
    }
  }
  return (fallbackText ?? "").trim() || EMPTY;
}

export type PrintRow = { label: string; value: string; lang?: "ko" | "ja" };

export type PrintSheetInput = {
  kind: IdDocumentKind;
  status: "pending" | "confirmed" | "returned";
  organizationName: string;
  profile: {
    nameKatakana: string | null;
    nameKo: string | null;
    nameJa: string | null;
    nameEn: string | null;
    nationality: string | null;
    birthDate: string | null;
  };
  doc: {
    nameRoman: string | null;
    birthDate: string | null;
    nationalityText: string | null;
    cardNumber: string | null;
    residenceStatus: string | null;
    expiresOn: string | null;
    workRestriction: string | null;
    extraActivity: string | null;
    confirmedAt: string | null;
  };
  confirmedByName: string | null;
};

export type PrintSheet = {
  title: string;
  frontLabel: string;
  backLabel: string | null;
  organizationName: string;
  top: PrintRow[];
  bottom: PrintRow[];
  /** 확인한 서류만 「원본과 같음」 문장. */
  attestation: string | null;
};

/** 인쇄 화면에 넘기는 한 사람 — 칸 + 짧은 서명 URL(마이넘버는 뒷면 없음). */
export type PrintablePerson = {
  userId: string;
  documentId: string;
  kind: IdDocumentKind;
  sheet: PrintSheet;
  frontUrl: string | null;
  backUrl: string | null;
};

const text = (value: string | null | undefined) => (value ?? "").trim() || EMPTY;

/** 한 사람의 A4 한 장 칸 — 위(이름 · 생년월일 · 국적 · 확인일) · 아래(카드 칸 · 확인자). */
export function buildPrintSheet(input: PrintSheetInput): PrintSheet {
  const { kind, profile, doc } = input;
  const confirmed = input.status === "confirmed" && Boolean(input.doc.confirmedAt);
  const isMyNumber = kind === "my_number_card";

  // 본명 줄: 일본 국적은 氏名(한자), 그 밖은 한국 이름이 있으면 韓国名.
  const nativeName: PrintRow | null =
    profile.nationality === "JP" || isMyNumber
      ? { label: "氏名", value: text(profile.nameJa), lang: "ja" }
      : profile.nameKo?.trim()
        ? { label: "韓国名", value: profile.nameKo.trim(), lang: "ko" }
        : null;

  const top: PrintRow[] = [
    { label: "氏名（カナ）", value: text(profile.nameKatakana) },
    ...(nativeName ? [nativeName] : []),
    { label: "英字氏名", value: text(doc.nameRoman || profile.nameEn) },
    { label: "生年月日", value: formatJaDate(doc.birthDate || profile.birthDate) },
    { label: "国籍・地域", value: nationalityJa(profile.nationality, doc.nationalityText) },
    { label: "確認日", value: confirmed ? formatJaDate(tokyoDateOf(input.doc.confirmedAt)) : UNCONFIRMED_JA },
  ];

  const confirmer: PrintRow = { label: "確認者", value: confirmed ? text(input.confirmedByName) : UNCONFIRMED_JA };
  const bottom: PrintRow[] = isMyNumber
    ? [{ label: "有効期限", value: formatJaDate(doc.expiresOn) }, confirmer]
    : [
        { label: "カード番号", value: text(doc.cardNumber) },
        { label: "在留資格", value: text(doc.residenceStatus) },
        { label: "在留期間満了日", value: formatJaDate(doc.expiresOn) },
        { label: "就労制限", value: WORK_RESTRICTION_JA[doc.workRestriction as WorkRestriction] ?? EMPTY },
        { label: "資格外活動許可", value: EXTRA_ACTIVITY_JA[doc.extraActivity as ExtraActivity] ?? EMPTY },
        confirmer,
      ];

  const cardName = isMyNumber ? "マイナンバーカード" : "在留カード";
  return {
    title: isMyNumber ? "マイナンバーカード（表面）写し" : "在留カード 写し",
    frontLabel: "表面",
    backLabel: isMyNumber ? null : "裏面",
    organizationName: input.organizationName,
    top,
    bottom,
    attestation: confirmed ? `上記の写しは本人の${cardName}原本と相違ないことを確認しました。` : null,
  };
}

/** 바닥글 「Foldy で出力　出力日時 …　出力者 …」. */
export function printFooter(printedAt: Date, printerName: string): string {
  return `Foldy で出力　出力日時 ${formatJaDateTime(printedAt)}　出力者 ${printerName.trim() || EMPTY}`;
}

export const PRINT_CONFIDENTIAL = "社外秘";
export const PRINT_STAMP_LABEL = "確認";
export const PRINT_SCALE_NOTE = "実寸（85.6 × 54 mm）で印刷しています";
export const PRINT_LARGE_SUFFIX = "（2倍）";
export const PRINT_PHOTO_MISSING = "画像なし";
