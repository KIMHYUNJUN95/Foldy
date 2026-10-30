/**
 * App Store 심사용 데모 조직(slug `stayops-review-demo`) — 모바일 실행 때 뜨는 안내 시트를 없앤다.
 *   1) 「이름 정보를 채워 주세요」(identityIncomplete) → 빠진 칸만 가상 값으로 채움 (profiles.name 은 건드리지 않음)
 *   2) 「서류를 등록해 주세요」 → 지금 서류가 없는 사람에게 확인 완료된 견본 서류 1건(만료 1년 이상 뒤)
 *
 *   node scripts/dev/review-demo-identity.js                 # dry run
 *   node scripts/dev/review-demo-identity.js --apply         # 실제 쓰기
 *   node scripts/dev/review-demo-identity.js --clean --apply # 이 스크립트가 만든 것만 되돌림 (--apply 없으면 dry run)
 *
 * 덱 명단(deck-demo-roster-data.js) 10명의 서류는 건드리지 않는다(의도된 「미등록」 등). 이름 칸이 비어 있으면 채운다.
 * 표식: 서류 id = md5(`review-demo-identity:<userId>`) 고정 uuid, 사진 파일명 `front-reviewdemo.jpg`.
 * 프로필 되돌리기용 기록: .claude/deck-tmp/review-identity-state.json (이 스크립트가 채운 칸만).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { connect, getDemoOrg, ensureDeckPeople, tokyoToday, addDays } = require("./deck-demo-roster");
const { ORG_SLUG, ROSTER } = require("./deck-demo-roster-data");

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const CLEAN = args.has("--clean");
const BUCKET = "staff-documents";
const MARK = "reviewdemo";
const STATE = path.join(__dirname, "..", "..", ".claude", "deck-tmp", "review-identity-state.json");
if (ORG_SLUG !== "stayops-review-demo") throw new Error("ORG_SLUG 불일치");

// 표시 이름(profiles.name) → 채울 값. 비어 있는 칸만 쓴다.
const FILL = {
  "App Reviewer": { nationality: "US", name_en: "APP REVIEWER", name_katakana: "アップ レビュアー", roman: "APP REVIEWER", birth: "1990-01-15" },
  "Mika Tanaka": { nationality: "JP", name_ja: "田中 美香", name_katakana: "タナカ ミカ", birth: "1992-05-20" },
  "Ken Sato": { nationality: "JP", name_ja: "佐藤 健", name_katakana: "サトウ ケン", birth: "1990-09-09" },
  "데모 관리자": { nationality: "KR", name_ko: "데모 관리자", name_katakana: "デモ カンリシャ", roman: "DEMO KANRISHA", birth: "1985-03-03" },
  "데모 전무": { nationality: "KR", name_ko: "데모 전무", name_katakana: "デモ センム", roman: "DEMO SENMU", birth: "1982-07-07" },
  "야마모토 레이": { nationality: "JP", name_ja: "山本 玲", name_katakana: "ヤマモト レイ", birth: "1993-11-11" },
  "데모 알바": { nationality: "KR", name_ko: "데모 알바", name_katakana: "デモ アルバ", roman: "DEMO ARUBA", birth: "2000-02-02" },
  // 덱 명단 중 이름 칸이 비어 있는 사람(서류는 건드리지 않음)
  "다나카 미사키": { nationality: "JP", name_ja: "田中 美咲", name_katakana: "タナカ ミサキ" },
  "사토 켄": { nationality: "JP", name_ja: "佐藤 健", name_katakana: "サトウ ケン" },
};
const FIELDS = ["nationality", "name_ko", "name_ja", "name_en", "name_katakana"];

// ── identity-names.ts 규칙 복사 ──
const collapse = (v) => v.replace(/[\s　]+/g, " ").trim();
function identityIncomplete(r) {
  const nat = (r.nationality || "").trim().toUpperCase();
  const ko = collapse(r.name_ko || ""), ja = collapse((r.name_ja || "").normalize("NFKC"));
  const en = collapse((r.name_en || "").normalize("NFKC").toUpperCase());
  const kata = collapse((r.name_katakana || "").normalize("NFKC").replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)));
  if (!/^[A-Z]{2}$/.test(nat)) return true;
  if (nat === "KR" && !ko) return true;
  if (nat === "JP" && !ja) return true;
  if (en && !/^[A-Z][A-Z .,'-]*$/.test(en)) return true;
  if (!kata || !/^[ァ-ヺー・ヽヾ ]+$/.test(kata) || !/[ァ-ヺ]/.test(kata)) return true;
  return false;
}
const docId = (uid) => {
  const h = crypto.createHash("md5").update(`review-demo-identity:${uid}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// ── 견본 이미지 ──
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const FONT = "Hiragino Sans, Hiragino Kaku Gothic ProN, Apple SD Gothic Neo, Helvetica, Arial, sans-serif";
function frame(inner, [c1, c2]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="856" height="540" viewBox="0 0 856 540" font-family="${FONT}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <rect width="856" height="540" rx="34" fill="url(#g)"/>
  <rect x="3" y="3" width="850" height="534" rx="32" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="2"/>
  ${inner}
  <g transform="translate(428 290) rotate(-18)" opacity="0.30" text-anchor="middle">
    <text y="0" font-size="86" font-weight="800" fill="#b3261e" letter-spacing="6">SAMPLE</text>
    <text y="74" font-size="62" font-weight="800" fill="#b3261e" letter-spacing="10">見本</text>
  </g></svg>`;
}
const NOTE = `<text x="40" y="500" font-size="14" fill="#5c6b88">※ これは審査用の架空の見本です。実在しません。 / FICTIONAL SAMPLE ONLY</text>`;
function residenceFront(p) {
  const row = (y, l, v, s = 25) => `<text x="262" y="${y}" font-size="14" fill="#3b4a66">${esc(l)}</text><text x="262" y="${y + 26}" font-size="${s}" font-weight="600" fill="#101a33">${esc(v)}</text>`;
  return frame(`
  <rect x="26" y="22" width="804" height="52" rx="12" fill="#1f3a6b" fill-opacity="0.92"/>
  <text x="46" y="57" font-size="22" font-weight="700" fill="#fff">RESIDENCE CARD (SAMPLE) ／ 在留カード風・見本</text>
  <rect x="40" y="110" width="190" height="236" rx="10" fill="#e8edf5" stroke="#9fb0cc" stroke-width="2"/>
  <circle cx="135" cy="198" r="40" fill="#b9c6dc"/><path d="M55 346 q80 -120 160 0z" fill="#b9c6dc"/>
  ${row(120, "氏名 / NAME", p.nameRoman, 30)}
  ${row(176, "生年月日 / DATE OF BIRTH", p.birthDate.replace(/-/g, "."), 24)}
  ${row(232, "国籍・地域 / NATIONALITY", p.nationalityText, 24)}
  ${row(288, "在留資格 / STATUS", p.residenceStatus, 24)}
  <text x="40" y="404" font-size="14" fill="#3b4a66">DATE OF EXPIRATION</text>
  <text x="40" y="436" font-size="30" font-weight="700" fill="#101a33">${esc(p.expiresOn.replace(/-/g, "."))}</text>
  ${NOTE}`, ["#d6e6f7", "#b9d3ee"]);
}
const residenceBack = () => frame(`
  <rect x="26" y="22" width="804" height="52" rx="12" fill="#1f3a6b" fill-opacity="0.92"/>
  <text x="46" y="57" font-size="22" font-weight="700" fill="#fff">SAMPLE ／ 裏面・見本</text>
  <text x="40" y="118" font-size="15" fill="#3b4a66">住居地記載欄 / ADDRESS</text>
  <rect x="40" y="130" width="776" height="62" rx="8" fill="#fff" fill-opacity="0.75" stroke="#9fb0cc"/>
  <text x="56" y="168" font-size="22" font-weight="600" fill="#101a33">東京都サンプル区見本町0-0-0</text>
  ${NOTE}`, ["#e3eef9", "#c5dbf1"]);
function myNumberFront(p) {
  return frame(`
  <rect x="26" y="22" width="804" height="52" rx="12" fill="#b3566b" fill-opacity="0.9"/>
  <text x="46" y="57" font-size="22" font-weight="700" fill="#fff">MY NUMBER CARD (SAMPLE) ／ マイナンバーカード風・見本</text>
  <rect x="40" y="110" width="190" height="236" rx="10" fill="#f5e8ec" stroke="#cc9fae" stroke-width="2"/>
  <circle cx="135" cy="198" r="40" fill="#dcb9c5"/><path d="M55 346 q80 -120 160 0z" fill="#dcb9c5"/>
  <text x="262" y="130" font-size="14" fill="#6b3b4a">氏名 / NAME</text>
  <text x="262" y="166" font-size="30" font-weight="600" fill="#331018">${esc(p.name)}</text>
  <text x="262" y="226" font-size="14" fill="#6b3b4a">生年月日 / DATE OF BIRTH</text>
  <text x="262" y="258" font-size="24" font-weight="600" fill="#331018">${esc(p.birthDate.replace(/-/g, "."))}</text>
  <text x="40" y="404" font-size="14" fill="#6b3b4a">有効期限 / EXPIRATION</text>
  <text x="40" y="436" font-size="30" font-weight="700" fill="#331018">${esc(p.expiresOn.replace(/-/g, "."))}</text>
  ${NOTE}`, ["#f7e0e8", "#eec3d1"]);
}
async function jpeg(svg) {
  const sharp = require("sharp");
  return sharp(Buffer.from(svg), { density: 144 }).resize(856, 540).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
}

async function main() {
  console.log(`모드: ${CLEAN ? "CLEAN" : "SEED"} / ${APPLY ? "APPLY(실제 쓰기)" : "dry run"}`);
  const sb = connect();
  const org = await getDemoOrg(sb);
  if (org.slug !== "stayops-review-demo") throw new Error("데모 조직이 아님 — 중단");

  const { data: ms, error: me } = await sb.from("memberships").select("user_id, role").eq("organization_id", org.id).eq("status", "active");
  if (me) throw new Error(me.message);
  const ids = ms.map((m) => m.user_id);
  const { data: profs, error: pe } = await sb.from("profiles").select("id, name, nationality, name_ko, name_ja, name_en, name_katakana").in("id", ids);
  if (pe) throw new Error(pe.message);
  const rosterIds = new Set();
  for (const v of (await ensureDeckPeople({ sb, apply: false })).values()) if (v.userId) rosterIds.add(v.userId);
  const owner = ms.find((m) => m.role === "owner");

  if (CLEAN) return clean({ sb, org, profs });

  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
  const today = tokyoToday();
  const expiresOn = addDays(today, 500);
  const rows = [];
  for (const p of profs) {
    const fill = FILL[p.name];
    const isRoster = rosterIds.has(p.id);
    const incomplete = identityIncomplete(p);
    const patch = {};
    if (incomplete) {
      if (!fill) { console.log(`  ! ${p.name}: 이름 정보가 비었지만 FILL 값이 없음 — 건너뜀`); continue; }
      for (const f of FIELDS) if (!p[f] && fill[f]) patch[f] = fill[f];
    }
    const merged = { ...p, ...patch };
    if (incomplete && identityIncomplete(merged)) console.log(`  ! ${p.name}: 채워도 여전히 미완성`);
    const { count } = await sb.from("staff_id_documents").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("user_id", p.id).eq("is_current", true);
    const needDoc = !isRoster && (count ?? 0) === 0;
    console.log(`  - ${p.name}${isRoster ? " [덱 명단]" : ""}: 프로필 ${Object.keys(patch).join(",") || "그대로"} / 서류 ${needDoc ? (merged.nationality === "JP" ? "마이넘버 견본 추가" : "재류카드 견본 추가") : isRoster ? "손대지 않음" : "이미 있음"}`);
    if (Object.keys(patch).length && APPLY) {
      const { error } = await sb.from("profiles").update(patch).eq("id", p.id);
      if (error) throw new Error(`profile ${p.name}: ${error.message}`);
      state[p.id] = { ...(state[p.id] || {}), ...Object.fromEntries(Object.keys(patch).map((k) => [k, patch[k]])) };
    }
    if (needDoc) rows.push({ p, merged, fill });
  }
  if (APPLY) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 2)); }

  for (const { p, merged, fill } of rows) {
    if (!APPLY) continue;
    const id = docId(p.id);
    const base = `${org.id}/${p.id}/${id}`;
    const isJp = merged.nationality === "JP";
    const birth = (fill && fill.birth) || "1995-01-01";
    const front = `${base}/front-${MARK}.jpg`;
    const back = isJp ? null : `${base}/back-${MARK}.jpg`;
    const fields = isJp
      ? { name: merged.name_ja || merged.name, birthDate: birth, expiresOn }
      : { nameRoman: (fill && fill.roman) || (merged.name_en || "DEMO USER"), birthDate: birth, nationalityText: merged.nationality, residenceStatus: "技術・人文知識・国際業務", expiresOn };
    const up = async (file, svg) => {
      const { error } = await sb.storage.from(BUCKET).upload(file, await jpeg(svg), { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(`upload ${file}: ${error.message}`);
    };
    await up(front, isJp ? myNumberFront(fields) : residenceFront(fields));
    if (back) await up(back, residenceBack());
    await sb.from("staff_id_documents").delete().eq("organization_id", org.id).eq("id", id);
    const now = new Date().toISOString();
    const row = {
      id, organization_id: org.id, user_id: p.id,
      kind: isJp ? "my_number_card" : "residence_card",
      status: "confirmed", is_current: false, front_path: front, back_path: back,
      name_roman: isJp ? null : fields.nameRoman, birth_date: birth,
      nationality_text: isJp ? null : fields.nationalityText,
      expires_on: expiresOn, card_number: null,
      residence_status: isJp ? null : fields.residenceStatus,
      work_restriction: isJp ? null : "designated_org", extra_activity: isJp ? null : "none",
      ocr_used: false, ocr_values: null, edited_fields: [],
      confirmed_by: owner ? owner.user_id : null, confirmed_at: now,
    };
    const { error: ie } = await sb.from("staff_id_documents").insert(row);
    if (ie) throw new Error(`insert ${p.name}: ${ie.message}`);
    const { data: ok, error: re } = await sb.rpc("promote_staff_id_document", { p_organization_id: org.id, p_user_id: p.id, p_document_id: id });
    if (re || !ok) throw new Error(`promote ${p.name}: ${re ? re.message : "false"}`);
    console.log(`  ✓ ${p.name} 서류 저장`);
  }
  if (!APPLY) console.log("\ndry run 끝 — 아무것도 쓰지 않았습니다. 실제 반영은 --apply");
  else await verify({ sb, org, rosterIds });
}

async function verify({ sb, org, rosterIds }) {
  const { data: ms } = await sb.from("memberships").select("user_id").eq("organization_id", org.id).eq("status", "active");
  const { data: profs } = await sb.from("profiles").select("id, name, nationality, name_ko, name_ja, name_en, name_katakana").in("id", ms.map((m) => m.user_id));
  console.log("\n검증 (이름 시트 / 서류 시트)");
  for (const p of profs) {
    const { count } = await sb.from("staff_id_documents").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("user_id", p.id).eq("is_current", true);
    const idn = identityIncomplete(p);
    const prompt = idn ? "이름 시트" : (count ?? 0) === 0 ? "서류 시트" : "없음";
    console.log(`  ${p.name.padEnd(12)} identityIncomplete=${idn} 현재서류=${count} → ${prompt}${rosterIds.has(p.id) && prompt !== "없음" ? " (덱 명단 · 의도)" : ""}`);
  }
}

async function clean({ sb, org, profs }) {
  const ids = profs.map((p) => docId(p.id));
  const { data: rows } = await sb.from("staff_id_documents").select("id, front_path, back_path").eq("organization_id", org.id).in("id", ids);
  const mine = (rows || []).filter((r) => r.front_path.includes(`-${MARK}.jpg`));
  const files = mine.flatMap((r) => [r.front_path, r.back_path]).filter((f) => f && f.startsWith(`${org.id}/`) && f.includes(`-${MARK}.jpg`));
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
  console.log(`삭제 대상: 서류 ${mine.length}건 · 사진 ${files.length}장 · 프로필 복원 ${Object.keys(state).length}명`);
  if (!APPLY) return console.log("dry run — 실제 되돌리기는 --clean --apply");
  if (files.length) await sb.storage.from(BUCKET).remove(files);
  if (mine.length) await sb.from("staff_id_documents").delete().eq("organization_id", org.id).in("id", mine.map((r) => r.id));
  for (const p of profs) {
    const set = state[p.id];
    if (!set) continue;
    const reset = {};
    for (const [k, v] of Object.entries(set)) if (p[k] === v) reset[k] = null; // 지금도 우리가 넣은 값일 때만 비움
    if (Object.keys(reset).length) await sb.from("profiles").update(reset).eq("id", p.id);
  }
  if (fs.existsSync(STATE)) fs.unlinkSync(STATE);
  console.log("되돌리기 완료");
}

main().catch((e) => { console.error(e); process.exit(1); });
