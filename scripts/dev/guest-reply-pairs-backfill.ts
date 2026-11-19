/**
 * AI 답장 도우미 — 과거 질문 · 답 줄 백필(49 §8). 최근 12개월 대화에서 손님 질문 + 12시간 안 우리 첫 답을 묶어
 * 가린 뒤 뜻 숫자(Voyage)로 바꿔 `guest_reply_pairs` 에 넣는다.
 *
 * - 다시 돌려도 된다: 같은 모델 숫자 + 같은 질문 글이 이미 있으면 다시 부르지 않는다(중간에 끊겨도 이어서). 답이 새로 생겼으면 답 글만 채운다.
 * - 가리기 규칙이 늘면(예: 2026-11-18 와이파이 이름 · 비밀번호 추가) 다시 돌린다 — 이미 있는 줄도 지금 규칙으로 다시 가려
 *   글이 바뀌면 고쳐 쓴다(답 글만 바뀌면 글만, 질문 글이 바뀌면 숫자도 다시).
 * - 가짜 모드(`GUEST_AI_FAKE=1`)는 `embed_model = "fake"` 로 적는다 — 진짜 키로 돌리면 그 줄을 다시 바꾼다.
 * - 뜻 숫자는 128개씩 묶어 부르고, 저장은 16개씩 넣는다(시간 초과면 반으로 나눠 다시). `--dry-run` 은 세기만(외부 호출 · 쓰기 없음).
 * - `.env` 를 읽지 않는다(운영 값이 들어 있다). 환경 변수를 직접 넘긴다. 로컬(127.0.0.1 · localhost)이 아니면
 *   `--allow-remote` 없이는 멈춘다 — 운영에 돌리는 것은 「배포」라 사용자 허락이 먼저다.
 *
 * - `server-only` 를 쓰는 모듈을 읽으므로 Next 밖에서는 빈 `server-only` 를 `NODE_PATH` 로 준다(ops-metrics-legacy-compare.ts 와 같은 방법).
 *
 * ```bash
 * mkdir -p /tmp/shim/server-only && echo '{"main":"i.js"}' > /tmp/shim/server-only/package.json && touch /tmp/shim/server-only/i.js
 * NODE_PATH=/tmp/shim NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<port> SUPABASE_SERVICE_ROLE_KEY=<로컬 키> GUEST_AI_FAKE=1 \
 *   npx tsx scripts/dev/guest-reply-pairs-backfill.ts [--org <uuid>] [--dry-run]
 * ```
 */
import { createClient } from "@supabase/supabase-js";
import {
  maskPastReply,
  maskQuestion,
  assistTextOf,
  pairQuestions,
  toVectorLiteral,
  tokyoMonthsAgoStart,
  type ThreadMessage,
} from "@/lib/guest-messages/ai-assist-model";
import { canonicalPropertyName, embedTexts, secretsOf } from "@/lib/guest-messages/ai-assist-server";
import { GUEST_AI_CONFIG, activeEmbedModel, hasVoyageKey } from "@/lib/guest-messages/ai-config";
import { loadBuildingGuestInfo } from "@/lib/guest-messages/guest-info-server";
import type { Database } from "@/types/database";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allowRemote = args.includes("--allow-remote");
const orgArg = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost"].includes(host) && !allowRemote) {
  console.error("로컬 DB 가 아닙니다 — 운영에 돌리려면 사용자 허락 뒤 --allow-remote 를 붙이세요.");
  process.exit(1);
}
if (!dryRun && !hasVoyageKey()) {
  console.error("VOYAGE_API_KEY(또는 로컬 시험용 GUEST_AI_FAKE=1)가 필요합니다.");
  process.exit(1);
}

const db = createClient<Database>(url, key, { auth: { persistSession: false } });
const since = tokyoMonthsAgoStart(new Date(), GUEST_AI_CONFIG.similarMonths);

type Conversation = { id: string; organization_id: string; property_name: string | null; guest_name: string | null };
type PendingPair = {
  organization_id: string;
  question_message_id: string;
  conversation_id: string;
  property_name: string | null;
  asked_at: string;
  question_text: string;
  reply_message_id: string | null;
  reply_text: string | null;
};

const codeCache = new Map<string, string[]>();
async function codesFor(organizationId: string, propertyName: string | null): Promise<string[]> {
  const cacheKey = `${organizationId}:${propertyName ?? ""}`;
  const cached = codeCache.get(cacheKey);
  if (cached) return cached;
  const codes = secretsOf(await loadBuildingGuestInfo(db, organizationId, propertyName));
  codeCache.set(cacheKey, codes);
  return codes;
}

const stats = { conversations: 0, questions: 0, skipped: 0, remasked: 0, written: 0, failedBatches: 0 };
let batch: PendingPair[] = [];

async function flush() {
  if (batch.length === 0) return;
  const part = batch;
  batch = [];
  if (dryRun) {
    stats.written += part.length;
    return;
  }
  const vectors = await embedTexts(part.map((pair) => pair.question_text), "query");
  if (!vectors) {
    stats.failedBatches += 1;
    console.error(`  임베딩 실패 — ${part.length}개 건너뜀(다시 돌리면 이어서)`);
    return;
  }
  const now = new Date().toISOString();
  const rows = part.map((pair, index) => ({
    ...pair,
    embedding: toVectorLiteral(vectors[index]),
    embed_model: activeEmbedModel(),
    updated_at: now,
  }));
  for (let start = 0; start < rows.length; start += SAVE_CHUNK) {
    await saveRows(rows.slice(start, start + SAVE_CHUNK));
  }
}

/**
 * 저장은 작은 묶음으로 — 벡터 색인(HNSW)이 커지면 한 번에 많이 넣을 때 서버 시간 제한(57014)에 걸린다
 * (2026-11-19, 2만여 줄 위에서 128개 묶음이 두 번 다 실패). 시간 초과면 반으로 나눠 다시, 1개도 실패하면 건너뛴다.
 */
const SAVE_CHUNK = 16;

async function saveRows(rows: Database["public"]["Tables"]["guest_reply_pairs"]["Insert"][]): Promise<void> {
  const { error } = await db.from("guest_reply_pairs").upsert(rows, { onConflict: "question_message_id" });
  if (!error) {
    stats.written += rows.length;
    return;
  }
  if (error.code === "57014" && rows.length > 1) {
    const half = Math.ceil(rows.length / 2);
    await saveRows(rows.slice(0, half));
    await saveRows(rows.slice(half));
    return;
  }
  stats.failedBatches += 1;
  console.error(`  저장 실패(${error.code ?? "unknown"}) — ${rows.length}개(다시 돌리면 이어서)`);
}

async function processConversation(conversation: Conversation) {
  const { data, error } = await db
    .from("guest_messages")
    .select("id, direction, body, sent_at")
    .eq("organization_id", conversation.organization_id)
    .eq("conversation_id", conversation.id)
    .in("direction", ["guest", "host"])
    .gte("sent_at", since)
    .order("sent_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(`messages read failed: ${error.code ?? "unknown"}`);
  const pairs = pairQuestions((data ?? []) as ThreadMessage[]);
  if (pairs.length === 0) return;
  stats.questions += pairs.length;

  const existing = await db
    .from("guest_reply_pairs")
    .select("id, question_message_id, embed_model, question_text, reply_text")
    .eq("organization_id", conversation.organization_id)
    .eq("conversation_id", conversation.id);
  if (existing.error) throw new Error(`pairs read failed: ${existing.error.code ?? "unknown"}`);
  const done = new Map(
    (existing.data ?? [])
      .filter((row) => row.embed_model === activeEmbedModel())
      .map((row) => [row.question_message_id, row] as const),
  );

  const codes = await codesFor(conversation.organization_id, conversation.property_name);
  for (const { question, reply } of pairs) {
    const replyText = reply ? assistTextOf(reply.body) : "";
    const pair: PendingPair = {
      organization_id: conversation.organization_id,
      question_message_id: question.id,
      conversation_id: conversation.id,
      property_name: canonicalPropertyName(conversation.property_name),
      asked_at: question.sent_at,
      question_text: maskQuestion(assistTextOf(question.body), codes, [conversation.guest_name]),
      reply_message_id: reply?.id ?? null,
      reply_text: replyText ? maskPastReply(replyText, codes, [conversation.guest_name]) : null,
    };
    const stored = done.get(question.id);
    // 이미 숫자가 있는 줄: 질문 글이 같으면 다시 부르지 않고, 가리기 규칙이 늘어 글이 바뀌었으면 글만 고쳐 쓴다(질문 글이 바뀌면 숫자도 다시).
    if (stored && stored.question_text === pair.question_text) {
      if (stored.reply_text !== pair.reply_text && pair.reply_text !== null) {
        stats.remasked += 1;
        if (!dryRun) {
          const { error: updateError } = await db
            .from("guest_reply_pairs")
            .update({ reply_text: pair.reply_text, property_name: pair.property_name, updated_at: new Date().toISOString() })
            .eq("organization_id", conversation.organization_id)
            .eq("id", stored.id);
          if (updateError) console.error(`  다시 가리기 실패(${updateError.code ?? "unknown"})`);
        }
      } else {
        stats.skipped += 1;
      }
      continue;
    }
    batch.push(pair);
    if (batch.length >= GUEST_AI_CONFIG.embedBatch) await flush();
  }
}

async function main() {
  console.log(`백필 시작 — ${dryRun ? "세기만(--dry-run)" : "쓰기"} · ${since.slice(0, 10)} 부터 · 조직 ${orgArg ?? "전부"}`);
  const PAGE = 200;
  for (let from = 0; ; from += PAGE) {
    let query = db
      .from("guest_conversations")
      .select("id, organization_id, property_name, guest_name")
      .gte("last_message_at", since)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (orgArg) query = query.eq("organization_id", orgArg);
    const { data, error } = await query;
    if (error) throw new Error(`conversations read failed: ${error.code ?? "unknown"}`);
    const page = (data ?? []) as Conversation[];
    for (const conversation of page) {
      stats.conversations += 1;
      await processConversation(conversation);
    }
    if (page.length < PAGE) break;
  }
  await flush();
  console.log(
    `끝 — 대화 ${stats.conversations} · 질문 ${stats.questions} · 건너뜀 ${stats.skipped} · 다시 가림 ${stats.remasked} · ${dryRun ? "넣을 것" : "넣음"} ${stats.written} · 실패 묶음 ${stats.failedBatches}`,
  );
  if (stats.failedBatches > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error("백필 실패:", error instanceof Error ? error.message : "unknown");
  process.exit(1);
});
