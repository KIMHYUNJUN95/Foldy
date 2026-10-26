#!/usr/bin/env node
/**
 * Booking.com 세부 점수 `comfort` 백필.
 *
 * 수집 코드가 `scoring` 에서 읽는 키 목록에 `comfort` 가 빠져 있어(대신 존재하지도 않는
 * `services` 를 찾고 있었다) 이미 수집된 리뷰의 `rating_breakdown.scoring` 에 쾌적함 점수가
 * 들어 있지 않다. 원본은 `raw_payload` 에 그대로 보존돼 있으므로 **Beds24 호출 없이** 복구한다.
 *
 * 재실행해도 무해하다(이미 값이 있으면 건너뛴다).
 *
 * 사용법: node scripts/dev/backfill-booking-comfort-score.js [--apply]
 *   --apply 없이 실행하면 무엇이 바뀌는지만 출력한다.
 */
const fs = require("fs");
const path = require("path");

const envLines = [];
for (const name of [".env.local", ".env"]) {
  const p = path.join(__dirname, "../..", name);
  if (fs.existsSync(p)) envLines.push(...fs.readFileSync(p, "utf8").split("\n"));
}
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = value;
}

const { createClient } = require("@supabase/supabase-js");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const APPLY = process.argv.includes("--apply");

function num(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

(async () => {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("external_reviews")
      .select("id, raw_payload, rating_breakdown")
      .eq("provider", "booking")
      .range(offset, offset + 999);
    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  console.log(`booking 리뷰 ${rows.length}건 검사`);

  const updates = [];
  let alreadyHad = 0;
  let noComfort = 0;
  for (const row of rows) {
    const scoring = row.raw_payload?.scoring;
    const comfort = scoring && typeof scoring === "object" ? num(scoring.comfort) : null;
    if (comfort === null) {
      noComfort += 1;
      continue;
    }
    const stored = row.rating_breakdown?.scoring;
    if (stored && typeof stored === "object" && num(stored.comfort) !== null) {
      alreadyHad += 1;
      continue;
    }
    updates.push({
      id: row.id,
      rating_breakdown: { scoring: { ...(stored ?? {}), comfort } },
    });
  }

  console.log(`  이미 comfort 있음   ${alreadyHad}`);
  console.log(`  원본에 comfort 없음 ${noComfort}`);
  console.log(`  복구 대상           ${updates.length}`);

  if (!APPLY) {
    console.log("\n--apply 없이 실행했습니다. 실제로 쓰려면 --apply 를 붙이세요.");
    return;
  }

  let done = 0;
  for (const update of updates) {
    const { error } = await supabase
      .from("external_reviews")
      .update({ rating_breakdown: update.rating_breakdown })
      .eq("id", update.id);
    if (error) {
      console.error(`  실패 ${update.id}: ${error.message}`);
      continue;
    }
    done += 1;
  }
  console.log(`\n복구 완료 ${done}/${updates.length}`);
})();
