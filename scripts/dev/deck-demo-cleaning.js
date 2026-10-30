/**
 * 발표(데크)용 데모 — 청소 배정 · 오늘 내 방 · 청소 현황. 「Foldy Demo」 조직(slug `stayops-review-demo`)에만 넣는다.
 * 가상 데이터다 — 투숙객 이름 · 전화번호 모두 가짜. 알바는 deck-demo-roster-data.js 의 10명 + 이 조직의 기존 알바 · 직원.
 *
 * 넣는 것 (모두 오늘(도쿄) 기준 상대 날짜 — 다시 돌리면 오늘에 맞춰 새로 만든다):
 *  1. 퇴실 예약 — 어제 8 · 오늘 11 · 내일 9건 + 이번 달 나머지 날 하루 3~6건. 오늘은 일부 방이 같은 날 체크인(턴오버).
 *     예약은 방마다 겹치지 않게 이어 붙인다. source_reservation_id 가 `DECK-DEMO-` 로 시작 → 정리 때 이것만 지운다.
 *  2. 방별 필요 인원(배정 설정 「큰 방」) — 배정 담당(owner · 전무 · 현장 매니저)마다. 이미 있으면 그대로.
 *  3. 시프트 신청 · 배정 — 이번 달 전체. 오늘은 신청 9명, 방의 약 2/3 만 배정(나머지 「미배정」 → 「제안대로 넣기」 시연),
 *     어제 한 방은 배정 · 청소 없이 남겨 오늘 「어제부터 · 1일째」로 뜬다. 큰 방은 2~3명.
 *  4. 청소 세션 — 어제까지 끝남, 오늘은 일부 끝 · 일부 진행 중(타이머) · 나머지 대기. 노트 `DECK-DEMO` 가 표식.
 *
 * 사용:
 *   node scripts/dev/deck-demo-cleaning.js            # 계획만 출력 (DB 에 쓰지 않음)
 *   node scripts/dev/deck-demo-cleaning.js --apply    # 지우고(이 스크립트 것) 다시 넣기
 *   node scripts/dev/deck-demo-cleaning.js --clean    # 이 스크립트가 넣은 것만 지우기
 *
 * 안전장치: 조직 slug 가 `stayops-review-demo` 가 아니면 멈춘다. 쓰기는 전부 그 조직 id 로만. 지우는 범위 —
 *   예약: 조직 + source_reservation_id `DECK-DEMO-%` / 청소 세션: 조직 + notes `DECK-DEMO` /
 *   시프트 신청 · 배정: 표식 칸이 없어 「조직 + 이 스크립트의 사람들」(데모 알바 · 10명) 것 전부(발표 전 초기화 용도).
 *   방별 필요 인원은 지우지 않는다(표식 없음 · 해롭지 않음).
 * 건물은 `properties` 표에 의존하지 않는다 — 청소 배정은 예약의 property_name/room_label 문자열에서 방을 만든다.
 */
const { ORG_SLUG, ROSTER, connect, getDemoOrg, ensureDeckPeople, tokyoToday, addDays } = require("./deck-demo-roster");
const crypto = require("crypto");

const APPLY = process.argv.includes("--apply");
const CLEAN = process.argv.includes("--clean");
const MARK = "DECK-DEMO";
const RES_PREFIX = "DECK-DEMO-";

// ── 방 (한국어 정식 건물 이름 = 데이터. 방 키 = `건물_표시 객실`) ──────────────────────────────────────────────
// resLabel: 예약에 저장되는 라벨 · cr: 정규 객실(세션 라벨) · display: 표시 라벨(배정 room_key/room_label)
// 아라키초B 는 `Ab101`(저장) → `AB101`(정규) → `101`(표시), 가부키초 `K202` → `202`, 오쿠보A 는 단일 호실(건물 = 방).
const ROOMS = [
  { id: "a201", property: "아라키초A", resLabel: "201", cr: "201", display: "201", headcount: 1 },
  { id: "a202", property: "아라키초A", resLabel: "202", cr: "202", display: "202", headcount: 1 },
  { id: "a301", property: "아라키초A", resLabel: "301", cr: "301", display: "301", headcount: 2 },
  { id: "a302", property: "아라키초A", resLabel: "302", cr: "302", display: "302", headcount: 1 },
  { id: "a401", property: "아라키초A", resLabel: "401", cr: "401", display: "401", headcount: 3 },
  { id: "b101", property: "아라키초B", resLabel: "Ab101", cr: "AB101", display: "101", headcount: 1 },
  { id: "b102", property: "아라키초B", resLabel: "Ab102", cr: "AB102", display: "102", headcount: 1 },
  { id: "b201", property: "아라키초B", resLabel: "Ab201", cr: "AB201", display: "201", headcount: 2 },
  { id: "b202", property: "아라키초B", resLabel: "Ab202", cr: "AB202", display: "202", headcount: 1 },
  { id: "k202", property: "가부키초", resLabel: "K202", cr: "202", display: "202", headcount: 1 },
  { id: "k301", property: "가부키초", resLabel: "K301", cr: "301", display: "301", headcount: 1 },
  { id: "k302", property: "가부키초", resLabel: "K302", cr: "302", display: "302", headcount: 2 },
  { id: "t301", property: "다카다노바바", resLabel: "301", cr: "301", display: "301", headcount: 1 },
  { id: "t302", property: "다카다노바바", resLabel: "302", cr: "302", display: "302", headcount: 1 },
  { id: "t501", property: "다카다노바바", resLabel: "501", cr: "501", display: "501", headcount: 2 },
  { id: "o_a", property: "오쿠보A", resLabel: "오쿠보A", cr: "오쿠보A", display: "오쿠보A", headcount: 1 },
];
for (const r of ROOMS) {
  r.roomKey = `${r.property}_${r.display}`;
  r.sessionLabel = r.cr === r.property ? r.property : `${r.property} ${r.cr}`;
  r.assignLabel = r.display === r.property ? r.property : r.display;
  r.name = r.display === r.property ? r.property : `${r.property} ${r.display}`;
}
const ROOM_BY_ID = new Map(ROOMS.map((r) => [r.id, r]));
const roomIdx = (id) => ROOMS.findIndex((r) => r.id === id);

// 어제 · 오늘 · 내일 퇴실 방 (방 id). TURN = 오늘 퇴실하고 같은 날 체크인이 있는 방.
const OUT_YESTERDAY = ["a201", "a302", "a401", "b102", "b201", "k301", "t302", "t501"]; // 8
const OUT_TODAY = ["a201", "a202", "a301", "a401", "b101", "b102", "b202", "k202", "k301", "t301", "o_a"]; // 11
const OUT_TOMORROW = ["a202", "a302", "b101", "b201", "k202", "k302", "t302", "t501", "o_a"]; // 9
const TURN_TODAY = new Set(["a202", "a301", "a401", "b101", "k202", "t301", "o_a"]);

// ── 도우미 ──
function rngOf(seedText) {
  let a = crypto.createHash("sha256").update(seedText).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const dow = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const monthStartOf = (ymd) => `${ymd.slice(0, 7)}-01`;
function monthEndOf(ymd) {
  const [y, m] = ymd.split("-").map(Number);
  return `${ymd.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
function must(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}
async function chunked(rows, size, fn) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}
const hhmmss = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
const fmtTime = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(11, 16);

// ── 가상 투숙객 ──
const GUEST_NAMES = [
  "Emily Carter", "Liam Johnson", "Sophia Martinez", "Noah Williams", "Olivia Brown", "James Anderson", "Mia Thompson", "Lucas Garcia",
  "Hannah Schmidt", "Pierre Dubois", "Chloe Laurent", "Marco Rossi", "Anna Kowalski", "Oliver Smith", "Grace Taylor", "Daniel Lee",
  "Wei Zhang", "Mei Lin Chen", "Arjun Mehta", "Priya Nair", "Somchai Prasert", "Nguyen Minh Anh",
  "田中 太郎", "鈴木 花子", "佐藤 健", "高橋 美咲", "伊藤 大輔", "渡辺 結衣",
  "김민준", "이서윤", "박지후", "최예린", "정우진", "한소율",
];
const CHANNELS = ["Airbnb", "Booking.com", "Expedia", "Direct"];
function guestPhone(r) {
  const k = String(randInt(r, 1000, 9999));
  switch (randInt(r, 0, 3)) {
    case 0: return `+1-415-555-${String(randInt(r, 100, 199)).padStart(4, "0")}`;
    case 1: return `+44-20-7946-${k}`;
    case 2: return `+81-90-0000-${k}`;
    default: return `+82-10-0000-${k}`;
  }
}

// ── ① 예약 만들기 — 방마다 겹치지 않는 투숙 이어 붙이기 ──
function buildReservations(today, winFrom, winTo) {
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const protectedDates = new Set([yesterday, today, tomorrow]);
  const forcedOf = (id) => [
    ...(OUT_YESTERDAY.includes(id) ? [yesterday] : []),
    ...(OUT_TODAY.includes(id) ? [today] : []),
    ...(OUT_TOMORROW.includes(id) ? [tomorrow] : []),
  ];
  const stays = [];
  for (const room of ROOMS) {
    const r = rngOf(`stays|${room.id}`);
    const F = forcedOf(room.id);
    const push = (ci, co) => stays.push({ roomId: room.id, checkIn: ci, checkOut: co });
    // 보호 날(어제 · 오늘 · 내일)에 강제가 아닌 퇴실이 생기지 않게 끝을 뒤로 민다.
    const safeEnd = (ci, n) => {
      let end = addDays(ci, n);
      while (protectedDates.has(end)) end = addDays(end, 1);
      return end;
    };
    const forward = (fromCi) => {
      let ci = fromCi;
      while (ci <= addDays(winTo, 4)) {
        const end = safeEnd(ci, randInt(r, 1, 4));
        push(ci, end);
        ci = addDays(end, r() < 0.3 ? 0 : randInt(r, 1, 3));
      }
    };
    if (F.length === 0) {
      forward(addDays(winFrom, -randInt(r, 1, 5)));
      continue;
    }
    // 강제 퇴실 사이를 잇는다.
    let firstCi = null;
    for (let i = 0; i < F.length; i++) {
      const b = F[i];
      let ci;
      if (i === 0) {
        ci = addDays(b, -randInt(r, 1, 4));
        firstCi = ci;
      } else {
        const a = F[i - 1];
        const gap = a === today && TURN_TODAY.has(room.id) ? 0 : randInt(r, 0, daysBetween(a, b) - 1);
        ci = addDays(a, gap);
      }
      push(ci, b);
    }
    // 앞쪽 — 첫 강제 투숙 이전
    let cursor = firstCi;
    let guard = 0;
    while (cursor > addDays(winFrom, -6) && guard++ < 30) {
      let end = addDays(cursor, -(r() < 0.3 ? 0 : randInt(r, 1, 2)));
      while (protectedDates.has(end)) end = addDays(end, -1);
      const ci = addDays(end, -randInt(r, 1, 4));
      push(ci, end);
      cursor = ci;
    }
    // 뒤쪽 — 마지막 강제 퇴실 이후
    const last = F[F.length - 1];
    forward(addDays(last, last === today && TURN_TODAY.has(room.id) ? 0 : randInt(r, last === today ? 1 : 0, 3)));
  }
  // 손님 · 인원 · 번호
  const rows = [];
  for (const s of stays) {
    const room = ROOM_BY_ID.get(s.roomId);
    const r = rngOf(`guest|${s.roomId}|${s.checkIn}`);
    const pax = room.headcount >= 3 ? randInt(r, 4, 6) : room.headcount === 2 ? randInt(r, 3, 5) : randInt(r, 2, 4);
    const children = pax >= 3 && r() < 0.4 ? randInt(r, 1, Math.min(2, pax - 2)) : 0;
    rows.push({
      ...s,
      sourceId: `${RES_PREFIX}${s.roomId}-${s.checkIn}`,
      guest: pick(r, GUEST_NAMES),
      payload: { numAdult: pax - children, numChild: children, phone: guestPhone(r), channel: pick(r, CHANNELS), demo: MARK },
    });
  }
  return rows.sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.roomId.localeCompare(b.roomId));
}

// ── ③ 신청 · 배정 · ④ 세션 ──
function buildPlan({ people, resRows, today, winFrom, winTo, nowMs, albaKey }) {
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const dates = [];
  for (let d = winFrom; d <= winTo; d = addDays(d, 1)) dates.push(d);
  // 사람별 신청 빈도 — 많이 하는 사람 · 가끔 하는 사람이 섞이게.
  const rateOf = new Map(people.map((p, i) => [p.key, [0.82, 0.68, 0.55, 0.42, 0.3][i % 5]]));
  const outByDate = new Map();
  for (const s of resRows) {
    if (!outByDate.has(s.checkOut)) outByDate.set(s.checkOut, []);
    outByDate.get(s.checkOut).push(s.roomId);
  }
  const orderOf = (ids) => [...ids].sort((a, b) => roomIdx(a) - roomIdx(b));

  const apps = []; // { key, date, source, startMin|null }
  const assigns = []; // { date, roomId, key }
  const sessions = []; // { date, roomId, key, status, startMs, endMs }

  for (const date of dates) {
    const r = rngOf(`day|${date}`);
    const roomsToday = orderOf(outByDate.get(date) ?? []);
    const n = date === today ? 9 : date === yesterday ? 7 : date === tomorrow ? 8 : randInt(r, 3, 7);
    const weekendBump = [0, 5, 6].includes(dow(date)) ? 0.12 : 0;
    const scored = people
      .map((p) => ({ p, score: r() - (rateOf.get(p.key) + weekendBump - 0.5) * 0.9 + (p.key === albaKey && date === today ? -9 : 0) }))
      .sort((a, b) => a.score - b.score);
    const applicants = scored.slice(0, Math.min(n, people.length)).map((x) => x.p);
    for (const p of applicants) {
      apps.push({ key: p.key, date, source: r() < 0.12 ? "admin" : "self", startMin: r() < 0.15 ? pick(r, [9 * 60, 11 * 60, 12 * 60]) : null });
    }

    // 배정할 방 고르기
    let assignRooms = [];
    if (date < yesterday) assignRooms = roomsToday;
    else if (date === yesterday) assignRooms = roomsToday.filter((id, i) => i !== roomsToday.length - 1); // 마지막 방 하나는 못 함 → 오늘 「어제부터 · 1일째」
    else if (date === today) assignRooms = roomsToday.filter((id, i) => !(i % 3 === 1 && ROOM_BY_ID.get(id).headcount === 1));
    else if (date === tomorrow) assignRooms = roomsToday.filter((_, i) => i % 2 === 0);
    else if (rngOf(`plan|${date}`)() < 0.45) assignRooms = roomsToday.filter((_, i) => i % 5 !== 1);
    if (assignRooms.length === 0 || applicants.length === 0) continue;

    // 건물별로 신청자를 나눠 같은 건물은 같은 사람들이 맡게(같은 건물 몰아주기).
    const buildings = [...new Set(assignRooms.map((id) => ROOM_BY_ID.get(id).property))];
    const home = new Map(buildings.map((b) => [b, []]));
    applicants.forEach((p, i) => home.get(buildings[i % buildings.length]).push(p));
    const load = new Map(applicants.map((p) => [p.key, 0]));
    for (const id of assignRooms) {
      const room = ROOM_BY_ID.get(id);
      const used = new Set();
      for (let h = 0; h < Math.min(room.headcount, applicants.length); h++) {
        const pool = [...home.get(room.property), ...applicants].filter((p) => !used.has(p.key) && load.get(p.key) < 4);
        const eff = (p) => load.get(p.key) - (p.key === albaKey && date === today ? 1.5 : 0); // 로그인 알바는 오늘 방을 여러 개(내 방 시연)
        pool.sort((a, b) => eff(a) - eff(b));
        const who = pool[0];
        if (!who) break;
        used.add(who.key);
        load.set(who.key, load.get(who.key) + 1);
        assigns.push({ date, roomId: id, key: who.key });
      }
    }
  }

  // ④ 청소 세션
  const byDayUser = new Map();
  for (const a of assigns) {
    const k = `${a.date}|${a.key}`;
    if (!byDayUser.has(k)) byDayUser.set(k, []);
    byDayUser.get(k).push(a.roomId);
  }
  const appStart = new Map(apps.map((a) => [`${a.date}|${a.key}`, a.startMin]));
  const todayModes = ["active", "alldone", "donefirst", "active", "waiting", "donefirst", "active", "alldone", "waiting"];
  let todayUserIdx = 0;
  const MIN = 60000;
  for (const [k, ids] of byDayUser) {
    const [date, key] = k.split("|");
    const r = rngOf(`sess|${k}`);
    const rooms = orderOf(ids);
    if (date < today) {
      // 지난 날 — 신청 시각(없으면 10시 안팎)부터 차례로 끝낸다.
      let t = (appStart.get(k) ?? 10 * 60 + randInt(r, 0, 20)) * MIN;
      const dayMs = new Date(`${date}T00:00:00+09:00`).getTime();
      for (const id of rooms) {
        const dur = randInt(r, 24, 48) * MIN;
        sessions.push({ date, roomId: id, key, status: "completed", startMs: dayMs + t, endMs: dayMs + t + dur });
        t += dur + randInt(r, 5, 14) * MIN;
      }
    } else if (date === today) {
      const mode = key === albaKey ? "donefirst" : todayModes[todayUserIdx++ % todayModes.length];
      // 지금(nowMs)에서 거꾸로 — 시각이 미래로 새지 않게.
      const durs = rooms.map(() => randInt(r, 24, 44) * MIN);
      let doneCount = 0;
      let activeAt = -1;
      if (mode === "alldone") doneCount = rooms.length;
      else if (mode === "donefirst") doneCount = 1;
      else if (mode === "active") {
        activeAt = rooms.length >= 2 && r() < 0.6 ? 1 : 0;
        doneCount = activeAt;
      }
      let cursor = nowMs; // 다음 일의 시작 한계(이보다 먼저 끝나야 한다)
      const planned = [];
      if (activeAt >= 0) {
        const startMs = nowMs - randInt(r, 6, 26) * MIN;
        planned.push({ i: activeAt, status: "in_progress", startMs, endMs: null });
        cursor = startMs - randInt(r, 4, 9) * MIN;
      } else if (doneCount > 0) {
        cursor = nowMs - randInt(r, 8, 55) * MIN;
      }
      for (let i = doneCount - 1; i >= 0; i--) {
        const endMs = cursor;
        const startMs = endMs - durs[i];
        planned.push({ i, status: "completed", startMs, endMs });
        cursor = startMs - randInt(r, 5, 12) * MIN;
      }
      for (const p of planned) sessions.push({ date, roomId: rooms[p.i], key, ...p });
    }
  }
  return { dates, apps, assigns, sessions };
}

// ── 지우기 ──
async function cleanOld(sb, org, peopleIds, verbose) {
  const org_id = org.id;
  const count = async (q) => (await q).count ?? 0;
  const sessions = await count(sb.from("cleaning_sessions").select("id", { count: "exact", head: true }).eq("organization_id", org_id).eq("notes", MARK));
  const reservations = await count(sb.from("reservations").select("id", { count: "exact", head: true }).eq("organization_id", org_id).like("source_reservation_id", `${RES_PREFIX}%`));
  let assignments = 0;
  let applications = 0;
  if (peopleIds.length) {
    assignments = await count(sb.from("cleaning_assignments").select("id", { count: "exact", head: true }).eq("organization_id", org_id).in("user_id", peopleIds));
    applications = await count(sb.from("cleaning_shift_applications").select("user_id", { count: "exact", head: true }).eq("organization_id", org_id).in("user_id", peopleIds));
  }
  console.log(`  지울 것: 청소 세션 ${sessions} · 배정 ${assignments} · 시프트 신청 ${applications} · 예약 ${reservations}`);
  if (!verbose) return;
  must(await sb.from("cleaning_sessions").delete().eq("organization_id", org_id).eq("notes", MARK), "세션 삭제");
  if (peopleIds.length) {
    must(await sb.from("cleaning_assignments").delete().eq("organization_id", org_id).in("user_id", peopleIds), "배정 삭제");
    must(await sb.from("cleaning_shift_applications").delete().eq("organization_id", org_id).in("user_id", peopleIds), "신청 삭제");
  }
  must(await sb.from("reservations").delete().eq("organization_id", org_id).like("source_reservation_id", `${RES_PREFIX}%`), "예약 삭제");
}

async function main() {
  const sb = connect();
  const org = await getDemoOrg(sb);
  if (org.slug !== ORG_SLUG) throw new Error(`조직이 ${ORG_SLUG} 가 아니다 — 중단.`);
  console.log(`조직: ${org.slug} (${org.id})  모드: ${CLEAN ? "--clean" : APPLY ? "--apply" : "dry run"}`);

  // 사람: ROSTER 10 + 이 조직의 기존 알바 · 직원. 소속은 항상 이 조직 memberships 에서만 읽는다.
  const deck = await ensureDeckPeople({ sb, apply: APPLY && !CLEAN });
  const members = must(await sb.from("memberships").select("user_id, role, status").eq("organization_id", org.id).eq("status", "active"), "소속 조회");
  const memberIds = members.map((m) => m.user_id);
  const profiles = memberIds.length ? must(await sb.from("profiles").select("id, name").in("id", memberIds), "프로필 조회") : [];
  const nameOf = new Map(profiles.map((p) => [p.id, p.name]));
  const rosterIds = new Set([...deck.values()].map((d) => d.userId).filter(Boolean));
  const people = ROSTER.map((p) => ({ key: p.key, name: p.name, userId: deck.get(p.key)?.userId ?? null }));
  let albaKey = null;
  for (const m of members) {
    if (rosterIds.has(m.user_id) || !["part_time_staff", "staff"].includes(m.role)) continue;
    const key = `x-${m.user_id.slice(0, 8)}`;
    if (!albaKey && m.role === "part_time_staff") albaKey = key; // 로그인 데모 알바 — 오늘 내 방에서 보여 줄 사람
    people.push({ key, name: nameOf.get(m.user_id) ?? key, userId: m.user_id });
  }
  const assignOwners = members.filter((m) => ["owner", "senior_managing_director", "field_manager"].includes(m.role)).map((m) => m.user_id);
  for (const p of people) {
    if (!p.userId) p.userId = APPLY && !CLEAN ? null : `dry:${p.key}`;
    if (!p.userId) throw new Error(`${p.name} 계정이 없다.`);
    if (!p.userId.startsWith("dry:") && !memberIds.includes(p.userId)) throw new Error(`${p.name} 은 이 조직 소속이 아니다 — 중단.`);
  }
  const peopleIds = people.map((p) => p.userId).filter((id) => !id.startsWith("dry:"));

  if (CLEAN) {
    await cleanOld(sb, org, peopleIds, true);
    console.log("정리 끝. (방별 필요 인원 설정은 그대로 둔다.)");
    return;
  }

  const today = tokyoToday();
  const winFrom = [monthStartOf(today), addDays(today, -1)].sort()[0];
  const winTo = [monthEndOf(today), addDays(today, 1)].sort().reverse()[0];
  const nowMs = Date.now();
  const resRows = buildReservations(today, winFrom, winTo);
  const plan = buildPlan({ people, resRows, today, winFrom, winTo, nowMs, albaKey });
  const personOf = new Map(people.map((p) => [p.key, p]));

  // ── 계획 출력 ──
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const outCount = (d) => resRows.filter((s) => s.checkOut === d).length;
  console.log(`\n오늘(도쿄) ${today} · 범위 ${winFrom} ~ ${winTo} · 사람 ${people.length}명 · 배정 담당(방 인원 설정) ${assignOwners.length}명`);
  console.log(`예약 ${resRows.length}건 — 퇴실 어제 ${outCount(yesterday)} · 오늘 ${outCount(today)} · 내일 ${outCount(tomorrow)} · 오늘 체크인 ${resRows.filter((s) => s.checkIn === today).length}(턴오버 ${resRows.filter((s) => s.checkIn === today && resRows.some((o) => o.roomId === s.roomId && o.checkOut === today)).length})`);
  console.log(`신청 ${plan.apps.length} · 배정 ${plan.assigns.length} · 청소 세션 ${plan.sessions.length} (오늘 끝 ${plan.sessions.filter((s) => s.date === today && s.status === "completed").length} · 진행 중 ${plan.sessions.filter((s) => s.status === "in_progress").length})`);
  const bigRooms = ROOMS.filter((r) => r.headcount > 1);
  console.log(`방별 필요 인원: ${bigRooms.map((r) => `${r.name} ${r.headcount}명`).join(" · ")} (그 밖 1명)`);
  console.log(`\n── 오늘 ${today} 방 ──`);
  const todayOut = resRows.filter((s) => s.checkOut === today).sort((a, b) => roomIdx(a.roomId) - roomIdx(b.roomId));
  for (const s of todayOut) {
    const room = ROOM_BY_ID.get(s.roomId);
    const as = plan.assigns.filter((a) => a.date === today && a.roomId === s.roomId);
    const turn = resRows.find((o) => o.roomId === s.roomId && o.checkIn === today);
    const stateOf = (key) => {
      const se = plan.sessions.find((x) => x.date === today && x.roomId === s.roomId && x.key === key);
      return se ? (se.status === "completed" ? `끝 ${fmtTime(new Date(se.endMs).toISOString())}` : `진행 중 ${fmtTime(new Date(se.startMs).toISOString())}~`) : "대기";
    };
    const who = as.length ? as.map((a) => `${personOf.get(a.key).name}(${stateOf(a.key)})`).join(", ") : "미배정";
    console.log(`  ${room.name.padEnd(12)} 퇴실 ${s.guest}${turn ? ` → 오늘 체크인 ${turn.guest}` : ""} | 필요 ${room.headcount}명 | ${who}`);
  }
  const carry = resRows.filter((s) => s.checkOut === yesterday).sort((a, b) => roomIdx(a.roomId) - roomIdx(b.roomId));
  const notCleaned = carry.filter((s) => !plan.sessions.some((x) => x.date === yesterday && x.roomId === s.roomId));
  console.log(`어제 퇴실 ${carry.length}방 중 청소 기록 없음 ${notCleaned.length} → 오늘 「어제부터 · 1일째」: ${notCleaned.map((s) => ROOM_BY_ID.get(s.roomId).name).join(", ") || "없음"}`);
  console.log(`\n── 오늘 신청자 ${plan.apps.filter((a) => a.date === today).length}명 ──`);
  console.log("  " + plan.apps.filter((a) => a.date === today).map((a) => personOf.get(a.key).name + (a.key === albaKey ? "(로그인 알바)" : "")).join(", "));
  console.log("\n── 이번 달 사람별 신청 / 배정 일수 ──");
  for (const p of people) {
    const a = new Set(plan.apps.filter((x) => x.key === p.key && x.date.startsWith(today.slice(0, 7))).map((x) => x.date)).size;
    const g = new Set(plan.assigns.filter((x) => x.key === p.key && x.date.startsWith(today.slice(0, 7))).map((x) => x.date)).size;
    console.log(`  ${p.name.padEnd(8)} 신청 ${String(a).padStart(2)}일 · 배정 ${String(g).padStart(2)}일${p.userId.startsWith("dry:") ? "  (계정 아직 없음 — --apply 때 만들어짐)" : ""}`);
  }
  console.log("\n── 기존 데이터 ──");
  await cleanOld(sb, org, peopleIds, false);

  if (!APPLY) {
    console.log("\ndry run — DB 에 쓰지 않았다. 넣으려면 --apply.");
    return;
  }

  // ── 쓰기 (전부 org.id) ──
  console.log("\n적용 중...");
  await cleanOld(sb, org, peopleIds, true);
  const uid = (key) => personOf.get(key).userId;
  const adminId = assignOwners[0] ?? null;

  await chunked(resRows, 400, async (rows) => {
    must(
      await sb.from("reservations").insert(
        rows.map((s) => {
          const room = ROOM_BY_ID.get(s.roomId);
          return {
            organization_id: org.id,
            source: "beds24",
            source_reservation_id: s.sourceId,
            property_name: room.property,
            room_label: room.resLabel,
            guest_name: s.guest,
            check_in_date: s.checkIn,
            check_out_date: s.checkOut,
            status: "confirmed",
            raw_payload: s.payload,
          };
        }),
      ),
      "예약 입력",
    );
  });

  // 방별 필요 인원 — 있으면 그대로
  const roomSettings = assignOwners.flatMap((owner) => bigRooms.map((r) => ({ organization_id: org.id, owner_id: owner, room_key: r.roomKey, usual_headcount: r.headcount, updated_by: owner })));
  if (roomSettings.length) must(await sb.from("cleaning_room_settings").upsert(roomSettings, { onConflict: "organization_id,owner_id,room_key", ignoreDuplicates: true }), "방별 인원");

  const nowIso = new Date().toISOString();
  await chunked(plan.apps, 400, async (rows) => {
    must(
      await sb.from("cleaning_shift_applications").insert(
        rows.map((a) => ({
          organization_id: org.id,
          user_id: uid(a.key),
          work_date: a.date,
          source: a.source,
          start_time: a.startMin == null ? null : hhmmss(a.startMin),
          created_by: a.source === "admin" ? adminId : uid(a.key),
          created_at: nowIso,
        })),
      ),
      "시프트 신청",
    );
  });
  await chunked(plan.assigns, 400, async (rows) => {
    must(
      await sb.from("cleaning_assignments").insert(
        rows.map((a) => {
          const room = ROOM_BY_ID.get(a.roomId);
          return { organization_id: org.id, work_date: a.date, room_key: room.roomKey, property_name: room.property, room_label: room.assignLabel, user_id: uid(a.key), created_by: adminId };
        }),
      ),
      "배정",
    );
  });

  // 진행 중 세션은 사람당 하나(DB 제약) — 이 조직에 이미 진행 중인 사람은 건너뛴다.
  const active = must(await sb.from("cleaning_sessions").select("staff_user_id").eq("organization_id", org.id).eq("status", "in_progress"), "진행 중 조회").map((r) => r.staff_user_id);
  const sessionRows = plan.sessions
    .filter((s) => !(s.status === "in_progress" && active.includes(uid(s.key))))
    .map((s) => {
      const room = ROOM_BY_ID.get(s.roomId);
      const done = s.status === "completed";
      return {
        organization_id: org.id,
        staff_user_id: uid(s.key),
        room_label: room.sessionLabel,
        task_label: "checkout",
        status: s.status,
        cleaning_date: s.date,
        started_at: new Date(s.startMs).toISOString(),
        completed_at: done ? new Date(s.endMs).toISOString() : null,
        duration_seconds: done ? Math.round((s.endMs - s.startMs) / 1000) : null,
        notes: MARK,
      };
    });
  await chunked(sessionRows, 400, async (rows) => must(await sb.from("cleaning_sessions").insert(rows), "청소 세션"));
  console.log(`끝 — 예약 ${resRows.length} · 신청 ${plan.apps.length} · 배정 ${plan.assigns.length} · 세션 ${sessionRows.length}`);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
