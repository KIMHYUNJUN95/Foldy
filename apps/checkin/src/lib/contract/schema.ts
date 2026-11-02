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
  "occupation",
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
});

export type Contract = z.infer<typeof contractSchema>;
