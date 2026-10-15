/**
 * 앱 심사용 데모 조직 · 계정 · 샘플 데이터 (계획 B6, docs/planning/18-store-review-kit.md 「데모 계정」).
 *
 * 심사관은 초대 코드 없이 이메일 · 비밀번호로 바로 홈에 들어가야 한다. 그래서 별도 조직 「Foldy Demo」를 만들고,
 * 그 안에 심사관 계정(owner)과 다른 직원 2명, 가상 건물 · 객실 · 공지 · 게시판 글(신고 · 차단을 시험할 「다른 사람의 글」) ·
 * 할 일 · 유지보수 · 분실물을 넣는다. 실제 조직 데이터와는 organization_id 로 분리된다(RLS · 서버 조직 격리).
 *
 * - 실제 투숙객 · 직원 정보는 넣지 않는다. 이름 · 전화번호는 가상값.
 * - Beds24 를 연결하지 않으므로 예약 캘린더 · 판매 화면은 비어 있다(심사 메모에 적는다).
 * - 출퇴근은 현장 QR + 근무지 반경 GPS 가 필요해 원격으로 시연할 수 없다 — 근무지는 만들지 않는다.
 *
 * 사용:
 *   node scripts/dev/seed-review-demo.js                       # 계획만 출력 (dry run, DB 를 건드리지 않음)
 *   node scripts/dev/seed-review-demo.js --apply               # 실제 생성. 비밀번호를 한 번만 출력한다
 *   node scripts/dev/seed-review-demo.js --apply --email review@example.com --password '...'
 *
 * 다시 돌려도 안전하다: 같은 slug 의 조직이 이미 있으면 계정 · 소속만 확인하고, 그 조직에 건물이 있으면 샘플 데이터는 다시 넣지 않는다.
 * 비밀번호를 바꾸려면 --apply --password '<새 비밀번호>' 로 다시 돌린다(심사관 계정만 갱신).
 */
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const fs = require("fs");

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (!(key in process.env)) process.env[key] = line.slice(i + 1);
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
const ORG_SLUG = "stayops-review-demo";
const ORG_NAME = "Foldy Demo";
const REVIEWER_EMAIL = (opt("--email") || "stayops.review@haru-tokyo.com").toLowerCase();
const PASSWORD_ARG = opt("--password");

const REVIEWER = {
  email: REVIEWER_EMAIL,
  name: "App Reviewer",
  role: "owner",
  birth_date: "1990-01-01",
  gender: "female",
  phone_number: "+81 3-0000-0000",
  preferred_language: "en",
};
// 신고 · 차단을 시험할 「다른 사용자」. 로그인하지 않으므로 비밀번호는 무작위로 만들고 버린다.
const COWORKERS = [
  { key: "mika", email: "stayops.demo.mika@haru-tokyo.com", name: "Mika Tanaka", role: "staff", birth_date: "1995-04-12", gender: "female", phone_number: "+81 3-0000-0001", preferred_language: "ja" },
  { key: "ken", email: "stayops.demo.ken@haru-tokyo.com", name: "Ken Sato", role: "field_manager", birth_date: "1988-09-30", gender: "male", phone_number: "+81 3-0000-0002", preferred_language: "en" },
];

const PROPERTIES = [
  { key: "shinjuku", name: "Demo House Shinjuku", ko: "데모 하우스 신주쿠", ja: "デモハウス新宿", en: "Demo House Shinjuku", rooms: ["101", "102", "201"] },
  { key: "asakusa", name: "Demo House Asakusa", ko: "데모 하우스 아사쿠사", ja: "デモハウス浅草", en: "Demo House Asakusa", rooms: ["A", "B"] },
];

/** 도쿄 기준 오늘(YYYY-MM-DD) + n 일. */
function tokyoDate(offsetDays = 0) {
  const now = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return now.toISOString().slice(0, 10);
}

function plan() {
  console.log(`조직: ${ORG_NAME} (slug ${ORG_SLUG})`);
  console.log(`심사관 계정: ${REVIEWER.email} — ${REVIEWER.role}, 언어 ${REVIEWER.preferred_language}, 메일 인증 완료 상태`);
  for (const c of COWORKERS) console.log(`직원: ${c.name} <${c.email}> — ${c.role} (로그인용 아님)`);
  for (const p of PROPERTIES) console.log(`건물: ${p.name} — 객실 ${p.rooms.join(", ")}`);
  console.log("공지 2 · 게시판 글 3 + 댓글 3 · 할 일 3 · 유지보수 1 · 분실물 1");
}

async function main() {
  plan();
  if (!APPLY) {
    console.log("\n(dry run) 실제로 만들려면 --apply 를 붙인다.");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없다 (.env.local).");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const must = (res, what) => {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data;
  };

  // ── 조직 ──
  let org = must(await db.from("organizations").select("id").eq("slug", ORG_SLUG).maybeSingle(), "조직 조회");
  const orgIsNew = !org;
  if (!org) {
    org = must(await db.from("organizations").insert({ name: ORG_NAME, slug: ORG_SLUG, status: "active" }).select("id").single(), "조직 생성");
  }
  console.log(`\n조직 ${orgIsNew ? "생성" : "이미 있음"}: ${org.id}`);

  // ── 계정 ──
  const existingByEmail = new Map();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`사용자 목록: ${error.message}`);
    for (const u of data.users) if (u.email) existingByEmail.set(u.email.toLowerCase(), u);
    if (data.users.length < 200) break;
  }

  async function ensureUser(person, password) {
    const found = existingByEmail.get(person.email);
    if (found) {
      // 실제 직원 계정과 이메일이 겹치면 절대 건드리지 않는다 — 데모 조직 소속이 아닌 기존 계정이면 중단.
      const m = must(await db.from("memberships").select("organization_id").eq("user_id", found.id), "기존 계정 소속 조회");
      if (m.some((r) => r.organization_id !== org.id)) {
        throw new Error(`${person.email} 은 다른 조직에 소속된 기존 계정이다. --email 로 다른 주소를 지정할 것.`);
      }
      if (password) {
        const { error } = await db.auth.admin.updateUserById(found.id, { password, email_confirm: true });
        if (error) throw new Error(`비밀번호 갱신: ${error.message}`);
      }
      return { id: found.id, created: false };
    }
    const { data, error } = await db.auth.admin.createUser({
      email: person.email,
      password: password || crypto.randomBytes(24).toString("base64url"),
      email_confirm: true,
      user_metadata: { full_name: person.name },
    });
    if (error) throw new Error(`계정 생성 ${person.email}: ${error.message}`);
    return { id: data.user.id, created: true };
  }

  async function ensureProfileAndMembership(userId, person) {
    must(
      await db.from("profiles").upsert({
        id: userId,
        name: person.name,
        birth_date: person.birth_date,
        gender: person.gender,
        phone_number: person.phone_number,
        preferred_language: person.preferred_language,
        last_used_organization_id: org.id,
      }),
      `프로필 ${person.email}`,
    );
    const existing = must(
      await db.from("memberships").select("id").eq("user_id", userId).eq("organization_id", org.id).maybeSingle(),
      "소속 조회",
    );
    if (!existing) {
      must(
        await db.from("memberships").insert({
          user_id: userId,
          organization_id: org.id,
          role: person.role,
          status: "active",
          joined_at: new Date().toISOString(),
        }),
        `소속 ${person.email}`,
      );
    }
  }

  const reviewerExists = existingByEmail.has(REVIEWER.email);
  const reviewerPassword = PASSWORD_ARG || (reviewerExists ? null : `Demo-${crypto.randomBytes(9).toString("base64url")}`);
  const reviewer = await ensureUser(REVIEWER, reviewerPassword);
  await ensureProfileAndMembership(reviewer.id, REVIEWER);
  const ids = { reviewer: reviewer.id };
  for (const c of COWORKERS) {
    const u = await ensureUser(c, null);
    await ensureProfileAndMembership(u.id, c);
    ids[c.key] = u.id;
  }

  // 건물이 하나라도 있으면 샘플은 이미 들어간 것 — 중간에 실패했다면 그 조직의 건물 · 객실을 지우고 다시 돌린다.
  const { count: propertyCount } = await db.from("properties").select("id", { count: "exact", head: true }).eq("organization_id", org.id);
  if (propertyCount) {
    console.log("샘플 데이터가 이미 있다 — 건너뜀.");
  } else {
    await seedContent(db, must, org.id, ids);
  }

  console.log("\n완료.");
  console.log(`  로그인 이메일: ${REVIEWER.email}`);
  if (reviewerPassword) console.log(`  비밀번호: ${reviewerPassword}   ← 지금 한 번만 표시된다. 안전한 곳에 보관할 것.`);
  else console.log("  비밀번호: (기존 그대로 — 바꾸려면 --password)");
}

async function seedContent(db, must, orgId, ids) {
  // ── 건물 · 객실 ──
  const rooms = {};
  for (const p of PROPERTIES) {
    const prop = must(
      await db
        .from("properties")
        .insert({ organization_id: orgId, name: p.name, display_name_ko: p.ko, display_name_ja: p.ja, display_name_en: p.en, property_type: "multi_room_building", status: "active" })
        .select("id")
        .single(),
      `건물 ${p.name}`,
    );
    for (const label of p.rooms) {
      const room = must(
        await db
          .from("rooms")
          .insert({ organization_id: orgId, property_id: prop.id, name: `${p.name} ${label}`, room_label: label, status: "active" })
          .select("id")
          .single(),
        `객실 ${p.name} ${label}`,
      );
      rooms[`${p.key}:${label}`] = { id: room.id, propertyId: prop.id, propertyName: p.name, label };
    }
  }

  // ── 공지 (관리 역할이 쓰는 공식 안내) ──
  const now = new Date().toISOString();
  must(
    await db.from("announcements").insert([
      {
        organization_id: orgId,
        created_by_user_id: ids.reviewer,
        title: "Welcome to Foldy",
        content: "This is a demo organization for app review. Use the menu to explore cleaning, tasks, maintenance, lost & found, the team board and announcements.",
        status: "published",
        published_at: now,
        is_pinned: true,
        is_important: false,
        target_scope: "everyone",
      },
      {
        organization_id: orgId,
        created_by_user_id: ids.ken,
        title: "Updated check-out cleaning checklist",
        content: "From this week, if you find any damage during check-out cleaning, please report it from the cleaning screen with a photo so the maintenance team can follow up.",
        status: "published",
        published_at: now,
        is_pinned: false,
        is_important: true,
        target_scope: "everyone",
      },
    ]),
    "공지",
  );

  // ── 게시판 (다른 사용자의 글 — 신고 · 차단 시험용) ──
  const posts = must(
    await db
      .from("board_posts")
      .insert([
        { organization_id: orgId, created_by_user_id: ids.mika, title: "Spare towels moved", content: "The spare bath towels for Demo House Shinjuku are now on the 2nd floor storage shelf." },
        { organization_id: orgId, created_by_user_id: ids.ken, title: "Elevator inspection on Friday", content: "The elevator at Demo House Asakusa will be out of service on Friday from 10:00 to 12:00 for inspection." },
        { organization_id: orgId, created_by_user_id: ids.mika, title: "Lunch recommendation", content: "There is a good soba place two minutes from Demo House Asakusa. Open from 11:00." },
      ])
      .select("id, title"),
    "게시판 글",
  );
  const postId = (title) => posts.find((p) => p.title === title).id;
  must(
    await db.from("board_comments").insert([
      { organization_id: orgId, post_id: postId("Spare towels moved"), created_by_user_id: ids.ken, content: "Thanks, I will tell the afternoon team." },
      { organization_id: orgId, post_id: postId("Elevator inspection on Friday"), created_by_user_id: ids.mika, content: "Noted. I will carry the linen by the stairs that morning." },
      { organization_id: orgId, post_id: postId("Lunch recommendation"), created_by_user_id: ids.ken, content: "Tried it yesterday, very good!" },
    ]),
    "게시판 댓글",
  );

  // ── 할 일 (심사관 본인) ──
  const shinjuku101 = rooms["shinjuku:101"];
  // 앱의 「오늘 · 내일」 추가와 같은 모양: 도쿄 자정 due_at + all_day + is_inbox false (src/app/mobile/tasks/new/actions.ts).
  const dueOn = (offset) => new Date(`${tokyoDate(offset)}T00:00:00+09:00`).toISOString();
  const tasks = [
    { title: "Check the air conditioner remote in room 101", due_at: dueOn(0), all_day: true, is_inbox: false, is_shared: false, property_id: shinjuku101.propertyId, room_id: shinjuku101.id },
    { title: "Order more bath towels", due_at: dueOn(1), all_day: true, is_inbox: false, is_shared: false },
    { title: "Review this week's cleaning photos", is_inbox: true, is_shared: false },
  ];
  for (const t of tasks) {
    const task = must(
      await db.from("tasks").insert({ organization_id: orgId, created_by_user_id: ids.reviewer, ...t }).select("id").single(),
      `할 일 ${t.title}`,
    );
    must(await db.from("task_participants").insert({ task_id: task.id, user_id: ids.reviewer, role: "author" }), "할 일 참여자");
  }

  // ── 유지보수 · 분실물 ──
  const asakusaA = rooms["asakusa:A"];
  must(
    await db.from("maintenance_reports").insert({
      organization_id: orgId,
      reported_by_user_id: ids.ken,
      issue_title: "Shower drains slowly",
      description: "The shower drain in room A is slow. Please check before the next check-in.",
      category: "water",
      priority: "normal",
      status: "open",
      property_name: asakusaA.propertyName,
      room_label: asakusaA.label,
    }),
    "유지보수",
  );
  must(
    await db.from("lost_items").insert({
      organization_id: orgId,
      reported_by_user_id: ids.mika,
      item_name: "Black umbrella",
      category: "accessory",
      memo: "Found in the entrance umbrella stand after check-out.",
      property_name: shinjuku101.propertyName,
      room_label: shinjuku101.label,
    }),
    "분실물",
  );
  console.log("샘플 데이터 생성 완료.");
}

main().catch((err) => {
  console.error("\n실패:", err.message);
  process.exit(1);
});
