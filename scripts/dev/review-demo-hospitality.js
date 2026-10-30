/**
 * 앱 스토어 심사용 데모 — 「Foldy Demo」 조직(slug `stayops-review-demo`)에 게스트 피드백 · 채용 지원서 ·
 * 판매 캘린더 가격 · 가격 변경 이력 · 건물 정보(출입 코드)를 넣는다. 전부 가상 데이터(영어 · 가짜 연락처 · 가짜 출입 코드).
 *
 *   node scripts/dev/review-demo-hospitality.js           # 계획만 출력 (DB 쓰기 없음)
 *   node scripts/dev/review-demo-hospitality.js --apply   # 이 조직의 해당 테이블 행을 전부 지우고 다시 넣음
 *   node scripts/dev/review-demo-hospitality.js --clean   # 지우기만
 *
 * 안전: Beds24 를 부르지 않고 beds24_* · automation_jobs · 큐 테이블에 쓰지 않는다. 마이그레이션을 확인한 결과
 * room_daily_rates · price_change_logs · external_reviews · job_applications · property_operation_infos 는
 * set_updated_at 트리거뿐이라 넣어도 가격이 밖으로 나가지 않는다. 사진 · 스토리지 업로드 없음(이력서 없음).
 * 건물 정보: 앱은 DB 행이 없으면 코드에 박힌 실제 출입 코드로 떨어지므로, 데모 조직엔 가짜 코드로 덮어쓴다.
 */
const { ORG_SLUG, connect, getDemoOrg, tokyoToday, addDays } = require("./deck-demo-roster");

const APPLY = process.argv.includes("--apply");
const CLEAN = process.argv.includes("--clean");

const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};
const tz = (ymd, hm = "12:00") => `${ymd}T${hm}:00+09:00`;
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// 예약의 한국어 정규 건물 이름 → 데모 properties.name
const PROP_BY_KO = {
  아라키초A: "Arakicho A",
  아라키초B: "Arakicho B",
  가부키초: "Kabukicho",
  다카다노바바: "Takadanobaba",
  오쿠보A: "Okubo_A (B棟)",
  오쿠보B: "Okubo_B (A棟)",
  오쿠보C: "Okubo_C (kr)",
};

// ── 게스트 피드백 ──────────────────────────────────────────────────────────
// [provider, 점수, headline, 본문(긍정), 부정, OTA 답글]
const REVIEWS = [
  ["airbnb", 5, null, "Spotless apartment, super easy self check-in and a fantastic location near the station. Would stay again!", null, "Thank you so much for the kind words!"],
  ["airbnb", 5, null, "Great communication and a very comfortable bed. The kitchenette had everything we needed for a week.", null, null],
  ["airbnb", 4, null, "Clean and well located. The room was a little small for our two suitcases but overall a great stay.", null, null],
  ["airbnb", 5, null, "Perfect for exploring Shinjuku. Quiet at night and the host replied within minutes.", null, "We are glad you enjoyed Tokyo, see you again!"],
  ["airbnb", 4, null, "Lovely place and easy check-in. Wi-Fi was fast. Hot water took a minute to warm up.", null, null],
  ["airbnb", 3, null, "Location is great but the room smelled slightly of smoke when we arrived and the towels were thin.", null, "We are sorry about the smell, we have asked housekeeping to air out the room before every stay."],
  ["airbnb", 2, null, "The air conditioner was noisy and we could hear the street all night. Not what the photos suggested.", null, null],
  ["airbnb", 5, null, "Beautiful, modern and very clean. The tips for local restaurants were a lovely touch.", null, null],
  ["airbnb", 4, null, "Good value for Tokyo. Stairs only, so pack light!", null, null],
  ["airbnb", 5, null, "Wonderful family stay. Kids loved the little balcony and the laundry made our trip so much easier.", null, "Thank you, we hope to welcome you again!"],
  ["booking", 9.2, "Exceptional stay", "Very clean, quiet room and the check-in instructions were clear. Walking distance to the metro.", "Nothing to complain about.", "Thank you for your wonderful review!"],
  ["booking", 8.8, "Great location", "Excellent location, comfortable bed, friendly staff over chat.", "Elevator is small.", null],
  ["booking", 10, "Perfect", "Everything was perfect. Spotless, modern and exactly like the photos.", null, "We are delighted you enjoyed your stay."],
  ["booking", 8.3, "Good stay", "Compact but very clean, good air conditioning, easy to find.", "No breakfast option nearby early in the morning.", null],
  ["booking", 9.6, "Loved it", "Stylish room, fast Wi-Fi and a great neighbourhood full of restaurants.", null, null],
  ["booking", 7.5, "Decent for the price", "Good location and clean bathroom.", "Walls are thin and the room was smaller than expected.", null],
  ["booking", 6.7, "Could be better", "Location was convenient.", "Bed was firm, the shower pressure was weak and check-in instructions arrived late.", "We apologise for the inconvenience and have passed your feedback to our team."],
  ["booking", 5.8, "Disappointing", "Easy to find the building.", "Room was not fully cleaned: hair in the bathroom and a dusty floor. Expected better.", null],
  ["booking", 9.0, "Very comfortable", "Comfortable beds, helpful tips from the host, great value.", "Washing machine instructions only in Japanese.", null],
  ["booking", 8.6, "Nice and central", "Central location, quiet at night, clean kitchenette.", null, null],
  ["booking", 9.8, "Highly recommended", "Perfect for a family trip. Spacious, bright and very clean.", null, "Thank you, we hope to see you again!"],
  ["booking", 8.0, "Good overall", "Friendly communication and a smooth self check-in.", "Hot water ran out during a long shower.", null],
];

// ── 채용 지원서 (폼이 저장하는 고정 선택지는 한국어 원문 — 화면이 현지화한다) ──────────
const APPLICANTS = [
  ["Alex Morgan", "28", "남성", "United States", "Working Holiday", "2027년 3월", "Housekeeping Staff", "아르바이트", ["월", "화", "수"], "3일", "6개월", "30분이내", "예", "Looking for flexible hours while I study Japanese."],
  ["Mina Park", "24", "여성", "Korea", "Student (part-time permit)", "2027년 8월", "Housekeeping Staff", "아르바이트", ["토", "일"], "2일", "1년", "30분~1시간", "아니오", "I enjoy keeping spaces tidy and want weekend work."],
  ["Hiro Tanaka", "31", "남성", "Japan", "없음", "없음", "Front Desk / Guest Support", "정사원", ["월", "화", "수", "목", "금"], "5일", "1년", "30분이내", "예", "Five years of hotel front desk experience."],
  ["Linh Tran", "26", "여성", "Vietnam", "Student (part-time permit)", "2027년 4월 30일", "Housekeeping Staff", "아르바이트", ["화", "목", "금"], "3일", "6개월", "30분~1시간", "아니오", "Saving money for tuition, reliable and punctual."],
  ["Chen Wei", "29", "남성", "China", "Engineer/Specialist", "2028.03.17", "Maintenance Assistant", "정사원", ["월", "화", "수", "목", "금"], "5일", "1년", "30분이내", "예", "Handy with repairs and basic electrical work."],
  ["Sofia Rossi", "23", "여성", "Italy", "Working Holiday", "2027년 1월", "Housekeeping Staff", "아르바이트", ["수", "목", "금", "토"], "4일", "6개월", "1시간이상", "아니오", "Excited to work in Tokyo for a year."],
  ["Kenji Sato", "35", "남성", "Japan", "없음", "없음", "Night Shift Support", "아르바이트", ["금", "토", "일"], "3일", "1년", "30분이내", "예", "Available nights and weekends."],
  ["Emily Johnson", "27", "여성", "Canada", "Working Holiday", "2027년 2월", "Guest Support (English)", "아르바이트", ["월", "수", "금"], "3일", "6개월", "30분~1시간", "예", "Native English speaker with hostel experience."],
  ["Rahul Sharma", "30", "남성", "India", "Permanent Resident", "영주", "Housekeeping Staff", "아르바이트", ["월", "화", "수", "목"], "4일", "1년", "30분이내", "아니오", "Want steady part-time work near home."],
  ["Yuna Kim", "22", "여성", "Korea", "Student (part-time permit)", "2027년 3월", "Housekeeping Staff", "아르바이트", ["토", "일"], "2일", "3개월", "30분~1시간", "아니오", "University student looking for weekend shifts."],
  ["Tom Becker", "33", "남성", "Germany", "Engineer/Specialist", "2028년 6월", "Front Desk / Guest Support", "정사원", ["월", "화", "수", "목", "금"], "5일", "1년", "30분이내", "예", "Hospitality background and fluent in German and English."],
  ["Aiko Yamada", "25", "여성", "Japan", "없음", "없음", "Housekeeping Staff", "아르바이트", ["화", "수", "목"], "3일", "6개월", "30분이내", "아니오", "I like detailed work and teamwork."],
  ["Marco Silva", "28", "남성", "Brazil", "Spouse of Japanese National", "2029.05.20", "Maintenance Assistant", "아르바이트", ["월", "수", "금"], "3일", "1년", "30분~1시간", "예", "Experienced with painting and light repairs."],
  ["Nina Petrova", "26", "여성", "Russia", "Student (part-time permit)", "2026년 12월", "Housekeeping Staff", "아르바이트", ["토", "일", "월"], "3일", "3개월", "30분~1시간", "아니오", "Need extra income while finishing my degree."],
];
const APP_STATUS = ["pending", "pending", "screening", "pending", "interview", "pending", "screening", "pending", "pending", "interview", "screening", "pending", "pending", "pending"];

// ── 건물 정보(가짜 출입 코드) ─────────────────────────────────────────────
const note = "Demo data - fictional access codes for App Store review.";
const BUILDING_INFOS = [
  { name: "아라키초A", shared: [{ labelKey: "storage", code: "0000" }], rooms: ["201", "202", "301", "302", "401", "402", "501", "502", "602", "701", "702"].map((l, i) => ({ roomLabel: l, code: `D${1000 + i * 7}#` })) },
  { name: "아라키초B", shared: [{ labelKey: "roomPassword", code: "123456", noteKey: "allRoomsSame" }, { labelKey: "storagePassword", prefixKey: "floor1", code: "0000" }, { labelKey: "keyBox", prefixKey: "floor1", code: "1111" }], rooms: [] },
  { name: "가부키초", shared: [{ labelKey: "keyBox", prefixKey: "floor1", code: "2222" }], rooms: ["202", "203", "302", "303", "402", "403", "502", "603", "802", "803"].map((l, i) => ({ roomLabel: l, code: `K${2000 + i * 11}#` })) },
  { name: "다카다노바바", shared: [{ labelKey: "storagePassword", prefixKey: "floor1", code: "3333" }, { labelKey: "linenStorageEntrancePassword", prefixKey: "floor1", code: "4444" }, { labelKey: "keyBoxPassword", prefixKey: "floor1", code: "555" }], rooms: ["2f", "3f", "4f", "5f", "6f", "7f", "8f", "9f"].map((l, i) => ({ roomLabel: l, code: `${3000 + i * 13}` })) },
  { name: "오쿠보A", shared: [{ labelKey: "keyBoxPassword", code: "6666" }, { labelKey: "storagePassword", code: "0000" }], rooms: [] },
  { name: "오쿠보B", shared: [{ labelKey: "keyBoxPassword", code: "7777" }, { labelKey: "storagePassword", code: "0000" }], rooms: [] },
  { name: "오쿠보C", shared: [{ labelKey: "doorPassword", code: "8888" }, { labelKey: "keyBoxPassword", code: "9999" }], rooms: [] },
  { name: "STAY ARI Apartment Hotel", shared: [{ labelKey: "keyBoxPassword", code: "1234" }, { labelKey: "storagePassword", code: "0000" }], rooms: [] },
];

// ── 가격 ───────────────────────────────────────────────────────────────────
const BASE_PRICE = {
  "Arakicho A": 14000, "Arakicho B": 15000, Kabukicho: 18000, "STAY ARI Apartment Hotel": 16000,
  Takadanobaba: 12000, "Okubo_A (B棟)": 28000, "Okubo_B (A棟)": 30000, "Okubo_C (kr)": 26000,
};
function priceFor(base, ymd, roomIdx) {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 일 … 6 토
  let p = base * (1 + 0.04 * (roomIdx % 4));
  if (dow === 5 || dow === 6) p *= 1.25;
  else if (dow === 0) p *= 1.05;
  const month = d.getUTCMonth() + 1;
  if (month === 11 || month === 12 || month === 4) p *= 1.15; // 성수기
  const day = d.getUTCDate();
  if (day % 9 === 0) p *= 1.1; // 이벤트 느낌의 작은 요철
  return Math.round(p / 100) * 100;
}

(async () => {
  const db = connect();
  const org = await getDemoOrg(db);
  if (org.slug !== ORG_SLUG) throw new Error("데모 조직이 아니다 — 중단.");
  const orgId = org.id;
  const today = tokyoToday();

  const props = must(await db.from("properties").select("id,name").eq("organization_id", orgId), "건물");
  const propId = new Map(props.map((p) => [p.name, p.id]));
  const rooms = must(await db.from("rooms").select("id,room_label,property_id").eq("organization_id", orgId).order("created_at"), "객실");
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const resv = must(
    await db.from("reservations").select("id,property_name,room_label,guest_name,check_in_date,check_out_date,source_reservation_id,status").eq("organization_id", orgId).lt("check_out_date", today).order("check_out_date", { ascending: false }).limit(200),
    "예약",
  );
  const usable = resv.filter((r) => PROP_BY_KO[r.property_name] && propId.get(PROP_BY_KO[r.property_name]) && r.status !== "cancelled");

  console.log(`조직 ${orgId} · 건물 ${props.length} · 객실 ${rooms.length} · 지난 예약 ${usable.length}`);

  // 지우기
  const TABLES = ["review_translations", "external_reviews", "job_applications", "price_change_logs", "room_daily_rates", "property_operation_infos"];
  if (APPLY || CLEAN) {
    for (const t of TABLES) must(await db.from(t).delete().eq("organization_id", orgId), `${t} 삭제`);
  }
  if (CLEAN) return console.log("삭제 끝.");

  // 행 만들기
  const reviewRows = REVIEWS.map(([provider, score, headline, text, negative, reply], i) => {
    const r = usable[Math.floor((i * usable.length) / REVIEWS.length)];
    const reviewed = addDays(r ? (r.check_out_date < today ? r.check_out_date : today) : addDays(today, -i * 2 - 2), 1);
    const reviewedAt = reviewed > today ? tz(today) : tz(reviewed);
    const scale = provider === "airbnb" ? 5 : 10;
    const risk = provider === "airbnb" ? (score <= 3 ? "risk" : "normal") : score <= 7.0 ? "risk" : "normal";
    const cat = (n) => Math.max(1, Math.min(5, Math.round(score) + n));
    const breakdown =
      provider === "airbnb"
        ? { category_ratings: [{ category: "cleanliness", rating: cat(0) }, { category: "accuracy", rating: cat(0) }, { category: "checkin", rating: cat(1) }, { category: "communication", rating: cat(1) }, { category: "location", rating: cat(0) }, { category: "value", rating: cat(-1) }] }
        : { scoring: { clean: score, comfort: Math.min(10, score + 0.2), facilities: score, location: Math.min(10, score + 0.4), staff: Math.min(10, score + 0.3), value: score } };
    const base = {
      organization_id: orgId,
      provider,
      external_review_id: `demo-${provider}-${String(i + 1).padStart(3, "0")}`,
      rating_value: score,
      rating_scale: scale,
      risk_level: risk,
      rating_breakdown: breakdown,
      reviewed_at: reviewedAt,
      imported_at: reviewedAt,
      source_updated_at: reviewedAt,
      property_id: r ? propId.get(PROP_BY_KO[r.property_name]) : null,
      property_name: r ? r.property_name : null,
      room_label: r ? r.room_label : null,
      reservation_id: r ? r.id : null,
      source_reservation_id: r ? r.source_reservation_id : null,
      guest_display_name: r ? r.guest_name : null,
      source_language_code: "en",
      ota_reply_text: reply,
      ota_replied_at: reply ? reviewedAt : null,
      raw_payload: { demo: true },
    };
    if (provider === "airbnb") return { ...base, review_text: text };
    return { ...base, headline, positive_review_text: text, negative_review_text: negative };
  });

  const appRows = APPLICANTS.map((a, i) => {
    const [name, age, gender, nationality, visa, visaPeriod, position, empType, days, perWeek, duration, commute, exp, motivation] = a;
    const appliedAt = tz(addDays(today, -(i * 2 + 1)), "10:30");
    return {
      organization_id: orgId,
      source: "applications",
      external_id: `demo-app-${String(i + 1).padStart(3, "0")}`,
      job_title: position,
      employment_type: empType,
      applied_position: position,
      applicant_name: name,
      age,
      gender,
      phone: `+81-90-0000-${String(1234 + i * 11).padStart(4, "0")}`,
      kakao_id: null,
      address: "Shinjuku-ku, Tokyo (demo)",
      commute_time: commute,
      uniform_size: ["M", "S", "L"][i % 3],
      nationality,
      visa_type: visa,
      visa_period: visaPeriod,
      work_days: days,
      days_per_week: perWeek,
      duration,
      start_date: i % 3 === 0 ? "즉시가능" : addDays(today, 14 + i),
      has_industry_exp: exp,
      industry_tasks: exp === "예" ? ["Cleaning", "Guest support"] : [],
      source_channel: ["Indeed", "Instagram", "Friend referral", "Company website"][i % 4],
      motivation: `${motivation} (contact: applicant${i + 1}@example.com)`,
      status: APP_STATUS[i],
      status_changed_at: APP_STATUS[i] === "pending" ? null : appliedAt,
      applied_at: appliedAt,
      imported_at: appliedAt,
      raw_payload: { demo: true },
    };
  });

  const infoRows = BUILDING_INFOS.map((b) => ({
    organization_id: orgId,
    canonical_name: b.name,
    shared_access: b.shared,
    room_access: b.rooms,
    note,
  }));

  const rateRows = [];
  rooms.forEach((room, idx) => {
    const base = BASE_PRICE[propName.get(room.property_id)] ?? 15000;
    for (let off = -30; off <= 90; off++) {
      const ymd = addDays(today, off);
      const p1 = priceFor(base, ymd, idx);
      const wk = [5, 6].includes(new Date(`${ymd}T00:00:00Z`).getUTCDay());
      rateRows.push({
        organization_id: orgId,
        room_id: room.id,
        stay_date: ymd,
        price1: p1,
        price2: Math.round((p1 * 1.48) / 100) * 100,
        price3: p1,
        min_stay: wk ? 2 : 1,
        max_stay: 30,
        num_avail: 1,
        override_kind: null,
        synced_at: tz(today, "06:00"),
      });
    }
  });

  const logRows = [];
  const logRooms = rooms.filter((_, i) => i % 4 === 0).slice(0, 12);
  logRooms.forEach((room, i) => {
    const ymd = addDays(today, 3 + i * 4);
    const cur = rateRows.find((r) => r.room_id === room.id && r.stay_date === ymd);
    if (!cur) return;
    const pct = [10, -10, 15, 5, -5][i % 5];
    const oldV = Math.round((cur.price1 / (1 + pct / 100)) / 100) * 100;
    logRows.push({
      organization_id: orgId,
      room_id: room.id,
      external_room_id: `demo-${room.id.slice(0, 8)}`,
      room_label: room.room_label,
      stay_date: ymd,
      field: "price1",
      old_value: oldV,
      new_value: cur.price1,
      adjust_mode: "percent",
      percent_value: pct,
      changed_by_name: "Demo Manager",
      created_at: tz(addDays(today, -(i % 9) - 1), "14:20"),
    });
  });

  console.log(`계획: 게스트 피드백 ${reviewRows.length} · 지원서 ${appRows.length} · 건물 정보 ${infoRows.length} · 요금 ${rateRows.length} · 가격 이력 ${logRows.length}`);
  if (!APPLY) return console.log("dry run — --apply 로 넣기.");

  must(await db.from("external_reviews").insert(reviewRows), "게스트 피드백");
  must(await db.from("job_applications").insert(appRows), "지원서");
  must(await db.from("property_operation_infos").insert(infoRows), "건물 정보");
  for (const part of chunk(rateRows, 1000)) must(await db.from("room_daily_rates").insert(part), "요금");
  if (logRows.length) must(await db.from("price_change_logs").insert(logRows), "가격 이력");

  for (const t of ["external_reviews", "job_applications", "property_operation_infos", "room_daily_rates", "price_change_logs"]) {
    const c = await db.from(t).select("id", { count: "exact", head: true }).eq("organization_id", orgId);
    console.log(`  ${t}: ${c.count}`);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
