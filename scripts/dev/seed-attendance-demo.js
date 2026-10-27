/**
 * 근태 · 급여 데모 데이터 — 「Foldy Demo」 조직(심사용 데모 조직, slug `stayops-review-demo`)에만 넣는다.
 * docs/engineering/07-environment-setup.md 「Sample data — 근태 · 급여 데모」.
 *
 * 사용자가 근태 · 급여 기능을 처음부터 끝까지 직접 눌러 보도록:
 * - 로그인 계정 3개: 데모 관리자(owner · 사장 결재) · 데모 전무(전무 결재 · 휴가 승인) · 데모 알바(시급 알바, 본인 화면).
 * - 로그인하지 않는 직원 6명: 시급 알바 5명(원천세 갑 · 을 · 병 · 미설정, 현금 · 이체, 시급 변경, 고용보험, 계좌 확인 필요 등) + 월급 사무 1명(휴가).
 * - 9월 · 10월(어제까지) 출퇴근 · 휴식, 정정 요청 · 수기 입력 · 무효 · 퇴근 누락 · 검토 필요, 추가수당, 교통비, 휴가,
 *   급여 설정 · 계좌(확인 대기 · 유초 포함), 9월 급여 입력(→ 10월 「지난달 값 가져오기」 원본), 회사 급여 설정(결재자 · 고용보험료율).
 * - 근태 마감 · 결재 · 지급 확인은 넣지 않는다 — 사용자가 직접 해 보는 단계.
 *
 * 사용:
 *   node scripts/dev/seed-attendance-demo.js            # 계획만 출력 (DB 를 건드리지 않음)
 *   node scripts/dev/seed-attendance-demo.js --apply    # 넣기. 이미 있으면 이 스크립트가 만든 사람들의 근태 · 급여 데이터를 지우고 다시 넣는다
 *
 * 안전장치: 조직 slug 가 `stayops-review-demo` 가 아니면 멈춘다. 지우는 범위는 그 조직 + 이 스크립트의 사람들뿐
 * (회차 결재는 데모 조직 9 · 10월분). 같은 이메일이 다른 조직 계정이면 멈춘다.
 * 로그인 비밀번호는 처음 만들 때 무작위로 정해 `.env.demo-accounts`(git 제외)에 적는다 — 다시 돌려도 그대로 쓴다.
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

const APPLY = process.argv.includes("--apply");
const ORG_SLUG = "stayops-review-demo";
const ACCOUNTS_FILE = ".env.demo-accounts";
const MONTHS = ["2026-09", "2026-10"];

// login: 로그인 계정(비밀번호를 파일에 적는다). pay: 시급 알바 설정.
const PEOPLE = [
  { key: "admin", email: "stayops.demo.admin@haru-tokyo.com", name: "데모 관리자", role: "owner", login: true, lang: "ko", gender: "male", birth: "1985-03-02", phone: "+81-90-0000-0100" },
  { key: "senmu", email: "stayops.demo.senmu@haru-tokyo.com", name: "데모 전무", role: "senior_managing_director", login: true, lang: "ko", gender: "female", birth: "1980-07-19", phone: "+81-90-0000-0101", leaveApprover: true },
  {
    key: "alba", email: "stayops.demo.alba@haru-tokyo.com", name: "데모 알바", kana: "デモ アルバ", role: "part_time_staff", login: true, lang: "ko", gender: "female", birth: "1999-11-08", phone: "+81-90-0000-0102", hire: "2026-04-01",
    pay: { rates: [["2026-04-01", 1250]], withholding: "kou", dependents: 0, method: "transfer", days: [1, 2, 3, 5, 6], bank: { bank: "三菱UFJ銀行", branch: "新宿支店", type: "ordinary", number: "1234567" } },
  },
  {
    key: "hana", email: "stayops.demo.hana@haru-tokyo.com", name: "사토 하나", kana: "サトウ ハナ", role: "part_time_staff", lang: "ja", gender: "female", birth: "1997-02-14", phone: "+81-90-0000-0103", hire: "2025-12-01",
    pay: { rates: [["2025-12-01", 1200], ["2026-10-16", 1300]], withholding: "kou", dependents: 0, method: "transfer", days: [1, 2, 3, 4, 5], bank: { bank: "三井住友銀行", branch: "浅草支店", type: "ordinary", number: "2345678" } },
  },
  {
    key: "li", email: "stayops.demo.li@haru-tokyo.com", name: "리 웨이", kana: "リ ウェイ", role: "part_time_staff", lang: "en", gender: "male", birth: "2001-06-30", phone: "+81-90-0000-0104", hire: "2026-06-01",
    pay: { rates: [["2026-06-01", 1150]], withholding: "otsu", dependents: 0, method: "cash", days: [0, 3, 6] },
  },
  {
    key: "nguyen", email: "stayops.demo.nguyen@haru-tokyo.com", name: "응우옌 안", kana: "グエン アン", role: "part_time_staff", lang: "en", gender: "female", birth: "1998-09-21", phone: "+81-90-0000-0105", hire: "2026-03-01",
    pay: {
      rates: [["2026-03-01", 1150], ["2026-10-11", 1200], ["2026-10-21", 1250]], withholding: "kou", dependents: 2, method: "transfer", insurance: true, days: [1, 2, 4, 5, 6],
      bank: { bank: "楽天銀行", branch: "第一営業支店", type: "ordinary", number: "7654321", pending: { bank: "みずほ銀行", branch: "渋谷支店", type: "ordinary", number: "3456789" } },
    },
  },
  {
    key: "tanaka", email: "stayops.demo.tanaka@haru-tokyo.com", name: "다나카 유키", kana: "タナカ ユキ", role: "part_time_staff", lang: "ja", gender: "male", birth: "2003-01-05", phone: "+81-90-0000-0106", hire: "2026-09-20",
    pay: { rates: [["2026-09-20", 1200]], withholding: "hei", dependents: 0, method: "transfer", days: [0, 2, 4, 6], bank: { bank: "ゆうちょ銀行", branch: "〇一八店", type: "ordinary", number: "4567890" } },
  },
  // 「확인 필요」 견본 — 원천세 구분 없음 · 이체인데 계좌 없음 · 가타카나 없음.
  {
    key: "kim", email: "stayops.demo.kim@haru-tokyo.com", name: "김민수", role: "part_time_staff", lang: "ko", gender: "male", birth: "2000-04-17", phone: "+81-90-0000-0107", hire: "2026-08-01",
    pay: { rates: [["2026-08-01", 1200]], withholding: null, dependents: 0, method: "transfer", days: [1, 3, 5] },
  },
  // 월급 사무 — 휴가 신청 · 승인 견본.
  { key: "office", email: "stayops.demo.office@haru-tokyo.com", name: "야마모토 레이", kana: "ヤマモト レイ", role: "office_admin", lang: "ja", gender: "female", birth: "1992-12-03", phone: "+81-90-0000-0108", hire: "2024-04-01", salaried: true },
];

const SITES = [
  { name: "Demo House Shinjuku", property: "Demo House Shinjuku", lat: 35.6938, lng: 139.7034 },
  { name: "Demo House Asakusa", property: "Demo House Asakusa", lat: 35.7148, lng: 139.7967 },
];

// ── 날짜 · 시각 (도쿄) ──
function tokyoToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function daysOf(ym, untilExclusive) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= last; d++) {
    const date = `${ym}-${String(d).padStart(2, "0")}`;
    if (date < untilExclusive) out.push(date);
  }
  return out;
}
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const at = (date, minutes) => {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${date}T${h}:${m}:00+09:00`;
};
function rng(seedText) {
  let a = crypto.createHash("sha256").update(seedText).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function plan() {
  console.log("조직: Foldy Demo (slug stayops-review-demo) — 다른 조직은 건드리지 않는다");
  for (const p of PEOPLE) {
    const kind = p.salaried ? "월급" : p.pay ? `시급 ${p.pay.rates.map((r) => `${r[1]}엔(${r[0]}~)`).join(" → ")}` : "";
    console.log(`${p.login ? "[로그인]" : "        "} ${p.name} <${p.email}> — ${p.role} ${kind}`);
  }
  console.log(`기간: ${MONTHS.join(", ")} (어제까지) · 근무지 ${SITES.length}곳`);
  console.log("10월 견본: 검토 필요 · 수기 입력 · 퇴근 누락 + 정정 요청 · 무효 · 시간 정정 요청 · 시급 3구간 · 추가수당 · 교통비 대기");
  console.log("9월 급여 입력(특별수당 · 원천세 직접 입력 · 메모) → 10월 「지난달 값 가져오기」 원본");
  console.log("넣지 않음: 근태 마감 · 결재 · 지급 확인 (직접 해 보는 단계)");
}

async function main() {
  plan();
  if (!APPLY) {
    console.log("\n(dry run) 실제로 넣으려면 --apply 를 붙인다.");
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
  // 여러 줄을 한 번에 넣으면 어떤 줄에 없는 칸이 기본값 대신 null 로 들어간다 — 칸 모양이 같은 줄끼리만 묶는다(순서 유지).
  const insertMany = async (table, rows, select) => {
    const out = [];
    for (let i = 0; i < rows.length; ) {
      const shape = Object.keys(rows[i]).sort().join(",");
      let j = i;
      while (j < rows.length && j - i < 200 && Object.keys(rows[j]).sort().join(",") === shape) j++;
      let q = db.from(table).insert(rows.slice(i, j));
      i = j;
      if (select) q = q.select(select);
      const data = must(await q, table);
      if (data) out.push(...data);
    }
    return out;
  };

  // ── 조직 (데모 조직만) ──
  const org = must(await db.from("organizations").select("id, slug").eq("slug", ORG_SLUG).maybeSingle(), "조직 조회");
  if (!org || org.slug !== ORG_SLUG) throw new Error("「Foldy Demo」 조직이 없다 — 먼저 seed-review-demo.js 를 돌린다.");
  const orgId = org.id;

  // ── 계정 ──
  const saved = {};
  if (fs.existsSync(ACCOUNTS_FILE)) {
    for (const line of fs.readFileSync(ACCOUNTS_FILE, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=\s]+@[^=\s]+)=(.+)$/);
      if (m) saved[m[1]] = m[2];
    }
  }
  const byEmail = new Map();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`사용자 목록: ${error.message}`);
    for (const u of data.users) if (u.email) byEmail.set(u.email.toLowerCase(), u);
    if (data.users.length < 200) break;
  }
  const ids = {};
  const passwords = {};
  for (const p of PEOPLE) {
    let found = byEmail.get(p.email);
    if (found) {
      const m = must(await db.from("memberships").select("organization_id").eq("user_id", found.id), "기존 소속");
      if (m.some((r) => r.organization_id !== orgId)) throw new Error(`${p.email} 은 다른 조직 계정이다 — 중단.`);
    }
    const password = p.login ? saved[p.email] || `Demo-${crypto.randomBytes(9).toString("base64url")}` : null;
    if (!found) {
      const { data, error } = await db.auth.admin.createUser({
        email: p.email,
        password: password || crypto.randomBytes(24).toString("base64url"),
        email_confirm: true,
        user_metadata: { full_name: p.name },
      });
      if (error) throw new Error(`계정 ${p.email}: ${error.message}`);
      found = data.user;
    } else if (password && !saved[p.email]) {
      const { error } = await db.auth.admin.updateUserById(found.id, { password, email_confirm: true });
      if (error) throw new Error(`비밀번호 ${p.email}: ${error.message}`);
    }
    if (password) passwords[p.email] = password;
    ids[p.key] = found.id;
    must(
      await db.from("profiles").upsert({
        id: found.id,
        name: p.name,
        name_katakana: p.kana ?? null,
        birth_date: p.birth,
        gender: p.gender,
        phone_number: p.phone,
        preferred_language: p.lang,
        hire_date: p.hire ?? null,
        last_used_organization_id: orgId,
      }),
      `프로필 ${p.email}`,
    );
    must(
      await db.from("memberships").upsert(
        {
          user_id: found.id,
          organization_id: orgId,
          role: p.role,
          status: "active",
          joined_at: `${p.hire ?? "2026-04-01"}T09:00:00+09:00`,
          leave_approver_role: p.leaveApprover ? "senior_managing_director" : null,
        },
        { onConflict: "organization_id,user_id" },
      ),
      `소속 ${p.email}`,
    );
  }
  fs.writeFileSync(
    ACCOUNTS_FILE,
    `# Foldy Demo 조직 근태 · 급여 테스트 계정 (scripts/dev/seed-attendance-demo.js). git 에 올리지 않는다.\n` +
      Object.entries(passwords).map(([e, pw]) => `${e}=${pw}`).join("\n") + "\n",
    { mode: 0o600 },
  );
  const allIds = Object.values(ids);
  const A = ids.admin;

  // ── 지우기 (데모 조직 + 이 사람들만) ──
  const sessionsOld = must(await db.from("attendance_sessions").select("id").eq("organization_id", orgId).in("user_id", allIds), "기존 세션");
  const oldIds = sessionsOld.map((s) => s.id);
  for (let i = 0; i < oldIds.length; i += 200) {
    const chunk = oldIds.slice(i, i + 200);
    must(await db.from("attendance_breaks").delete().eq("organization_id", orgId).in("session_id", chunk), "휴식 지우기");
    must(await db.from("attendance_session_audits").delete().eq("organization_id", orgId).in("session_id", chunk), "감사 지우기");
  }
  must(await db.from("attendance_correction_requests").delete().eq("organization_id", orgId).in("requested_by_user_id", allIds), "정정 지우기");
  const reports = must(await db.from("transport_reimbursement_reports").select("id").eq("organization_id", orgId).in("user_id", allIds), "교통비 조회");
  if (reports.length) {
    must(await db.from("transport_reimbursement_items").delete().eq("organization_id", orgId).in("report_id", reports.map((r) => r.id)), "교통비 항목 지우기");
  }
  for (const [table, col] of [
    ["transport_reimbursement_reports", "user_id"],
    ["attendance_pay_allowances", "target_user_id"],
    ["attendance_month_snapshots", "user_id"],
    ["attendance_sessions", "user_id"],
    ["payroll_month_inputs", "user_id"],
    ["payroll_payment_checks", "user_id"],
    ["member_bank_account_changes", "user_id"],
    ["member_bank_accounts", "user_id"],
    ["payroll_member_settings", "user_id"],
    ["hourly_rate_history", "user_id"],
    ["employment_type_history", "user_id"],
    ["annual_leave_requests", "user_id"],
    ["annual_leave_baselines", "user_id"],
  ]) {
    must(await db.from(table).delete().eq("organization_id", orgId).in(col, allIds), `${table} 지우기`);
  }
  const monthFirsts = MONTHS.map((ym) => `${ym}-01`);
  must(await db.from("payroll_month_approval_events").delete().eq("organization_id", orgId).in("target_month", monthFirsts), "결재 기록 지우기");
  must(await db.from("payroll_month_approvals").delete().eq("organization_id", orgId).in("target_month", monthFirsts), "결재 지우기");

  // ── 근무지 ──
  const props = must(await db.from("properties").select("id, name").eq("organization_id", orgId), "건물");
  const siteIds = [];
  for (const s of SITES) {
    const existing = must(await db.from("attendance_sites").select("id").eq("organization_id", orgId).eq("name", s.name).maybeSingle(), "근무지 조회");
    if (existing) {
      siteIds.push(existing.id);
      continue;
    }
    const prop = props.find((p) => p.name === s.property);
    const row = must(
      await db
        .from("attendance_sites")
        .insert({ organization_id: orgId, name: s.name, print_name: s.name, property_id: prop?.id ?? null, latitude: s.lat, longitude: s.lng, allowed_radius_meters: 150, is_active: true })
        .select("id")
        .single(),
      "근무지",
    );
    siteIds.push(row.id);
  }

  // ── 회사 급여 설정 ──
  must(
    await db.from("org_payroll_settings").upsert({
      organization_id: orgId,
      company_name: "Foldy Demo 株式会社",
      pay_day: 10,
      senmu_approver_id: ids.senmu,
      president_approver_id: A,
      employment_insurance_rates: { 2026: 5.5 },
      updated_by: A,
    }),
    "회사 급여 설정",
  );

  // ── 고용형태 · 시급 · 급여 설정 · 계좌 ──
  for (const p of PEOPLE) {
    const id = ids[p.key];
    if (p.salaried) {
      must(await db.from("employment_type_history").insert({ organization_id: orgId, user_id: id, employment_type: "salaried", effective_from: p.hire, created_by_user_id: A }), "고용형태");
      continue;
    }
    if (!p.pay) continue;
    must(await db.from("employment_type_history").insert({ organization_id: orgId, user_id: id, employment_type: "hourly", effective_from: p.hire, created_by_user_id: A }), "고용형태");
    const rates = p.pay.rates.map(([from, rate], i) => {
      const next = p.pay.rates[i + 1];
      const to = next ? new Date(Date.parse(`${next[0]}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : null;
      return { organization_id: orgId, user_id: id, hourly_rate: rate, effective_from: from, effective_to: to, created_by_user_id: A };
    });
    await insertMany("hourly_rate_history", rates);
    must(
      await db.from("payroll_member_settings").insert({
        organization_id: orgId,
        user_id: id,
        payment_method: p.pay.method,
        withholding_class: p.pay.withholding,
        dependents: p.pay.dependents,
        employment_insurance: !!p.pay.insurance,
        employment_insurance_since: p.pay.insurance ? "2026-09-01" : null,
        updated_by: A,
      }),
      "급여 설정",
    );
    const b = p.pay.bank;
    if (b) {
      const pend = b.pending;
      const cur = pend ?? b;
      must(
        await db.from("member_bank_accounts").insert({
          organization_id: orgId,
          user_id: id,
          bank_name: cur.bank,
          branch_name: cur.branch,
          account_type: cur.type,
          account_number: cur.number,
          holder_kana: p.kana,
          pending: !!pend,
          confirmed_bank_name: b.bank,
          confirmed_branch_name: b.branch,
          confirmed_account_type: b.type,
          confirmed_account_number: b.number,
          confirmed_holder_kana: p.kana,
          confirmed_by: A,
          confirmed_at: "2026-09-01T10:00:00+09:00",
          updated_by: pend ? id : A,
          updated_at: pend ? "2026-10-24T21:12:00+09:00" : "2026-09-01T10:00:00+09:00",
        }),
        "계좌",
      );
      const changes = [
        { organization_id: orgId, user_id: id, kind: "created", by_self: false, changed_by: A, new_bank_name: b.bank, new_last4: b.number.slice(-4), created_at: "2026-09-01T10:00:00+09:00" },
      ];
      if (pend) {
        changes.push({ organization_id: orgId, user_id: id, kind: "updated", by_self: true, changed_by: id, prev_bank_name: b.bank, prev_last4: b.number.slice(-4), new_bank_name: pend.bank, new_last4: pend.number.slice(-4), created_at: "2026-10-24T21:12:00+09:00" });
      }
      await insertMany("member_bank_account_changes", changes);
    }
  }

  // ── 출퇴근 · 휴식 ──
  const today = tokyoToday();
  const sessions = [];
  const meta = []; // 세션 순서대로: { breakMinutes: [start, end] | null }
  for (const p of PEOPLE) {
    if (!p.pay && !p.salaried) continue;
    const workDays = p.salaried ? [1, 2, 3, 4, 5] : p.pay.days;
    for (const ym of MONTHS) {
      for (const date of daysOf(ym, today)) {
        if (date < (p.hire ?? "")) continue;
        if (!workDays.includes(weekday(date))) continue;
        const r = rng(`${p.key}:${date}`);
        if (r() < 0.08) continue; // 가끔 쉬는 날
        const site = r() < 0.5 ? siteIds[0] : siteIds[1];
        const inMin = 8 * 60 + 50 + Math.floor(r() * 20);
        const late = r() < 0.2;
        const outMin = late ? 19 * 60 + 15 + Math.floor(r() * 75) : 17 * 60 + 55 + Math.floor(r() * 15);
        sessions.push({
          organization_id: orgId,
          user_id: ids[p.key],
          operating_date: date,
          status: "completed",
          review_state: "normal",
          manual_created: false,
          clock_in_at: at(date, inMin),
          clock_in_site_id: site,
          clock_in_method: "gps_qr",
          clock_out_at: at(date, outMin),
          clock_out_site_id: site,
          clock_out_method: "gps_qr",
        });
        const bStart = 12 * 60 + Math.floor(r() * 10);
        meta.push({ key: p.key, date, brk: [bStart, bStart + 60] });
      }
    }
  }
  const nearest = (key, date) => {
    // 그날 근무가 없으면 그 뒤 가장 가까운 근무일.
    const list = meta.map((m, i) => ({ ...m, i })).filter((m) => m.key === key && m.date >= date);
    return list.length ? list[0].i : -1;
  };
  const extras = []; // 세션이 들어간 뒤 할 일

  // 10월 견본
  let i = nearest("hana", "2026-10-08");
  if (i >= 0) Object.assign(sessions[i], { review_state: "review_required", clock_in_accuracy_meters: 380 });
  i = nearest("li", "2026-10-14");
  if (i >= 0) {
    Object.assign(sessions[i], {
      clock_in_method: "manual",
      clock_out_method: "manual",
      clock_in_site_id: null,
      clock_out_site_id: null,
      manual_created: true,
      manual_created_by_user_id: A,
      manual_created_reason: "휴대폰 배터리가 없어 관리자가 대신 입력",
      manual_location: "Demo House Asakusa",
    });
  }
  i = nearest("alba", "2026-10-21");
  if (i >= 0 && meta[i].date < today) {
    Object.assign(sessions[i], { status: "open", clock_out_at: null, clock_out_site_id: null, clock_out_method: null });
    extras.push({ type: "missing_out", index: i });
  }
  i = nearest("tanaka", "2026-10-03");
  if (i >= 0) {
    const s = sessions[i];
    sessions.push({ ...s, status: "invalid", clock_in_at: at(meta[i].date, 8 * 60 + 41), clock_out_at: null, clock_out_site_id: null, clock_out_method: null, invalidated_at: `${meta[i].date}T09:05:00+09:00`, invalidated_by_user_id: A, invalidated_reason: "출근을 두 번 눌러 중복 기록" });
    meta.push({ key: "tanaka", date: meta[i].date, brk: null });
  }
  i = nearest("nguyen", "2026-10-17");
  if (i >= 0) extras.push({ type: "wrong_time", index: i });
  i = nearest("hana", "2026-09-11");
  if (i >= 0) {
    sessions[i].review_state = "approved_correction";
    extras.push({ type: "approved_sep", index: i });
  }

  const inserted = await insertMany("attendance_sessions", sessions, "id, user_id, operating_date, status, clock_out_at");
  const breaks = [];
  inserted.forEach((s, k) => {
    const m = meta[k];
    if (!m.brk || s.status === "invalid" || !s.clock_out_at) return;
    breaks.push({ organization_id: orgId, session_id: s.id, started_at: at(m.date, m.brk[0]), ended_at: at(m.date, m.brk[1]) });
  });
  await insertMany("attendance_breaks", breaks);

  // 정정 요청
  const corrections = [];
  for (const e of extras) {
    const s = inserted[e.index];
    const date = meta[e.index].date;
    const base = { organization_id: orgId, session_id: s.id, requested_by_user_id: s.user_id, target_month: `${date.slice(0, 7)}-01`, image_urls: [] };
    if (e.type === "missing_out") {
      corrections.push({ ...base, status: "requested", reason_type: "missing_clock_out", memo: "퇴근 버튼을 깜빡했어요. 18시에 퇴근했습니다.", desired_clock_out_at: at(date, 18 * 60), desired_clock_out_site_id: siteIds[0] });
    } else if (e.type === "wrong_time") {
      corrections.push({ ...base, status: "requested", reason_type: "wrong_time", memo: "QR 이 안 읽혀서 늦게 찍혔어요. 실제 출근은 9시입니다.", desired_clock_in_at: at(date, 9 * 60) });
    } else if (e.type === "approved_sep") {
      corrections.push({ ...base, status: "approved", reason_type: "wrong_time", memo: "출근 시각 정정", desired_clock_in_at: at(date, 9 * 60), review_comment: "확인했습니다", reviewed_by_user_id: A, reviewed_at: `${date}T19:00:00+09:00` });
    }
  }
  await insertMany("attendance_correction_requests", corrections);

  // ── 추가수당 (일반 → 주말수당 칸, 특별 → 특별수당 칸) ──
  const allowances = [];
  inserted.forEach((s, k) => {
    const m = meta[k];
    if (s.status !== "completed" || PEOPLE.find((p) => p.key === m.key)?.salaried) return;
    const wd = weekday(m.date);
    if (wd === 0 || wd === 6) {
      allowances.push({ organization_id: orgId, target_date: m.date, target_user_id: s.user_id, allowance_type: "daily_fixed", amount_yen: 1000, category: "regular", memo: "주말 근무", status: "active", created_by_user_id: A });
    }
  });
  allowances.push({ organization_id: orgId, target_date: "2026-10-10", target_user_id: ids.alba, allowance_type: "daily_fixed", amount_yen: 3000, category: "special", memo: "대청소 지원", status: "active", created_by_user_id: A });
  await insertMany("attendance_pay_allowances", allowances);

  // ── 교통비 ──
  const transport = [
    { key: "hana", ym: "2026-09", status: "approved", items: [["2026-09-02", 420], ["2026-09-09", 420], ["2026-09-16", 420]] },
    { key: "hana", ym: "2026-10", status: "approved", items: [["2026-10-01", 420], ["2026-10-07", 420], ["2026-10-14", 420], ["2026-10-21", 420]] },
    { key: "alba", ym: "2026-10", status: "submitted", items: [["2026-10-06", 360], ["2026-10-13", 360], ["2026-10-20", 360]] },
    { key: "nguyen", ym: "2026-10", status: "submitted", items: [["2026-10-09", 280], ["2026-10-16", 280]] },
  ];
  for (const t of transport) {
    const total = t.items.reduce((sum, [, yen]) => sum + yen, 0);
    const submitted = `${t.ym}-25T20:00:00+09:00`;
    const report = must(
      await db
        .from("transport_reimbursement_reports")
        .insert({
          organization_id: orgId,
          user_id: ids[t.key],
          target_month: `${t.ym}-01`,
          status: t.status,
          submitted_at: submitted,
          reviewed_at: t.status === "approved" ? `${t.ym}-26T10:00:00+09:00` : null,
          reviewed_by_user_id: t.status === "approved" ? A : null,
          total_amount_cached: total,
        })
        .select("id")
        .single(),
      "교통비",
    );
    await insertMany(
      "transport_reimbursement_items",
      t.items.map(([date, yen], k) => ({ organization_id: orgId, report_id: report.id, user_id: ids[t.key], usage_date: date, amount_yen: yen, entry_mode: "manual", memo: "신주쿠 ↔ 아사쿠사 지하철", sort_order: k })),
    );
  }

  // ── 9월 급여 입력 (10월 「지난달 값 가져오기」 원본) · 10월 입력 일부 ──
  await insertMany("payroll_month_inputs", [
    { organization_id: orgId, user_id: ids.hana, target_month: "2026-09-01", special: 5000, memo: "리더 수당", updated_by: A },
    { organization_id: orgId, user_id: ids.li, target_month: "2026-09-01", withholding_override: 1200, withholding_override_reason: "본인 신고 기준 금액", updated_by: A },
    { organization_id: orgId, user_id: ids.nguyen, target_month: "2026-09-01", memo: "9월부터 고용보험 가입", updated_by: A },
    { organization_id: orgId, user_id: ids.tanaka, target_month: "2026-10-01", prev_adjustment: 1500, prev_adjustment_kind: "taxable", prev_adjustment_month: "2026-09-01", memo: "9월 근무 1시간 누락분", updated_by: A },
  ]);

  // ── 휴가 (월급 사무) ──
  must(await db.from("annual_leave_baselines").insert({ organization_id: orgId, user_id: ids.office, base_amount: 10, bonus_amount: 1, baseline_date: "2026-04-01" }), "휴가 기준");
  await insertMany("annual_leave_requests", [
    { organization_id: orgId, user_id: ids.office, applicant_name: "야마모토 레이", leave_type: "annual", start_date: "2026-09-18", end_date: "2026-09-18", duration_unit: "full", days_count: 1, reason: "개인 용무", emergency_contact: "+81-90-0000-0108", status: "approved", submitted_at: "2026-09-08T10:00:00+09:00", approved_by_user_id: ids.senmu, approved_role: "senior_managing_director", approved_at: "2026-09-09T11:00:00+09:00" },
    { organization_id: orgId, user_id: ids.office, applicant_name: "야마모토 레이", leave_type: "annual", start_date: "2026-11-06", end_date: "2026-11-06", duration_unit: "am", days_count: 0.5, reason: "병원 진료", emergency_contact: "+81-90-0000-0108", status: "requested", submitted_at: `${today}T08:30:00+09:00` },
  ]);

  console.log(`\n완료 — 세션 ${inserted.length} · 휴식 ${breaks.length} · 정정 ${corrections.length} · 추가수당 ${allowances.length} · 교통비 ${transport.length}`);
  console.log(`로그인 계정 · 비밀번호: ${ACCOUNTS_FILE} (git 제외)`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
