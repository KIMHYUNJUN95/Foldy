import { nationalityName } from "@/lib/identity-names";

// 셀프 체크인 명부의 국적은 ISO 3166-1 alpha-3(여권 MRZ 와 같다)로 저장된다. 화면에는 보는 사람 언어의 나라 이름으로 보여 준다.
// 이름 도구는 기존 `nationalityName`(Intl.DisplayNames, alpha-2)을 쓰고, 여기서는 alpha-3 → alpha-2 표만 둔다. 모르는 코드는 코드 그대로.

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  AND: "AD", ARE: "AE", AFG: "AF", ATG: "AG", AIA: "AI", ALB: "AL", ARM: "AM", AGO: "AO", ARG: "AR", ASM: "AS", AUT: "AT", AUS: "AU",
  ABW: "AW", ALA: "AX", AZE: "AZ", BIH: "BA", BRB: "BB", BGD: "BD", BEL: "BE", BFA: "BF", BGR: "BG", BHR: "BH", BDI: "BI", BEN: "BJ",
  BLM: "BL", BMU: "BM", BRN: "BN", BOL: "BO", BES: "BQ", BRA: "BR", BHS: "BS", BTN: "BT", BWA: "BW", BLR: "BY", BLZ: "BZ", CAN: "CA",
  CCK: "CC", COD: "CD", CAF: "CF", COG: "CG", CHE: "CH", CIV: "CI", COK: "CK", CHL: "CL", CMR: "CM", CHN: "CN", COL: "CO", CRI: "CR",
  CUB: "CU", CPV: "CV", CUW: "CW", CXR: "CX", CYP: "CY", CZE: "CZ", DEU: "DE", DJI: "DJ", DNK: "DK", DMA: "DM", DOM: "DO", DZA: "DZ",
  ECU: "EC", EST: "EE", EGY: "EG", ESH: "EH", ERI: "ER", ESP: "ES", ETH: "ET", FIN: "FI", FJI: "FJ", FLK: "FK", FSM: "FM", FRO: "FO",
  FRA: "FR", GAB: "GA", GBR: "GB", GRD: "GD", GEO: "GE", GUF: "GF", GGY: "GG", GHA: "GH", GIB: "GI", GRL: "GL", GMB: "GM", GIN: "GN",
  GLP: "GP", GNQ: "GQ", GRC: "GR", GTM: "GT", GUM: "GU", GNB: "GW", GUY: "GY", HKG: "HK", HND: "HN", HRV: "HR", HTI: "HT", HUN: "HU",
  IDN: "ID", IRL: "IE", ISR: "IL", IMN: "IM", IND: "IN", IRQ: "IQ", IRN: "IR", ISL: "IS", ITA: "IT", JEY: "JE", JAM: "JM", JOR: "JO",
  JPN: "JP", KEN: "KE", KGZ: "KG", KHM: "KH", KIR: "KI", COM: "KM", KNA: "KN", PRK: "KP", KOR: "KR", KWT: "KW", CYM: "KY", KAZ: "KZ",
  LAO: "LA", LBN: "LB", LCA: "LC", LIE: "LI", LKA: "LK", LBR: "LR", LSO: "LS", LTU: "LT", LUX: "LU", LVA: "LV", LBY: "LY", MAR: "MA",
  MCO: "MC", MDA: "MD", MNE: "ME", MAF: "MF", MDG: "MG", MHL: "MH", MKD: "MK", MLI: "ML", MMR: "MM", MNG: "MN", MAC: "MO", MNP: "MP",
  MTQ: "MQ", MRT: "MR", MSR: "MS", MLT: "MT", MUS: "MU", MDV: "MV", MWI: "MW", MEX: "MX", MYS: "MY", MOZ: "MZ", NAM: "NA", NCL: "NC",
  NER: "NE", NFK: "NF", NGA: "NG", NIC: "NI", NLD: "NL", NOR: "NO", NPL: "NP", NRU: "NR", NIU: "NU", NZL: "NZ", OMN: "OM", PAN: "PA",
  PER: "PE", PYF: "PF", PNG: "PG", PHL: "PH", PAK: "PK", POL: "PL", SPM: "PM", PCN: "PN", PRI: "PR", PSE: "PS", PRT: "PT", PLW: "PW",
  PRY: "PY", QAT: "QA", REU: "RE", ROU: "RO", SRB: "RS", RUS: "RU", RWA: "RW", SAU: "SA", SLB: "SB", SYC: "SC", SDN: "SD", SWE: "SE",
  SGP: "SG", SHN: "SH", SVN: "SI", SJM: "SJ", SVK: "SK", SLE: "SL", SMR: "SM", SEN: "SN", SOM: "SO", SUR: "SR", SSD: "SS", STP: "ST",
  SLV: "SV", SXM: "SX", SYR: "SY", SWZ: "SZ", TCA: "TC", TCD: "TD", TGO: "TG", THA: "TH", TJK: "TJ", TKL: "TK", TLS: "TL", TKM: "TM",
  TUN: "TN", TON: "TO", TUR: "TR", TTO: "TT", TUV: "TV", TWN: "TW", TZA: "TZ", UKR: "UA", UGA: "UG", USA: "US", URY: "UY", UZB: "UZ",
  VAT: "VA", VCT: "VC", VEN: "VE", VGB: "VG", VIR: "VI", VNM: "VN", VUT: "VU", WLF: "WF", WSM: "WS", XKX: "XK", YEM: "YE", MYT: "YT",
  ZAF: "ZA", ZMB: "ZM", ZWE: "ZW",
  // 여권 MRZ 에서 독일은 「D」 한 글자.
  D: "DE",
};

/** 저장된 국적(alpha-3, 대소문자 무관) → 화면 언어의 나라 이름. 모르는 코드는 코드 그대로(대문자). */
export function checkinNationalityName(code: string | null, locale: string): string | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  const alpha2 = ALPHA3_TO_ALPHA2[upper];
  if (!alpha2) return upper;
  const name = nationalityName(alpha2, locale);
  return name === alpha2 ? upper : name;
}
