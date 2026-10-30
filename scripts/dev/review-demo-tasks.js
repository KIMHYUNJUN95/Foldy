/**
 * 앱스토어 심사용 데모 — 「Foldy Demo」 조직(slug `stayops-review-demo`)에 할 일 샘플을 채운다.
 * 대상: projects · project_sections · project_participants · tasks · task_participants · task_updates ·
 *       task_occurrence_state (반복 회차 완료). 보고서 자동 보내기(task_report_schedules)는 없던 일이라 넣지 않는다.
 * 심사 계정(stayops.review@haru-tokyo.com, owner)이 작성자 · 참여자인 할 일을 많이 넣어 내 목록이 차게 한다.
 * 문구는 영어(심사자가 영어로 본다). 날짜는 도쿄 오늘 기준 상대.
 *
 *   node scripts/dev/review-demo-tasks.js           # 계획만 출력 (DB 쓰기 없음)
 *   node scripts/dev/review-demo-tasks.js --apply   # 데모 조직의 위 테이블 행을 모두 지우고 다시 넣음
 *   node scripts/dev/review-demo-tasks.js --clean   # 지우기만
 */
const crypto = require("crypto");
const { ORG_SLUG, connect, getDemoOrg, tokyoToday, addDays } = require("./deck-demo-roster");

const APPLY = process.argv.includes("--apply");
const CLEAN = process.argv.includes("--clean");
const REVIEWER = "stayops.review@haru-tokyo.com";

const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};
const uuid = () => crypto.randomUUID();
const iso = (ymd, hm) => `${ymd}T${hm}:00+09:00`;

(async () => {
  const db = await connect();
  const org = await getDemoOrg(db);
  if (org.slug !== ORG_SLUG) throw new Error("데모 조직이 아니다 — 중단.");
  const orgId = org.id;

  const members = must(await db.from("memberships").select("user_id, role").eq("organization_id", orgId).eq("status", "active"), "소속");
  const memberIds = new Set(members.map((m) => m.user_id));
  const profiles = [];
  for (let page = 1; page < 20; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    for (const u of data.users) if (memberIds.has(u.id)) profiles.push({ id: u.id, email: u.email });
    if (data.users.length < 200) break;
  }
  const reviewer = profiles.find((p) => p.email === REVIEWER);
  if (!reviewer) throw new Error("심사 계정이 데모 조직 멤버가 아니다.");
  const others = profiles.filter((p) => p.id !== reviewer.id);
  if (others.length < 3) throw new Error("다른 멤버가 3명 미만 — 중단.");
  const R = reviewer.id;
  const deckAdminProfile = must(await db.from("profiles").select("id").in("id", [...memberIds]).eq("name", "데모 관리자").maybeSingle(), "데모 관리자");
  const deckAdmin = deckAdminProfile?.id ?? null;
  const P = (i) => others[i % others.length].id;
  console.log(`조직 ${orgId} · 멤버 ${profiles.length}명 · 심사 계정 ${R}`);

  // 지우기 (자식 먼저). tasks 를 지우면 participants/updates/occurrence_* 는 cascade 이지만 명시적으로 지운다.
  const delAll = async () => {
    const tIds = must(await db.from("tasks").select("id").eq("organization_id", orgId), "기존 할 일").map((t) => t.id);
    const pIds = must(await db.from("projects").select("id").eq("organization_id", orgId), "기존 프로젝트").map((p) => p.id);
    for (let i = 0; i < tIds.length; i += 100) {
      const c = tIds.slice(i, i + 100);
      must(await db.from("task_updates").delete().in("task_id", c), "update 삭제");
      must(await db.from("task_participants").delete().in("task_id", c), "participant 삭제");
    }
    must(await db.from("task_occurrence_order").delete().eq("organization_id", orgId), "order 삭제");
    must(await db.from("task_occurrence_state").delete().eq("organization_id", orgId), "state 삭제");
    must(await db.from("tasks").delete().eq("organization_id", orgId), "tasks 삭제");
    if (pIds.length) {
      must(await db.from("project_sections").delete().in("project_id", pIds), "section 삭제");
      must(await db.from("project_participants").delete().in("project_id", pIds), "project participant 삭제");
    }
    must(await db.from("projects").delete().eq("organization_id", orgId), "projects 삭제");
  };

  const today = tokyoToday();
  const d = (n) => addDays(today, n);
  // 월 반복 앵커: 지난 달 25일 → 오늘 이전의 가장 가까운 25일 (anchor 는 고정)
  const monthAnchor = (() => {
    const [y, m] = today.split("-").map(Number);
    const pm = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    return `${pm.y}-${String(pm.m).padStart(2, "0")}-25`;
  })();

  // ── 프로젝트
  const projA = uuid();
  const projB = uuid();
  const secA = { deep: uuid(), linen: uuid(), done: uuid() };
  const secB = { legal: uuid(), setup: uuid(), launch: uuid() };
  const projects = [
    { id: projA, organization_id: orgId, created_by_user_id: R, title: "Spring deep-clean", description: "Seasonal deep clean of all guest rooms and common areas before the golden week rush.", is_shared: true, sort_order: 1 },
    { id: projB, organization_id: orgId, created_by_user_id: R, title: "New building opening", description: "Everything needed to open the new Shinjuku annex to guests.", is_shared: true, sort_order: 2 },
  ];
  const sections = [
    { id: secA.deep, project_id: projA, title: "Rooms", sort_order: 1 },
    { id: secA.linen, project_id: projA, title: "Linen & supplies", sort_order: 2 },
    { id: secA.done, project_id: projA, title: "Common areas", sort_order: 3 },
    { id: secB.legal, project_id: projB, title: "Licenses & inspections", sort_order: 1 },
    { id: secB.setup, project_id: projB, title: "Furnishing & setup", sort_order: 2 },
    { id: secB.launch, project_id: projB, title: "Listing & launch", sort_order: 3 },
  ];
  const projectParticipants = [
    { project_id: projA, user_id: R, role: "owner", is_first_recipient: false, added_by_user_id: R },
    { project_id: projA, user_id: P(0), role: "member", is_first_recipient: true, added_by_user_id: R },
    { project_id: projA, user_id: P(1), role: "member", is_first_recipient: false, added_by_user_id: R },
    { project_id: projB, user_id: R, role: "owner", is_first_recipient: false, added_by_user_id: R },
    { project_id: projB, user_id: P(2), role: "member", is_first_recipient: true, added_by_user_id: R },
    { project_id: projB, user_id: P(0), role: "member", is_first_recipient: false, added_by_user_id: R },
  ];

  // ── 할 일. who = 작성자 key ("R" 또는 index), with = 추가 참여자 index 들
  const tasks = [];
  const mk = (o) => {
    const t = {
      id: uuid(), title: "", description: null, scheduled_date: null, due_at: null, all_day: true, time_label: null,
      priority: "normal", status: "open", is_inbox: false, is_shared: false, recurrence_rule: null, tags: [],
      project_id: null, section_id: null, author: R, with: [], completed: false, ...o,
    };
    tasks.push(t);
    return t;
  };

  // 오늘 (심사 계정)
  mk({ title: "Review this week's cleaning assignments", description: "Check that every checkout room tomorrow has a cleaner assigned.", scheduled_date: d(0), due_at: iso(d(0), "10:00"), all_day: false, time_label: "10:00", priority: "important", tags: ["cleaning"], key: "t_today1" });
  mk({ title: "Call the plumber about Room 302 leak", description: "Slow leak under the bathroom sink reported yesterday.", scheduled_date: d(0), due_at: iso(d(0), "14:00"), all_day: false, time_label: "14:00", priority: "urgent", tags: ["maintenance"], with: [1], key: "t_today2" });
  mk({ title: "Approve part-time shift requests", scheduled_date: d(0), priority: "normal", tags: ["shifts"], key: "t_today3" });
  mk({ title: "Restock guest amenities at front desk", scheduled_date: d(0), priority: "normal", tags: ["supplies"], author: P(0), with: ["R"], key: "t_today4" });
  mk({ title: "Reply to guest message about late check-in", scheduled_date: d(0), due_at: iso(d(0), "17:30"), all_day: false, time_label: "17:30", priority: "important", tags: ["guest"], key: "t_today5" });
  // 지연
  mk({ title: "Order replacement towels (Arakicho B)", scheduled_date: d(-2), priority: "important", tags: ["supplies"], key: "t_over1" });
  mk({ title: "Update the lost & found shelf labels", scheduled_date: d(-4), priority: "normal", tags: ["lost-found"], author: P(1), with: ["R"], key: "t_over2" });
  mk({ title: "Send monthly report to the owner", scheduled_date: d(-1), priority: "urgent", tags: ["report"], key: "t_over3" });
  // 예정
  mk({ title: "Interview new part-time cleaner", scheduled_date: d(1), due_at: iso(d(1), "11:00"), all_day: false, time_label: "11:00", duration_minutes: 45, priority: "important", tags: ["hiring"], key: "t_up1" });
  mk({ title: "Check air conditioner filters in all rooms", scheduled_date: d(2), priority: "normal", tags: ["maintenance"], with: [2], key: "t_up2" });
  mk({ title: "Renew the building insurance quote", scheduled_date: d(5), priority: "normal", tags: ["admin"], key: "t_up3" });
  mk({ title: "Prepare staff meeting agenda", scheduled_date: d(3), due_at: iso(d(3), "09:30"), all_day: false, time_label: "09:30", priority: "normal", tags: ["meeting"], with: [0, 1], is_shared: true, key: "t_up4" });
  mk({ title: "Test the new key box code rotation", scheduled_date: d(7), priority: "normal", tags: ["security"], author: P(2), with: ["R"], key: "t_up5" });
  // 관리함 (날짜 없음)
  mk({ title: "Look into a laundry vendor for peak season", is_inbox: true, priority: "normal", key: "t_in1" });
  mk({ title: "Ask about a multilingual welcome guide", is_inbox: true, priority: "normal", tags: ["guest"], key: "t_in2" });
  mk({ title: "Idea: QR code for house rules in each room", is_inbox: true, priority: "normal", key: "t_in3" });
  // 완료
  mk({ title: "Fix the broken lock on Room 205", scheduled_date: d(-3), priority: "urgent", status: "completed", completed: true, completedAt: iso(d(-3), "16:20"), tags: ["maintenance"], key: "t_done1" });
  mk({ title: "Update the check-in instructions PDF", scheduled_date: d(-1), priority: "normal", status: "completed", completed: true, completedAt: iso(d(-1), "13:05"), tags: ["guest"], key: "t_done2" });
  mk({ title: "Confirm cleaner schedule for the weekend", scheduled_date: d(-2), priority: "important", status: "completed", completed: true, completedAt: iso(d(-2), "18:10"), author: P(0), with: ["R"], key: "t_done3" });
  mk({ title: "Photograph the renovated Room 410", scheduled_date: d(-5), status: "completed", completed: true, completedAt: iso(d(-5), "15:00"), key: "t_done4" });

  // 프로젝트 A — Spring deep-clean
  mk({ title: "Deep-clean bathrooms, floors 2-4", project_id: projA, section_id: secA.deep, scheduled_date: d(2), priority: "important", with: [0], key: "a1" });
  mk({ title: "Steam-clean carpets in family rooms", project_id: projA, section_id: secA.deep, scheduled_date: d(4), priority: "normal", with: [1], key: "a2" });
  mk({ title: "Wash and rotate all duvets", project_id: projA, section_id: secA.linen, scheduled_date: d(3), priority: "normal", with: [0], key: "a3" });
  mk({ title: "Order extra cleaning supplies", project_id: projA, section_id: secA.linen, scheduled_date: d(-1), priority: "important", key: "a4" });
  mk({ title: "Clean the entrance and elevator hall", project_id: projA, section_id: secA.done, scheduled_date: d(6), priority: "normal", with: [1], key: "a5" });
  mk({ title: "Window cleaning booking", project_id: projA, section_id: secA.done, scheduled_date: d(-4), status: "completed", completed: true, completedAt: iso(d(-4), "11:30"), key: "a6" });
  // 프로젝트 B — New building opening
  mk({ title: "Submit minpaku notification to the ward office", project_id: projB, section_id: secB.legal, scheduled_date: d(1), priority: "urgent", key: "b1" });
  mk({ title: "Fire safety inspection appointment", project_id: projB, section_id: secB.legal, scheduled_date: d(8), priority: "important", with: [2], key: "b2" });
  mk({ title: "Order beds and mattresses (12 rooms)", project_id: projB, section_id: secB.setup, scheduled_date: d(-3), priority: "important", with: [0], key: "b3" });
  mk({ title: "Install smart locks", project_id: projB, section_id: secB.setup, scheduled_date: d(10), priority: "normal", with: [2], key: "b4" });
  mk({ title: "Write listing descriptions (EN / JA)", project_id: projB, section_id: secB.launch, scheduled_date: d(12), priority: "normal", key: "b5" });
  mk({ title: "Choose the opening-day rate plan", project_id: projB, section_id: secB.launch, scheduled_date: d(-6), status: "completed", completed: true, completedAt: iso(d(-6), "17:00"), key: "b6" });

  // 반복 (앵커 고정, 회차는 가상). series_id = 자기 id
  const mondayAnchor = (() => {
    // 오늘 이전의 가장 가까운 월요일에서 3주 전
    const dt = new Date(`${today}T00:00:00Z`);
    const back = (dt.getUTCDay() + 6) % 7;
    return addDays(today, -back - 21);
  })();
  const linen = mk({ title: "Weekly linen count", description: "Count clean and dirty linen at every building and log the totals.", scheduled_date: mondayAnchor, recurrence_rule: "weekly", priority: "normal", tags: ["linen"], with: [0], key: "r1" });
  const fire = mk({ title: "Monthly fire-extinguisher check", description: "Check pressure gauges and expiry dates on every floor.", scheduled_date: monthAnchor, recurrence_rule: "monthly", priority: "important", tags: ["safety"], with: [1], key: "r2" });
  const trash = mk({ title: "Daily lobby and trash-room round", scheduled_date: d(-10), recurrence_rule: "daily", priority: "normal", tags: ["cleaning"], author: P(0), with: ["R"], key: "r3" });
  const stock = mk({ title: "Weekday amenity stock check", scheduled_date: d(-14), recurrence_rule: "weekdays", priority: "normal", tags: ["supplies"], key: "r4" });
  for (const t of [linen, fire, trash, stock]) t.series = true;

  const userOf = (x) => (x === "R" ? R : x);
  const rows = tasks.map((t, i) => ({
    id: t.id, organization_id: orgId, created_by_user_id: userOf(t.author), title: t.title, description: t.description,
    scheduled_date: t.scheduled_date, due_at: t.due_at, all_day: t.all_day, time_label: t.time_label,
    duration_minutes: t.duration_minutes ?? null, priority: t.priority, status: t.status, is_inbox: t.is_inbox,
    is_shared: t.is_shared || t.with.length > 0, recurrence_rule: t.recurrence_rule, tags: t.tags,
    project_id: t.project_id, section_id: t.section_id, sort_order: i + 1,
    recurrence_series_id: t.series ? t.id : null, recurrence_instance_date: t.series ? t.scheduled_date : null,
    completed_at: t.completedAt ?? null, completed_by_user_id: t.completed ? userOf(t.author) : null,
    created_at: iso(addDays(t.scheduled_date ?? today, -3 < 0 ? -3 : 0), "09:00"),
  }));

  const participants = [];
  for (const t of tasks) {
    const author = userOf(t.author);
    participants.push({ task_id: t.id, user_id: author, role: "author", is_first_recipient: false, added_by_user_id: author });
    const seen = new Set([author]);
    for (const w of t.with) {
      const uid = w === "R" ? R : P(w);
      if (seen.has(uid)) continue;
      seen.add(uid);
      participants.push({ task_id: t.id, user_id: uid, role: "participant", is_first_recipient: seen.size === 2, added_by_user_id: author });
    }
    // 발표 · 확인용 「데모 관리자」 계정으로 열어도 심사 계정과 같은 목록이 보이게 참여자로 같이 넣는다.
    if (deckAdmin && seen.has(R) && !seen.has(deckAdmin)) {
      participants.push({ task_id: t.id, user_id: deckAdmin, role: "participant", is_first_recipient: false, added_by_user_id: author });
    }
  }

  const byKey = Object.fromEntries(tasks.map((t) => [t.key, t]));
  const upd = (key, type, body, by, at) => ({ task_id: byKey[key].id, created_by_user_id: by, update_type: type, body, created_at: at });
  const updates = [
    upd("t_today2", "note", "Plumber can come at 3pm. Please leave the key at the front desk.", P(1), iso(d(0), "08:40")),
    upd("t_today2", "note", "Got it, I will let the front desk know.", R, iso(d(0), "08:55")),
    upd("t_over1", "note", "Supplier says delivery takes 3 business days.", R, iso(d(-2), "12:10")),
    upd("t_up4", "note", "Added agenda items: summer shifts, new linen vendor, safety drill.", R, iso(d(-1), "19:00")),
    upd("t_up4", "note", "Can we also discuss the key box rotation?", P(0), iso(d(0), "07:50")),
    upd("t_done1", "note", "Replaced the lock cylinder. Tested with 3 guest codes.", R, iso(d(-3), "16:15")),
    upd("t_done1", "completed", null, R, iso(d(-3), "16:20")),
    upd("t_done2", "completed", null, R, iso(d(-1), "13:05")),
    upd("a1", "note", "Floors 2 and 3 done, floor 4 tomorrow.", P(0), iso(d(-1), "17:40")),
    upd("a3", "note", "We are short on duvet covers, ordering more.", P(0), iso(d(-1), "10:20")),
    upd("a3", "status_changed", "Status changed to in progress", P(0), iso(d(-1), "10:21")),
    upd("b1", "note", "Documents are ready. Need a copy of the floor plan from the architect.", P(2), iso(d(-1), "15:00")),
    upd("b3", "note", "Quote approved: 12 beds, delivery in two weeks.", R, iso(d(-3), "11:15")),
    upd("b6", "completed", null, R, iso(d(-6), "17:00")),
    upd("r1", "note", "Last count: Arakicho A 214 sets, B 168 sets, Kabukicho 120 sets.", P(0), iso(d(-2), "12:00")),
    upd("r2", "note", "Two extinguishers on the 3rd floor expire next month.", P(1), iso(d(-5), "14:30")),
  ];
  // 반복 완료 회차: 주간(마지막 두 회차), 월간(앵커 회차), 일간(어제), 평일(최근 평일)
  const wk = [];
  for (let a = mondayAnchor; a < today && wk.length < 3; a = addDays(a, 7)) wk.push(a);
  const states = [
    ...wk.slice(0, 3).map((od) => ({ task_id: linen.id, occurrence_date: od, organization_id: orgId, state: "completed", completed_by_user_id: P(0) })),
    { task_id: fire.id, occurrence_date: monthAnchor, organization_id: orgId, state: "completed", completed_by_user_id: P(1) },
    { task_id: trash.id, occurrence_date: d(-1), organization_id: orgId, state: "completed", completed_by_user_id: R },
    { task_id: trash.id, occurrence_date: d(-2), organization_id: orgId, state: "completed", completed_by_user_id: R },
    { task_id: stock.id, occurrence_date: d(-3), organization_id: orgId, state: "skipped", completed_by_user_id: null },
  ];

  console.log(`projects ${projects.length} · sections ${sections.length} · project_participants ${projectParticipants.length} · tasks ${rows.length} · task_participants ${participants.length} · task_updates ${updates.length} · occurrence_state ${states.length}`);
  console.log(`반복 앵커: weekly ${mondayAnchor}, monthly ${monthAnchor}`);

  if (CLEAN) { await delAll(); console.log("삭제 끝."); return; }
  if (!APPLY) { console.log("dry run — --apply 로 넣기."); return; }

  await delAll();
  must(await db.from("projects").insert(projects), "projects");
  must(await db.from("project_sections").insert(sections), "sections");
  // 「데모 관리자」로 열어도 프로젝트가 보이게(할 일 참여자와 같은 이유).
  if (deckAdmin)
    for (const pid of [projA, projB])
      if (!projectParticipants.some((x) => x.project_id === pid && x.user_id === deckAdmin))
        projectParticipants.push({ project_id: pid, user_id: deckAdmin, role: "member", is_first_recipient: false, added_by_user_id: R });
  must(await db.from("project_participants").insert(projectParticipants), "project_participants");
  must(await db.from("tasks").insert(rows), "tasks");
  must(await db.from("task_participants").insert(participants), "task_participants");
  must(await db.from("task_updates").insert(updates), "task_updates");
  must(await db.from("task_occurrence_state").insert(states), "occurrence_state");

  for (const t of ["projects", "project_sections", "tasks", "task_updates", "task_occurrence_state"]) {
    const q = db.from(t).select("*", { count: "exact", head: true });
    const r = t === "project_sections" || t === "task_updates" ? await q : await (t === "tasks" || t === "projects" ? q.eq("organization_id", orgId) : q.eq("organization_id", orgId));
    console.log(`  ${t}: ${r.count ?? "?"}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
