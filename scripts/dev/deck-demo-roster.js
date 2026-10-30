/**
 * 발표(데크)용 데모 시드 공용 헬퍼 — deck-demo-payroll / -cleaning / -residence 가 같이 쓴다.
 * 「Foldy Demo」 조직(slug `stayops-review-demo`) 밖은 읽지도 쓰지도 않는다.
 * 명단은 deck-demo-roster-data.js 의 ROSTER (가상 시급 알바 10명).
 */
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const fs = require("fs");
const { ORG_SLUG, ROSTER } = require("./deck-demo-roster-data");

const ACCOUNTS_FILE = ".env.demo-accounts";

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (!(key in process.env)) process.env[key] = line.slice(i + 1);
  }
}
function loadEnv() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
}

function connect() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없다 (.env.local).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function must(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function getDemoOrg(sb) {
  const org = must(await sb.from("organizations").select("id, slug").eq("slug", ORG_SLUG).maybeSingle(), "조직 조회");
  if (!org || org.slug !== ORG_SLUG) throw new Error("「Foldy Demo」 조직이 없다 — 먼저 seed-review-demo.js 를 돌린다.");
  return { id: org.id, slug: org.slug };
}

function tokyoToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function listAuthUsers(sb) {
  const byEmail = new Map();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`사용자 목록: ${error.message}`);
    for (const u of data.users) if (u.email) byEmail.set(u.email.toLowerCase(), u);
    if (data.users.length < 200) break;
  }
  return byEmail;
}

function readAccounts() {
  const saved = {};
  if (fs.existsSync(ACCOUNTS_FILE)) {
    for (const line of fs.readFileSync(ACCOUNTS_FILE, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=\s]+@[^=\s]+)=(.+)$/);
      if (m) saved[m[1]] = m[2];
    }
  }
  return saved;
}
// 기존 줄(주석 · 다른 계정)은 그대로 두고, 이 명단 이메일 줄만 더하거나 바꾼다.
function writeAccounts(additions) {
  if (!Object.keys(additions).length) return;
  const lines = fs.existsSync(ACCOUNTS_FILE) ? fs.readFileSync(ACCOUNTS_FILE, "utf8").split(/\r?\n/).filter((l, i, a) => l || i < a.length - 1) : ["# Foldy Demo 조직 데모 계정. git 에 올리지 않는다."];
  const left = { ...additions };
  const next = lines.map((l) => {
    const m = l.match(/^([^#=\s]+@[^=\s]+)=/);
    if (m && left[m[1]]) {
      const out = `${m[1]}=${left[m[1]]}`;
      delete left[m[1]];
      return out;
    }
    return l;
  });
  for (const [e, pw] of Object.entries(left)) next.push(`${e}=${pw}`);
  fs.writeFileSync(ACCOUNTS_FILE, next.join("\n") + "\n", { mode: 0o600 });
}

/**
 * 명단 10명의 계정 · 프로필 · 소속(part_time_staff)을 보장한다. 이미 있으면 재사용.
 * dry run(apply 아님)은 찾기만 하고 없으면 userId null. 같은 이메일이 다른 조직이면 throw.
 */
async function ensureDeckPeople({ sb, apply }) {
  const org = await getDemoOrg(sb);
  const byEmail = await listAuthUsers(sb);
  const saved = readAccounts();
  const out = new Map();
  const newPasswords = {};
  for (const p of ROSTER) {
    let found = byEmail.get(p.email.toLowerCase());
    if (found) {
      const m = must(await sb.from("memberships").select("organization_id").eq("user_id", found.id), "기존 소속");
      if (m.some((r) => r.organization_id !== org.id)) throw new Error(`${p.email} 은 다른 조직 계정이다 — 중단.`);
    }
    if (!found && !apply) {
      out.set(p.key, { userId: null, email: p.email, name: p.name });
      continue;
    }
    if (!found) {
      const password = `Demo-${crypto.randomBytes(9).toString("base64url")}-7a`;
      const { data, error } = await sb.auth.admin.createUser({ email: p.email, password, email_confirm: true, user_metadata: { full_name: p.name } });
      if (error) throw new Error(`계정 ${p.email}: ${error.message}`);
      found = data.user;
      newPasswords[p.email] = password;
    } else if (apply && !saved[p.email]) {
      // 파일에 비밀번호가 없는 기존 계정 — 새로 정해 적는다.
      const password = `Demo-${crypto.randomBytes(9).toString("base64url")}-7a`;
      const { error } = await sb.auth.admin.updateUserById(found.id, { password, email_confirm: true });
      if (error) throw new Error(`비밀번호 ${p.email}: ${error.message}`);
      newPasswords[p.email] = password;
    }
    if (apply) {
      const first = p.name.split(" ")[0];
      must(
        await sb.from("profiles").upsert({
          id: found.id,
          name: p.name,
          name_katakana: p.kana,
          name_ko: p.nationality === "JP" ? null : p.name,
          nationality: p.nationality,
          birth_date: p.birth,
          gender: p.gender,
          phone_number: p.phone,
          preferred_language: p.nationality === "JP" ? "ja" : "ko",
          hire_date: p.hire ?? "2026-04-01",
          last_used_organization_id: org.id,
        }),
        `프로필 ${p.email} (${first})`,
      );
      must(
        await sb.from("memberships").upsert(
          { user_id: found.id, organization_id: org.id, role: "part_time_staff", status: "active", joined_at: `${p.hire ?? "2026-04-01"}T09:00:00+09:00` },
          { onConflict: "organization_id,user_id" },
        ),
        `소속 ${p.email}`,
      );
    }
    out.set(p.key, { userId: found.id, email: p.email, name: p.name });
  }
  if (apply) writeAccounts(newPasswords);
  return out;
}

// 이 명단 사람들의 데모 데이터와 소속만 지운다(데모 조직 한정). 계정은 다른 소속이 없을 때만 지운다.
async function removeDeckPeople({ sb }) {
  const org = await getDemoOrg(sb);
  const byEmail = await listAuthUsers(sb);
  const users = ROSTER.map((p) => byEmail.get(p.email.toLowerCase())).filter(Boolean);
  const ids = [];
  for (const u of users) {
    const m = must(await sb.from("memberships").select("organization_id").eq("user_id", u.id), "소속");
    if (m.some((r) => r.organization_id !== org.id)) throw new Error(`${u.email} 은 다른 조직 계정이다 — 중단.`);
    ids.push(u.id);
  }
  if (!ids.length) return { removed: 0 };
  const sessions = must(await sb.from("attendance_sessions").select("id").eq("organization_id", org.id).in("user_id", ids), "세션");
  for (let i = 0; i < sessions.length; i += 200) {
    const chunk = sessions.slice(i, i + 200).map((s) => s.id);
    must(await sb.from("attendance_breaks").delete().eq("organization_id", org.id).in("session_id", chunk), "휴식");
    must(await sb.from("attendance_session_audits").delete().eq("organization_id", org.id).in("session_id", chunk), "감사");
  }
  must(await sb.from("attendance_correction_requests").delete().eq("organization_id", org.id).in("requested_by_user_id", ids), "정정");
  const reports = must(await sb.from("transport_reimbursement_reports").select("id").eq("organization_id", org.id).in("user_id", ids), "교통비");
  if (reports.length) must(await sb.from("transport_reimbursement_items").delete().eq("organization_id", org.id).in("report_id", reports.map((r) => r.id)), "교통비 항목");
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
    ["cleaning_staff_profiles", "user_id"],
    ["staff_id_documents", "user_id"],
  ]) {
    const res = await sb.from(table).delete().eq("organization_id", org.id).in(col, ids);
    // 다른 시드가 쓰는 표가 아직 없는 환경이면 건너뛴다.
    if (res.error && !/does not exist|schema cache/i.test(res.error.message)) throw new Error(`${table}: ${res.error.message}`);
  }
  must(await sb.from("memberships").delete().eq("organization_id", org.id).in("user_id", ids), "소속 지우기");
  for (const id of ids) {
    const left = must(await sb.from("memberships").select("organization_id").eq("user_id", id), "남은 소속");
    if (!left.length) await sb.auth.admin.deleteUser(id); // profiles 는 cascade
  }
  return { removed: ids.length };
}

module.exports = { ORG_SLUG, ROSTER, loadEnv, connect, getDemoOrg, ensureDeckPeople, tokyoToday, addDays, removeDeckPeople };
