/**
 * 손님 메시지함 시험 데이터 (2단계 화면 확인용, docs/product/47-guest-messaging.md 「시험 데이터」).
 *
 * 한 조직에 가상 대화 8개를 넣는다 — Airbnb · Booking.com · 직접 예약 · 문의(inquiry) · 숙박 중 · 목표 넘음 ·
 * 나중에 · 처리 끝 · 내부 메모 · 보내지 못한 답장(발송 큐 failed). 손님 이름 · 글은 모두 가상값이다. Beds24 는 부르지 않는다.
 *
 * **운영 프로젝트(sspdgzkytkpmquqsfaup)에는 절대 돌지 않는다** — 주소에 그 ref 가 있으면 바로 멈춘다.
 * 로컬 Supabase 나 시험 프로젝트에서만 쓴다.
 *
 * 사용:
 *   node scripts/dev/seed-guest-messages.mjs --org <조직 uuid>            # 계획만 출력 (DB 를 건드리지 않음)
 *   node scripts/dev/seed-guest-messages.mjs --org <조직 uuid> --apply    # 넣기
 *   node scripts/dev/seed-guest-messages.mjs --org <조직 uuid> --apply --reset   # 이 스크립트가 넣은 대화(예약 번호 SEED-…)를 지우고 다시
 *
 * 필요한 환경 값: NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (.env.local 에서 읽는다 — 값은 출력하지 않는다).
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const PROD_REF = "sspdgzkytkpmquqsfaup";

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    if (!(key in process.env)) process.env[key] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};

const APPLY = flag("--apply");
const RESET = flag("--reset");
const ORG = opt("--org");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** 서비스 키가 JWT 면 안의 `ref`(프로젝트) — 주소를 바꿔 끼워도 운영 키면 멈추게. 값은 출력하지 않는다. */
function jwtRef(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}

if (url.includes(PROD_REF) || jwtRef(key) === PROD_REF) {
  console.error(`멈춤: 운영 프로젝트(${PROD_REF})에는 시험 데이터를 넣지 않는다. 로컬 · 시험 프로젝트 주소로 바꿔서 돌려 주세요.`);
  process.exit(1);
}
if (!ORG || !/^[0-9a-f-]{36}$/i.test(ORG)) {
  console.error("--org <조직 uuid> 가 필요합니다.");
  process.exit(1);
}
if (APPLY && (!url || !key)) {
  console.error("NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 가 없습니다.");
  process.exit(1);
}

const MIN = 60_000;
const now = Date.now();
const ago = (minutes) => new Date(now - minutes * MIN).toISOString();
const later = (minutes) => new Date(now + minutes * MIN).toISOString();
/** 도쿄 날짜 + n일 */
const tokyoDay = (offset) => new Date(now + 9 * 60 * MIN + offset * 24 * 60 * MIN).toISOString().slice(0, 10);

const SCENARIOS = [
  {
    ref: "SEED-AIR-1",
    channel: "airbnb",
    booking_status: "confirmed",
    guest_name: "Emma Wilson",
    guest_language: "en",
    property_name: "아라키초A",
    room_label: "101",
    check_in: tokyoDay(3),
    check_out: tokyoDay(6),
    status: "awaiting",
    messages: [
      { dir: "guest", at: 200, body: "Hi! We land at Haneda at 9pm. Is late check-in okay?" },
      { dir: "host", at: 190, body: "Of course! Self check-in works any time after 3pm." },
      { dir: "guest", at: 95, body: "Great, thanks. Is there a luggage storage before check-in? Our flight arrives early on the next trip." },
    ],
  },
  {
    ref: "SEED-BDC-1",
    channel: "booking",
    booking_status: "confirmed",
    guest_name: "田中 美咲",
    guest_language: "ja",
    property_name: "아라키초B",
    room_label: "202",
    check_in: tokyoDay(0),
    check_out: tokyoDay(2),
    status: "awaiting",
    messages: [{ dir: "guest", at: 40, body: "本日チェックインです。駐車場はありますか？" }],
  },
  {
    ref: "SEED-INQ-1",
    channel: "airbnb",
    booking_status: "inquiry",
    guest_name: "Lucas Moreau",
    guest_language: "fr",
    property_name: "아라키초A",
    room_label: "102",
    check_in: tokyoDay(20),
    check_out: tokyoDay(24),
    status: "awaiting",
    // 문의는 목표가 짧다 — 오래 기다려 「목표 넘음」.
    messages: [{ dir: "guest", at: 180, body: "Bonjour, l'appartement est-il adapté pour 4 adultes ? Merci." }],
  },
  {
    ref: "SEED-STAY-1",
    channel: "booking",
    booking_status: "confirmed",
    guest_name: "Kim Minji",
    guest_language: "ko",
    property_name: "아라키초B",
    room_label: "201",
    check_in: tokyoDay(-1),
    check_out: tokyoDay(2),
    status: "awaiting",
    messages: [
      { dir: "guest", at: 1500, body: "체크인했어요. 와이파이 비밀번호가 어디 있나요?" },
      { dir: "host", at: 1490, body: "현관 옆 카드에 있어요. 안 보이시면 말씀해 주세요." },
      { dir: "guest", at: 25, body: "수건을 조금 더 받을 수 있을까요?" },
      { dir: "internal", at: 20, body: "청소 담당에게 수건 2장 전달 부탁함" },
    ],
  },
  {
    ref: "SEED-DIR-1",
    channel: "direct",
    booking_status: "confirmed",
    guest_name: "David Chen",
    guest_language: "en",
    property_name: "아라키초A",
    room_label: "103",
    check_in: tokyoDay(5),
    check_out: tokyoDay(7),
    status: "awaiting",
    messages: [{ dir: "guest", at: 300, body: "Can I pay the city tax in cash on arrival?" }],
  },
  {
    ref: "SEED-SNZ-1",
    channel: "airbnb",
    booking_status: "confirmed",
    guest_name: "Sofia Rossi",
    guest_language: "it",
    property_name: "아라키초B",
    room_label: "203",
    check_in: tokyoDay(9),
    check_out: tokyoDay(12),
    status: "snoozed",
    snooze_minutes: 180,
    messages: [{ dir: "guest", at: 400, body: "Ciao! Is there a supermarket nearby?" }],
  },
  {
    ref: "SEED-DONE-1",
    channel: "booking",
    booking_status: "confirmed",
    guest_name: "Wang Lei",
    guest_language: "zh",
    property_name: "아라키초A",
    room_label: "101",
    check_in: tokyoDay(-5),
    check_out: tokyoDay(-2),
    status: "done",
    messages: [
      { dir: "guest", at: 4000, body: "谢谢，房间很干净！" },
      { dir: "host", at: 3990, body: "Thank you for staying with us!" },
    ],
  },
  {
    ref: "SEED-FAIL-1",
    channel: "airbnb",
    booking_status: "confirmed",
    guest_name: "Olivia Brown",
    guest_language: "en",
    property_name: "아라키초B",
    room_label: "202",
    check_in: tokyoDay(1),
    check_out: tokyoDay(3),
    status: "awaiting",
    messages: [{ dir: "guest", at: 70, body: "What's the door code?" }],
    // 보내지 못한 답장 — 발송 큐 failed(Beds24 거절) + 대기 메시지 줄.
    failedReply: { at: 60, body: "The code will be sent on the morning of check-in.", error: "provider_rejected" },
  },
];

function plan() {
  for (const s of SCENARIOS) {
    console.log(`- ${s.ref} · ${s.channel} · ${s.booking_status} · ${s.status} · 메시지 ${s.messages.length}${s.failedReply ? " + 보내지 못한 답장" : ""}`);
  }
}

async function main() {
  console.log(`대상 조직 ${ORG} · 대화 ${SCENARIOS.length}개${APPLY ? "" : " (계획만 — --apply 로 넣기)"}`);
  plan();
  if (!APPLY) return;

  const db = createClient(url, key, { auth: { persistSession: false } });
  const org = await db.from("organizations").select("id").eq("id", ORG).maybeSingle();
  if (org.error || !org.data) throw new Error("조직을 찾지 못했습니다.");

  if (RESET) {
    const removed = await db.from("guest_conversations").delete().eq("organization_id", ORG).like("provider_booking_id", "SEED-%").select("id");
    if (removed.error) throw new Error(`지우기 실패: ${removed.error.message}`);
    console.log(`지움: ${removed.data.length}개`);
  }

  for (const s of SCENARIOS) {
    const guestTimes = s.messages.filter((m) => m.dir === "guest").map((m) => m.at);
    const hostTimes = s.messages.filter((m) => m.dir === "host").map((m) => m.at);
    const lastGuest = guestTimes.length ? ago(Math.min(...guestTimes)) : null;
    const lastReply = hostTimes.length ? ago(Math.min(...hostTimes)) : null;
    const lastMessage = ago(Math.min(...s.messages.map((m) => m.at), s.failedReply?.at ?? Infinity));
    const upserted = await db
      .from("guest_conversations")
      .upsert(
        {
          organization_id: ORG,
          provider: "beds24",
          provider_booking_id: s.ref,
          property_name: s.property_name,
          room_label: s.room_label,
          channel: s.channel,
          booking_status: s.booking_status,
          check_in_date: s.check_in,
          check_out_date: s.check_out,
          guest_name: s.guest_name,
          guest_language: s.guest_language,
          status: s.status,
          snooze_until: s.status === "snoozed" ? later(s.snooze_minutes ?? 60) : null,
          last_guest_at: lastGuest,
          last_reply_at: lastReply,
          last_message_at: lastMessage,
        },
        { onConflict: "organization_id,provider,provider_booking_id" },
      )
      .select("id")
      .single();
    if (upserted.error) throw new Error(`${s.ref} 대화 넣기 실패: ${upserted.error.message}`);
    const conversationId = upserted.data.id;

    const existing = await db.from("guest_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
    if ((existing.count ?? 0) > 0) {
      console.log(`  ${s.ref}: 메시지가 이미 있어 건너뜀 (--reset 로 다시)`);
      continue;
    }
    const rows = s.messages.map((m, index) => ({
      organization_id: ORG,
      conversation_id: conversationId,
      provider: "beds24",
      external_id: m.dir === "internal" ? null : `${s.ref}-${index + 1}`,
      provider_source: m.dir === "internal" ? "internalNote" : m.dir,
      direction: m.dir,
      body: m.body,
      sent_at: ago(m.at),
    }));
    const inserted = await db.from("guest_messages").insert(rows);
    if (inserted.error) throw new Error(`${s.ref} 메시지 넣기 실패: ${inserted.error.message}`);

    if (s.failedReply) {
      const outbox = await db
        .from("guest_message_outbox")
        .insert({
          organization_id: ORG,
          conversation_id: conversationId,
          kind: "reply",
          body: s.failedReply.body,
          status: "failed",
          attempts: 1,
          error_code: s.failedReply.error,
          idempotency_key: `seed-${s.ref}`,
        })
        .select("id")
        .single();
      if (outbox.error) throw new Error(`${s.ref} 발송 큐 넣기 실패: ${outbox.error.message}`);
      const pending = await db.from("guest_messages").insert({
        organization_id: ORG,
        conversation_id: conversationId,
        provider: "beds24",
        direction: "host",
        body: s.failedReply.body,
        sent_at: ago(s.failedReply.at),
        outbox_id: outbox.data.id,
      });
      if (pending.error) throw new Error(`${s.ref} 대기 메시지 넣기 실패: ${pending.error.message}`);
    }
    console.log(`  ${s.ref}: 넣음`);
  }
  console.log("끝.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
