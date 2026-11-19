/**
 * 과거 답장에서 찾은 후보 — 뽑기 · 읽기 · 결정(서버 전용). docs/product/49-guest-message-ai-reply-assist.md §9
 *
 * - service_role + **조직 필터 명시**. 새 표 두 개는 RLS 켜고 정책 없음(브라우저 직접 읽기 · 쓰기 없음).
 * - **넣기 전엔 아무것도 바뀌지 않는다** — 뽑기는 후보 표에만 쓴다. 정해 둔 문구 · 건물 안내는 사람이 「추가」 · 「넣기」 할 때만.
 * - **비밀은 후보가 되지 않는다** — 모델 입력은 가린 글, 지시문으로 막고(1차), 나온 글을 `anySecretLike` 로 다시 본다(2차).
 * - **최신이 이긴다** — 근거는 최근 답장부터, 값이 섞이면 마지막으로 쓴 날이 늦은 쪽이 앞(`mergeOptions`).
 * - **넣은 · 뺀 것은 기억한다** — 다시 찾기는 남은(pending) 후보만 새로 만들고, 같은 묶음 · 같은 값은 다시 띄우지 않는다.
 * - 비용은 실행 줄(`guest_reply_candidate_runs.cost_micro_usd`)에 — 한 달 상한 계산(`guest_reply_assist_cost_since`)에 같이 들어간다.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  maskPastReply,
  maskQuestion,
  toVectorLiteral,
  tokyoMonthBounds,
  tokyoMonthsAgoStart,
} from "@/lib/guest-messages/ai-assist-model";
import { callGuestJsonModel, parseVector, savedReplyVectors, secretsOf, type GuestJsonCall } from "@/lib/guest-messages/ai-assist-server";
import { GUEST_AI_CONFIG, guestAiMonthlyCapMicroUsd, hasAnthropicKey, hasVoyageKey, isGuestAiFake } from "@/lib/guest-messages/ai-config";
import { GUEST_LANGS, type GuestLang, type Localized } from "@/lib/guest-messages/guest-info-model";
import { loadBuildingGuestInfo, loadBuildingGuestInfos, saveBuildingGuestInfo, type BuildingGuestInfo } from "@/lib/guest-messages/guest-info-server";
import {
  anySecretLike,
  CANDIDATE_FIELDS,
  CANDIDATE_RULES,
  centroidOf,
  cosineOf,
  detectLang,
  eachLimited,
  greedyClusters,
  isCandidateField,
  isRemembered,
  mentionsSecretWord,
  mergeOptions,
  scrubSecretSentences,
  validateGuestInfoOutput,
  validateSavedReplyOutput,
  valueHashesOf,
  type CandidateEvidence,
  type CandidateField,
  type CandidateOption,
} from "@/lib/guest-messages/reply-candidates-model";
import { settleStaleRun } from "@/lib/guest-messages/reply-candidates-view";
import { validateSavedReplyInput } from "@/lib/guest-messages/saved-reply-model";
import { createSavedReply, loadSavedReplies } from "@/lib/guest-messages/saved-replies-server";
import { tokyoDateOf } from "@/lib/tokyo-date";
import type { Database, Json } from "@/types/database";

type Client = SupabaseClient<Database>;
type CandidateRow = Database["public"]["Tables"]["guest_reply_candidates"]["Row"];
type CandidateInsert = Database["public"]["Tables"]["guest_reply_candidates"]["Insert"];
type RunRow = Database["public"]["Tables"]["guest_reply_candidate_runs"]["Row"];

const EMPTY: Localized = { ko: "", ja: "", en: "" };

// ── 화면 모양 ─────────────────────────────────────────────────────────────────

export type SkipNote = { property: string; field: CandidateField; reason: "few" | "filled"; count: number };

export type CandidateRunView = {
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  sourceCount: number;
  sourceSince: string | null;
  errorKey: "unavailable" | "cap" | "failed" | "stale" | null;
  skipNotes: SkipNote[];
};

export type CandidateView = {
  id: string;
  kind: "saved_reply" | "guest_info";
  status: "pending" | "added" | "dismissed";
  title: Localized;
  question: Localized;
  bodies: Localized;
  note: Localized;
  askCount: number;
  firstAskedAt: string | null;
  lastAskedAt: string | null;
  evidence: CandidateEvidence[];
  similarSavedReplyId: string | null;
  /** 건물 칸 — 한국어 정식 이름(화면에서 `useBuildingName` 으로 바꿔 그린다). */
  propertyName: string | null;
  field: CandidateField | null;
  /** 값 후보 — 최신 순(첫째가 미리 골라 둔 값). */
  options: CandidateOption[];
  decidedAt: string | null;
  /** 넣은 칸을 되돌릴 수 있나(모바일 바로 저장 뒤 · 5초 되돌리기). */
  canUndo: boolean;
};

export type CandidateOverview = {
  /** 키가 없으면 false — 화면은 「사용할 수 없음」. */
  available: boolean;
  lastRun: CandidateRunView | null;
  pending: CandidateView[];
  /** 끝낸 것(추가함 · 뺌) — 최근 결정 순. */
  decided: CandidateView[];
};

const VIEW_COLUMNS =
  "id, kind, status, title, question, bodies, note, ask_count, first_asked_at, last_asked_at, evidence, similar_saved_reply_id, property_name, field, options, decided_at, applied_previous, result_saved_reply_id";

function localized(raw: unknown): Localized {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...EMPTY };
  for (const lang of GUEST_LANGS) out[lang] = typeof record[lang] === "string" ? (record[lang] as string) : "";
  return out;
}

function evidenceOf(raw: unknown): CandidateEvidence[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.at !== "string" || typeof record.text !== "string") return [];
    const lang = record.lang === "ja" || record.lang === "en" ? record.lang : "ko";
    return [{ at: record.at, property: typeof record.property === "string" ? record.property : null, lang, text: record.text }];
  });
}

function optionsOf(raw: unknown): CandidateOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return [
      {
        value: localized(record.value),
        count: typeof record.count === "number" ? record.count : 0,
        firstAt: typeof record.firstAt === "string" ? record.firstAt : "",
        lastAt: typeof record.lastAt === "string" ? record.lastAt : "",
      },
    ];
  });
}

type ViewRow = Pick<
  CandidateRow,
  | "id"
  | "kind"
  | "status"
  | "title"
  | "question"
  | "bodies"
  | "note"
  | "ask_count"
  | "first_asked_at"
  | "last_asked_at"
  | "evidence"
  | "similar_saved_reply_id"
  | "property_name"
  | "field"
  | "options"
  | "decided_at"
  | "applied_previous"
  | "result_saved_reply_id"
>;

function toView(row: ViewRow): CandidateView {
  const kind = row.kind === "guest_info" ? "guest_info" : "saved_reply";
  const status = row.status === "added" || row.status === "dismissed" ? row.status : "pending";
  return {
    id: row.id,
    kind,
    status,
    title: localized(row.title),
    question: localized(row.question),
    bodies: localized(row.bodies),
    note: localized(row.note),
    askCount: row.ask_count,
    firstAskedAt: row.first_asked_at,
    lastAskedAt: row.last_asked_at,
    evidence: evidenceOf(row.evidence),
    similarSavedReplyId: row.similar_saved_reply_id,
    propertyName: row.property_name,
    field: isCandidateField(row.field) ? row.field : null,
    options: optionsOf(row.options),
    decidedAt: row.decided_at,
    canUndo:
      status === "dismissed" ||
      (status === "added" && (kind === "saved_reply" ? Boolean(row.result_saved_reply_id) : row.applied_previous !== null)),
  };
}

function toRunView(row: Pick<RunRow, "status" | "started_at" | "finished_at" | "source_count" | "source_since" | "error_key" | "skip_notes">): CandidateRunView {
  const notes = Array.isArray(row.skip_notes) ? (row.skip_notes as unknown[]) : [];
  return {
    status: row.status === "done" || row.status === "failed" ? row.status : "running",
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    sourceCount: row.source_count,
    sourceSince: row.source_since,
    errorKey:
      row.error_key === "unavailable" || row.error_key === "cap" || row.error_key === "failed" || row.error_key === "stale" ? row.error_key : null,
    skipNotes: notes.flatMap((note) => {
      if (!note || typeof note !== "object") return [];
      const record = note as Record<string, unknown>;
      if (typeof record.property !== "string" || !isCandidateField(record.field)) return [];
      if (record.reason !== "few" && record.reason !== "filled") return [];
      return [{ property: record.property, field: record.field, reason: record.reason, count: typeof record.count === "number" ? record.count : 0 }];
    }),
  };
}

export function candidatesAvailable(): boolean {
  return hasVoyageKey() && hasAnthropicKey();
}

/**
 * 화면 하나 분량 — 남은 후보 전부 + 끝낸 것 최근 200개 + 마지막 실행. `kinds` 로 권한 없는 종류는 아예 읽지 않는다.
 */
export async function loadCandidateOverview(
  db: Client,
  organizationId: string,
  kinds: ReadonlyArray<"saved_reply" | "guest_info">,
): Promise<CandidateOverview> {
  const [pending, decided, run] = await Promise.all([
    db
      .from("guest_reply_candidates")
      .select(VIEW_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .in("kind", [...kinds])
      .order("ask_count", { ascending: false })
      .limit(500),
    db
      .from("guest_reply_candidates")
      .select(VIEW_COLUMNS)
      .eq("organization_id", organizationId)
      .neq("status", "pending")
      .in("kind", [...kinds])
      .order("decided_at", { ascending: false })
      .limit(200),
    db
      .from("guest_reply_candidate_runs")
      .select("status, started_at, finished_at, source_count, source_since, error_key, skip_notes")
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (pending.error || decided.error || run.error) throw new Error("candidate overview read failed");
  return {
    available: candidatesAvailable(),
    lastRun: run.data ? settleStaleRun(toRunView(run.data as RunRow), Date.now()) : null,
    pending: ((pending.data ?? []) as ViewRow[]).map(toView),
    decided: ((decided.data ?? []) as ViewRow[]).map(toView),
  };
}

/**
 * 입구 줄 숫자만(2026-11-19, 화면용 읽기) — 남은 후보 수를 종류별로 센다. 본문은 읽지 않는다(head count).
 * `kinds` 는 서버 액션 게이트와 같은 판정으로 페이지가 정한다 — 권한 없는 종류는 0.
 */
export async function countPendingCandidates(
  db: Client,
  organizationId: string,
  kinds: ReadonlyArray<"saved_reply" | "guest_info">,
): Promise<{ replies: number; info: number }> {
  const count = async (kind: "saved_reply" | "guest_info") => {
    if (!kinds.includes(kind)) return 0;
    const { count: n, error } = await db
      .from("guest_reply_candidates")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .eq("kind", kind);
    if (error) return 0;
    return n ?? 0;
  };
  const [replies, info] = await Promise.all([count("saved_reply"), count("guest_info")]);
  return { replies, info };
}

// ── 실행 시작 ─────────────────────────────────────────────────────────────────

export type StartRunResult = { ok: true; runId: string } | { ok: false; error: "busy" | "cap" | "unavailable" | "failed" };

/** 실행 줄 하나 잡기 — 조직마다 하나만, 한 달 상한 안에서 `runReserveMicroUsd` 를 먼저 잡는다(DB 함수, 잠금 안). */
export async function startCandidateRun(db: Client, organizationId: string, userId: string, now = new Date()): Promise<StartRunResult> {
  if (!candidatesAvailable()) return { ok: false, error: "unavailable" };
  const { data, error } = await db.rpc("guest_reply_candidate_run_start", {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_since: tokyoMonthBounds(now).start,
    p_cap_micro_usd: guestAiMonthlyCapMicroUsd(),
    p_reserve_micro_usd: CANDIDATE_RULES.runReserveMicroUsd,
  });
  if (error) {
    console.error("[guest-candidates] run start failed", { code: error.code });
    return { ok: false, error: "failed" };
  }
  const row = (data ?? [])[0];
  if (!row) return { ok: false, error: "failed" };
  if (row.outcome === "busy") return { ok: false, error: "busy" };
  if (row.outcome === "cap") return { ok: false, error: "cap" };
  return row.run_id ? { ok: true, runId: row.run_id } : { ok: false, error: "failed" };
}

// ── 모델 ──────────────────────────────────────────────────────────────────────

const LOCALIZED_SCHEMA = {
  type: "object",
  properties: { ko: { type: "string" }, ja: { type: "string" }, en: { type: "string" } },
  required: ["ko", "ja", "en"],
  additionalProperties: false,
} as const;

const SAVED_REPLY_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          skip: { type: "boolean" },
          title: LOCALIZED_SCHEMA,
          question: LOCALIZED_SCHEMA,
          body: LOCALIZED_SCHEMA,
          note: LOCALIZED_SCHEMA,
        },
        required: ["index", "skip", "title", "question", "body", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

const GUEST_INFO_SCHEMA = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string", enum: [...CANDIDATE_FIELDS] },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: { value: LOCALIZED_SCHEMA, support: { type: "array", items: { type: "integer" } } },
              required: ["value", "support"],
              additionalProperties: false,
            },
          },
        },
        required: ["field", "options"],
        additionalProperties: false,
      },
    },
  },
  required: ["fields"],
  additionalProperties: false,
} as const;

const NEVER_SECRETS = `Never write any door code, entry code, keypad or keybox number, lock code, room passcode, Wi-Fi network name or Wi-Fi password — not even partly, not even as an example. Masked parts appear as […]; never guess what they were. If an answer only makes sense with such a value, skip it.`;

export const SAVED_REPLY_SYSTEM = `You help the staff of a small group of short-stay accommodation buildings in Tokyo turn questions guests ask again and again into reusable saved replies.
You get groups of similar guest questions, each with the replies staff actually sent, newest first.
For each group write one saved reply that works for any building:
- Newer replies win. If replies disagree, follow the newest ones and say so in "note".
- Use only these placeholders where a guest-specific value belongs: {guest_name} {checkin_date} {checkout_date} {nights} {building} {room}. No other braces.
- Do not include building-specific facts (addresses, times that differ by building, codes). Those belong to the building info, not to a saved reply.
- ${NEVER_SECRETS}
- "title": a short name staff will see (Korean about 2–8 words). "question": the typical question in one short line. "body": the reply, polite and short, in Korean, Japanese and English. "note": one short line for staff, or empty strings.
- Set "skip": true (with empty strings) for a group that is a one-off, depends on one booking, complains about something specific, or would need a secret.
Return exactly one entry per group, using the group's index.`;

export const GUEST_INFO_SYSTEM = `You read replies the staff of one short-stay building in Tokyo sent to guests, and pull out the building's standing guest information.
Only these fields: checkIn (check-in time and how), checkOut (check-out time and how), luggage (luggage storage before check-in / after check-out), parking, trash (rubbish sorting and where to put it), directions (how to get to the building).
Rules:
- Use only what the replies say. Each value must be backed by the numbered replies listed in "support".
- Newer replies win. If replies give different answers over time (for example check-out 10:00 earlier, 11:00 later), return each distinct answer as its own option with its own support — do not merge them.
- Keep each value short and written for guests, in Korean, Japanese and English.
- ${NEVER_SECRETS}
- Skip a field (leave it out) when the replies do not clearly state it.`;

type JsonCall = GuestJsonCall;

const callJsonModel = (system: string, user: string, schema: Record<string, unknown>, maxTokens: number): Promise<JsonCall> =>
  callGuestJsonModel({ system, user, schema, maxTokens, timeoutMs: 120_000, logTag: "[guest-candidates]" });

// ── 가짜 모델(GUEST_AI_FAKE=1 — 로컬 시험) ─────────────────────────────────────

function fakeSavedReplyOutput(clusters: ReadonlyArray<{ replies: ReadonlyArray<{ question: string; reply: string }> }>): unknown {
  return {
    candidates: clusters.map((cluster, index) => {
      const question = cluster.replies[0]?.question.slice(0, 120) ?? "";
      const body = (cluster.replies[0]?.reply ?? "").slice(0, 600);
      return {
        index,
        skip: false,
        title: { ko: `자주 묻는 질문 ${index + 1}`, ja: `よくある質問 ${index + 1}`, en: `Frequent question ${index + 1}` },
        question: { ko: question, ja: question, en: question },
        body: { ko: body, ja: body, en: body },
        note: { ko: "", ja: "", en: "" },
      };
    }),
  };
}

const FAKE_FIELD_WORDS: Record<CandidateField, RegExp> = {
  checkIn: /체크인|check-?in|チェックイン/i,
  checkOut: /체크아웃|check-?out|チェックアウト/i,
  luggage: /짐|luggage|荷物/i,
  parking: /주차|parking|駐車/i,
  trash: /쓰레기|trash|garbage|ゴミ/i,
  directions: /역에서|station|駅から/i,
};

function fakeGuestInfoOutput(replies: ReadonlyArray<{ text: string }>, fields: readonly CandidateField[]): unknown {
  return {
    fields: fields.flatMap((field) => {
      const support = replies.flatMap((reply, index) => (FAKE_FIELD_WORDS[field].test(reply.text) ? [index] : []));
      if (support.length === 0) return [];
      const sentence = (replies[support[0]].text.split(/(?<=[.!?。！？\n])/).find((part) => FAKE_FIELD_WORDS[field].test(part)) ?? "").trim().slice(0, 110);
      if (!sentence) return [];
      return [{ field, options: [{ value: { ko: sentence, ja: sentence, en: sentence }, support }] }];
    }),
  };
}

// ── 뽑기 ──────────────────────────────────────────────────────────────────────

type PairSample = { id: string; conversationId: string; property: string | null; askedAt: string; vector: number[] };
type RecentReply = { conversationId: string; property: string | null; askedAt: string; question: string; reply: string };

const PAGE = 1000;

async function loadSample(db: Client, organizationId: string, since: string): Promise<PairSample[]> {
  const out: PairSample[] = [];
  // 읽은 줄 수(`from`)로 돈다 — 뜻 숫자가 깨진 줄이 섞여도 범위가 거꾸로(range(2000, 1499)) 되지 않게.
  for (let from = 0; from < CANDIDATE_RULES.sampleSize; from += PAGE) {
    const to = Math.min(from + PAGE, CANDIDATE_RULES.sampleSize) - 1;
    const { data, error } = await db
      .from("guest_reply_pairs")
      .select("id, conversation_id, property_name, asked_at, embedding")
      .eq("organization_id", organizationId)
      .gte("asked_at", since)
      .not("embedding", "is", null)
      .not("reply_text", "is", null)
      .order("asked_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(`pair sample read failed: ${error.code ?? "unknown"}`);
    const rows = (data ?? []) as Array<{ id: string; conversation_id: string; property_name: string | null; asked_at: string; embedding: unknown }>;
    for (const row of rows) {
      const vector = parseVector(row.embedding);
      if (vector) out.push({ id: row.id, conversationId: row.conversation_id, property: row.property_name, askedAt: row.asked_at, vector });
    }
    if (rows.length < to - from + 1) break;
  }
  return out;
}

async function countReplies(db: Client, organizationId: string, since: string): Promise<number> {
  const { count, error } = await db
    .from("guest_reply_pairs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("asked_at", since)
    .not("reply_text", "is", null);
  if (error) throw new Error(`pair count failed: ${error.code ?? "unknown"}`);
  return count ?? 0;
}

async function guestNamesFor(db: Client, organizationId: string, conversationIds: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(conversationIds)];
  for (let start = 0; start < unique.length; start += 200) {
    const { data, error } = await db
      .from("guest_conversations")
      .select("id, guest_name")
      .eq("organization_id", organizationId)
      .in("id", unique.slice(start, start + 200));
    if (error) throw new Error(`guest names read failed: ${error.code ?? "unknown"}`);
    for (const row of (data ?? []) as Array<{ id: string; guest_name: string | null }>) if (row.guest_name) names.set(row.id, row.guest_name);
  }
  return names;
}

function clipChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

type Masker = {
  secrets: readonly string[];
  reply: (text: string, property: string | null, guestName: string | undefined) => string;
  question: (text: string, property: string | null, guestName: string | undefined) => string;
};

/** 가리기 — 조직 전체 비밀(다른 건물 코드가 섞여 있을 수 있다) + 그 대화 손님 이름 + 숫자 · 주소 · 연락처(`maskPastReply`). */
export function makeMasker(buildings: readonly BuildingGuestInfo[]): Masker {
  const byName = new Map(buildings.map((building) => [building.canonicalName, secretsOf(building)]));
  const all = [...new Set(buildings.flatMap((building) => secretsOf(building)))];
  // 다른 건물 코드가 섞여 있을 수 있어 조직 전체 비밀을 모두 가린다(건물 것만으로는 부족).
  const codesFor = (property: string | null) => [...new Set([...(property ? (byName.get(property) ?? []) : []), ...all])];
  return {
    secrets: all,
    reply: (text, property, guestName) => maskPastReply(text, codesFor(property), [guestName]),
    question: (text, property, guestName) => maskQuestion(text, codesFor(property), [guestName]),
  };
}

/** 근거로 저장하는 과거 답 — 이미 가린 글을 한 번 더 보고(비밀 문장은 통째로 `[…]`) 200자로 자른다. */
function evidenceText(maskedReply: string, masker: Masker): string {
  return clipChars(scrubSecretSentences(maskedReply, masker.secrets), 200);
}

type RunTotals = { inputTokens: number; outputTokens: number; costMicroUsd: number; failedCalls: number; unavailable: boolean };

function addUsage(totals: RunTotals, call: JsonCall) {
  totals.inputTokens += call.inputTokens;
  totals.outputTokens += call.outputTokens;
  totals.costMicroUsd += call.costMicroUsd;
  if (!call.ok) {
    totals.failedCalls += 1;
    if (call.reason === "unavailable") totals.unavailable = true;
  }
}

/** 비용 한도 — 실행마다 먼저 잡은 값 안에서만 부른다(다음 호출이 넘칠 것 같으면 그만). */
function budgetLeft(totals: RunTotals): boolean {
  return totals.costMicroUsd + GUEST_AI_CONFIG.draftReserveMicroUsd * 2 <= CANDIDATE_RULES.runReserveMicroUsd;
}

async function extractSavedReplies(
  db: Client,
  organizationId: string,
  runId: string,
  since: string,
  sample: readonly PairSample[],
  masker: Masker,
  totals: RunTotals,
): Promise<number> {
  const [savedReplies, remembered] = await Promise.all([
    loadSavedReplies(db, organizationId),
    db.from("guest_reply_candidates").select("centroid").eq("organization_id", organizationId).eq("kind", "saved_reply").neq("status", "pending"),
  ]);
  if (remembered.error) throw new Error(`remembered read failed: ${remembered.error.code ?? "unknown"}`);
  const rememberedVectors = ((remembered.data ?? []) as Array<{ centroid: unknown }>).flatMap((row) => {
    const vector = parseVector(row.centroid);
    return vector ? [vector] : [];
  });
  const savedVectors = await savedReplyVectors(db, organizationId, savedReplies);

  const clusters = greedyClusters(
    sample.map((pair) => pair.vector),
    { maxDistance: CANDIDATE_RULES.clusterMaxDistance, minSize: CANDIDATE_RULES.clusterMinSample, max: CANDIDATE_RULES.maxSavedReplyCandidates * 2 },
  );

  type Ready = { centroid: number[]; stats: { count: number; firstAt: string | null; lastAt: string | null }; similarId: string | null; replies: RecentReply[] };
  const ready: Ready[] = [];
  for (const cluster of clusters) {
    if (ready.length >= CANDIDATE_RULES.maxSavedReplyCandidates) break;
    const centroid = centroidOf(cluster.members.map((index) => sample[index].vector));
    if (isRemembered(centroid, rememberedVectors, CANDIDATE_RULES.rememberSimilarity)) continue;
    let best: { id: string; similarity: number } | null = null;
    for (const [id, vector] of savedVectors) {
      const similarity = cosineOf(centroid, vector);
      if (!best || similarity > best.similarity) best = { id, similarity };
    }
    if (best && best.similarity >= CANDIDATE_RULES.savedReplySkipSimilarity) continue;
    const literal = toVectorLiteral(centroid);
    const [stats, recent] = await Promise.all([
      db.rpc("guest_reply_cluster_stats", {
        p_organization_id: organizationId,
        p_centroid: literal,
        p_max_distance: CANDIDATE_RULES.clusterMaxDistance,
        p_since: since,
      }),
      db.rpc("guest_reply_cluster_recent", {
        p_organization_id: organizationId,
        p_centroid: literal,
        p_max_distance: CANDIDATE_RULES.clusterMaxDistance,
        p_since: since,
        p_limit: CANDIDATE_RULES.repliesPerCluster,
      }),
    ]);
    if (stats.error || recent.error) throw new Error("cluster read failed");
    const stat = (stats.data ?? [])[0];
    const count = Number(stat?.ask_count ?? 0);
    if (count < CANDIDATE_RULES.minAskCount) continue;
    ready.push({
      centroid,
      stats: { count, firstAt: stat?.first_at ?? null, lastAt: stat?.last_at ?? null },
      similarId: best && best.similarity >= CANDIDATE_RULES.savedReplyHintSimilarity ? best.id : null,
      replies: (recent.data ?? []).map((row) => ({
        conversationId: row.conversation_id,
        property: row.property_name,
        askedAt: row.asked_at,
        question: row.question_text,
        reply: row.reply_text ?? "",
      })),
    });
  }
  if (ready.length === 0) return 0;

  const names = await guestNamesFor(db, organizationId, ready.flatMap((item) => item.replies.map((reply) => reply.conversationId)));
  const masked = ready.map((item) => ({
    ...item,
    replies: item.replies.map((reply) => {
      const guestName = names.get(reply.conversationId);
      return {
        ...reply,
        question: clipChars(masker.question(reply.question, reply.property, guestName), 300),
        reply: clipChars(masker.reply(reply.reply, reply.property, guestName), CANDIDATE_RULES.replyClipChars),
      };
    }),
  }));

  const batches: Array<typeof masked> = [];
  for (let start = 0; start < masked.length; start += CANDIDATE_RULES.clustersPerCall) batches.push(masked.slice(start, start + CANDIDATE_RULES.clustersPerCall));

  let made = 0;
  await eachLimited(batches, 3, async (batch) => {
    if (!budgetLeft(totals)) return;
    const user = batch
      .map((item, index) =>
        [
          `## Group ${index} — asked ${item.stats.count} times, last ${tokyoDateOf(item.stats.lastAt) ?? "?"}`,
          ...item.replies.map((reply, n) => `${n + 1}. [${tokyoDateOf(reply.askedAt) ?? "?"}] Guest: ${reply.question}\n   Staff: ${reply.reply}`),
        ].join("\n"),
      )
      .join("\n\n");
    let parsed: unknown;
    if (isGuestAiFake()) parsed = fakeSavedReplyOutput(batch);
    else {
      const call = await callJsonModel(SAVED_REPLY_SYSTEM, user, SAVED_REPLY_SCHEMA, 6000);
      addUsage(totals, call);
      if (!call.ok) return;
      parsed = call.parsed;
    }
    const rows: CandidateInsert[] = [];
    for (const draft of validateSavedReplyOutput(parsed, batch.length)) {
      if (draft.skip) continue;
      const texts = [draft.title, draft.question, draft.body, draft.note].flatMap((value) => GUEST_LANGS.map((lang) => value[lang]));
      if (anySecretLike(texts, masker.secrets, { wifi: true })) continue;
      const item = batch[draft.index];
      rows.push({
        organization_id: organizationId,
        run_id: runId,
        kind: "saved_reply",
        title: draft.title as unknown as Json,
        question: draft.question as unknown as Json,
        bodies: draft.body as unknown as Json,
        note: draft.note as unknown as Json,
        ask_count: item.stats.count,
        first_asked_at: item.stats.firstAt,
        last_asked_at: item.stats.lastAt,
        evidence: item.replies
          .slice(0, CANDIDATE_RULES.evidencePerCandidate)
          .map((reply) => ({ at: reply.askedAt, property: reply.property, lang: detectLang(reply.reply), text: evidenceText(reply.reply, masker) })) as unknown as Json,
        centroid: toVectorLiteral(item.centroid),
        similar_saved_reply_id: item.similarId,
      });
    }
    if (rows.length === 0) return;
    const inserted = await db.from("guest_reply_candidates").insert(rows);
    if (inserted.error) throw new Error(`candidate insert failed: ${inserted.error.code ?? "unknown"}`);
    made += rows.length;
  });
  return made;
}

function fieldFilled(info: BuildingGuestInfo, field: CandidateField): boolean {
  const value = info.guestInfo[field];
  return GUEST_LANGS.some((lang) => value[lang].trim().length > 0);
}

async function extractGuestInfo(
  db: Client,
  organizationId: string,
  runId: string,
  since: string,
  buildings: readonly BuildingGuestInfo[],
  masker: Masker,
  totals: RunTotals,
  notes: SkipNote[],
): Promise<number> {
  const remembered = await db
    .from("guest_reply_candidates")
    .select("property_name, field, value_hashes")
    .eq("organization_id", organizationId)
    .eq("kind", "guest_info")
    .neq("status", "pending");
  if (remembered.error) throw new Error(`remembered read failed: ${remembered.error.code ?? "unknown"}`);
  const seen = new Map<string, Set<string>>();
  for (const row of (remembered.data ?? []) as Array<{ property_name: string | null; field: string | null; value_hashes: string[] }>) {
    const key = `${row.property_name}|${row.field}`;
    const set = seen.get(key) ?? new Set<string>();
    for (const hash of row.value_hashes ?? []) set.add(hash);
    seen.set(key, set);
  }

  let made = 0;
  await eachLimited(buildings, 4, async (building) => {
    const property = building.canonicalName;
    const open = CANDIDATE_FIELDS.filter((field) => !fieldFilled(building, field));
    for (const field of CANDIDATE_FIELDS) if (!open.includes(field)) notes.push({ property, field, reason: "filled", count: 0 });
    if (open.length === 0 || !budgetLeft(totals)) return;

    const { data, error } = await db
      .from("guest_reply_pairs")
      .select("id, conversation_id, asked_at, reply_text")
      .eq("organization_id", organizationId)
      .eq("property_name", property)
      .gte("asked_at", since)
      .not("reply_text", "is", null)
      .order("asked_at", { ascending: false })
      .limit(CANDIDATE_RULES.repliesPerBuilding);
    if (error) throw new Error(`building replies read failed: ${error.code ?? "unknown"}`);
    const rows = (data ?? []) as Array<{ id: string; conversation_id: string; asked_at: string; reply_text: string | null }>;
    if (rows.length < CANDIDATE_RULES.minFieldSupport) {
      for (const field of open) notes.push({ property, field, reason: "few", count: rows.length });
      return;
    }
    const names = await guestNamesFor(db, organizationId, rows.map((row) => row.conversation_id));
    const replies = rows.map((row) => ({
      id: row.id,
      at: row.asked_at,
      text: clipChars(masker.reply(row.reply_text ?? "", property, names.get(row.conversation_id)), CANDIDATE_RULES.replyClipChars),
    }));
    const user = [
      `Fields to look for: ${open.join(", ")}`,
      "Staff replies, newest first:",
      ...replies.map((reply, index) => `${index}. [${tokyoDateOf(reply.at) ?? "?"}] ${reply.text}`),
    ].join("\n");
    let parsed: unknown;
    if (isGuestAiFake()) parsed = fakeGuestInfoOutput(replies, open);
    else {
      const call = await callJsonModel(GUEST_INFO_SYSTEM, user, GUEST_INFO_SCHEMA, 4000);
      addUsage(totals, call);
      if (!call.ok) return;
      parsed = call.parsed;
    }
    const drafts = validateGuestInfoOutput(parsed, replies.length, open);
    const inserts: CandidateInsert[] = [];
    for (const field of open) {
      const draft = drafts.find((item) => item.field === field);
      const rememberedHashes = seen.get(`${property}|${field}`) ?? new Set<string>();
      const safe = (draft?.options ?? []).filter((option) => {
        const texts = GUEST_LANGS.map((lang) => option.value[lang]);
        if (anySecretLike(texts, masker.secrets, { wifi: true })) return false;
        // 손님에게 그대로 나가는 칸 — 숫자가 없어도 비밀 낱말이 있으면 버린다(「비밀번호는 sakura」).
        if (texts.some(mentionsSecretWord)) return false;
        return !valueHashesOf(option.value).some((hash) => rememberedHashes.has(hash));
      });
      const options = mergeOptions(safe.map((option) => ({ value: option.value, support: option.support.map((index) => ({ id: replies[index].id, at: replies[index].at })) })));
      const support = new Set(safe.flatMap((option) => option.support));
      if (options.length === 0 || support.size < CANDIDATE_RULES.minFieldSupport) {
        notes.push({ property, field, reason: "few", count: support.size });
        continue;
      }
      const firstSupport = safe.find((option) => valueHashesOf(option.value).some((hash) => valueHashesOf(options[0].value).includes(hash)))?.support ?? [];
      const evidence = [...firstSupport]
        .sort((a, b) => (replies[a].at < replies[b].at ? 1 : -1))
        .slice(0, CANDIDATE_RULES.evidencePerCandidate)
        .map((index) => ({ at: replies[index].at, property, lang: detectLang(replies[index].text), text: evidenceText(replies[index].text, masker) }));
      const ats = options.flatMap((option) => [option.firstAt, option.lastAt]).filter(Boolean).sort();
      inserts.push({
        organization_id: organizationId,
        run_id: runId,
        kind: "guest_info",
        property_name: property,
        field,
        options: options as unknown as Json,
        value_hashes: [...new Set(options.flatMap((option) => valueHashesOf(option.value)))],
        ask_count: support.size,
        first_asked_at: ats[0] ?? null,
        last_asked_at: ats[ats.length - 1] ?? null,
        evidence: evidence as unknown as Json,
      });
    }
    if (inserts.length === 0) return;
    const inserted = await db.from("guest_reply_candidates").insert(inserts);
    if (inserted.error) throw new Error(`candidate insert failed: ${inserted.error.code ?? "unknown"}`);
    made += inserts.length;
  });
  return made;
}

/**
 * 실행 하나 — `after()` 안에서 돈다. 새 후보를 **먼저 다 넣고**, 성공으로 끝났을 때만 예전 남은(pending) 후보를 지운다
 * (실패하면 예전 것은 그대로 두고 이번 실행이 넣은 것만 지운다 — 줄이 0 으로 비지 않게). 넣은 · 뺀 줄은 기억으로 남긴다.
 * 문구 · 건물 두 쪽은 둘 다 끝날 때까지 기다린 뒤(`allSettled`) 실행 줄을 닫는다 — 한쪽이 실패해도 다른 쪽 비용까지 합쳐 정산.
 * 그 사이 시작 함수가 멈춤(stale)으로 닫았으면 그 줄에 실제 쓴 값을 적고, 이번 실행 후보는 지운다.
 */
export async function runCandidateExtraction(db: Client, organizationId: string, runId: string, now = new Date()): Promise<void> {
  const totals: RunTotals = { inputTokens: 0, outputTokens: 0, costMicroUsd: 0, failedCalls: 0, unavailable: false };
  const notes: SkipNote[] = [];
  const since = tokyoMonthsAgoStart(now, CANDIDATE_RULES.sourceMonths);
  const usage = () => ({
    model: isGuestAiFake() ? "fake" : GUEST_AI_CONFIG.draftModel,
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    cost_micro_usd: totals.costMicroUsd,
  });
  /** 닫기 — 아직 running 이면 true. 멈춤으로 이미 닫혔으면 그 줄에 실제 비용만 적고 false. */
  const finish = async (patch: { status: "done" | "failed"; error_key?: string | null; source_count?: number }): Promise<boolean> => {
    const { data, error } = await db
      .from("guest_reply_candidate_runs")
      .update({
        status: patch.status,
        error_key: patch.error_key ?? null,
        finished_at: new Date().toISOString(),
        source_count: patch.source_count ?? 0,
        source_since: since,
        source_until: now.toISOString(),
        skip_notes: notes as unknown as Json,
        ...usage(),
      })
      .eq("organization_id", organizationId)
      .eq("id", runId)
      .eq("status", "running")
      .select("id");
    if (error) {
      console.error("[guest-candidates] run finish failed", { code: error.code });
      return false;
    }
    if ((data ?? []).length > 0) return true;
    const settled = await db
      .from("guest_reply_candidate_runs")
      .update(usage())
      .eq("organization_id", organizationId)
      .eq("id", runId)
      .eq("error_key", "stale");
    if (settled.error) console.error("[guest-candidates] stale settle failed", { code: settled.error.code });
    return false;
  };
  const dropOwn = async () => {
    const { error } = await db.from("guest_reply_candidates").delete().eq("organization_id", organizationId).eq("run_id", runId).eq("status", "pending");
    if (error) console.error("[guest-candidates] own pending drop failed", { code: error.code });
  };
  const dropOld = async (ids: readonly string[]) => {
    for (let start = 0; start < ids.length; start += 200) {
      const { error } = await db
        .from("guest_reply_candidates")
        .delete()
        .eq("organization_id", organizationId)
        .eq("status", "pending")
        .in("id", ids.slice(start, start + 200));
      if (error) console.error("[guest-candidates] old pending clear failed", { code: error.code });
    }
  };

  let sourceCount = 0;
  try {
    const [count, sample, buildings, old] = await Promise.all([
      countReplies(db, organizationId, since),
      loadSample(db, organizationId, since),
      loadBuildingGuestInfos(db, organizationId),
      db.from("guest_reply_candidates").select("id").eq("organization_id", organizationId).eq("status", "pending"),
    ]);
    sourceCount = count;
    if (old.error) throw new Error(`pending read failed: ${old.error.code ?? "unknown"}`);
    const oldIds = ((old.data ?? []) as Array<{ id: string }>).map((row) => row.id);
    const masker = makeMasker(buildings);
    const [saved, info] = await Promise.allSettled([
      extractSavedReplies(db, organizationId, runId, since, sample, masker, totals),
      extractGuestInfo(db, organizationId, runId, since, buildings, masker, totals, notes),
    ]);
    if (saved.status === "rejected" || info.status === "rejected") {
      const reason = saved.status === "rejected" ? saved.reason : info.status === "rejected" ? info.reason : null;
      throw reason instanceof Error ? reason : new Error("extract failed");
    }
    const made = saved.value + info.value;
    if (made === 0 && (totals.unavailable || totals.failedCalls > 0)) {
      await dropOwn();
      await finish({ status: "failed", error_key: totals.unavailable ? "unavailable" : "failed", source_count: sourceCount });
      return;
    }
    if (await finish({ status: "done", source_count: sourceCount })) await dropOld(oldIds);
    else await dropOwn();
  } catch (error) {
    console.error("[guest-candidates] run failed", error instanceof Error ? error.message : "unknown");
    await dropOwn();
    await finish({ status: "failed", error_key: "failed", source_count: sourceCount });
  }
}

// ── 결정 ──────────────────────────────────────────────────────────────────────

export type DecideResult = { ok: true; candidate: CandidateView } | { ok: false; error: "not_found" | "invalid_input" | "too_long" | "limit" | "conflict" | "changed" | "save_failed" };

async function claim(
  db: Client,
  organizationId: string,
  id: string,
  kind: "saved_reply" | "guest_info" | null,
  from: "pending" | "added" | "dismissed",
  patch: Database["public"]["Tables"]["guest_reply_candidates"]["Update"],
): Promise<ViewRow | null> {
  let query = db.from("guest_reply_candidates").update(patch).eq("organization_id", organizationId).eq("id", id).eq("status", from);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query.select(VIEW_COLUMNS).maybeSingle();
  if (error) throw new Error(`candidate update failed: ${error.code ?? "unknown"}`);
  return (data as ViewRow | null) ?? null;
}

const BACK_TO_PENDING = { status: "pending", decided_at: null, decided_by: null, result_saved_reply_id: null, applied_previous: null } as const;

/** 문구 후보 → 정해 둔 문구(맨 아래). 먼저 후보를 잡고(두 사람이 동시에 눌러도 하나만), 만들기 실패면 되돌린다. */
export async function addSavedReplyCandidate(db: Client, organizationId: string, userId: string, id: string, input: unknown): Promise<DecideResult> {
  const checked = validateSavedReplyInput(input);
  if (!checked.ok) return { ok: false, error: checked.error === "too_long" ? "too_long" : "invalid_input" };
  const now = new Date().toISOString();
  const claimed = await claim(db, organizationId, id, "saved_reply", "pending", { status: "added", decided_at: now, decided_by: userId });
  if (!claimed) return { ok: false, error: "not_found" };
  const created = await createSavedReply(db, organizationId, userId, checked.value);
  if (!created.ok) {
    await claim(db, organizationId, id, "saved_reply", "added", BACK_TO_PENDING);
    return { ok: false, error: created.error === "limit" ? "limit" : "save_failed" };
  }
  const linked = await claim(db, organizationId, id, "saved_reply", "added", { result_saved_reply_id: created.reply.id });
  return { ok: true, candidate: toView(linked ?? { ...claimed, result_saved_reply_id: created.reply.id }) };
}

/** 추가 되돌리기 — 방금 만든 문구를 지우고 후보를 남은 것으로. 그 사이 문구 글을 고쳤으면 지우지 않고 `changed`. */
export async function undoAddSavedReplyCandidate(db: Client, organizationId: string, id: string): Promise<DecideResult> {
  const { data, error } = await db
    .from("guest_reply_candidates")
    .select("result_saved_reply_id")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .eq("kind", "saved_reply")
    .eq("status", "added")
    .maybeSingle();
  if (error) return { ok: false, error: "save_failed" };
  const replyId = (data as { result_saved_reply_id: string | null } | null)?.result_saved_reply_id;
  if (!replyId) return { ok: false, error: "not_found" };
  const current = await db
    .from("guest_message_saved_replies")
    .select("created_at, updated_at")
    .eq("organization_id", organizationId)
    .eq("id", replyId)
    .maybeSingle();
  if (current.error) return { ok: false, error: "save_failed" };
  const version = current.data as { created_at: string; updated_at: string } | null;
  if (version) {
    // 만든 뒤 글을 고쳤으면(updated_at 이 올라감) 지우지 않는다 — 시간 제한 대신 이 조건. 순서만 바꾸면 안 올라간다.
    if (Date.parse(version.updated_at) > Date.parse(version.created_at)) return { ok: false, error: "changed" };
    const removed = await db
      .from("guest_message_saved_replies")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", replyId)
      .eq("updated_at", version.updated_at)
      .select("id");
    if (removed.error) return { ok: false, error: "save_failed" };
    if ((removed.data ?? []).length === 0) return { ok: false, error: "changed" };
  }
  const back = await claim(db, organizationId, id, "saved_reply", "added", BACK_TO_PENDING);
  return back ? { ok: true, candidate: toView(back) } : { ok: false, error: "not_found" };
}

/** 빼기 — 영영 숨김(다음 「다시 찾기」에도 같은 묶음 · 같은 값은 안 뜬다). */
export async function dismissCandidate(db: Client, organizationId: string, userId: string, id: string, kind: "saved_reply" | "guest_info"): Promise<DecideResult> {
  const row = await claim(db, organizationId, id, kind, "pending", { status: "dismissed", decided_at: new Date().toISOString(), decided_by: userId });
  return row ? { ok: true, candidate: toView(row) } : { ok: false, error: "not_found" };
}

/** 빼기 되돌리기(5초 토스트 · 끝낸 것 탭). */
export async function restoreDismissedCandidate(db: Client, organizationId: string, id: string, kind: "saved_reply" | "guest_info"): Promise<DecideResult> {
  const row = await claim(db, organizationId, id, kind, "dismissed", BACK_TO_PENDING);
  return row ? { ok: true, candidate: toView(row) } : { ok: false, error: "not_found" };
}

type AppliedPrevious = { value: Localized; applied: Localized };

function sameLocalized(a: Localized, b: Localized): boolean {
  return GUEST_LANGS.every((lang) => a[lang].trim() === b[lang].trim());
}

/**
 * 건물 칸 넣기(PC 후보 화면 · 모바일 공용 — 바로 저장). 후보를 먼저 잡고, 최신 건물 안내에 그 칸만 바꿔 저장(버전 확인).
 * 이전 값을 후보 줄에 남겨 「되돌리기」가 그 칸만 돌린다.
 */
export async function applyGuestInfoCandidate(db: Client, organizationId: string, userId: string, id: string, value: unknown): Promise<DecideResult> {
  if (!value || typeof value !== "object") return { ok: false, error: "invalid_input" };
  const next = localized(value);
  if (GUEST_LANGS.every((lang) => !next[lang].trim())) return { ok: false, error: "invalid_input" };
  const { data, error } = await db
    .from("guest_reply_candidates")
    .select("property_name, field")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .eq("kind", "guest_info")
    .eq("status", "pending")
    .maybeSingle();
  if (error) return { ok: false, error: "save_failed" };
  const target = data as { property_name: string | null; field: string | null } | null;
  if (!target?.property_name || !isCandidateField(target.field)) return { ok: false, error: "not_found" };
  const field = target.field;
  const building = await loadBuildingGuestInfo(db, organizationId, target.property_name);
  if (!building) return { ok: false, error: "not_found" };
  // 뽑은 뒤 누가 그 칸을 채웠으면 덮지 않는다(화면이 최신 값을 보여 주고 다시 고르게).
  if (fieldFilled(building, field)) return { ok: false, error: "conflict" };
  const previous = building.guestInfo[field];
  const claimed = await claim(db, organizationId, id, "guest_info", "pending", {
    status: "added",
    decided_at: new Date().toISOString(),
    decided_by: userId,
    applied_previous: { value: previous, applied: next } as unknown as Json,
  });
  if (!claimed) return { ok: false, error: "not_found" };
  const saved = await saveBuildingGuestInfo(db, organizationId, {
    canonicalName: building.canonicalName,
    guestInfo: { ...building.guestInfo, [field]: next },
    expectedUpdatedAt: building.guestInfoUpdatedAt,
  });
  if (!saved.ok) {
    await claim(db, organizationId, id, "guest_info", "added", BACK_TO_PENDING);
    if (saved.error === "conflict") return { ok: false, error: "conflict" };
    return { ok: false, error: saved.error === "too_long" ? "too_long" : saved.error === "invalid_input" ? "invalid_input" : "save_failed" };
  }
  return { ok: true, candidate: toView(claimed) };
}

/** 넣기 되돌리기 — 그 칸이 아직 넣은 값 그대로일 때만 이전 값으로(그 사이 누가 고쳤으면 `changed`). */
export async function undoGuestInfoCandidate(db: Client, organizationId: string, id: string): Promise<DecideResult> {
  const { data, error } = await db
    .from("guest_reply_candidates")
    .select("property_name, field, applied_previous")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .eq("kind", "guest_info")
    .eq("status", "added")
    .maybeSingle();
  if (error) return { ok: false, error: "save_failed" };
  const row = data as { property_name: string | null; field: string | null; applied_previous: unknown } | null;
  const previous = row?.applied_previous as AppliedPrevious | null | undefined;
  if (!row?.property_name || !isCandidateField(row.field) || !previous?.value || !previous.applied) return { ok: false, error: "not_found" };
  const field = row.field;
  const building = await loadBuildingGuestInfo(db, organizationId, row.property_name);
  if (!building) return { ok: false, error: "not_found" };
  if (!sameLocalized(building.guestInfo[field], localized(previous.applied))) return { ok: false, error: "changed" };
  const saved = await saveBuildingGuestInfo(db, organizationId, {
    canonicalName: building.canonicalName,
    guestInfo: { ...building.guestInfo, [field]: localized(previous.value) },
    expectedUpdatedAt: building.guestInfoUpdatedAt,
  });
  if (!saved.ok) return { ok: false, error: saved.error === "conflict" ? "conflict" : "save_failed" };
  const back = await claim(db, organizationId, id, "guest_info", "added", BACK_TO_PENDING);
  return back ? { ok: true, candidate: toView(back) } : { ok: false, error: "not_found" };
}

/**
 * PC 건물 패널 — 「넣기」는 폼만 채우고, 패널이 저장에 성공한 뒤 이 함수로 그 후보들을 「추가함」으로 바꾼다.
 * 저장된 칸이 실제로 비어 있지 않은 후보만(폼에서 넣었다가 지운 칸은 남은 것 그대로). 되돌리기는 패널 저장 쪽 일이라 이전 값을 남기지 않는다.
 */
export async function markGuestInfoCandidatesApplied(
  db: Client,
  organizationId: string,
  userId: string,
  propertyName: string,
  ids: readonly string[],
): Promise<{ ok: true; marked: string[] } | { ok: false; error: "not_found" | "save_failed" }> {
  if (ids.length === 0) return { ok: true, marked: [] };
  const building = await loadBuildingGuestInfo(db, organizationId, propertyName);
  if (!building) return { ok: false, error: "not_found" };
  const { data, error } = await db
    .from("guest_reply_candidates")
    .select("id, field")
    .eq("organization_id", organizationId)
    .eq("kind", "guest_info")
    .eq("status", "pending")
    .eq("property_name", building.canonicalName)
    .in("id", [...ids]);
  if (error) return { ok: false, error: "save_failed" };
  const filled = ((data ?? []) as Array<{ id: string; field: string | null }>)
    .filter((row) => isCandidateField(row.field) && fieldFilled(building, row.field))
    .map((row) => row.id);
  if (filled.length === 0) return { ok: true, marked: [] };
  const updated = await db
    .from("guest_reply_candidates")
    .update({ status: "added", decided_at: new Date().toISOString(), decided_by: userId })
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .in("id", filled)
    .select("id");
  if (updated.error) return { ok: false, error: "save_failed" };
  return { ok: true, marked: ((updated.data ?? []) as Array<{ id: string }>).map((row) => row.id) };
}

export type { GuestLang };
