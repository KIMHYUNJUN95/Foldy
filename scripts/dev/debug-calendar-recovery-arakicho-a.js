#!/usr/bin/env node
/**
 * 아라키초A 예약 막대가 /mobile/calendar 에 보이지 않을 수 있는 이유를 진단한다.
 *
 * 쿼리:
 *   1. rooms 테이블 → 아라키초A 의 활성 정규 객실 집합
 *   2. reservations 테이블 → 현재 운영 구간에서 아라키초A 의 원본 room_label 값
 *
 * 성공/실패 건수와 실패 행 샘플을 JSON 리포트로 출력한다.
 *
 * 사용법:
 *   node scripts/dev/debug-calendar-recovery-arakicho-a.js [YYYY-MM]
 *
 * 필요: .env.local 의 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// .env.local 불러오기
// ---------------------------------------------------------------------------
const envPath = path.join(__dirname, "../../.env.local");
if (!fs.existsSync(envPath)) {
  console.error("ERROR: .env.local not found at", envPath);
  process.exit(1);
}
const envLines = fs.readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (key && !(key in process.env)) {
    process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// fetch 기반 최소 Supabase REST 클라이언트 (npm import 불필요)
// ---------------------------------------------------------------------------
async function supabaseSelect(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase REST error ${res.status}: ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// 정규화 (src/lib/room-label-normalization.ts 와 동일하게 맞춤)
// ---------------------------------------------------------------------------
function normalizeKey(value) {
  return value.replace(/\s+/g, "").replace(/[_()\-]/g, "").toLowerCase();
}

function isArakichoA(name) {
  const key = normalizeKey(name);
  return ["아라키초a", "arakichoa", "荒木町a"].some((c) => key.includes(c));
}

function getCanonicalRoomLabel(propertyName, roomLabel) {
  if (!isArakichoA(propertyName)) return roomLabel.trim();
  const digits = roomLabel.trim().match(/\d{3,4}/);
  return digits ? digits[0] : roomLabel.trim();
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------
(async () => {
  // 운영 구간 (이번 달 + 다음 달, JST)
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  const targetMonthArg = process.argv[2];
  const targetMonth =
    targetMonthArg && /^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonthArg)
      ? targetMonthArg
      : jstNow.toISOString().slice(0, 7);

  const [y, m] = targetMonth.split("-").map(Number);
  const windowStart = `${targetMonth}-01`;
  const windowEnd = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);

  console.error(`[debug] Target month: ${targetMonth}, window: ${windowStart} → ${windowEnd}`);

  // 1. Active rooms for 아라키초A
  const roomsRaw = await supabaseSelect(
    "rooms",
    new URLSearchParams({
      select: "room_label,external_room_id,external_minimum_stay,external_provider,status",
      status: "eq.active",
    }).toString(),
  );

  const arakichoRooms = roomsRaw.filter((r) => {
    // external_room_id 접두사 또는 room_label 패턴으로 아라키초A 숙소에 속한 객실을 거른다
    // status=active 이고 external_minimum_stay < 50 인 모든 객실(또는 beds24 가 아닌 객실)을 확인한다
    if (r.external_provider === "beds24") {
      if (r.external_minimum_stay === null) return false;
      if (r.external_minimum_stay >= 50) return false;
    }
    return true;
  });

  // 숙소 조인으로 가져와 아라키초A 로 거른다
  const roomsWithProperty = await supabaseSelect(
    "rooms",
    new URLSearchParams({
      select: "room_label,external_room_id,external_minimum_stay,external_provider,status,properties(name)",
      status: "eq.active",
    }).toString(),
  );

  const arakichoActiveRooms = roomsWithProperty.filter((r) => {
    const propName = Array.isArray(r.properties) ? r.properties[0]?.name : r.properties?.name;
    if (!propName || !isArakichoA(propName)) return false;
    if (r.external_provider === "beds24") {
      if (r.external_minimum_stay === null) return false;
      if (r.external_minimum_stay >= 50) return false;
    }
    return true;
  });

  const activeCanonicalSet = new Set(
    arakichoActiveRooms.map((r) => {
      const propName = Array.isArray(r.properties) ? r.properties[0]?.name : r.properties?.name;
      return getCanonicalRoomLabel(propName ?? "", r.room_label);
    }),
  );

  const externalRoomToCanonical = new Map(
    arakichoActiveRooms
      .filter((r) => r.external_room_id)
      .map((r) => {
        const propName = Array.isArray(r.properties) ? r.properties[0]?.name : r.properties?.name;
        return [r.external_room_id, getCanonicalRoomLabel(propName ?? "", r.room_label)];
      }),
  );

  // 2. 구간 내 예약
  const reservations = await supabaseSelect(
    "reservations",
    new URLSearchParams({
      select: "id,room_label,property_name,raw_payload,check_in_date,check_out_date",
      check_in_date: `lt.${windowEnd}`,
      check_out_date: `gte.${windowStart}`,
      status: "neq.cancelled",
    }).toString(),
  );

  const arakichoReservations = reservations.filter((r) => isArakichoA(r.property_name ?? ""));

  const results = arakichoReservations.map((r) => {
    const canonical = getCanonicalRoomLabel("아라키초A", r.room_label ?? "");
    const directMatch = activeCanonicalSet.has(canonical);

    let externalId = null;
    if (r.raw_payload && typeof r.raw_payload === "object" && !Array.isArray(r.raw_payload)) {
      for (const key of ["unitId", "unit_id", "roomId", "room_id"]) {
        const val = r.raw_payload[key];
        if (val !== undefined && val !== null) {
          externalId = String(val);
          break;
        }
      }
    }
    const globalMatch = externalId ? externalRoomToCanonical.get(externalId) ?? null : null;

    return {
      id: r.id,
      rawRoomLabel: r.room_label,
      canonicalRoomLabel: canonical,
      externalId,
      directMatch,
      globalMatch,
      recovered: directMatch || !!globalMatch,
    };
  });

  const succeeded = results.filter((r) => r.recovered);
  const failed = results.filter((r) => !r.recovered);

  console.log(
    JSON.stringify(
      {
        targetMonth,
        window: { start: windowStart, end: windowEnd },
        activeCanonicalRoomSet: [...activeCanonicalSet],
        externalRoomToCanonical: Object.fromEntries(externalRoomToCanonical),
        totalReservations: arakichoReservations.length,
        succeeded: succeeded.length,
        failed: failed.length,
        failedSamples: failed.slice(0, 10),
        succeededSamples: succeeded.slice(0, 5).map((r) => ({
          rawRoomLabel: r.rawRoomLabel,
          canonicalRoomLabel: r.canonicalRoomLabel,
          directMatch: r.directMatch,
          globalMatch: r.globalMatch,
        })),
      },
      null,
      2,
    ),
  );
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
