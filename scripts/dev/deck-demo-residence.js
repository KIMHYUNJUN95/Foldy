/**
 * 발표(데크)용 데모 — 「Foldy Demo」 조직(slug `stayops-review-demo`)의 재류카드(직원 서류) 가상 데이터 + 가상 카드 사진.
 *
 *   node scripts/dev/deck-demo-residence.js            # dry run: 계획 출력 + 견본 이미지 생성(업로드 · DB 쓰기 없음)
 *   node scripts/dev/deck-demo-residence.js --apply    # 사진 업로드 + staff_id_documents 행 넣기
 *   node scripts/dev/deck-demo-residence.js --clean    # 이 스크립트가 만든 행 · 사진만 삭제 (dry run 이 기본, --apply 와 같이 써야 실제 삭제)
 *
 * 실제 서버 액션(submitIdCard · saveStaffIdDocumentByAdmin · reviewIdDocument)이 만드는 모양 그대로 행을 만든다:
 *   새 행 is_current=false 로 insert → promote_staff_id_document RPC 로 지금 카드 올리기(이전 카드는 이력으로 내려감).
 * 표식(clean 대상 구분): 서류 id 는 `deck-demo-residence:<key>` 의 md5 로 만든 고정 uuid, 사진 파일명은 `front-deckdemo.jpg` / `back-deckdemo.jpg`.
 * 안전장치: slug 가 stayops-review-demo 인 조직 하나에만 쓴다. 그 사람에게 이 스크립트 것이 아닌 「지금 카드」가 있으면 건드리지 않고 건너뛴다.
 * 멱등: 같은 id 의 행은 지우고 다시 넣고, 사진은 upsert 한다.
 *
 * 이미지: 명백한 견본(SAMPLE · 見本 워터마크, 실제 서식 · 로고 복제 없음) — sharp 로 SVG → JPEG(저장소 경로 규칙이 .jpg).
 * 임시 파일: .claude/deck-tmp/residence/
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const CLEAN = args.has("--clean");
const BUCKET = "staff-documents";
const MARK = "deckdemo"; // 파일명 표식
const OUT_DIR = path.join(__dirname, "..", "..", ".claude", "deck-tmp", "residence");

// ── 헬퍼 (다른 에이전트가 만드는 deck-demo-roster.js) ────────────────────────────
let helper = null;
try {
  helper = require("./deck-demo-roster");
} catch (e) {
  if (e.code !== "MODULE_NOT_FOUND") throw e;
}
const data = require("./deck-demo-roster-data");
const ORG_SLUG = helper ? helper.ORG_SLUG : data.ORG_SLUG;
const ROSTER = helper ? helper.ROSTER : data.ROSTER;
function ymdToday() {
  if (helper) return helper.tokyoToday();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}
function ymdAdd(ymd, n) {
  if (helper) return helper.addDays(ymd, n);
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

if (ORG_SLUG !== "stayops-review-demo") throw new Error(`ORG_SLUG 가 예상과 다름: ${ORG_SLUG}`);

// ── 카드 칸 값 (가상) ────────────────────────────────────────────────────────────
const ROMAN = {
  d01: "PARK SEOYEON", d02: "LEE DOHYEON", d03: "CHOI YUNA", d05: "NGUYEN VAN ANH",
  d06: "LI WEI", d07: "JEONG HAJUN", d10: "TRAN THI MAI",
};
const NATIONALITY_TEXT = { KR: "韓国", VN: "ベトナム", CN: "中国" };
const ADDRESS = "東京都サンプル区見本町0-0-0 サンプルハイツ000"; // 가상 주소

function workFields(card) {
  const v = card.visa;
  if (v.startsWith("特定活動")) return { work: "designated", extra: "none" }; // 워킹홀리데이: 지정서 활동
  if (v === "技術・人文知識・国際業務") return { work: "designated_org", extra: "none" };
  // 留学 · 家族滞在: 취업 불가 + 자격외활동허가(주 28시간)
  return { work: "not_allowed", extra: card.workPermit ? "weekly_28h" : "none" };
}
function visaForDb(card) {
  return card.visa.startsWith("特定活動") ? "特定活動" : card.visa; // 카드에는 자격명만 적힌다
}
const WORK_TEXT = {
  none: "就労制限なし",
  status_based: "在留資格に基づく就労活動のみ可",
  designated_org: "指定書により指定された機関での就労のみ可",
  designated: "指定書により指定された就労活動のみ可",
  not_allowed: "就労不可",
};
const EXTRA_TEXT = {
  none: "資格外活動許可：なし",
  weekly_28h: "資格外活動許可：原則週28時間以内（風俗営業等を除く）",
  per_certificate: "資格外活動許可：許可書記載の活動のみ",
};

function docId(key, suffix = "") {
  const h = crypto.createHash("md5").update(`deck-demo-residence:${key}${suffix}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ── 견본 이미지 ──────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const FONT = "Hiragino Sans, Hiragino Kaku Gothic ProN, Apple SD Gothic Neo, Helvetica, Arial, sans-serif";

function frame(inner, tone) {
  const [c1, c2] = tone;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="856" height="540" viewBox="0 0 856 540" font-family="${FONT}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <pattern id="p" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#ffffff" opacity="0.35"/></pattern>
  </defs>
  <rect width="856" height="540" rx="34" fill="url(#g)"/>
  <rect width="856" height="540" rx="34" fill="url(#p)"/>
  <rect x="3" y="3" width="850" height="534" rx="32" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="2"/>
  ${inner}
  <g transform="translate(428 290) rotate(-18)" opacity="0.30" text-anchor="middle">
    <text y="0" font-size="86" font-weight="800" fill="#b3261e" letter-spacing="6">SAMPLE</text>
    <text y="74" font-size="62" font-weight="800" fill="#b3261e" letter-spacing="10">見本</text>
  </g>
</svg>`;
}

function frontSvg(p) {
  const row = (y, label, value, size = 25) =>
    `<text x="262" y="${y}" font-size="14" fill="#3b4a66">${esc(label)}</text><text x="262" y="${y + 26}" font-size="${size}" font-weight="600" fill="#101a33">${esc(value)}</text>`;
  const inner = `
  <rect x="26" y="22" width="804" height="52" rx="12" fill="#1f3a6b" fill-opacity="0.92"/>
  <text x="46" y="57" font-size="22" font-weight="700" fill="#fff">RESIDENCE CARD (SAMPLE) ／ 在留カード風・見本</text>
  <text x="810" y="54" font-size="14" fill="#cfdcf5" text-anchor="end">架空のデータ・実在しません</text>
  <rect x="40" y="110" width="190" height="236" rx="10" fill="#e8edf5" stroke="#9fb0cc" stroke-width="2"/>
  <circle cx="135" cy="198" r="40" fill="#b9c6dc"/><path d="M55 346 q80 -120 160 0z" fill="#b9c6dc"/>
  <text x="135" y="332" font-size="14" fill="#6b7a96" text-anchor="middle">PHOTO (SAMPLE)</text>
  ${row(120, "氏名 / NAME", p.nameRoman, 30)}
  ${row(176, "生年月日 / DATE OF BIRTH　性別 / SEX", `${p.birthDate.replace(/-/g, ".")}　${p.gender === "female" ? "F" : "M"}`, 24)}
  ${row(232, "国籍・地域 / NATIONALITY", p.nationalityText, 24)}
  ${row(288, "在留資格 / STATUS", p.residenceStatus, 24)}
  <text x="262" y="352" font-size="14" fill="#3b4a66">就労制限の有無</text>
  <text x="262" y="378" font-size="22" font-weight="700" fill="#0b2a63">${esc(p.workText)}</text>
  <text x="40" y="404" font-size="14" fill="#3b4a66">在留期間の満了する日 / DATE OF EXPIRATION</text>
  <text x="40" y="436" font-size="30" font-weight="700" fill="#101a33">${esc(p.expiresOn.replace(/-/g, "."))}</text>
  <text x="430" y="404" font-size="14" fill="#3b4a66">番号 / No.</text>
  <text x="430" y="436" font-size="30" font-weight="700" fill="#101a33" letter-spacing="2">${esc(p.cardNumber)}</text>
  <text x="40" y="500" font-size="14" fill="#5c6b88">※ これは発表用の架空の見本です。実際の在留カードではありません。 / FICTIONAL SAMPLE ONLY</text>`;
  return frame(inner, ["#d6e6f7", "#b9d3ee"]);
}

function backSvg(p) {
  const inner = `
  <rect x="26" y="22" width="804" height="52" rx="12" fill="#1f3a6b" fill-opacity="0.92"/>
  <text x="46" y="57" font-size="22" font-weight="700" fill="#fff">SAMPLE ／ 裏面・見本</text>
  <text x="40" y="118" font-size="15" fill="#3b4a66">住居地記載欄 / ADDRESS</text>
  <rect x="40" y="130" width="776" height="62" rx="8" fill="#ffffff" fill-opacity="0.75" stroke="#9fb0cc"/>
  <text x="56" y="168" font-size="22" font-weight="600" fill="#101a33">${esc(p.address)}</text>
  <text x="40" y="236" font-size="15" fill="#3b4a66">資格外活動許可欄</text>
  <rect x="40" y="248" width="776" height="62" rx="8" fill="#ffffff" fill-opacity="0.75" stroke="#9fb0cc"/>
  <text x="56" y="286" font-size="20" font-weight="700" fill="#0b2a63">${esc(p.extraText)}</text>
  <text x="40" y="350" font-size="15" fill="#3b4a66">在留期間更新等許可申請欄 / 備考</text>
  <rect x="40" y="362" width="776" height="62" rx="8" fill="#ffffff" fill-opacity="0.5" stroke="#9fb0cc" stroke-dasharray="6 5"/>
  <text x="56" y="400" font-size="16" fill="#6b7a96">（サンプル：記載なし）</text>
  <text x="40" y="500" font-size="14" fill="#5c6b88">※ これは発表用の架空の見本です。実際の在留カードではありません。 / FICTIONAL SAMPLE ONLY</text>`;
  return frame(inner, ["#e3eef9", "#c5dbf1"]);
}

async function renderJpeg(svg) {
  const sharp = require("sharp");
  return sharp(Buffer.from(svg), { density: 144 }).resize(856, 540).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
}

// ── 계획 ─────────────────────────────────────────────────────────────────────────
function buildPlan() {
  const today = ymdToday();
  const plan = [];
  for (const r of ROSTER) {
    if (!r.card) {
      plan.push({ key: r.key, name: r.name, skip: r.cardRequired ? "미등록 그대로(카드 없음 · 등록 대상)" : "카드 대상 아님/없음" });
      continue;
    }
    const c = r.card;
    const roman = ROMAN[r.key];
    if (!roman) throw new Error(`ROMAN 매핑 없음: ${r.key}`);
    const { work, extra } = workFields(c);
    const p = {
      nameRoman: roman,
      birthDate: r.birth,
      gender: r.gender,
      nationalityText: NATIONALITY_TEXT[r.nationality] || r.nationality,
      address: ADDRESS,
      expiresOn: ymdAdd(today, c.expiresInDays),
      cardNumber: c.cardNo,
      residenceStatus: visaForDb(c),
      work,
      extra,
      workText: WORK_TEXT[work],
      extraText: EXTRA_TEXT[extra],
    };
    plan.push({ key: r.key, name: r.name, status: c.status, docId: docId(r.key), p, adminUpload: r.key === "d05" || r.key === "d06" });
    // 이력 예시: 갱신 전 카드(이미 만료·확인함, 지금 카드 아님)
    if (r.key === "d01" || r.key === "d06") {
      plan.push({
        key: r.key, name: r.name, history: true, status: "confirmed", docId: docId(r.key, ":prev"),
        p: { ...p, expiresOn: ymdAdd(today, -40), cardNumber: c.cardNo.slice(0, 2) + "99" + c.cardNo.slice(4) },
      });
    }
  }
  return plan;
}

function paths(org, userId, id) {
  return { front: `${org}/${userId}/${id}/front-${MARK}.jpg`, back: `${org}/${userId}/${id}/back-${MARK}.jpg` };
}

async function main() {
  console.log(`모드: ${CLEAN ? "CLEAN" : "SEED"} / ${APPLY ? "APPLY(실제 쓰기)" : "dry run"} / 헬퍼 ${helper ? "있음" : "없음(deck-demo-roster.js 미작성 — 폴백으로 계획만)"}`);
  const plan = buildPlan();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) 이미지 (dry run 에서도 생성)
  if (!CLEAN) {
    for (const it of plan.filter((x) => x.p)) {
      const base = it.history ? `${it.key}-prev` : it.key;
      fs.writeFileSync(path.join(OUT_DIR, `${base}-front.jpg`), await renderJpeg(frontSvg(it.p)));
      fs.writeFileSync(path.join(OUT_DIR, `${base}-back.jpg`), await renderJpeg(backSvg(it.p)));
    }
    console.log(`견본 이미지 생성: ${OUT_DIR} (${plan.filter((x) => x.p).length * 2}장)`);
  }

  // 2) 계획 출력
  for (const it of plan) {
    if (it.skip) console.log(`  - ${it.key} ${it.name}: 건너뜀 — ${it.skip}`);
    else
      console.log(
        `  - ${it.key} ${it.name}: ${it.history ? "[이력] " : ""}${it.status}${it.adminUpload ? " (관리자가 올림)" : ""} · ${it.p.residenceStatus} · 만료 ${it.p.expiresOn} · ${it.p.cardNumber} · ${it.p.work}/${it.p.extra}`,
      );
  }

  if (!helper) {
    console.log("\n헬퍼(scripts/dev/deck-demo-roster.js)가 없어 DB 단계는 건너뜁니다.");
    return;
  }
  const { connect, getDemoOrg, ensureDeckPeople } = helper;
  const sb = connect();
  const org = await getDemoOrg(sb);
  if (!org || org.slug !== "stayops-review-demo") throw new Error("데모 조직이 아님 — 중단");
  const people = await ensureDeckPeople({ sb, apply: false }); // 서류 단계는 사람 생성 안 함(이미 있어야 함)
  // 새로 만들어야 하는 사람은 apply 때만 — 다른 시드(ensureDeckPeople)가 먼저 채운 상태를 가정하되, --apply 면 보장한다.
  const people2 = APPLY && !CLEAN ? await ensureDeckPeople({ sb, apply: true }) : people;

  if (CLEAN) return clean({ sb, org, plan, people: people2 });

  // 확인자: 이 조직의 대표 · 전무(없으면 아무 활성 멤버)
  let reviewer = null;
  {
    const { data: ms } = await sb.from("memberships").select("user_id, role, status").eq("organization_id", org.id).eq("status", "active");
    const pick = (ms || []).find((m) => m.role === "owner") || (ms || []).find((m) => m.role === "senior_managing_director") || (ms || [])[0];
    reviewer = pick ? pick.user_id : null;
  }
  console.log(`확인자: ${reviewer ? reviewer : "없음(confirmed_by null)"}`);

  const ordered = [...plan.filter((x) => x.history), ...plan.filter((x) => !x.history && x.p)]; // 이력 먼저 → 지금 카드가 마지막에 올라간다
  const now = Date.now();
  let done = 0;
  for (const it of ordered) {
    const person = people2.get(it.key);
    if (!person || !person.userId) {
      console.log(`  ! ${it.key}: userId 없음(dry run 또는 사람 미생성) — 건너뜀`);
      continue;
    }
    // 이 스크립트 것이 아닌 지금 카드가 있으면 건드리지 않는다.
    const { data: cur } = await sb.from("staff_id_documents").select("id, front_path").eq("organization_id", org.id).eq("user_id", person.userId).eq("is_current", true);
    const foreign = (cur || []).filter((c) => !c.front_path.endsWith(`front-${MARK}.jpg`));
    if (foreign.length) {
      console.log(`  ! ${it.key}: 이 스크립트가 만들지 않은 지금 카드가 있어 건너뜀`);
      continue;
    }
    if (!APPLY) continue;

    const pp = paths(org.id, person.userId, it.docId);
    for (const [side, file] of [["front", pp.front], ["back", pp.back]]) {
      const base = it.history ? `${it.key}-prev` : it.key;
      const buf = fs.readFileSync(path.join(OUT_DIR, `${base}-${side}.jpg`));
      const { error } = await sb.storage.from(BUCKET).upload(file, buf, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(`upload ${file}: ${error.message}`);
    }
    await sb.from("staff_id_documents").delete().eq("organization_id", org.id).eq("id", it.docId);

    const isHistory = !!it.history;
    const confirmed = it.status === "confirmed";
    const days = isHistory ? 120 : 1 + (it.key.charCodeAt(2) % 6);
    const confirmedAt = new Date(now - days * 86400000).toISOString();
    const r = ROSTER.find((x) => x.key === it.key);
    const p = it.p;
    const row = {
      id: it.docId,
      organization_id: org.id,
      user_id: person.userId,
      kind: "residence_card",
      status: confirmed ? "confirmed" : "pending",
      is_current: false,
      front_path: pp.front,
      back_path: pp.back,
      name_roman: p.nameRoman,
      birth_date: p.birthDate,
      expires_on: p.expiresOn,
      card_number: p.cardNumber,
      residence_status: p.residenceStatus,
      work_restriction: p.work,
      extra_activity: p.extra,
      ocr_used: false,
      ocr_values: null,
      edited_fields: [],
      confirmed_by: confirmed ? reviewer : null,
      confirmed_at: confirmed ? confirmedAt : null,
      created_at: new Date(now - (days + 1) * 86400000).toISOString(),
    };
    if (it.adminUpload) {
      // saveStaffIdDocumentByAdmin: 성별 · 국적 · 주소 없음, 올린 사람 = 확인한 사람
      row.uploaded_by = reviewer;
    } else {
      row.gender = p.gender;
      row.nationality_text = p.nationalityText;
      row.address = p.address;
      if (it.key === "d03" || it.key === "d02") {
        // 자동 읽기를 쓰고 한 칸 고친 흔적(editedFieldsOf 모양: 칸 이름 배열)
        row.ocr_used = true;
        row.ocr_values = {
          nameRoman: p.nameRoman, birthDate: p.birthDate, gender: p.gender, nationalityText: p.nationalityText,
          address: "", expiresOn: p.expiresOn, cardNumber: p.cardNumber, residenceStatus: p.residenceStatus,
          workRestriction: p.work, extraActivity: it.key === "d03" ? "none" : p.extra,
        };
        row.edited_fields = it.key === "d03" ? ["extraActivity"] : [];
      }
    }
    const { error: insErr } = await sb.from("staff_id_documents").insert(row);
    if (insErr) throw new Error(`insert ${it.key}: ${insErr.message}`);
    if (!isHistory) {
      const { data: ok, error: rpcErr } = await sb.rpc("promote_staff_id_document", {
        p_organization_id: org.id, p_user_id: person.userId, p_document_id: it.docId,
      });
      if (rpcErr || !ok) throw new Error(`promote ${it.key}: ${rpcErr ? rpcErr.message : "false"}`);
    }
    done++;
    console.log(`  ✓ ${it.key}${isHistory ? " (이력)" : ""} 저장`);
  }
  console.log(APPLY ? `\n완료: ${done}건 저장` : "\ndry run 끝 — 아무것도 쓰지 않았습니다. 실제 반영은 --apply");
}

async function clean({ sb, org, plan, people }) {
  const ids = plan.filter((x) => x.docId).map((x) => x.docId);
  const { data: rows } = await sb.from("staff_id_documents").select("id, front_path, back_path").eq("organization_id", org.id);
  const mine = (rows || []).filter((r) => ids.includes(r.id) || r.front_path.endsWith(`front-${MARK}.jpg`));
  const files = mine.flatMap((r) => [r.front_path, r.back_path]).filter(Boolean).filter((f) => f.startsWith(`${org.id}/`) && f.includes(`-${MARK}.jpg`));
  console.log(`삭제 대상: 행 ${mine.length}건 · 사진 ${files.length}장`);
  if (!APPLY) return console.log("dry run — 실제 삭제는 --clean --apply");
  if (files.length) await sb.storage.from(BUCKET).remove(files);
  if (mine.length) await sb.from("staff_id_documents").delete().eq("organization_id", org.id).in("id", mine.map((r) => r.id));
  console.log("삭제 완료");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
