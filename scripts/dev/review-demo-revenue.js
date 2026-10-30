/**
 * 앱 스토어 심사용 데모 — 「Foldy Demo」 조직(slug `stayops-review-demo`)의 매출 · 가동률을 현실적으로 보이게 한다.
 *
 * 매출은 `reservations.raw_payload.price`(+ channel · commission) 를 읽고(`ops-sales-summary.ts`), 가동률은 객실 카탈로그에 있는
 * 방의 예약 밤 수를 센다. 그래서 (1) 기존 데모 예약(deck-demo 가 넣은 것)에 금액을 붙이고, (2) 카탈로그 밖 방(다카다노바바 301 등)에
 * 걸린 기존 예약을 카탈로그 방으로 옮기고, (3) 5월~12월 가상 예약(영어 이름 · Airbnb/Booking.com/직접)을 채운다.
 * 월 집계(`ops_room_month_stats`)는 예약 트리거가 dirty 로 표시해 화면이 열릴 때 앱 자신의 빌더가 다시 계산한다.
 *
 *   node scripts/dev/review-demo-revenue.js           # 계획만 출력 (DB 쓰기 없음)
 *   node scripts/dev/review-demo-revenue.js --apply   # 넣기 (멱등 — 먼저 --clean 과 같이 되돌린 뒤 다시 넣음)
 *   node scripts/dev/review-demo-revenue.js --clean   # 이 스크립트가 넣은 예약 삭제 + 기존 예약에 붙인 금액 · 옮긴 방 되돌림
 *
 * 안전: Beds24 호출 없음, 큐 테이블 쓰기 없음(reservations 트리거는 통계 dirty 표시뿐). 기존 예약은 삭제하지 않는다.
 * 방 이름 메모: 객실은 `201_2` 로 저장돼 있지만 앱이 `201` 로 정규화해 예약(`201`)과 같은 키로 만난다 — 어긋남 없음.
 */
const { ORG_SLUG, connect, getDemoOrg, tokyoToday, addDays } = require("./deck-demo-roster");

const APPLY = process.argv.includes("--apply");
const CLEAN = process.argv.includes("--clean");
const MARK = "REVIEW-DEMO-REV";
const END = "2026-12-20";
const START = "2026-05-01";

const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const day = (ymd) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86400000);

// 결정적 난수(다시 돌려도 같은 결과)
let seed = 20261030;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];

// properties.name → [예약의 건물 이름, 예약 방 이름 만드는 법, 슬롯(정규화) 만드는 법, 1박 기준가(엔)]
const PROPS = {
  "Arakicho A": ["아라키초A", (l) => l.replace(/_.*$/, ""), (l) => l.replace(/_.*$/, ""), 14000],
  "Arakicho B": ["아라키초B", (l) => l, (l) => l.replace(/^[A-Za-z]+/, ""), 15000],
  Kabukicho: ["가부키초", (l) => l, (l) => l.replace(/^[A-Za-z]+/, ""), 18000],
  "STAY ARI Apartment Hotel": ["STAY ARI Apartment Hotel", (l) => l, (l) => l.replace(/^[A-Za-z]+/, ""), 16000],
  Takadanobaba: ["다카다노바바", (l) => l, (l) => l, 12000],
  "Okubo_A (B棟)": ["오쿠보A", () => "오쿠보A", () => "오쿠보A", 28000],
  "Okubo_B (A棟)": ["오쿠보B", () => "오쿠보B", () => "오쿠보B", 30000],
  "Okubo_C (kr)": ["오쿠보C", () => "오쿠보C", () => "오쿠보C", 26000],
};
const BASE_BY_KO = Object.fromEntries(Object.values(PROPS).map((p) => [p[0], p[3]]));
const MONTH_F = { 5: 0.95, 6: 0.98, 7: 1.2, 8: 1.28, 9: 1.05, 10: 1.1, 11: 1.12, 12: 1.2 };
const OCC = { 5: 0.7, 6: 0.74, 7: 0.86, 8: 0.9, 9: 0.8, 10: 0.78, 11: 0.62, 12: 0.55 };
const NIGHTS = [1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7];
const NAMES = [
  "Olivia Bennett", "Liam Carter", "Emma Wilson", "Noah Davis", "Sophie Martin", "Lucas Dubois", "Mia Schmidt", "Felix Wagner",
  "Hannah Lee", "Daniel Kim", "Aisha Khan", "Omar Haddad", "Isabella Rossi", "Marco Bianchi", "Chloe Nguyen", "Minh Tran",
  "Priya Patel", "Arjun Mehta", "Wei Zhang", "Li Na Chen", "Jack Thompson", "Grace Murphy", "Ethan Brown", "Zoe Taylor",
  "Carlos Mendez", "Lucia Fernandez", "Anna Kowalski", "Jan Novak", "Elena Petrova", "Ivan Sokolov", "Sarah Cohen", "Tom Anderson",
  "Yuki Tanaka", "Haruto Sato", "Emily Clark", "James Walker", "Amelie Laurent", "Hugo Bernard", "Nina Johansson", "Erik Larsen",
];

const nightly = (ko, ymd) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay();
  const f = MONTH_F[d.getUTCMonth() + 1] ?? 1;
  return Math.round(((BASE_BY_KO[ko] ?? 15000) * f * (dow === 5 || dow === 6 ? 1.2 : 1) * (0.9 + 0.25 * rnd())) / 100) * 100;
};
const money = (ko, ci, nights, channel) => {
  const price = nightly(ko, ci) * nights;
  const commission = channel === "Airbnb" ? Math.round(price * 0.03) : channel === "Booking.com" ? Math.round(price * 0.15) : 0;
  return { price, commission };
};
const pickChannel = () => {
  const x = rnd();
  return x < 0.45 ? "Airbnb" : x < 0.85 ? "Booking.com" : "Direct";
};

(async () => {
  const db = connect();
  const org = await getDemoOrg(db);
  if (org.slug !== ORG_SLUG) throw new Error("데모 조직이 아니다 — 중단.");
  const orgId = org.id;
  const today = tokyoToday();

  const props = must(await db.from("properties").select("id,name").eq("organization_id", orgId), "건물");
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const rooms = must(await db.from("rooms").select("room_label,property_id").eq("organization_id", orgId), "객실");

  // 카탈로그 슬롯 — `건물::정규화 번호`
  const slots = new Map(); // slotKey → { ko, label }
  for (const r of rooms) {
    const def = PROPS[propName.get(r.property_id)];
    if (!def) continue;
    const [ko, emit, norm] = def;
    slots.set(`${ko}::${norm(r.room_label)}`, { ko, label: emit(r.room_label), norm: norm(r.room_label) });
  }
  const normOf = (ko, label) => {
    const def = Object.values(PROPS).find((p) => p[0] === ko);
    return def ? def[2](label) : label;
  };

  // ── 먼저 되돌리기 (멱등) ──
  const mine = must(await db.from("reservations").select("id").eq("organization_id", orgId).like("source_reservation_id", `${MARK}-%`), "내 예약");
  const touched = must(
    await db.from("reservations").select("id,room_label,raw_payload").eq("organization_id", orgId).eq("raw_payload->>revDemoPrice", "true"),
    "금액 붙인 기존 예약",
  );
  console.log(`되돌릴 것: 내가 넣은 예약 ${mine.length} · 금액/방 바꾼 기존 예약 ${touched.length}`);
  if (APPLY || CLEAN) {
    for (const part of chunk(mine.map((m) => m.id), 200)) must(await db.from("reservations").delete().in("id", part), "예약 삭제");
    for (const part of chunk(touched, 20)) {
      await Promise.all(
        part.map(async (t) => {
          const { price, commission, revDemoPrice, revDemoOrigLabel, ...rest } = t.raw_payload;
          must(await db.from("reservations").update({ raw_payload: rest, room_label: revDemoOrigLabel ?? t.room_label }).eq("id", t.id), "되돌림");
        }),
      );
    }
  }
  if (CLEAN) return console.log("되돌림 끝.");

  // ── 기존 데모 예약 ──
  const existing = must(
    await db.from("reservations").select("id,property_name,room_label,check_in_date,check_out_date,status,raw_payload,source_reservation_id").eq("organization_id", orgId).not("source_reservation_id", "like", `${MARK}-%`),
    "기존 예약",
  );
  const busy = new Map(); // slotKey → [[inDay, outDay]]
  const addBusy = (key, a, b) => (busy.get(key) ?? busy.set(key, []).get(key)).push([day(a), day(b)]);
  const overlaps = (key, a, b) => (busy.get(key) ?? []).some(([x, y]) => a < y && b > x);

  const updates = [];
  const orphans = [];
  for (const r of existing) {
    const key = `${r.property_name}::${normOf(r.property_name, r.room_label)}`;
    if (slots.has(key)) addBusy(key, r.check_in_date, r.check_out_date);
    else orphans.push(r);
  }
  // 카탈로그 밖 방의 예약 → 같은 건물의 비어 있는 카탈로그 방으로
  const remapped = new Map();
  for (const r of orphans) {
    const a = day(r.check_in_date), b = day(r.check_out_date);
    const cand = [...slots.entries()].find(([k, s]) => s.ko === r.property_name && !overlaps(k, a, b));
    if (cand) {
      addBusy(cand[0], r.check_in_date, r.check_out_date);
      remapped.set(r.id, { label: cand[1].label, orig: r.room_label });
    }
  }
  for (const r of existing) {
    if (r.status === "cancelled") continue;
    const nights = Math.max(1, day(r.check_out_date) - day(r.check_in_date));
    const channel = /airbnb/i.test(String(r.raw_payload.channel)) ? "Airbnb" : /booking/i.test(String(r.raw_payload.channel)) ? "Booking.com" : "Direct";
    const { price, commission } = money(r.property_name, r.check_in_date, nights, channel);
    const mv = remapped.get(r.id);
    updates.push({
      id: r.id,
      room_label: mv ? mv.label : r.room_label,
      raw_payload: { ...r.raw_payload, price, commission, revDemoPrice: "true", ...(mv ? { revDemoOrigLabel: mv.orig } : {}) },
    });
  }

  // ── 가상 예약 ──
  const newRows = [];
  let n = 0;
  for (const [key, slot] of slots) {
    let cur = day(START) + Math.floor(rnd() * 3);
    const end = day(END);
    while (cur < end) {
      const ymd = new Date(cur * 86400000).toISOString().slice(0, 10);
      const month = Number(ymd.slice(5, 7));
      let nights = pick(NIGHTS);
      let out = cur + nights;
      const hit = (busy.get(key) ?? []).find(([x, y]) => cur < y && out > x);
      if (hit) {
        if (hit[0] > cur) {
          out = hit[0]; // 다음 기존 예약 앞까지만
          nights = out - cur;
          if (nights < 1) { cur = hit[1]; continue; }
        } else { cur = hit[1]; continue; }
      }
      const occ = OCC[month] ?? 0.6;
      const channel = pickChannel();
      const outYmd = new Date(out * 86400000).toISOString().slice(0, 10);
      const { price, commission } = money(slot.ko, ymd, nights, channel);
      n += 1;
      newRows.push({
        organization_id: orgId,
        source: "beds24",
        source_reservation_id: `${MARK}-${String(n).padStart(5, "0")}`,
        property_name: slot.ko,
        room_label: slot.label,
        guest_name: pick(NAMES),
        check_in_date: ymd,
        check_out_date: outYmd,
        status: "confirmed",
        raw_payload: { demo: MARK, channel, price, commission, numAdult: 1 + Math.floor(rnd() * 3), numChild: rnd() < 0.2 ? 1 : 0, phone: `+81-90-0000-${String(1000 + (n % 9000)).padStart(4, "0")}` },
      });
      const gapMean = (nights * (1 - occ)) / occ;
      cur = out + Math.round(rnd() * 2 * gapMean);
    }
  }

  const rev = newRows.reduce((s, r) => s + r.raw_payload.price, 0);
  console.log(`계획: 기존 예약 금액 ${updates.length}건(방 옮김 ${remapped.size}) · 가상 예약 ${newRows.length}건 (가상 매출 합 ¥${rev.toLocaleString()}) · 카탈로그 방 ${slots.size}`);
  if (!APPLY) return console.log("dry run — --apply 로 넣기.");

  for (const part of chunk(updates, 20))
    await Promise.all(part.map(async (u) => must(await db.from("reservations").update({ room_label: u.room_label, raw_payload: u.raw_payload }).eq("id", u.id), "기존 예약 수정")));
  for (const part of chunk(newRows, 500)) must(await db.from("reservations").insert(part), "가상 예약");

  const c = await db.from("reservations").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
  const dirty = await db.from("ops_stats_months").select("month", { count: "exact", head: true }).eq("organization_id", orgId).eq("dirty", true);
  console.log(`넣음 — 예약 총 ${c.count} · dirty 월 ${dirty.count} (화면을 열면 앱이 다시 계산)`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
