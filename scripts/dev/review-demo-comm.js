/**
 * 앱스토어 심사용 데모 — 「Foldy Demo」 조직(slug `stayops-review-demo`)의 소통 기능에 영어 샘플을 넣는다.
 * 공지(announcements · 댓글 · 읽음) · 게시판(글 · 댓글 · 반응 · 신고) · 건의(staff_suggestions · 댓글 · 상태 기록) · 버그 신고.
 * 게시판은 심사자가 신고 · 차단을 시험할 수 있게 심사자 계정이 아닌 다른 사람 글 · 댓글이 있어야 한다. 차단 행은 만들지 않는다.
 * 조직 밖은 읽지도 쓰지도 않는다. 이 표들은 데모 조직에서 비어 있었으므로 --apply 는 이 조직의 해당 표를 모두 지우고 다시 넣는다.
 *
 *   node scripts/dev/review-demo-comm.js           # 계획만 출력 (DB 쓰기 없음)
 *   node scripts/dev/review-demo-comm.js --apply   # 지우고 넣기
 *   node scripts/dev/review-demo-comm.js --clean   # 삭제만
 */
const { ORG_SLUG, connect, getDemoOrg, tokyoToday, addDays } = require("./deck-demo-roster");

const APPLY = process.argv.includes("--apply");
const CLEAN = process.argv.includes("--clean");
const REVIEWER_EMAIL = "stayops.review@haru-tokyo.com";

const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

// Tokyo 날짜 + 시각 -> ISO (예: at(-3, "09:30"))
const TODAY = tokyoToday();
const at = (daysAgo, hm) => new Date(`${addDays(TODAY, -daysAgo)}T${hm}:00+09:00`).toISOString();

(async () => {
  const db = await connect();
  const org = await getDemoOrg(db);
  if (org.slug !== ORG_SLUG) throw new Error("데모 조직이 아니다 — 중단.");
  const orgId = org.id;

  const members = must(await db.from("memberships").select("user_id, role").eq("organization_id", orgId).eq("status", "active"), "소속");
  const ids = members.map((m) => m.user_id);
  const profiles = must(await db.from("profiles").select("id, name, name_en").in("id", ids), "프로필");
  const nameOf = new Map(profiles.map((p) => [p.id, p.name_en || p.name]));
  const roleOf = new Map(members.map((m) => [m.user_id, m.role]));

  let reviewerId = null;
  for (let page = 1; page < 20 && !reviewerId; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    reviewerId = data.users.find((u) => u.email === REVIEWER_EMAIL)?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (!reviewerId || !ids.includes(reviewerId)) throw new Error("심사자 계정이 데모 조직 구성원이 아니다.");

  // 영어 화면에서 읽히는 이름을 앞에 둔다 (Mika Tanaka · Ken Sato, 그 다음 일본식 이름 → 나머지)
  const byName = (n) => profiles.find((p) => p.name === n)?.id;
  const prefer = ["Mika Tanaka", "Ken Sato", "다나카 미사키", "야마모토 레이", "사토 켄"].map(byName).filter(Boolean);
  const rest = ids.filter((i) => i !== reviewerId && !prefer.includes(i));
  const others = [...prefer, ...rest];
  const [A, B, C, D, E] = others;
  console.log(`조직 ${orgId} · 구성원 ${ids.length}명 · 심사자 ${nameOf.get(reviewerId)}`);
  console.log(`작성자: ${[A, B, C, D, E].map((i) => `${nameOf.get(i)}(${roleOf.get(i)})`).join(", ")}`);

  // ───────── 계획 ─────────
  const announcements = [
    { key: "holiday", by: reviewerId, title: "Golden Week schedule and staffing", content: "Golden Week is nearly here. Please submit your shift requests by Friday so we can finalize the roster. Expect full occupancy at Arakicho A and B from the 29th to the 5th, so linen deliveries will be doubled. Reply below if you cannot work a requested day.", important: true, pinned: true, popup: true, daysAgo: 2, hm: "09:00" },
    { key: "linen", by: reviewerId, title: "New linen delivery times", content: "Starting next week the linen supplier will deliver between 8:30 and 9:30 every morning, one hour earlier than before. Please keep the back entrance clear and sign the delivery slip. Short counts should be reported to the office the same day.", important: false, pinned: true, popup: false, daysAgo: 6, hm: "10:15" },
    { key: "safety", by: A, title: "Reminder: fire safety check this Thursday", content: "The building inspector will visit every property on Thursday afternoon. Please make sure emergency exits are unblocked, smoke detectors are not covered, and extinguisher tags are up to date during your cleaning round.", important: true, pinned: false, popup: false, daysAgo: 4, hm: "16:40" },
    { key: "checkin", by: B, title: "Self check-in: updated door code process", content: "Door codes are now sent to guests automatically two hours before check-in. If a guest contacts you about a code, do not reply with the code by chat. Please forward the message to the office team instead.", important: false, pinned: false, popup: false, daysAgo: 9, hm: "11:00" },
    { key: "welcome", by: reviewerId, title: "Welcome to the new team members", content: "Please join us in welcoming three new part-time cleaners who started this week. Show them around the storage rooms and the laundry flow when you get a chance. Thank you for making them feel at home.", important: false, pinned: false, popup: false, daysAgo: 13, hm: "09:30" },
    { key: "waste", by: A, title: "Waste sorting rules updated", content: "The ward office changed the collection days. Burnable waste is now Monday, Wednesday and Friday, and plastics only on Tuesday. A new sorting chart is posted in every building's trash room.", important: false, pinned: false, popup: false, daysAgo: 17, hm: "14:20" },
    { key: "draft", by: reviewerId, title: "Summer uniform order (draft)", content: "Draft: we plan to order summer polo shirts next month. Collecting sizes soon.", status: "draft", important: false, pinned: false, popup: false, daysAgo: 1, hm: "18:00" },
  ];
  const annComments = [
    ["holiday", B, "I can work all days except the 3rd. Submitting my request now.", 2, "10:05"],
    ["holiday", C, "Is there a transport allowance for the early shifts?", 2, "12:30"],
    ["holiday", reviewerId, "Yes, the usual transport allowance applies to early shifts.", 2, "13:10"],
    ["linen", D, "Got it. I will leave the back door unlocked from 8:15.", 5, "09:00"],
    ["safety", E, "Will the inspector need access to the rooftop as well?", 3, "08:50"],
    ["safety", A, "Yes, please keep the rooftop door open until 17:00.", 3, "09:20"],
    ["checkin", C, "Thanks, that makes things much simpler.", 8, "15:00"],
  ];
  const posts = [
    { key: "tips", by: C, title: "Faster bed making: my 5-minute routine", content: "I have been trying a corner-first method for fitted sheets and it saves almost a minute per bed. Happy to show anyone who wants to try it during the next shift.", tags: ["tips"], daysAgo: 1, hm: "19:10" },
    { key: "lost", by: D, title: "Found: black umbrella in room 302", content: "I found a black folding umbrella in room 302 after checkout. It is at the front desk lost-and-found shelf if anyone is asking.", tags: ["lost-found"], daysAgo: 2, hm: "11:45" },
    { key: "vacuum", by: B, title: "Vacuum on floor 4 is making a strange noise", content: "The vacuum stored on the 4th floor started making a loud rattling noise today. Please use the one in the storage room until it is checked.", tags: ["equipment"], daysAgo: 3, hm: "15:30" },
    { key: "lunch", by: E, title: "Good ramen place near Takadanobaba?", content: "Any recommendations for a quick lunch near the Takadanobaba building? I only get a 30 minute break.", tags: ["chat"], daysAgo: 5, hm: "12:05" },
    { key: "thanks", by: A, title: "Thank you for the great week", content: "All 24 rooms were turned over on time on Saturday even with the late checkouts. Great teamwork, everyone.", tags: ["thanks"], daysAgo: 7, hm: "17:50" },
    { key: "swap", by: D, title: "Looking to swap Sunday shift", content: "Can anyone swap a Sunday shift with my Wednesday this week? I have a school event. Please message me if you can help.", tags: ["shift"], daysAgo: 10, hm: "08:30" },
    { key: "rev", by: reviewerId, title: "Reminder: report damages with photos", content: "If you notice any damage during cleaning, please post a photo in the maintenance request instead of messaging in chat. It helps us repair faster.", tags: ["notice"], daysAgo: 4, hm: "09:40" },
    { key: "spam", by: E, title: "Buy cheap watches here!!!", content: "Visit my site for amazing deals on watches, limited offer, click now!", tags: ["chat"], daysAgo: 0, hm: "08:20" },
  ];
  const postComments = [
    ["tips", D, "That is clever, I will try it tomorrow.", 1, "20:00"],
    ["tips", B, "Can you show me on Monday? Thanks!", 1, "21:15"],
    ["lost", A, "Thanks for dropping it off. I will let the guest know.", 2, "12:30"],
    ["vacuum", reviewerId, "Thanks for flagging. I have asked maintenance to check it.", 3, "16:10"],
    ["lunch", C, "There is a small ramen shop two minutes from the station exit.", 5, "12:40"],
    ["lunch", D, "Try the curry place on the second floor, it is quick.", 5, "13:00"],
    ["swap", B, "I can take the Sunday shift. Let us talk at handover.", 10, "10:00"],
    ["spam", C, "This looks like spam, I reported it.", 0, "08:45"],
    ["thanks", reviewerId, "Well done, team!", 7, "18:30"],
  ];
  const reactions = [
    ["tips", [[D, "👍"], [B, "👍"], [A, "❤️"], [reviewerId, "👍"]]],
    ["lost", [[A, "👍"], [reviewerId, "👍"]]],
    ["vacuum", [[C, "😮"], [D, "👍"]]],
    ["thanks", [[reviewerId, "❤️"], [B, "❤️"], [C, "👍"], [D, "😂"]]],
    ["swap", [[B, "👍"]]],
    ["rev", [[A, "👍"], [C, "👍"]]],
  ];
  const suggestions = [
    { key: "s1", by: C, to: reviewerId, title: "More hangers for the guest closets", body: "Several rooms at Arakicho B only have two or three hangers. Guests often ask for more. Could we add five hangers per room?", category: "supplies", status: "reviewing", daysAgo: 3, events: ["submitted", "reviewing"] },
    { key: "s2", by: D, to: reviewerId, title: "Label the storage shelves by room type", body: "It takes time to find the right towel sets. Simple labels on each shelf would help new staff.", category: "operations", status: "completed", completion: "Labels were printed and attached to all storage shelves on Monday.", daysAgo: 12, events: ["submitted", "reviewing", "completed"] },
    { key: "s3", by: E, to: reviewerId, title: "Earlier delivery slot for amenities", body: "Amenity boxes arrive after the first rooms are done. Can we move the delivery to before 9:00?", category: "operations", status: "on_hold", hold: "Waiting for the supplier to confirm their new schedule.", daysAgo: 8, events: ["submitted", "reviewing", "on_hold"] },
    { key: "s4", by: reviewerId, to: A, title: "Add a quick-start guide for new cleaners", body: "A one-page guide with building access, linen flow and checkout rules would help new staff on their first day.", category: "operations", status: "submitted", daysAgo: 1, events: ["submitted"] },
    { key: "s5", by: reviewerId, to: B, title: "Replace the worn mop heads", body: "Mop heads in the Kabukicho storage room are worn out and leave streaks. Please replace them with new ones.", category: "supplies", status: "reviewing", daysAgo: 5, events: ["submitted", "reviewing"] },
  ];
  const sugComments = [
    ["s1", reviewerId, "Thanks for the idea. I am checking prices with the supplier.", 2, "10:00"],
    ["s2", reviewerId, "Great suggestion, this is done now.", 11, "09:30"],
    ["s2", D, "Thank you, it already feels faster!", 11, "10:15"],
    ["s3", reviewerId, "On hold until the supplier replies.", 7, "11:00"],
    ["s5", B, "Noted, I will order them this week.", 4, "13:20"],
  ];
  const bugs = [
    { by: C, title: "Cannot open the photo picker on Android", description: "When I tap the camera icon while recording a cleaning report, the app shows a blank screen. Closing and reopening the app fixes it.", status: "reviewing", daysAgo: 2 },
    { by: D, title: "Notification badge does not clear", description: "The red badge on the bell icon stays after I read all notifications. It disappears after a restart.", status: "submitted", daysAgo: 1 },
    { by: E, title: "Wrong room order on the cleaning list", description: "Rooms on the daily cleaning list sometimes appear in a different order after pulling to refresh.", status: "fixed", daysAgo: 9 },
    { by: reviewerId, title: "Text is cut off in the board filter on small screens", description: "On a small phone the longest filter label is cropped on the board screen.", status: "submitted", daysAgo: 0 },
    { by: B, title: "Duplicate announcement popup", description: "The announcement popup showed twice when I opened the app after logging in.", status: "closed", daysAgo: 15 },
  ];
  const reports = [
    { post: "spam", by: C, author: E, reason: "spam", note: "Looks like an advertisement unrelated to work.", status: "pending", daysAgo: 0, hm: "08:50" },
    { post: "spam", by: D, author: E, reason: "inappropriate", note: null, status: "pending", daysAgo: 0, hm: "09:10" },
    { post: "lunch", by: B, author: E, reason: "other", note: "Off topic, but harmless. Marking for review.", status: "dismissed", daysAgo: 4, hm: "10:00", resolved: true },
  ];

  console.log(`계획: 공지 ${announcements.length} · 공지 댓글 ${annComments.length} · 게시글 ${posts.length} · 게시 댓글 ${postComments.length} · 반응 ${reactions.reduce((n, r) => n + r[1].length, 0)} · 신고 ${reports.length} · 건의 ${suggestions.length} · 건의 댓글 ${sugComments.length} · 버그 ${bugs.length}`);

  // ───────── 지우기 (자식 먼저) ─────────
  if (APPLY || CLEAN) {
    for (const t of ["board_reports", "board_reactions", "board_post_reads"]) {
      const postIds = must(await db.from("board_posts").select("id").eq("organization_id", orgId), "글 조회").map((r) => r.id);
      if (t === "board_reports") must(await db.from(t).delete().eq("organization_id", orgId), `${t} 삭제`);
      else if (postIds.length) must(await db.from(t).delete().in("post_id", postIds), `${t} 삭제`);
    }
    for (const t of ["board_comments", "board_posts", "announcement_comments", "announcement_reads", "staff_suggestion_events", "staff_suggestion_comments", "staff_suggestion_references", "staff_suggestions", "bug_reports", "announcements"]) {
      must(await db.from(t).delete().eq("organization_id", orgId), `${t} 삭제`);
    }
  }
  if (CLEAN || !APPLY) {
    console.log(CLEAN ? "삭제 끝." : "dry run — --apply 로 넣기.");
    return;
  }

  // ───────── 넣기 ─────────
  const annId = new Map();
  for (const a of announcements) {
    const published = a.status !== "draft";
    const row = must(
      await db.from("announcements").insert({
        organization_id: orgId, created_by_user_id: a.by, title: a.title, content: a.content,
        target_scope: "everyone", target_roles: [], status: a.status ?? "published",
        is_important: a.important, is_pinned: a.pinned, show_popup_on_app_open: a.popup,
        popup_until: a.popup ? at(-5, "23:59") : null, allow_comments: true,
        published_at: published ? at(a.daysAgo, a.hm) : null, created_at: at(a.daysAgo, a.hm),
      }).select("id").single(), `공지 ${a.key}`);
    annId.set(a.key, row.id);
  }
  const readRows = [];
  for (const a of announcements.filter((x) => x.status !== "draft")) {
    others.forEach((u, i) => { if ((i + a.daysAgo) % 3 !== 0) readRows.push({ organization_id: orgId, announcement_id: annId.get(a.key), user_id: u, read_at: at(Math.max(a.daysAgo - 1, 0), "12:00") }); });
  }
  must(await db.from("announcement_reads").insert(readRows), "공지 읽음");
  must(await db.from("announcement_comments").insert(annComments.map(([k, u, c, d, hm]) => ({ organization_id: orgId, announcement_id: annId.get(k), user_id: u, content: c, created_at: at(d, hm) }))), "공지 댓글");

  const postId = new Map();
  const postCommentIds = new Map();
  for (const p of posts) {
    const row = must(await db.from("board_posts").insert({ organization_id: orgId, created_by_user_id: p.by, title: p.title, content: p.content, tags: p.tags, created_at: at(p.daysAgo, p.hm) }).select("id").single(), `글 ${p.key}`);
    postId.set(p.key, row.id);
  }
  for (const [k, u, c, d, hm] of postComments) {
    const row = must(await db.from("board_comments").insert({ organization_id: orgId, post_id: postId.get(k), created_by_user_id: u, content: c, created_at: at(d, hm) }).select("id").single(), "게시 댓글");
    if (!postCommentIds.has(k)) postCommentIds.set(k, row.id);
  }
  must(await db.from("board_reactions").insert(reactions.flatMap(([k, rs]) => rs.map(([u, e]) => ({ post_id: postId.get(k), user_id: u, emoji: e })))), "반응");
  must(await db.from("board_reports").insert(reports.map((r) => ({
    organization_id: orgId, reporter_user_id: r.by, target_type: "post", post_id: postId.get(r.post), target_author_user_id: r.author,
    reason: r.reason, note: r.note, status: r.status, resolved_by_user_id: r.resolved ? reviewerId : null, resolved_at: r.resolved ? at(r.daysAgo - 1 < 0 ? 0 : r.daysAgo - 1, "09:00") : null, created_at: at(r.daysAgo, r.hm),
  }))), "신고");

  const sugId = new Map();
  for (const s of suggestions) {
    const row = must(await db.from("staff_suggestions").insert({
      organization_id: orgId, created_by_user_id: s.by, recipient_user_id: s.to, title: s.title, body: s.body, category: s.category,
      status: s.status, hold_reason: s.hold ?? null, completion_note: s.completion ?? null, created_at: at(s.daysAgo, "10:00"), updated_at: at(Math.max(s.daysAgo - 1, 0), "10:00"),
    }).select("id").single(), `건의 ${s.key}`);
    sugId.set(s.key, row.id);
    must(await db.from("staff_suggestion_events").insert(s.events.map((st, i) => ({ organization_id: orgId, suggestion_id: row.id, actor_user_id: i === 0 ? s.by : s.to, status: st, created_at: at(Math.max(s.daysAgo - i, 0), `1${i}:00`) }))), "건의 기록");
  }
  must(await db.from("staff_suggestion_comments").insert(sugComments.map(([k, u, b, d, hm]) => ({ organization_id: orgId, suggestion_id: sugId.get(k), created_by_user_id: u, body: b, created_at: at(d, hm) }))), "건의 댓글");

  must(await db.from("bug_reports").insert(bugs.map((b) => ({
    organization_id: orgId, reported_by_user_id: b.by, title: b.title, description: b.description, status: b.status,
    reviewed_by_user_id: b.status === "submitted" ? null : reviewerId,
    closed_by_user_id: ["fixed", "closed"].includes(b.status) ? reviewerId : null, closed_at: ["fixed", "closed"].includes(b.status) ? at(Math.max(b.daysAgo - 2, 0), "15:00") : null,
    created_at: at(b.daysAgo, "13:00"), updated_at: at(Math.max(b.daysAgo - 1, 0), "13:00"),
  }))), "버그");

  const tables = ["announcements", "announcement_comments", "announcement_reads", "board_posts", "board_comments", "board_reports", "staff_suggestions", "staff_suggestion_comments", "staff_suggestion_events", "bug_reports"];
  for (const t of tables) {
    const { count } = await db.from(t).select("id", { count: "exact", head: true }).eq("organization_id", orgId);
    console.log(`  ${t}: ${count}`);
  }
  console.log("넣기 끝.");
})().catch((e) => { console.error(e.message); process.exit(1); });
