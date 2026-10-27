/**
 * 근태 · 급여 데모 데이터 — 「Foldy Demo」 조직(심사용 데모 조직, slug `stayops-review-demo`)에만 넣는다.
 * docs/engineering/07-environment-setup.md 「Sample data — 근태 · 급여 데모」.
 *
 * 사용자가 근태 · 급여 기능을 처음부터 끝까지 직접 눌러 보도록:
 * - 로그인 계정 3개: 데모 관리자(owner · 사장 결재) · 데모 전무(전무 결재 · 휴가 승인) · 데모 알바(시급 알바, 본인 화면).
 * - 시급 알바 = **실제 8월 · 9월분 급여 파일의 사람들**(2026-10-27 사용자 지시 — 나중에 전부 지운다). `.env.demo-real-payroll.json`
 *   (git 제외, scripts/dev/extract-real-payroll-demo.js 가 만든다)에서 읽는다: 이름 · 가타카나 · 시급 ①② · 분 단위 시간 · 일수 ·
 *   교통비 · 조정분 · 잔업 · 甲乙丙 · 현금/이체. 8월 · 9월 출퇴근을 그 분 · 일수에 딱 맞게 만들어 급여 준비 금액이 원본과 같다
 *   (9월 課税対象額 = 원본, 8월은 시급 × 분, 엑셀 ROUND ↔ Foldy 1엔 올림 차이 1엔 안쪽). 계좌는 넣지 않는다(실제 정보 없음 → 「확인 필요」).
 * - 그 밖에 월급 사무 1명(휴가 견본). 데모 알바(로그인)는 10월만 근무 — 8 · 9월 합계가 원본과 같게.
 * - 10월(어제까지) 견본: 퇴근 누락 + 정정 요청 · 추가수당 · 교통비 대기, 회사 급여 설정(결재자 · 고용보험료율).
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
const MONTHS = ["2026-08", "2026-09", "2026-10"];
const REAL_FILE = ".env.demo-real-payroll.json";
// 예전 가짜 시급 직원 — 다시 돌리면 근태 · 급여 데이터와 소속을 지운다.
const RETIRED_EMAILS = ["hana", "li", "nguyen", "tanaka", "kim"].map((k) => `stayops.demo.${k}@haru-tokyo.com`);

// login: 로그인 계정(비밀번호를 파일에 적는다). pay: 시급 알바 설정.
const PEOPLE = [
  { key: "admin", email: "stayops.demo.admin@haru-tokyo.com", name: "데모 관리자", role: "owner", login: true, lang: "ko", gender: "male", birth: "1985-03-02", phone: "+81-90-0000-0100" },
  { key: "senmu", email: "stayops.demo.senmu@haru-tokyo.com", name: "데모 전무", role: "senior_managing_director", login: true, lang: "ko", gender: "female", birth: "1980-07-19", phone: "+81-90-0000-0101", leaveApprover: true },
  {
    key: "alba", email: "stayops.demo.alba@haru-tokyo.com", name: "데모 알바", kana: "デモ アルバ", role: "part_time_staff", login: true, lang: "ko", gender: "female", birth: "1999-11-08", phone: "+81-90-0000-0102", hire: "2026-04-01",
    onlyMonths: ["2026-10"],
    pay: { rates: [["2026-04-01", 1250]], withholding: "kou", dependents: 0, method: "transfer", days: [1, 2, 3, 5, 6], bank: { bank: "三菱UFJ銀行", branch: "新宿支店", type: "ordinary", number: "1234567" } },
  },
  // 월급 사무 — 휴가 신청 · 승인 견본.
  { key: "office", email: "stayops.demo.office@haru-tokyo.com", name: "야마모토 레이", kana: "ヤマモト レイ", role: "office_admin", lang: "ja", gender: "female", birth: "1992-12-03", phone: "+81-90-0000-0108", hire: "2024-04-01", salaried: true },
];

// 실제 급여 파일 사람들(있으면). months: { "YYYY-MM": { segments: [{ rate, minutes }], days, commute, overtime, adjust, adjustMonth, withholdingOverride?, withholdingReason? } }
const REAL = fs.existsSync(REAL_FILE) ? JSON.parse(fs.readFileSync(REAL_FILE, "utf8")) : [];
const realStart = (r) => Object.keys(r.months).sort()[0];
REAL.forEach((r, n) => {
  PEOPLE.push({
    key: `real-${r.id}`,
    email: `stayops.demo.real-${r.id}@haru-tokyo.com`,
    name: r.ko ?? r.kana,
    kana: r.kana,
    role: "part_time_staff",
    lang: "ko",
    gender: null,
    birth: null,
    phone: `+81-90-0001-${String(n + 1).padStart(4, "0")}`, // 실제 번호 없음 — 데모 자리 번호(필수 칸)
    hire: `${realStart(r)}-01`,
    real: r,
    pay: { withholding: r.cls, dependents: 0, method: r.method },
  });
});

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

// 실제 사람의 달별 근무 — 일수만큼 달 전체에 고르게 펴고, 분은 시급 구간별로 나눠 하루하루에 싣는다(합계는 딱 맞게).
// 시급 ② 는 마지막 며칠. 돌려줌: { days: [{ date, paid, rate }], rates: [[from, rate]] }
function realSchedule(p) {
  const days = [];
  for (const ym of Object.keys(p.real.months).sort()) {
    const m = p.real.months[ym];
    const total = m.segments.reduce((sum, x) => sum + x.minutes, 0);
    if (!total || !m.days) continue;
    const all = daysOf(ym, "9999-12-31");
    const count = Math.min(m.days, all.length);
    const picked = Array.from({ length: count }, (_, i) => all[Math.floor(((i + 0.5) * all.length) / count)]);
    const per = total / count;
    let cursor = 0;
    m.segments.forEach((seg, si) => {
      const left = count - cursor;
      const n = si === m.segments.length - 1 ? left : Math.min(left - 1, Math.max(1, Math.round(seg.minutes / per)));
      const share = picked.slice(cursor, cursor + n);
      cursor += n;
      const base = Math.floor(seg.minutes / n);
      const paid = share.map((_, k) => base + (k < seg.minutes - base * n ? 1 : 0));
      const r = rng(`${p.key}:${ym}:${si}`);
      for (let k = 0; k + 1 < paid.length; k += 2) {
        const d = Math.min(Math.floor(r() * 25), paid[k + 1] - 60, paid[k] - 60);
        if (d > 0) {
          paid[k] += d;
          paid[k + 1] -= d;
        }
      }
      share.forEach((date, k) => days.push({ date, paid: paid[k], rate: seg.rate }));
    });
  }
  const rates = [];
  for (const d of days) if (!rates.length || rates.at(-1)[1] !== d.rate) rates.push([rates.length ? d.date : p.hire, d.rate]);
  if (!rates.length) rates.push([p.hire, 1350]);
  return { days, rates };
}

function plan() {
  console.log("조직: Foldy Demo (slug stayops-review-demo) — 다른 조직은 건드리지 않는다");
  for (const p of PEOPLE) {
    if (p.real) continue;
    const kind = p.salaried ? "월급" : p.pay ? `시급 ${p.pay.rates.map((r) => `${r[1]}엔(${r[0]}~)`).join(" → ")}` : "";
    console.log(`${p.login ? "[로그인]" : "        "} ${p.name} <${p.email}> — ${p.role} ${kind}`);
  }
  if (!REAL.length) console.log(`(${REAL_FILE} 없음 — 실제 급여 파일 사람 없이 넣는다. 먼저 extract-real-payroll-demo.js)`);
  for (const ym of ["2026-08", "2026-09"]) {
    const rows = PEOPLE.filter((p) => p.real?.months[ym]);
    const minutes = rows.reduce((sum, p) => sum + p.real.months[ym].segments.reduce((a, x) => a + x.minutes, 0), 0);
    const days = rows.reduce((sum, p) => sum + p.real.months[ym].days, 0);
    const commute = rows.reduce((sum, p) => sum + p.real.months[ym].commute, 0);
    console.log(`실제 ${ym}: ${rows.length}명 · ${(minutes / 60).toFixed(1)}시간 · ${days}일 · 교통비 ${commute.toLocaleString()}엔`);
  }
  // 넣기 전에 실제 사람마다 근무 일수 · 분 · 課税 금액이 원본과 맞는지 따진다(안 맞으면 멈춘다).
  for (const p of PEOPLE.filter((x) => x.real)) {
    const sched = realSchedule(p).days;
    for (const [ym, m] of Object.entries(p.real.months)) {
      const ds = sched.filter((d) => d.date.startsWith(ym));
      const byRate = new Map();
      for (const d of ds) byRate.set(d.rate, (byRate.get(d.rate) ?? 0) + d.paid);
      const pay = [...byRate].reduce((sum, [rate, min]) => sum + Math.ceil((rate * min) / 60 - 1e-9), 0);
      const want = m.segments.reduce((sum, x) => sum + x.minutes, 0);
      const got = ds.reduce((sum, d) => sum + d.paid, 0);
      if (got !== want || (want && ds.length !== Math.min(m.days, 31)) || new Set(ds.map((d) => d.date)).size !== ds.length) {
        throw new Error(`${p.name} ${ym}: 분 ${got}/${want} · 일수 ${ds.length}/${m.days}`);
      }
      if (m.expectTaxable != null && pay + m.adjust + m.overtime !== m.expectTaxable) throw new Error(`${p.name} ${ym}: 課税 ${pay + m.adjust} ≠ ${m.expectTaxable}`);
    }
  }
  console.log(`기간: ${MONTHS.join(", ")} (어제까지) · 근무지 ${SITES.length}곳`);
  console.log("10월 견본(데모 알바): 퇴근 누락 + 정정 요청 · 추가수당 · 교통비 대기");
  console.log("8 · 9월 급여 입력: 조정분 · 잔업(원본) · 분 끝돈 조정 · 8월 구분이 다른 사람 원천세 직접 입력(원본 값)");
  console.log(`지우는 예전 가짜 직원: ${RETIRED_EMAILS.length}명(근태 · 급여 · 소속)`);
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
    const password = p.login ? saved[p.email] || `Demo-${crypto.randomBytes(9).toString("base64url")}-7a` : null;
    if (!found) {
      const { data, error } = await db.auth.admin.createUser({
        email: p.email,
        password: password || `Nl-${crypto.randomBytes(24).toString("base64url")}-x9`, // 로그인 안 하는 계정 — 비밀번호 규칙(대 · 소문자 · 숫자)만 맞춘다
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
  const retiredIds = [];
  // 지금 JSON 에 없는 예전 실제 사람 계정(`stayops.demo.real-*`)도 근태 · 급여 · 소속을 지운다.
  const current = new Set(PEOPLE.map((p) => p.email));
  const stale = [...byEmail.keys()].filter((e) => /^stayops\.demo\.real-[0-9a-f]+@haru-tokyo\.com$/.test(e) && !current.has(e));
  for (const email of [...RETIRED_EMAILS, ...stale]) {
    const u = byEmail.get(email);
    if (!u) continue;
    const m = must(await db.from("memberships").select("organization_id").eq("user_id", u.id), "예전 직원 소속");
    if (m.some((r) => r.organization_id !== orgId)) throw new Error(`${email} 은 다른 조직 계정이다 — 중단.`);
    retiredIds.push(u.id);
  }
  const allIds = [...Object.values(ids), ...retiredIds];
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
  if (retiredIds.length) must(await db.from("memberships").delete().eq("organization_id", orgId).in("user_id", retiredIds), "예전 직원 소속 지우기");
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
    const rateList = p.real ? realSchedule(p).rates : p.pay.rates;
    const rates = rateList.map(([from, rate], i) => {
      const next = rateList[i + 1];
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
    if (p.real) {
      // 출근 9:00 전후, 6시간 넘으면 휴식 1시간 — 쉰 시간을 뺀 분이 그날 몫과 딱 같다.
      for (const d of realSchedule(p).days) {
        const r = rng(`${p.key}:${d.date}`);
        const site = r() < 0.5 ? siteIds[0] : siteIds[1];
        const inMin = 8 * 60 + 50 + Math.floor(r() * 20);
        const brk = d.paid > 360 ? [12 * 60 + Math.floor(r() * 10), 0] : null;
        if (brk) brk[1] = brk[0] + 60;
        const outMin = inMin + d.paid + (brk ? 60 : 0);
        if (outMin > 23 * 60 + 30) throw new Error(`${p.name} ${d.date} 퇴근이 23:30 을 넘는다(${d.paid}분)`);
        sessions.push({
          organization_id: orgId,
          user_id: ids[p.key],
          operating_date: d.date,
          status: "completed",
          review_state: "normal",
          manual_created: false,
          clock_in_at: at(d.date, inMin),
          clock_in_site_id: site,
          clock_in_method: "gps_qr",
          clock_out_at: at(d.date, outMin),
          clock_out_site_id: site,
          clock_out_method: "gps_qr",
        });
        meta.push({ key: p.key, date: d.date, brk });
      }
      continue;
    }
    const workDays = p.salaried ? [1, 2, 3, 4, 5] : p.pay.days;
    for (const ym of p.onlyMonths ?? MONTHS) {
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

  // 10월 견본 — 전부 데모 알바(실제 사람들의 8 · 9월 숫자는 건드리지 않는다)
  let i = nearest("alba", "2026-10-08");
  if (i >= 0) Object.assign(sessions[i], { review_state: "review_required", clock_in_accuracy_meters: 380 });
  i = nearest("alba", "2026-10-14");
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
  i = nearest("alba", "2026-10-03");
  if (i >= 0) {
    const s = sessions[i];
    sessions.push({ ...s, status: "invalid", clock_in_at: at(meta[i].date, 8 * 60 + 41), clock_out_at: null, clock_out_site_id: null, clock_out_method: null, invalidated_at: `${meta[i].date}T09:05:00+09:00`, invalidated_by_user_id: A, invalidated_reason: "출근을 두 번 눌러 중복 기록" });
    meta.push({ key: "alba", date: meta[i].date, brk: null });
  }
  i = nearest("alba", "2026-10-17");
  if (i >= 0) extras.push({ type: "wrong_time", index: i });

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
    }
  }
  await insertMany("attendance_correction_requests", corrections);

  // ── 추가수당 (일반 → 주말수당 칸, 특별 → 특별수당 칸) ──
  const allowances = [];
  inserted.forEach((s, k) => {
    const m = meta[k];
    const who = PEOPLE.find((p) => p.key === m.key);
    if (s.status !== "completed" || who?.salaried || who?.real) return;
    const wd = weekday(m.date);
    if (wd === 0 || wd === 6) {
      allowances.push({ organization_id: orgId, target_date: m.date, target_user_id: s.user_id, allowance_type: "daily_fixed", amount_yen: 1000, category: "regular", memo: "주말 근무", status: "active", created_by_user_id: A });
    }
  });
  allowances.push({ organization_id: orgId, target_date: "2026-10-10", target_user_id: ids.alba, allowance_type: "daily_fixed", amount_yen: 3000, category: "special", memo: "대청소 지원", status: "active", created_by_user_id: A });
  await insertMany("attendance_pay_allowances", allowances);

  // ── 교통비 ──
  const transport = [
    { key: "alba", ym: "2026-10", status: "submitted", items: [["2026-10-06", 360], ["2026-10-13", 360], ["2026-10-20", 360]] },
  ];
  // 실제 교통비(원본 通勤非課税) — 승인된 신청 하나, 근무일마다 나눠 적는다(끝돈은 마지막 날).
  for (const p of PEOPLE.filter((x) => x.real)) {
    const sched = realSchedule(p).days;
    for (const [ym, m] of Object.entries(p.real.months)) {
      if (!m.commute) continue;
      const dates = sched.filter((d) => d.date.startsWith(ym)).map((d) => d.date);
      if (!dates.length) dates.push(`${ym}-01`);
      const each = Math.floor(m.commute / dates.length);
      transport.push({ key: p.key, ym, status: "approved", memo: "출퇴근 교통비", items: dates.map((d, k) => [d, k === dates.length - 1 ? m.commute - each * (dates.length - 1) : each]) });
    }
  }
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
      t.items.map(([date, yen], k) => ({ organization_id: orgId, report_id: report.id, user_id: ids[t.key], usage_date: date, amount_yen: yen, entry_mode: "manual", memo: t.memo ?? "신주쿠 ↔ 아사쿠사 지하철", sort_order: k })),
    );
  }

  // ── 8 · 9월 급여 입력 — 원본의 조정분 · 잔업, 분으로 안 떨어지는 끝돈, 8월 구분이 지금과 다른 사람의 원천세(원본 값) ──
  const inputs = [];
  for (const p of PEOPLE.filter((x) => x.real)) {
    for (const [ym, m] of Object.entries(p.real.months)) {
      const row = { organization_id: orgId, user_id: ids[p.key], target_month: `${ym}-01`, updated_by: A };
      if (m.overtime) row.overtime = m.overtime;
      if (m.adjust) Object.assign(row, { prev_adjustment: m.adjust, prev_adjustment_kind: "taxable", prev_adjustment_month: `${m.adjustMonth}-01` });
      if (m.withholdingOverride != null) Object.assign(row, { withholding_override: m.withholdingOverride, withholding_override_reason: m.withholdingReason });
      if (Object.keys(row).length > 4) inputs.push(row);
    }
  }
  await insertMany("payroll_month_inputs", inputs);

  // ── 휴가 (월급 사무) ──
  must(await db.from("annual_leave_baselines").insert({ organization_id: orgId, user_id: ids.office, base_amount: 10, bonus_amount: 1, baseline_date: "2026-04-01" }), "휴가 기준");
  await insertMany("annual_leave_requests", [
    { organization_id: orgId, user_id: ids.office, applicant_name: "야마모토 레이", leave_type: "annual", start_date: "2026-09-18", end_date: "2026-09-18", duration_unit: "full", days_count: 1, reason: "개인 용무", emergency_contact: "+81-90-0000-0108", status: "approved", submitted_at: "2026-09-08T10:00:00+09:00", approved_by_user_id: ids.senmu, approved_role: "senior_managing_director", approved_at: "2026-09-09T11:00:00+09:00" },
    { organization_id: orgId, user_id: ids.office, applicant_name: "야마모토 레이", leave_type: "annual", start_date: "2026-11-06", end_date: "2026-11-06", duration_unit: "am", days_count: 0.5, reason: "병원 진료", emergency_contact: "+81-90-0000-0108", status: "requested", submitted_at: `${today}T08:30:00+09:00` },
  ]);

  console.log(`\n완료 — 지운 예전 계정 ${retiredIds.length} · 실제 ${REAL.length}명 · 급여 입력 ${inputs.length} · 세션 ${inserted.length} · 휴식 ${breaks.length} · 정정 ${corrections.length} · 추가수당 ${allowances.length} · 교통비 ${transport.length}`);
  console.log(`로그인 계정 · 비밀번호: ${ACCOUNTS_FILE} (git 제외)`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
