/**
 * 발표(데크)용 데모 — 가상 시급 알바 10명의 근태 · 급여 데이터. 「Foldy Demo」 조직(slug `stayops-review-demo`)에만 넣는다.
 * 명단: deck-demo-roster-data.js · 공용 헬퍼: deck-demo-roster.js. 기존 seed-attendance-demo.js 의 방식을 따른다.
 *
 *   node scripts/dev/deck-demo-payroll.js           # 계획만 출력 (DB 쓰기 없음)
 *   node scripts/dev/deck-demo-payroll.js --apply   # 넣기 (이 명단 사람들의 근태 · 급여 행을 지우고 다시 넣는다 — 멱등)
 *   node scripts/dev/deck-demo-payroll.js --clean   # 이 스크립트가 넣은 행만 삭제 (계정 · 소속은 남김)
 *
 * 넣는 것: 8 · 9 · 10월(어제까지) 출퇴근 · 휴식, 시급 · 고용형태 · 급여 설정(甲乙丙 · 지급 방식), 교통비 · 추가수당 · 잔업,
 *   계좌, 회사 급여 설정. 10월분에는 「확인 필요」 견본(계좌 없음 · 계좌 변경 대기 · 퇴근 누락 정정 요청)을 남긴다.
 * 넣지 않는 것: 근태 마감 · 결재 · 지급 확인(발표 때 직접). 급여 계산 방식은 건드리지 않는다.
 * 데모 계정(데모 관리자 · 전무 · 알바 · 사무)은 seed-attendance-demo.js 가 만든 것을 그대로 쓴다(결재자).
 */
const crypto = require("crypto");
const { ORG_SLUG, ROSTER, connect, getDemoOrg, ensureDeckPeople, tokyoToday, addDays } = require("./deck-demo-roster");

const APPLY = process.argv.includes("--apply");
const CLEAN = process.argv.includes("--clean");
const MONTHS = ["2026-08", "2026-09", "2026-10"];
const HIRE = "2026-04-01";
const ADMIN_EMAIL = "stayops.demo.admin@haru-tokyo.com";
const SENMU_EMAIL = "stayops.demo.senmu@haru-tokyo.com";
const SITES = [{ name: "Demo House Shinjuku" }, { name: "Demo House Asakusa" }];

// 사람별 견본 (key → 설정). 숫자는 전부 가상.
//  commute: 월 교통비(승인 8 · 9월 / 10월은 신청 대기), extra: 추가수당 정액, bank: 이체 계좌(없으면 10월 「확인 필요」)
const SPEC = {
  d01: { commute: { "2026-08": 7200, "2026-09": 6800, "2026-10": 6400 }, bank: { bank: "三菱UFJ銀行", branch: "新宿支店", number: "1010101" } },
  d02: { overtimeLate: true, missingOut: true, commute: { "2026-08": 5400, "2026-09": 5400 }, bank: { bank: "みずほ銀行", branch: "浅草支店", number: "2020202" } },
  d03: { overtime: { "2026-09": 3000 } },
  d04: { commute: { "2026-08": 4800, "2026-09": 5200, "2026-10": 5200 }, bank: { bank: "三井住友銀行", branch: "渋谷支店", number: "3030303", pending: { bank: "ゆうちょ銀行", branch: "〇一八支店", number: "4040404" } } },
  d05: { special: { "2026-10": 3000 }, overtime: { "2026-08": 2000, "2026-10": 2000 } },
  d06: { overtimeLate: true, commute: { "2026-08": 9600, "2026-09": 9600, "2026-10": 9000 }, bank: { bank: "りそな銀行", branch: "上野支店", number: "5050505" } },
  d07: { commute: { "2026-08": 3600, "2026-09": 4000 } /* 이체인데 계좌 없음 → 10월 확인 필요 */ },
  d08: { weekend: { "2026-09": 2000, "2026-10": 2000 }, commute: { "2026-09": 3200, "2026-10": 3200 }, bank: { bank: "三菱UFJ銀行", branch: "池袋支店", number: "6060606" } },
  d09: { commute: { "2026-10": 4400 } },
  d10: { overtime: { "2026-10": 2500 } },
};

// ── 날짜 · 시각 (도쿄) ──
const at = (date, minutes) => `${date}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00+09:00`;
function rng(seedText) {
  let a = crypto.createHash("sha256").update(seedText).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

// 사람 · 달마다 8~16일 근무(달 안에 고르게 흩어 뽑는다), 보통 8~9시 출근 → 18시 퇴근, 가끔 야근 1~2h. 하루 6시간 넘으면 휴식 1시간.
function buildSessions(today) {
  const list = [];
  for (const p of ROSTER) {
    for (const ym of MONTHS) {
      const all = daysOf(ym, today);
      if (!all.length) continue;
      const r = rng(`${p.key}:${ym}:n`);
      const want = 8 + Math.floor(r() * 9); // 8..16
      const count = Math.min(want, all.length);
      const picked = Array.from({ length: count }, (_, i) => {
        const jitter = Math.floor(r() * 2);
        return all[Math.min(all.length - 1, Math.floor(((i + 0.5) * all.length) / count) + jitter - (i === 0 ? 0 : 0))];
      });
      for (const date of [...new Set(picked)]) {
        const rr = rng(`${p.key}:${date}`);
        const inMin = 8 * 60 + Math.floor(rr() * 61); // 8:00~9:00
        const lateChance = SPEC[p.key]?.overtimeLate ? 0.3 : 0.1;
        const overtime = rr() < lateChance ? 60 + Math.floor(rr() * 61) : 0; // 야근 1~2h
        const outMin = Math.min(23 * 60 + 30, 18 * 60 + Math.floor(rr() * 11) + overtime);
        const bStart = 12 * 60 + Math.floor(rr() * 10);
        list.push({ key: p.key, date, ym, inMin, outMin, brk: [bStart, bStart + 60], site: rr() < 0.5 ? 0 : 1 });
      }
    }
  }
  return list;
}

function summarize(sessions) {
  const per = new Map();
  for (const s of sessions) {
    const e = per.get(s.key) ?? Object.fromEntries(MONTHS.map((m) => [m, 0]));
    e[s.ym]++;
    per.set(s.key, e);
  }
  return per;
}

function plan(sessions, today) {
  console.log(`조직: Foldy Demo (slug ${ORG_SLUG}) — 다른 조직은 건드리지 않는다`);
  const per = summarize(sessions);
  for (const p of ROSTER) {
    const d = per.get(p.key) ?? {};
    const days = MONTHS.map((m) => `${m.slice(5)}월 ${d[m] ?? 0}일`).join(" · ");
    const extra = [];
    const s = SPEC[p.key] ?? {};
    if (s.commute) extra.push(`교통비 ${Object.keys(s.commute).map((m) => m.slice(5)).join("/")}월`);
    for (const k of ["overtime", "weekend", "special"]) if (s[k]) extra.push(`${k} ${Object.entries(s[k]).map(([m, v]) => `${m.slice(5)}월 ${v}`).join("/")}`);
    if (s.missingOut) extra.push("10월 퇴근 누락+정정 요청");
    if (p.method === "transfer" && !s.bank) extra.push("계좌 없음(확인 필요)");
    if (s.bank?.pending) extra.push("계좌 변경 대기(확인 필요)");
    console.log(`  ${p.name} — 시급 ${p.rate}엔 · ${p.withholding} · ${p.method} · ${days}${extra.length ? " · " + extra.join(", ") : ""}`);
  }
  console.log(`기간 ${MONTHS.join(", ")} (${today} 전까지) · 세션 ${sessions.length}건 · 근무지 ${SITES.length}곳 · 회사 급여 설정(지급일 10일 · 결재자 · 고용보험 5.5%)`);
  console.log("넣지 않음: 근태 마감 · 결재 · 지급 확인 (발표 때 직접)");
}

async function deleteRows(db, orgId, ids) {
  const must = (res, what) => {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data;
  };
  const old = must(await db.from("attendance_sessions").select("id").eq("organization_id", orgId).in("user_id", ids), "기존 세션");
  for (let i = 0; i < old.length; i += 200) {
    const chunk = old.slice(i, i + 200).map((s) => s.id);
    must(await db.from("attendance_breaks").delete().eq("organization_id", orgId).in("session_id", chunk), "휴식 지우기");
    must(await db.from("attendance_session_audits").delete().eq("organization_id", orgId).in("session_id", chunk), "감사 지우기");
  }
  must(await db.from("attendance_correction_requests").delete().eq("organization_id", orgId).in("requested_by_user_id", ids), "정정 지우기");
  const reports = must(await db.from("transport_reimbursement_reports").select("id").eq("organization_id", orgId).in("user_id", ids), "교통비 조회");
  if (reports.length) must(await db.from("transport_reimbursement_items").delete().eq("organization_id", orgId).in("report_id", reports.map((r) => r.id)), "교통비 항목 지우기");
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
  ]) {
    must(await db.from(table).delete().eq("organization_id", orgId).in(col, ids), `${table} 지우기`);
  }
}

async function main() {
  const today = tokyoToday();
  const sessions = buildSessions(today);
  if (!CLEAN) plan(sessions, today);
  if (!APPLY && !CLEAN) {
    // dry run — 읽기만: 조직 · 사람 · 결재자 계정이 있는지 확인한다.
    const db = connect();
    const org = await getDemoOrg(db);
    const people = await ensureDeckPeople({ sb: db, apply: false });
    const have = [...people.values()].filter((p) => p.userId).length;
    const admins = await db.from("memberships").select("user_id").eq("organization_id", org.id).in("role", ["owner", "senior_managing_director"]);
    console.log(`\n(dry run) 조직 확인 OK · 명단 ${have}/${ROSTER.length}명 이미 있음 · 데모 결재자 소속 ${admins.data?.length ?? 0}명.`);
    console.log("실제로 넣으려면 --apply, 지우려면 --clean.");
    return;
  }

  const db = connect();
  const must = (res, what) => {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data;
  };
  const org = await getDemoOrg(db);
  const orgId = org.id;

  const people = await ensureDeckPeople({ sb: db, apply: APPLY });
  const ids = [...people.values()].map((p) => p.userId).filter(Boolean);
  if (CLEAN) {
    if (ids.length) await deleteRows(db, orgId, ids);
    console.log(`정리 완료 — ${ids.length}명의 근태 · 급여 행을 지웠다(계정 · 소속 · 회사 급여 설정은 남김).`);
    return;
  }

  // 결재자 — seed-attendance-demo.js 가 만든 데모 계정을 찾는다(없으면 멈춘다).
  const authIds = {};
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    for (const u of data.users) if (u.email === ADMIN_EMAIL || u.email === SENMU_EMAIL) authIds[u.email] = u.id;
    if (data.users.length < 200) break;
  }
  const A = authIds[ADMIN_EMAIL];
  const S = authIds[SENMU_EMAIL];
  if (!A || !S) throw new Error("데모 관리자 · 전무 계정이 없다 — 먼저 seed-attendance-demo.js --apply 를 돌린다.");

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

  await deleteRows(db, orgId, ids);

  // 근무지
  const siteIds = [];
  for (const s of SITES) {
    const existing = must(await db.from("attendance_sites").select("id").eq("organization_id", orgId).eq("name", s.name).maybeSingle(), "근무지 조회");
    if (!existing) throw new Error(`근무지 ${s.name} 이 없다 — 먼저 seed-attendance-demo.js --apply 를 돌린다.`);
    siteIds.push(existing.id);
  }

  // 회사 급여 설정 (기존 시드와 같은 값)
  must(
    await db.from("org_payroll_settings").upsert({
      organization_id: orgId,
      company_name: "Foldy Demo 株式会社",
      pay_day: 10,
      senmu_approver_id: S,
      president_approver_id: A,
      employment_insurance_rates: { 2026: 5.5 },
      updated_by: A,
    }),
    "회사 급여 설정",
  );

  // 고용형태 · 시급 · 급여 설정 · 계좌
  for (const p of ROSTER) {
    const id = people.get(p.key).userId;
    const spec = SPEC[p.key] ?? {};
    must(await db.from("employment_type_history").insert({ organization_id: orgId, user_id: id, employment_type: "hourly", effective_from: HIRE, created_by_user_id: A }), "고용형태");
    must(await db.from("hourly_rate_history").insert({ organization_id: orgId, user_id: id, hourly_rate: p.rate, effective_from: HIRE, effective_to: null, created_by_user_id: A }), "시급");
    must(
      await db.from("payroll_member_settings").insert({
        organization_id: orgId,
        user_id: id,
        payment_method: p.method,
        withholding_class: p.withholding,
        dependents: 0,
        employment_insurance: false,
        employment_insurance_since: null,
        updated_by: A,
      }),
      "급여 설정",
    );
    const b = spec.bank;
    if (b && p.method === "transfer") {
      const pend = b.pending;
      const cur = pend ?? b;
      must(
        await db.from("member_bank_accounts").insert({
          organization_id: orgId,
          user_id: id,
          bank_name: cur.bank,
          branch_name: cur.branch,
          account_type: "ordinary",
          account_number: cur.number,
          holder_kana: p.kana,
          pending: !!pend,
          confirmed_bank_name: b.bank,
          confirmed_branch_name: b.branch,
          confirmed_account_type: "ordinary",
          confirmed_account_number: b.number,
          confirmed_holder_kana: p.kana,
          confirmed_by: A,
          confirmed_at: "2026-09-01T10:00:00+09:00",
          updated_by: pend ? id : A,
          updated_at: pend ? "2026-10-24T21:12:00+09:00" : "2026-09-01T10:00:00+09:00",
        }),
        "계좌",
      );
      const changes = [{ organization_id: orgId, user_id: id, kind: "created", by_self: false, changed_by: A, new_bank_name: b.bank, new_last4: b.number.slice(-4), created_at: "2026-09-01T10:00:00+09:00" }];
      if (pend) changes.push({ organization_id: orgId, user_id: id, kind: "updated", by_self: true, changed_by: id, prev_bank_name: b.bank, prev_last4: b.number.slice(-4), new_bank_name: pend.bank, new_last4: pend.number.slice(-4), created_at: "2026-10-24T21:12:00+09:00" });
      await insertMany("member_bank_account_changes", changes);
    }
  }

  // 출퇴근 · 휴식
  const rows = sessions.map((s) => ({
    organization_id: orgId,
    user_id: people.get(s.key).userId,
    operating_date: s.date,
    status: "completed",
    review_state: "normal",
    manual_created: false,
    clock_in_at: at(s.date, s.inMin),
    clock_in_site_id: siteIds[s.site],
    clock_in_method: "gps_qr",
    clock_out_at: at(s.date, s.outMin),
    clock_out_site_id: siteIds[s.site],
    clock_out_method: "gps_qr",
  }));
  // 10월 견본 — 퇴근 누락 + 정정 요청 (SPEC.missingOut 인 사람의 10월 둘째 근무일)
  const corrections = [];
  const missing = [];
  for (const [k, s] of sessions.entries()) {
    if (!SPEC[s.key]?.missingOut || s.ym !== "2026-10") continue;
    if (missing.some((m) => sessions[m].key === s.key)) continue;
    if (s.date < "2026-10-08") continue;
    missing.push(k);
    Object.assign(rows[k], { status: "open", clock_out_at: null, clock_out_site_id: null, clock_out_method: null });
  }
  const inserted = await insertMany("attendance_sessions", rows, "id, user_id");
  const breaks = [];
  inserted.forEach((row, k) => {
    const s = sessions[k];
    if (missing.includes(k)) return;
    breaks.push({ organization_id: orgId, session_id: row.id, started_at: at(s.date, s.brk[0]), ended_at: at(s.date, s.brk[1]) });
  });
  await insertMany("attendance_breaks", breaks);
  for (const k of missing) {
    const s = sessions[k];
    corrections.push({ organization_id: orgId, session_id: inserted[k].id, requested_by_user_id: inserted[k].user_id, target_month: `${s.ym}-01`, image_urls: [], status: "requested", reason_type: "missing_clock_out", memo: "퇴근 버튼을 깜빡했어요. 18시에 퇴근했습니다.", desired_clock_out_at: at(s.date, 18 * 60), desired_clock_out_site_id: siteIds[0] });
  }
  await insertMany("attendance_correction_requests", corrections);

  // 교통비 — 8 · 9월 승인, 10월은 신청(대기)
  const transport = [];
  for (const p of ROSTER) {
    for (const [ym, total] of Object.entries(SPEC[p.key]?.commute ?? {})) {
      let dates = sessions.filter((s) => s.key === p.key && s.ym === ym).map((s) => s.date);
      if (!dates.length) dates = [`${ym}-02`];
      const each = Math.floor(total / dates.length);
      transport.push({ key: p.key, ym, status: ym === "2026-10" ? "submitted" : "approved", items: dates.map((d, i) => [d, i === dates.length - 1 ? total - each * (dates.length - 1) : each]) });
    }
  }
  for (const t of transport) {
    const total = t.items.reduce((sum, [, yen]) => sum + yen, 0);
    const approved = t.status === "approved";
    const uid = people.get(t.key).userId;
    const report = must(
      await db
        .from("transport_reimbursement_reports")
        .insert({
          organization_id: orgId,
          user_id: uid,
          target_month: `${t.ym}-01`,
          status: t.status,
          submitted_at: t.ym === "2026-10" ? "2026-10-27T20:00:00+09:00" : `${t.ym}-25T20:00:00+09:00`,
          reviewed_at: approved ? `${t.ym}-26T10:00:00+09:00` : null,
          reviewed_by_user_id: approved ? A : null,
          total_amount_cached: total,
        })
        .select("id")
        .single(),
      "교통비",
    );
    await insertMany(
      "transport_reimbursement_items",
      t.items.map(([date, yen], i) => ({ organization_id: orgId, report_id: report.id, user_id: uid, usage_date: date, amount_yen: yen, entry_mode: "manual", memo: "출퇴근 교통비", sort_order: i })),
    );
  }

  // 추가수당(정액): 월 잔업 · 주말 · 특별은 급여 입력 칸, 10월 일일 추가수당은 근무한 날에 건다.
  const inputs = [];
  for (const p of ROSTER) {
    const spec = SPEC[p.key] ?? {};
    for (const ym of MONTHS) {
      const row = { organization_id: orgId, user_id: people.get(p.key).userId, target_month: `${ym}-01`, updated_by: A };
      for (const k of ["overtime", "weekend", "special"]) if (spec[k]?.[ym]) row[k] = spec[k][ym];
      if (Object.keys(row).length > 4) inputs.push(row);
    }
  }
  await insertMany("payroll_month_inputs", inputs);
  const allowances = [];
  for (const s of sessions) {
    if (s.ym !== "2026-10" || !["d05", "d08"].includes(s.key)) continue;
    const wd = new Date(`${s.date}T00:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) allowances.push({ organization_id: orgId, target_date: s.date, target_user_id: people.get(s.key).userId, allowance_type: "daily_fixed", amount_yen: 1000, category: "regular", memo: "주말 근무", status: "active", created_by_user_id: A });
  }
  await insertMany("attendance_pay_allowances", allowances);

  console.log(`\n완료 — 명단 ${ids.length}명 · 세션 ${inserted.length} · 휴식 ${breaks.length} · 정정 ${corrections.length} · 교통비 ${transport.length} · 급여 입력 ${inputs.length} · 일일 추가수당 ${allowances.length}`);
  console.log("로그인 계정 · 비밀번호: .env.demo-accounts (git 제외). 근태 마감 · 결재 · 지급 확인은 넣지 않았다.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
