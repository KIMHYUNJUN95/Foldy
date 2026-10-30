/**
 * 발표(데크)용 데모 — 가상 시급 알바 명단. 실제 사람이 아니다(이름 · 전화 · 카드 모두 가상).
 * 세 시드(deck-demo-payroll / -cleaning / -residence)가 같은 명단을 쓴다. 「Foldy Demo」 조직(slug `stayops-review-demo`)에만 넣는다.
 *
 * nationality: KR · JP · VN · CN. 일본 국적은 재류카드 없음(마이넘버), 그 밖은 재류카드 대상.
 * card: 재류카드 견본 — null 이면 카드 없음/미등록.
 *   status: "confirmed"(확인함) | "pending"(확인 대기) | null(미등록)
 *   expiresInDays: 오늘부터 만료까지 남은 날(90 이하면 만료 임박 표시)
 */
const ORG_SLUG = "stayops-review-demo";
const EMAIL_DOMAIN = "haru-tokyo.com";

const ROSTER = [
  { key: "d01", email: `stayops.demo.deck01@${EMAIL_DOMAIN}`, name: "박서연", kana: "パク ソヨン", nationality: "KR", gender: "female", birth: "1999-04-12", phone: "+81-90-0100-0001", rate: 1300, withholding: "kou", method: "transfer", card: { status: "confirmed", visa: "留学", expiresInDays: 400, workPermit: true, cardNo: "AB12345678CD" } },
  { key: "d02", email: `stayops.demo.deck02@${EMAIL_DOMAIN}`, name: "이도현", kana: "イ ドヒョン", nationality: "KR", gender: "male", birth: "2000-09-03", phone: "+81-90-0100-0002", rate: 1250, withholding: "kou", method: "transfer", card: { status: "confirmed", visa: "特定活動(ワーキングホリデー)", expiresInDays: 75, workPermit: true, cardNo: "EF23456789GH" } },
  { key: "d03", email: `stayops.demo.deck03@${EMAIL_DOMAIN}`, name: "최유나", kana: "チェ ユナ", nationality: "KR", gender: "female", birth: "1998-12-21", phone: "+81-90-0100-0003", rate: 1350, withholding: "kou", method: "cash", card: { status: "pending", visa: "留学", expiresInDays: 520, workPermit: true, cardNo: "JK34567890LM" } },
  { key: "d04", email: `stayops.demo.deck04@${EMAIL_DOMAIN}`, name: "다나카 미사키", kana: "タナカ ミサキ", nationality: "JP", gender: "female", birth: "2001-02-17", phone: "+81-90-0100-0004", rate: 1250, withholding: "kou", method: "transfer", card: null },
  { key: "d05", email: `stayops.demo.deck05@${EMAIL_DOMAIN}`, name: "응우옌 반안", kana: "グエン ヴァン アン", nationality: "VN", gender: "male", birth: "2000-06-30", phone: "+81-90-0100-0005", rate: 1250, withholding: "kou", method: "cash", card: { status: "confirmed", visa: "留学", expiresInDays: 210, workPermit: true, cardNo: "NP45678901QR" } },
  { key: "d06", email: `stayops.demo.deck06@${EMAIL_DOMAIN}`, name: "리웨이", kana: "リー ウェイ", nationality: "CN", gender: "male", birth: "1997-08-08", phone: "+81-90-0100-0006", rate: 1400, withholding: "otsu", method: "transfer", card: { status: "confirmed", visa: "技術・人文知識・国際業務", expiresInDays: 28, workPermit: false, cardNo: "ST56789012UV" } },
  { key: "d07", email: `stayops.demo.deck07@${EMAIL_DOMAIN}`, name: "정하준", kana: "チョン ハジュン", nationality: "KR", gender: "male", birth: "1999-01-25", phone: "+81-90-0100-0007", rate: 1300, withholding: "kou", method: "transfer", card: { status: "pending", visa: "家族滞在", expiresInDays: 300, workPermit: true, cardNo: "WX67890123YZ" } },
  { key: "d08", email: `stayops.demo.deck08@${EMAIL_DOMAIN}`, name: "김나영", kana: "キム ナヨン", nationality: "KR", gender: "female", birth: "2002-05-14", phone: "+81-90-0100-0008", rate: 1250, withholding: "kou", method: "transfer", card: null /* 재류카드 미등록 — 「미등록」 견본 */, cardRequired: true },
  { key: "d09", email: `stayops.demo.deck09@${EMAIL_DOMAIN}`, name: "사토 켄", kana: "サトウ ケン", nationality: "JP", gender: "male", birth: "2000-10-09", phone: "+81-90-0100-0009", rate: 1300, withholding: "kou", method: "cash", card: null },
  { key: "d10", email: `stayops.demo.deck10@${EMAIL_DOMAIN}`, name: "쩐티마이", kana: "チャン ティ マイ", nationality: "VN", gender: "female", birth: "2001-03-27", phone: "+81-90-0100-0010", rate: 1250, withholding: "kou", method: "cash", card: { status: "confirmed", visa: "留学", expiresInDays: 85, workPermit: true, cardNo: "BC78901234DE" } },
];

module.exports = { ORG_SLUG, EMAIL_DOMAIN, ROSTER };
