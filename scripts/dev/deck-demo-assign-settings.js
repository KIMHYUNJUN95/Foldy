/**
 * 발표(데크)용 데모 — 「Foldy Demo」 조직(slug `stayops-review-demo`)에 건물 · 객실 목록과 건물별 고정 인력을 넣는다.
 * 배정 설정의 「건물별 고정 인력」 · 「큰 방」 탭은 `rooms` 카탈로그가 있어야 그려지는데 데모 조직에는 없었다.
 * 방 목록은 실제 조직의 객실 번호를 옮겨 적었다(건물마다 모든 방이 보이게).
 *
 *   node scripts/dev/deck-demo-assign-settings.js           # 계획만 출력 (DB 쓰기 없음)
 *   node scripts/dev/deck-demo-assign-settings.js --apply   # 넣기 (멱등 — 이 스크립트가 넣은 행을 지우고 다시 넣음)
 *   node scripts/dev/deck-demo-assign-settings.js --clean   # 이 스크립트가 넣은 행만 삭제
 */
const { ORG_SLUG, ROSTER, connect, getDemoOrg } = require("./deck-demo-roster");

const APPLY = process.argv.includes("--apply");
const CLEAN = process.argv.includes("--clean");
const MARK = "deck-demo"; // rooms.unit_type · properties.external_provider 에 남겨 지울 때 찾는다

// 실제 조직의 객실 번호를 그대로(이름 · 번호만 — 예약 · 사람 데이터는 아님). 건물 이름은 원래 표기 그대로 넣어
// getCanonicalPropertyName 이 정규 이름으로 바꾸게 둔다. 사노(별장)는 카탈로그가 빼므로 넣지 않는다.
const BUILDINGS = {
  "Arakicho A": ["201_2", "202_2", "301_2", "302_2", "401_2_2", "402_2", "501_2", "502_2", "601_2", "602_2", "701_2", "702_2"],
  "Arakicho B": ["Ab101", "Ab102", "Ab201", "Ab202", "Ab301", "Ab302", "Ab401", "Ab402"],
  Kabukicho: ["K202", "K203", "K302", "K303", "K402", "K403", "K502", "K603", "K802", "K803"],
  "STAY ARI Apartment Hotel": ["O101", "O102", "O103", "O105", "O106", "O107", "O108", "O109", "O110", "O201", "O202", "O203", "O205", "O206", "O207", "O208", "O209", "O210", "O302", "O303", "O305", "O306", "O307", "O308", "O309", "O310"],
  Takadanobaba: ["2", "3", "4", "5", "6", "7", "8", "9"],
  "Okubo_A (B棟)": ["오쿠보A"],
  "Okubo_B (A棟)": ["ファミリー"],
  "Okubo_C (kr)": ["OkuboCC"],
};
// 건물별 고정 인력 — ROSTER key 를 순위별로 (가상)
const FIXED = {
  아라키초A: [["d01", "d04"], ["d02"], ["d06"]],
  아라키초B: [["d03"], ["d05", "d08"], []],
  가부키초: [["d02"], ["d07"], ["d09"]],
  다카다노바바: [["d06"], ["d10"], ["d01"]],
  오쿠보A: [["d08"], [], []],
  "STAY ARI Apartment Hotel": [["d04", "d09"], ["d03"], ["d05"]],
};

const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

(async () => {
  const db = await connect();
  const org = await getDemoOrg(db);
  const orgId = org.id ?? org;
  if (org.slug && org.slug !== ORG_SLUG) throw new Error("데모 조직이 아니다 — 중단.");

  const members = must(await db.from("memberships").select("user_id, role, status").eq("organization_id", orgId).eq("status", "active"), "소속");
  const owners = members.filter((m) => ["owner", "senior_managing_director", "field_manager"].includes(m.role)).map((m) => m.user_id);

  const emailToId = new Map();
  for (let page = 1; page < 20; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    for (const u of data.users) emailToId.set(u.email, u.id);
    if (data.users.length < 200) break;
  }
  const keyToId = new Map(ROSTER.map((p) => [p.key, emailToId.get(p.email)]));
  const memberIds = new Set(members.map((m) => m.user_id));

  console.log(`조직 ${orgId} · 배정 담당 ${owners.length}명`);
  for (const [b, rooms] of Object.entries(BUILDINGS)) console.log(`  ${b}: ${rooms.join(", ")}`);

  // 지우기 (이 스크립트가 넣은 것만)
  const oldProps = must(await db.from("properties").select("id").eq("organization_id", orgId).eq("external_provider", MARK), "기존 건물");
  if (APPLY || CLEAN) {
    must(await db.from("rooms").delete().eq("organization_id", orgId).eq("unit_type", MARK), "객실 삭제");
    if (oldProps.length) must(await db.from("properties").delete().in("id", oldProps.map((p) => p.id)), "건물 삭제");
    must(await db.from("cleaning_fixed_staff").delete().eq("organization_id", orgId).in("owner_id", owners), "고정 인력 삭제");
  }
  if (CLEAN || !APPLY) {
    console.log(CLEAN ? "삭제 끝." : "dry run — --apply 로 넣기.");
    return;
  }

  for (const [name, labels] of Object.entries(BUILDINGS)) {
    const prop = must(await db.from("properties").insert({ organization_id: orgId, name, external_provider: MARK }).select("id").single(), `건물 ${name}`);
    must(
      await db.from("rooms").insert(
        labels.map((label) => ({ organization_id: orgId, property_id: prop.id, name: label, room_label: label, status: "active", unit_type: MARK })),
      ),
      `객실 ${name}`,
    );
  }
  const fixed = [];
  for (const owner of owners)
    for (const [property, tiers] of Object.entries(FIXED))
      tiers.forEach((keys, i) =>
        keys.forEach((key, position) => {
          const id = keyToId.get(key);
          if (!id || !memberIds.has(id)) return;
          fixed.push({ organization_id: orgId, owner_id: owner, property_name: property, user_id: id, tier: i + 1, position });
        }),
      );
  if (fixed.length) must(await db.from("cleaning_fixed_staff").insert(fixed), "고정 인력");
  console.log(`넣음 — 건물 ${Object.keys(BUILDINGS).length} · 고정 인력 ${fixed.length}행`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
