import { z } from "zod";

import { LOCALES } from "@/lib/i18n";

// 「계약」 — 명부 칸 · 규칙 · 문구를 서버가 JSON 으로 내려주고, 태블릿(Kotlin)과 웹이 그대로 그린다(16 §2).
// 이 파일이 원본이다. Kotlin 모델은 이 JSON 과 1:1 로 맞추고, 바꿀 때는 CONTRACT_VERSION 을 올린다.
export const CONTRACT_VERSION = 1;

const localeSchema = z.enum(LOCALES);
const localizedText = z.partialRecord(localeSchema, z.string());

export const fieldKeySchema = z.enum([
  "name_roman",
  "address",
  "nationality",
  "passport_number",
  "next_dest",
  "prev_stay",
]);

export const contractFieldSchema = z.object({
  key: fieldKeySchema,
  required: z.boolean(),
  // 외국인(일본 주소 없음)에게만 묻는 칸인지.
  foreignOnly: z.boolean().default(false),
  label: localizedText,
});

export const contractSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  languages: z.array(localeSchema).min(1),
  welcomeText: localizedText,
  termsVersion: z.number().int().positive(),
  fields: z.array(contractFieldSchema).min(1),
  videoSecondsPerGuest: z.number().int().min(3).max(15),
  verificationMethod: z.enum(["video", "staff_call", "auto_match"]),
  // 태블릿이 쓰는 건물 설정(2026-11-02, 3단계 뼈대). 아직 배포된 앱이 없어 버전은 1 그대로 늘렸다.
  termsText: localizedText,
  idleSecondsInput: z.number().int().min(30).max(900),
  idleSecondsDone: z.number().int().min(5).max(120),
  mrzAutofill: z.boolean(),
  // 집 주소 입력 규칙(2026-11-06). 서버 `addressError` 와 같은 값 — 태블릿은 같은 사례표(`guest/address-cases.json`)로 맞춘다.
  // 외국인(일본 주소 없음)은 라틴 글자만, 일본 거주자는 아무 글자. 운영 선택이지 법 해석이 아니다.
  addressRules: z.object({
    maxLength: z.number().int().positive(),
    minLengthForeign: z.number().int().positive(),
    minLengthJapan: z.number().int().positive(),
    foreignScript: z.literal("latin"),
  }),
  // 「직원에게 연락」 — 값은 건물 설정 그대로(전화 · LINE · WhatsApp). 비어 있으면 버튼만 숨긴다.
  supportContacts: z.partialRecord(z.enum(["phone", "line", "whatsapp"]), z.string()),
  // 직원 해제 PIN — 원문은 없다. 기기가 오프라인에서도 같은 방식(PBKDF2-SHA256)으로 대조한다. 설정 전이면 null.
  staffPin: z
    .object({ algorithm: z.literal("pbkdf2-sha256"), iterations: z.number().int().positive(), salt: z.string(), hash: z.string() })
    .nullable(),
  // 직원 통화(2026-11-06, 46 §4). 옛 앱은 모르는 키를 무시하므로 버전은 그대로. 꺼져 있으면 태블릿은 연락처 화면만 보여 준다.
  staffCallEnabled: z.boolean(),
});

export type Contract = z.infer<typeof contractSchema>;
