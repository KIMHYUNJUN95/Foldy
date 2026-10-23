import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import {
  EMPTY_ID_FIELDS,
  normalizeIdFields,
  type IdDocumentField,
  type IdDocumentFields,
  type IdDocumentKind,
} from "@/lib/staff-documents/fields";

/**
 * 카드 사진 → 칸 값 (재류카드 R2, docs/product/41 §3-1a).
 *
 * Claude API 이미지 읽기 + 정해진 JSON(structured outputs). 키는 서버 전용 `ANTHROPIC_API_KEY`.
 * 사진은 이 요청에만 쓰인다(Anthropic API 는 학습에 쓰지 않고 보통 30일 안에 지운다 — 안전 점검에 걸린 요청은 최대 2년.
 * 촬영 전 동의 「자세히 보기」가 이 사실을 말한다).
 *
 * 읽기는 「미리 채우기」일 뿐이다 — 실패해도 손으로 입력해 가입을 마칠 수 있어야 한다. 그래서 오류를 던지지 않고
 * `{ ok: false, reason }` 으로 돌려준다.
 */

const MODEL = "claude-opus-5-5";

export type OcrImage = { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };

export type OcrResult =
  | {
      ok: true;
      fields: IdDocumentFields;
      /** 글자가 흐리거나 확신이 낮은 칸 — 화면이 「카드와 같은지 봐 주세요」를 붙인다. */
      unsure: IdDocumentField[];
    }
  | { ok: false; reason: "not_configured" | "not_card" | "unreadable" | "individual_number" | "failed" };

const FIELD_KEYS = [
  "nameRoman",
  "birthDate",
  "gender",
  "nationalityText",
  "address",
  "expiresOn",
  "cardNumber",
  "residenceStatus",
  "workRestriction",
  "extraActivity",
] as const satisfies readonly IdDocumentField[];

const fieldSchema = {
  type: "object",
  properties: {
    value: { type: "string" },
    sure: { type: "boolean" },
  },
  required: ["value", "sure"],
  additionalProperties: false,
} as const;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    isExpectedCard: { type: "boolean" },
    readable: { type: "boolean" },
    individualNumberVisible: { type: "boolean" },
    fields: {
      type: "object",
      properties: Object.fromEntries(FIELD_KEYS.map((key) => [key, fieldSchema])),
      required: [...FIELD_KEYS],
      additionalProperties: false,
    },
  },
  required: ["isExpectedCard", "readable", "individualNumberVisible", "fields"],
  additionalProperties: false,
};

const RESIDENCE_PROMPT = `These two photos are the front and back of a Japanese residence card (在留カード).
Read the printed text and fill every field. Use "" when a field is not on the card or you cannot read it.
- nameRoman: 氏名 in Latin letters exactly as printed (upper case, keep spaces and commas).
- birthDate, expiresOn: YYYY-MM-DD. expiresOn = 在留期間（満了日）, the date in parentheses "(YYYY年MM月DD日)".
- gender: "male" for 男 / M, "female" for 女 / F.
- nationalityText: 国籍・地域 as printed.
- address: the most recent 住居地 — if the back has an address change entry, use the newest one.
- cardNumber: the 12-character number at the top right (two letters, eight digits, two letters), no spaces.
- residenceStatus: 在留資格 exactly as printed in Japanese (for example 特定活動, 留学, 技術・人文知識・国際業務).
- workRestriction: from 就労制限の有無 — "none" for 就労制限なし; "status_based" for 在留資格に基づく就労活動のみ可;
  "designated_org" for 指定書記載機関での在留資格に基づく就労活動のみ可; "designated" for 指定書により指定された就労活動のみ可;
  "not_allowed" for 就労不可.
- extraActivity: from 資格外活動許可欄 on the back — "weekly_28h" for 許可（原則週28時間以内・風俗営業等の従事を除く）,
  "per_certificate" for 許可（資格外活動許可書に記載された範囲内の活動）, "none" if the box is empty.
Set sure=false for any value that is blurred, cut off, covered by glare or that you had to guess.
isExpectedCard=false if the photos are not a residence card. readable=false if the photos are too blurry to read.
individualNumberVisible is always false for a residence card.`;

const MY_NUMBER_PROMPT = `This photo should be the FRONT of a Japanese My Number card (マイナンバーカード表面).
Read the printed text. Use "" for fields that are not on the card or that you cannot read.
- nameRoman: the 氏名 as printed (in Japanese characters is fine — copy it exactly).
- birthDate: YYYY-MM-DD (convert 昭和/平成/令和 to the Western year).
- gender: "male" for 男, "female" for 女.
- address: 住所 as printed.
- expiresOn: the card's 有効期限 (YYYY-MM-DD), the date in the box like "2034年 5月14日まで有効".
- cardNumber, residenceStatus, workRestriction, extraActivity, nationalityText: always "".
Set sure=false for any value that is blurred, cut off or guessed.
IMPORTANT: if a 12-digit 個人番号 (individual number) is visible anywhere in the photo — that means this is the back side —
set individualNumberVisible=true and leave every field "". Never write that number anywhere.
isExpectedCard=false if the photo is not a My Number card. readable=false if it is too blurry to read.`;

type RawOutput = {
  isExpectedCard: boolean;
  readable: boolean;
  individualNumberVisible: boolean;
  fields: Record<(typeof FIELD_KEYS)[number], { value: string; sure: boolean }>;
};

export async function readIdCardPhotos(kind: IdDocumentKind, images: OcrImage[]): Promise<OcrResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "not_configured" };

  const client = new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...images.map(
      (image): Anthropic.Beta.BetaContentBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.data },
      }),
    ),
    { type: "text", text: kind === "residence_card" ? RESIDENCE_PROMPT : MY_NUMBER_PROMPT },
  ];

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 4000,
        // 칸 옮겨 적기라 깊게 생각할 일이 아니다 — 빠르고 싸게.
        output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        // 드물게 안전 분류기가 거절하면 서버가 알맞은 모델로 다시 돌린다.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // 동의 문구가 「미국에 있는 서버」라 처리 지역을 미국으로 묶는다(지정 안 하면 global — 미국 밖일 수 있다). 요금 1.1배.
        inference_geo: "us",
        messages: [{ role: "user", content }],
      },
      { timeout: 60_000, maxRetries: 1 },
    );
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error("[staff-documents] Claude API key rejected");
      return { ok: false, reason: "not_configured" };
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`[staff-documents] Claude API error ${error.status}`);
    } else {
      console.error("[staff-documents] Claude API request failed");
    }
    return { ok: false, reason: "failed" };
  }

  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    return { ok: false, reason: "failed" };
  }
  const text = response.content.find((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")?.text;
  if (!text) return { ok: false, reason: "failed" };

  let raw: RawOutput;
  try {
    raw = JSON.parse(text) as RawOutput;
  } catch {
    return { ok: false, reason: "failed" };
  }

  if (kind === "my_number_card" && raw.individualNumberVisible) return { ok: false, reason: "individual_number" };
  if (!raw.isExpectedCard) return { ok: false, reason: "not_card" };
  if (!raw.readable) return { ok: false, reason: "unreadable" };

  const picked: Partial<IdDocumentFields> = {};
  const unsure: IdDocumentField[] = [];
  for (const key of FIELD_KEYS) {
    const entry = raw.fields?.[key];
    if (!entry || typeof entry.value !== "string") continue;
    (picked as Record<string, string>)[key] = entry.value;
    if (entry.value && entry.sure === false) unsure.push(key);
  }
  const fields = normalizeIdFields({ ...EMPTY_ID_FIELDS, ...picked });
  if (kind === "my_number_card") {
    // 앞면에는 없는 칸 — 혹시 채워 와도 버린다.
    fields.cardNumber = "";
    fields.residenceStatus = "";
    fields.workRestriction = "";
    fields.extraActivity = "";
    fields.nationalityText = "";
  }
  return { ok: true, fields, unsure: unsure.filter((key) => fields[key] !== "") };
}
