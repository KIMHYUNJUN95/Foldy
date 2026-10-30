/**
 * App Store 심사용 데모 — 「Foldy Demo」 조직(slug `stayops-review-demo`)의 「현장 요청」 화면에 샘플 데이터를 넣는다.
 * 대상: 수리·점검(maintenance_reports) · 분실물(lost_items) · 주문 요청(order_requests) ·
 *       컴플레인(customer_complaints · complaint_comments) · 린넨 반품(linen_items · linen_return_records · linen_return_record_items)
 * 심사자는 영어로 앱을 보므로 자유 문구는 영어, 건물 이름은 앱이 저장하는 한국어 정규 이름(아라키초A 등)으로 넣는다.
 * 사진은 넣지 않는다(스토리지 객체 없음). 날짜는 도쿄 오늘 기준 최근 3주.
 *
 *   node scripts/dev/review-demo-field.js           # 계획만 출력 (DB 쓰기 없음)
 *   node scripts/dev/review-demo-field.js --apply   # 이 표들의 데모 조직 행을 전부 지우고(자식 먼저) 다시 넣음
 *   node scripts/dev/review-demo-field.js --clean   # 지우기만
 */
const { ORG_SLUG, connect, getDemoOrg, tokyoToday, addDays } = require("./deck-demo-roster");

const APPLY = process.argv.includes("--apply");
const CLEAN = process.argv.includes("--clean");

const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

const TODAY = tokyoToday();
/** n일 전 도쿄 벽시계 시각 → +09:00 ISO */
const at = (daysAgo, hhmm) => `${addDays(TODAY, -daysAgo)}T${hhmm}:00+09:00`;

// 건물: [정규 이름, 표시 객실 라벨들]
const B = {
  A: "아라키초A",
  Bb: "아라키초B",
  K: "가부키초",
  S: "STAY ARI Apartment Hotel",
  T: "다카다노바바",
  O: "오쿠보A",
};

(async () => {
  const db = await connect();
  const org = await getDemoOrg(db);
  if (org.slug !== ORG_SLUG) throw new Error("데모 조직이 아니다 — 중단.");
  const orgId = org.id;

  // 멤버 (활성)
  const members = must(await db.from("memberships").select("user_id, role").eq("organization_id", orgId).eq("status", "active"), "소속");
  const profiles = must(await db.from("profiles").select("id, name").in("id", members.map((m) => m.user_id)), "프로필");
  const nameOf = new Map(profiles.map((p) => [p.id, p.name]));
  const byRole = (...roles) => members.filter((m) => roles.includes(m.role)).map((m) => m.user_id);
  const staff = byRole("part_time_staff", "staff");
  const managers = byRole("field_manager", "office_admin", "owner");
  if (staff.length < 4 || !managers.length) throw new Error("멤버가 부족하다.");
  const S = (i) => staff[i % staff.length];
  const M = (i) => managers[i % managers.length];

  const props = must(await db.from("properties").select("id, name").eq("organization_id", orgId), "건물");
  const propIdByCanon = new Map();
  for (const p of props) {
    const k = p.name.replace(/[\s_()\-]/g, "").toLowerCase();
    const canon = k.includes("arakichoa") ? B.A : k.includes("arakichob") ? B.Bb : k.includes("kabukicho") ? B.K : k.includes("stayari") ? B.S : k.includes("takadanobaba") ? B.T : k.includes("okuboa") ? B.O : null;
    if (canon) propIdByCanon.set(canon, p.id);
  }

  // ───────── 수리 · 점검 ─────────
  // [건물, 객실(표시), 건물 전체?, 제목, 설명, 분류, 우선순위, 상태, 신고 며칠 전, 시각, 신고자 i, 처리 메모]
  const maint = [
    [B.A, "201", false, "Bathroom faucet is leaking", "Slow drip from the cold tap even when fully closed. Towel placed under the sink.", "water", "high", "open", 0, "09:40", 0],
    [B.K, "503", false, "AC remote is missing", "Guest checked out and the remote is not in the room. Spare needed before tonight's check-in.", "air_conditioning_heating", "urgent", "open", 0, "11:15", 1],
    [B.S, "205", false, "Wi-Fi router keeps dropping", "Guest reported the connection drops every few minutes. Router lights flash orange.", "wifi", "high", "in_progress", 1, "16:20", 2],
    [B.Bb, "302", false, "Desk lamp bulb burnt out", "Replace the E26 bulb on the desk lamp.", "electric", "low", "open", 2, "10:05", 3],
    [B.T, "7", false, "Microwave door will not close", "Hinge looks bent. Heating does not start.", "appliance", "normal", "in_progress", 3, "13:30", 0],
    [B.O, "-", true, "Entrance auto-lock is slow to respond", "Keypad needs two or three presses before it unlocks. Check batteries.", "electric", "normal", "open", 4, "18:10", 1],
    [B.A, "502", false, "Wardrobe door is off its rail", "Left sliding door will not stay on the rail.", "furniture", "normal", "closed", 6, "09:00", 2, "Re-seated the door and tightened the rail screws. Works smoothly now."],
    [B.K, "202", false, "Toilet keeps running", "Water keeps running after flushing.", "water", "high", "closed", 8, "14:45", 3, "Replaced the flapper valve. Checked twice, no more running."],
    [B.S, "309", false, "Stain on the carpet near the bed", "Large coffee stain. Cleaning crew could not remove it.", "cleaning_condition", "normal", "closed", 10, "12:20", 0, "Spot-cleaned by the carpet service. Faint mark remains but acceptable."],
    [B.Bb, "101", false, "Shower head cracked", "Shower head cracked at the base and sprays sideways.", "damage", "high", "closed", 13, "17:00", 1, "Replaced with a spare shower head from storage."],
    [B.T, "3", false, "Hallway light flickers", "Flickers at night in the corridor outside the room.", "electric", "low", "cancelled", 15, "20:30", 2],
    [B.A, "701", false, "Hair dryer not working", "No power. Checked the outlet, it works with a phone charger.", "appliance", "normal", "closed", 17, "10:30", 3, "Swapped for a new hair dryer. Old one disposed."],
  ].map((r, i) => {
    const [bld, room, only, title, desc, cat, pri, st, ago, hhmm, rep, memo] = r;
    const closed = st === "closed";
    return {
      organization_id: orgId,
      reported_by_user_id: S(rep),
      property_name: bld,
      room_label: room,
      is_building_only: only,
      issue_title: title,
      description: desc,
      category: cat,
      priority: pri,
      status: st,
      created_at: at(ago, hhmm),
      completed_at: closed ? at(Math.max(ago - 1, 0), "15:00") : null,
      completed_by: closed ? M(i) : null,
      completed_by_admin: closed,
      resolution_memo: closed ? memo : null,
    };
  });

  // ───────── 분실물 ─────────
  const lost = [
    [B.A, "201", "Phone charger and cable", "electronics", "registered", 0, "10:20", 0, "White USB-C cable with a plug, left in the outlet by the bed.", "Mr. Sample Guest"],
    [B.K, "403", "Black leather wallet", "wallet", "registered", 1, "11:00", 1, "Contains cards and some cash. Handed to the front desk.", "Ms. Example Traveler"],
    [B.S, "208", "Sunglasses", "accessory", "stored", 3, "12:40", 2, "Found under the bed.", "Guest Demo Park"],
    [B.T, "5", "Blue umbrella", "umbrella", "stored", 5, "09:50", 3, "Folding umbrella left in the entrance.", null],
    [B.Bb, "202", "Passport holder", "document", "stored", 7, "15:10", 0, "Empty passport holder. Guest has been contacted by email.", "Demo Visitor Lee"],
    [B.A, "602", "Child's cardigan", "clothing", "disposal_scheduled", 14, "10:00", 1, "Pink cardigan, size 100. No reply from the guest.", null],
    [B.K, "302", "Shampoo bottle", "toiletry", "disposed", 19, "13:20", 2, "Half-used bottle left in the bath.", null],
    [B.S, "110", "Laptop bag", "bag", "returned", 12, "16:30", 3, "Gray laptop bag with a charger inside.", "Sample Traveler Kim"],
  ].map((r, i) => {
    const [bld, room, name, cat, st, ago, hhmm, rep, memo, guest] = r;
    const o = {
      organization_id: orgId,
      reported_by_user_id: S(rep),
      property_name: bld,
      room_label: `${bld} ${room}`,
      item_name: name,
      category: cat,
      status: st,
      memo,
      guest_name: guest,
      found_at: at(ago, hhmm),
      created_at: at(ago, hhmm),
      // 일괄 insert 는 행마다 키가 같아야 한다(빠진 키는 null 로 들어가 not null 에 걸림)
      handled_by_admin: false,
      hold_until: null,
      hold_reason: null,
      handling_memo: null,
      handled_at: null,
      handled_by: null,
      return_method: null,
      return_tracking_no: null,
    };
    if (st === "stored") {
      o.hold_until = addDays(TODAY, 30 - ago);
      o.hold_reason = "Held at the front desk for one month";
    }
    if (st === "disposal_scheduled") {
      o.hold_until = addDays(TODAY, 3);
      o.hold_reason = "Holding period ends soon";
      o.handling_memo = "Scheduled for disposal if the guest does not respond.";
    }
    if (st === "disposed") {
      o.handled_at = at(Math.max(ago - 8, 0), "11:00");
      o.handled_by = M(i);
      o.handled_by_admin = true;
      o.handling_memo = "Disposed after the holding period.";
    }
    if (st === "returned") {
      o.handled_at = at(ago - 4, "14:00");
      o.handled_by = M(i);
      o.handled_by_admin = true;
      o.return_method = "delivery";
      o.return_tracking_no = "5012-3456-7890";
      o.handling_memo = "Shipped to the guest by courier at their expense.";
    }
    return o;
  });

  // ───────── 주문 요청 ─────────
  const it = (id, name, quantity, memo = "", link = "") => ({ id, name, quantity, memo, link });
  const orders = [
    [B.A, "requested", "high", 0, 0, "Running low before the weekend arrivals.", [it("i1", "Toilet paper (12 rolls)", "6", "Double ply"), it("i2", "Tissue boxes", "10")], null],
    [B.K, "requested", "normal", 1, 1, "Guests are asking for extra hangers.", [it("i1", "Clothes hangers", "30", "Slim non-slip type")], null],
    [B.S, "approved", "normal", 3, 2, "Replacement for worn-out items.", [it("i1", "Bath mats", "8"), it("i2", "Slippers", "20", "Disposable")], "Approved. Please order from the usual supplier."],
    [B.T, "ordered", "high", 5, 3, "Coffee ran out in two rooms.", [it("i1", "Drip coffee bags (100 pack)", "2"), it("i2", "Tea bags (50 pack)", "2")], "Ordered, arriving within the week.", 2],
    [B.Bb, "received", "normal", 9, 0, "Weekly amenity restock.", [it("i1", "Shampoo refill (5L)", "2"), it("i2", "Body soap refill (5L)", "2")], "Received and stored in the supply closet.", -3],
    [B.O, "closed", "normal", 14, 1, "Cleaning supplies.", [it("i1", "Kitchen sponges", "20"), it("i2", "Trash bags 45L (100 pack)", "3")], "Delivered and checked.", -9],
    [B.A, "closed", "high", 18, 2, "Replacement vacuum filters.", [it("i1", "Vacuum cleaner filter", "4", "Model VC-200")], "Delivered and checked.", -14],
  ].map((r) => {
    const [bld, st, urg, ago, rep, reason, items, memo, deliv] = r;
    const o = {
      organization_id: orgId,
      reported_by_user_id: S(rep),
      building_name: bld,
      room_label: "-",
      title: items[0].name,
      description: items[0].memo || null,
      reason,
      urgency: urg,
      status: st,
      items,
      admin_memo: memo,
      created_at: at(ago, "10:30"),
      delivery_date: null,
      delivery_start_date: null,
      delivery_end_date: null,
    };
    if (deliv !== undefined) {
      const d = addDays(TODAY, deliv);
      o.delivery_date = d;
      o.delivery_start_date = d;
      o.delivery_end_date = d;
    }
    return o;
  });

  // ───────── 컴플레인 ─────────
  const complaints = [
    [B.A, "401", "Noise from the next room late at night", "airbnb", "open", 2, 1, "Guest could not sleep because of loud voices after midnight.", "Sample Guest A", [["Spoke to the neighbouring guests at the front desk. Checking again tonight.", 0, 1], ["Guest asked for a partial refund. Waiting for manager approval.", 1, 1]]],
    [B.S, "303", "Air conditioner was too weak", "booking", "open", 1, 2, "Room stayed warm even at the lowest setting.", "Sample Guest B", [["Maintenance has been asked to check the unit.", 0, 0]]],
    [B.K, "602", "Room was not fully cleaned", "airbnb", "open", 0, 2, "Hair found in the bathroom and the trash was not emptied.", "Sample Guest C", []],
    [B.T, "4", "Check-in instructions were unclear", "direct", "resolved", 6, 3, "Guest had trouble finding the key box.", "Sample Guest D", [["Added photos to the check-in message template.", 0, 6], ["Confirmed with the guest, issue resolved.", 1, 5]]],
    [B.Bb, "201", "Towels were stained", "google", "resolved", 11, 3, "Two towels had visible stains.", "Sample Guest E", [["Replaced all towels in this room and reported to the laundry vendor.", 0, 10]]],
    [B.O, null, "Hot water ran out in the morning", "booking", "resolved", 16, 3, "Hot water stopped during a morning shower.", "Sample Guest F", [["Water heater was reset by maintenance. Monitoring.", 0, 15]]],
  ];

  // ───────── 린넨 ─────────
  const linenCatalog = [
    ["duvet_single", "싱글 이불 커버"],
    ["duvet_double", "더블 이불 커버"],
    ["mattress_single", "싱글 매트리스 커버"],
    ["mattress_double", "더블 매트리스 커버"],
    ["pillow", "베개 커버"],
    ["towel", "수건"],
    ["mat", "발 매트"],
  ];
  // [건물, 며칠 전, 시각, 등록자, 메모, {품목 code: 수량}]
  const linenRecords = [
    [B.A, 0, "10:10", 0, "Stains on three duvet covers, set aside for the vendor.", { duvet_single: 3, towel: 6 }],
    [B.K, 2, "11:30", 1, "", { pillow: 4, towel: 8, mat: 2 }],
    [B.S, 4, "09:40", 2, "Cart 2 used for pickup.", { duvet_double: 5, mattress_double: 2, towel: 10 }],
    [B.Bb, 7, "14:15", 3, "", { duvet_single: 2, pillow: 3 }],
    [B.T, 9, "10:50", 0, "Weekend check-out batch.", { towel: 12, mat: 3, mattress_single: 1 }],
    [B.A, 12, "13:20", 1, "", { duvet_double: 4, pillow: 5 }],
    [B.O, 16, "15:00", 2, "Elevator maintenance delayed pickup by one day.", { duvet_single: 2, towel: 4 }],
    [B.S, 19, "11:45", 3, "", { mattress_single: 2, mat: 4, towel: 7 }],
  ];

  console.log(`조직 ${orgId} · 직원 ${staff.length}명 · 관리자 ${managers.length}명 (${[...new Set(staff.map((x) => nameOf.get(x)))].slice(0, 3).join(", ")} ...)`);
  console.log(`계획 — 수리 ${maint.length} · 분실물 ${lost.length} · 주문 ${orders.length} · 컴플레인 ${complaints.length} (댓글 ${complaints.reduce((n, c) => n + c[9].length, 0)}) · 린넨 품목 ${linenCatalog.length} · 린넨 기록 ${linenRecords.length}`);

  if (APPLY || CLEAN) {
    // 자식 먼저
    const recIds = must(await db.from("linen_return_records").select("id").eq("organization_id", orgId), "린넨 기록 조회").map((r) => r.id);
    if (recIds.length) must(await db.from("linen_return_record_items").delete().in("return_record_id", recIds), "린넨 기록 품목 삭제");
    must(await db.from("linen_return_records").delete().eq("organization_id", orgId), "린넨 기록 삭제");
    must(await db.from("linen_items").delete().eq("organization_id", orgId), "린넨 품목 삭제");
    must(await db.from("complaint_comments").delete().eq("organization_id", orgId), "컴플레인 댓글 삭제");
    must(await db.from("customer_complaints").delete().eq("organization_id", orgId), "컴플레인 삭제");
    must(await db.from("order_requests").delete().eq("organization_id", orgId), "주문 삭제");
    must(await db.from("lost_items").delete().eq("organization_id", orgId), "분실물 삭제");
    must(await db.from("maintenance_reports").delete().eq("organization_id", orgId), "수리 삭제");
  }
  if (CLEAN || !APPLY) {
    console.log(CLEAN ? "삭제 끝." : "dry run — --apply 로 넣기.");
    return;
  }

  must(await db.from("maintenance_reports").insert(maint), "수리 입력");
  must(await db.from("lost_items").insert(lost), "분실물 입력");
  must(await db.from("order_requests").insert(orders), "주문 입력");

  for (const [i, c] of complaints.entries()) {
    const [bld, room, title, platform, st, ago, rating, desc, guest, comments] = c;
    const row = must(
      await db
        .from("customer_complaints")
        .insert({
          organization_id: orgId,
          created_by_user_id: M(i),
          title,
          platform,
          status: st,
          description: desc,
          rating,
          guest_name: guest,
          property_id: propIdByCanon.get(bld) ?? null,
          property_name: bld,
          room_label: room,
          created_at: at(ago, "12:00"),
          resolved_at: st === "resolved" ? at(Math.max(ago - 1, 0), "17:00") : null,
          resolved_by_user_id: st === "resolved" ? M(i) : null,
        })
        .select("id")
        .single(),
      "컴플레인 입력",
    );
    if (comments.length) {
      must(
        await db.from("complaint_comments").insert(
          comments.map(([content, who, cago], k) => ({
            organization_id: orgId,
            complaint_id: row.id,
            created_by_user_id: M(who + k),
            content,
            created_at: at(Math.min(cago, ago), `${13 + k}:00`),
          })),
        ),
        "댓글 입력",
      );
    }
  }

  const items = must(
    await db
      .from("linen_items")
      .insert(linenCatalog.map(([code, name], k) => ({ organization_id: orgId, code, name, display_order: k + 1, is_active: true, building_name: null })))
      .select("id, code"),
    "린넨 품목 입력",
  );
  const itemId = new Map(items.map((x) => [x.code, x.id]));
  for (const [bld, ago, hhmm, who, note, qty] of linenRecords) {
    const rec = must(
      await db
        .from("linen_return_records")
        .insert({
          organization_id: orgId,
          building_name: bld,
          registered_by_user_id: S(who),
          registered_at: at(ago, hhmm),
          note: note || null,
        })
        .select("id")
        .single(),
      "린넨 기록 입력",
    );
    must(
      await db.from("linen_return_record_items").insert(
        Object.entries(qty).map(([code, quantity], k) => ({ return_record_id: rec.id, linen_item_id: itemId.get(code), quantity, sort_order: k })),
      ),
      "린넨 기록 품목 입력",
    );
  }

  const cnt = async (t) => (await db.from(t).select("id", { count: "exact", head: true }).eq("organization_id", orgId)).count;
  const out = {};
  for (const t of ["maintenance_reports", "lost_items", "order_requests", "customer_complaints", "complaint_comments", "linen_items", "linen_return_records"]) out[t] = await cnt(t);
  console.log("넣음 —", JSON.stringify(out));
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
