import type { Locale } from "@/lib/i18n";

export type PropertyAccessInfo = {
  labelKey:
    | "doorPassword"
    | "keyBox"
    | "keyBoxPassword"
    | "linenStorageEntrancePassword"
    | "roomPassword"
    | "storage"
    | "storagePassword";
  code: string;
  prefixKey?: "floor1";
  noteKey?: "allRoomsSame";
};

export type PropertyRoomCode = {
  roomLabel: string;
  code: string;
};

export type PropertyMapMeta = {
  canonicalName: string;
  kind: "hotel" | "house";
  address: {
    ko: string;
    ja: string;
    en: string;
  };
  googleMapsUrl: string;
  note?: string;
  sharedAccess: PropertyAccessInfo[];
  roomAccess?: PropertyRoomCode[];
};

export const PROPERTY_MAP_META: PropertyMapMeta[] = [
  {
    canonicalName: "아라키초A",
    kind: "hotel",
    address: {
      ko: "〒160-0007 Tokyo, Shinjuku City, Arakicho, 18−7 四谷長岡ビル",
      ja: "〒160-0007 Tokyo, Shinjuku City, Arakicho, 18−7 四谷長岡ビル",
      en: "〒160-0007 Tokyo, Shinjuku City, Arakicho, 18−7 四谷長岡ビル",
    },
    googleMapsUrl:
      "https://www.google.com/maps/place/JJ+HOUSE+Arakicho/@35.6941824,139.7194752,14z/data=!3m1!5s0x60188cf2267f3533:0xa732e333ba61cefb!4m9!3m8!1s0x60188dfd04c8fbf5:0x245eac1d16d4743a!5m2!4m1!1i2!8m2!3d35.691589!4d139.7235419!16s%2Fg%2F11j6k7s5f9?entry=tts",
    sharedAccess: [{ labelKey: "storage", code: "519" }],
    roomAccess: [
      { roomLabel: "201", code: "2010045*" },
      { roomLabel: "202", code: "2566*" },
      { roomLabel: "301", code: "3011006*" },
      { roomLabel: "302", code: "3020218*" },
      { roomLabel: "401", code: "CB8625" },
      { roomLabel: "402", code: "4020005*" },
      { roomLabel: "501", code: "5011170* (5012345*)" },
      { roomLabel: "502", code: "5021006*" },
      { roomLabel: "602", code: "6021221*" },
      { roomLabel: "701", code: "C12389" },
      { roomLabel: "702", code: "7020707*" },
    ],
  },
  {
    canonicalName: "아라키초B",
    kind: "hotel",
    address: {
      ko: "〒160-0007 Tokyo, Shinjuku City, Arakicho, 15−8 杉森ビル",
      ja: "〒160-0007 Tokyo, Shinjuku City, Arakicho, 15−8 杉森ビル",
      en: "〒160-0007 Tokyo, Shinjuku City, Arakicho, 15−8 杉森ビル",
    },
    googleMapsUrl:
      "https://www.google.com/maps/place/%E3%80%92160-0007+Tokyo,+Shinjuku+City,+Arakich%C5%8D,+15%E2%88%928+%E6%9D%89%E6%A3%AE%E3%83%93%E3%83%AB/@35.6908858,139.7242438,19z/data=!4m6!3m5!1s0x60188cf233594aff:0x179d356351dc97be!8m2!3d35.6913069!4d139.7242565!16s%2Fg%2F12hm7hkzm?entry=tts&g_ep=EgoyMDI1MDMyNS4xIPu8ASoASAFQAw%3D%3D&skid=5e9601a3-6ea4-4d2a-a0e2-223b2972e774",
    sharedAccess: [
      { labelKey: "roomPassword", code: "000000", noteKey: "allRoomsSame" },
      { labelKey: "storagePassword", prefixKey: "floor1", code: "519" },
      { labelKey: "keyBox", prefixKey: "floor1", code: "8511" },
    ],
  },
  {
    canonicalName: "가부키초",
    kind: "hotel",
    address: {
      ko: "〒160-0021 Tokyo, Shinjuku City, Kabukicho, 2 Chome−41−12 泉ビル",
      ja: "〒160-0021 Tokyo, Shinjuku City, Kabukicho, 2 Chome−41−12 泉ビル",
      en: "〒160-0021 Tokyo, Shinjuku City, Kabukicho, 2 Chome−41−12 泉ビル",
    },
    googleMapsUrl:
      "https://www.google.com/maps/place/JJ+HOUSE+KABUKICHO/@35.6941824,139.7194752,14z/data=!4m9!3m8!1s0x60188dcf23952c4b:0x1b670277b2224462!5m2!4m1!1i2!8m2!3d35.6979227!4d139.7025887!16s%2Fg%2F11svxlt6_p?entry=tts",
    sharedAccess: [{ labelKey: "keyBox", prefixKey: "floor1", code: "0021" }],
    roomAccess: [
      { roomLabel: "202", code: "2020117*" },
      { roomLabel: "203", code: "CB245" },
      { roomLabel: "302", code: "3020207*" },
      { roomLabel: "303", code: "3031006*" },
      { roomLabel: "402", code: "0317*" },
      { roomLabel: "403", code: "4030506*" },
      { roomLabel: "502", code: "5020110*" },
      { roomLabel: "603", code: "7007*" },
      { roomLabel: "802", code: "8027894*" },
      { roomLabel: "803", code: "CY2581" },
    ],
  },
  {
    canonicalName: "다카다노바바",
    kind: "hotel",
    address: {
      ko: "4 Chome-38-16 Takadanobaba, Shinjuku City, Tokyo 169-0075",
      ja: "4 Chome-38-16 Takadanobaba, Shinjuku City, Tokyo 169-0075",
      en: "4 Chome-38-16 Takadanobaba, Shinjuku City, Tokyo 169-0075",
    },
    googleMapsUrl:
      "https://www.google.com/maps/place/Light+House/@35.7086048,139.7016972,16.5z/data=!4m6!3m5!1s0x60188dc4ad0a46ab:0x8df54927b465b695!8m2!3d35.7113447!4d139.6966335!16s%2Fg%2F11l4kslr29?entry=tts&g_ep=EgoyMDI0MDYwOS4wKgBIAVAD",
    sharedAccess: [
      { labelKey: "storagePassword", prefixKey: "floor1", code: "1537" },
      { labelKey: "linenStorageEntrancePassword", prefixKey: "floor1", code: "5963" },
      { labelKey: "keyBoxPassword", prefixKey: "floor1", code: "912" },
    ],
    roomAccess: [
      { roomLabel: "2f", code: "4827" },
      { roomLabel: "3f", code: "1392" },
      { roomLabel: "4f", code: "7250" },
      { roomLabel: "5f", code: "3164" },
      { roomLabel: "6f", code: "4502" },
      { roomLabel: "7f", code: "1537" },
      { roomLabel: "8f", code: "6789" },
      { roomLabel: "9f", code: "5648" },
    ],
  },
  {
    canonicalName: "오쿠보A",
    kind: "house",
    address: {
      ko: "1 Chome-5-19 Okubo, Shinjuku City, Tokyo 169-0072",
      ja: "1 Chome-5-19 Okubo, Shinjuku City, Tokyo 169-0072",
      en: "1 Chome-5-19 Okubo, Shinjuku City, Tokyo 169-0072",
    },
    googleMapsUrl:
      "https://www.google.com/maps/place/Hotel+STAY+ARI+Highashi+Shinjuku/@35.6993611,139.7035311,16.64z/data=!4m9!3m8!1s0x60188d4a4ba67c23:0xe32142309aa2de59!5m2!4m1!1i2!8m2!3d35.7002401!4d139.706157!16s%2Fg%2F11vkft6rpq?entry=tts&g_ep=EgoyMDI2MDMyNC4wIPu8ASoASAFQAw%3D%3D&skid=e50d31ca-42e2-4891-b634-6737921a0629",
    sharedAccess: [
      { labelKey: "keyBoxPassword", code: "0072" },
      { labelKey: "storagePassword", code: "519" },
    ],
  },
  {
    canonicalName: "오쿠보B",
    kind: "house",
    address: {
      ko: "오쿠보A와 동일한 위치 (3개 건물 중 가장 왼쪽 집)",
      ja: "オクボAと同じ場所（3棟のうち一番左の家）",
      en: "Same location as OkuboA (leftmost house among the three buildings).",
    },
    googleMapsUrl:
      "https://www.google.com/maps/place/Hotel+STAY+ARI+Highashi+Shinjuku/@35.6993611,139.7035311,16.64z/data=!4m9!3m8!1s0x60188d4a4ba67c23:0xe32142309aa2de59!5m2!4m1!1i2!8m2!3d35.7002401!4d139.706157!16s%2Fg%2F11vkft6rpq?entry=tts&g_ep=EgoyMDI2MDMyNC4wIPu8ASoASAFQAw%3D%3D&skid=e50d31ca-42e2-4891-b634-6737921a0629",
    sharedAccess: [
      { labelKey: "keyBoxPassword", code: "5757" },
      { labelKey: "storagePassword", code: "519" },
    ],
  },
  {
    canonicalName: "오쿠보C",
    kind: "house",
    address: {
      ko: "1 Chome-13-1 Okubo, Shinjuku City, Tokyo 169-0072",
      ja: "1 Chome-13-1 Okubo, Shinjuku City, Tokyo 169-0072",
      en: "1 Chome-13-1 Okubo, Shinjuku City, Tokyo 169-0072",
    },
    googleMapsUrl:
      "https://www.google.com/maps/place/%E9%9F%93%E5%9B%BD%E3%82%A2%E3%82%AF%E3%82%BB%E3%82%B5%E3%83%AA%E3%83%BC1%2F2/@35.699421,139.7022241,18z/data=!4m6!3m5!1s0x60188dd0e32d190f:0xed6ee9edd00c64cd!8m2!3d35.699386!4d139.7038418!16s%2Fg%2F11vbqj0_0w?entry=ttu&g_ep=EgoyMDI2MDUyMC4wIKXMDSoASAFQAw%3D%3D",
    sharedAccess: [
      { labelKey: "doorPassword", code: "1205115" },
      { labelKey: "keyBoxPassword", code: "6174" },
    ],
  },
  {
    // 2026-10-02 추가 — 룸 링크 화면의 건물 주소(사용자 제공). 출입 정보는 아직 없다 — 건물 정보 화면에서 넣는다.
    canonicalName: "STAY ARI Apartment Hotel",
    kind: "hotel",
    address: {
      ko: "1 Chome-9-26 Okubo, Shinjuku City, Tokyo 169-0072",
      ja: "1 Chome-9-26 Okubo, Shinjuku City, Tokyo 169-0072",
      en: "1 Chome-9-26 Okubo, Shinjuku City, Tokyo 169-0072",
    },
    googleMapsUrl:
      "https://www.google.com/maps/search/?api=1&query=1%20Chome-9-26%20Okubo%2C%20Shinjuku%20City%2C%20Tokyo%20169-0072",
    sharedAccess: [],
  },
];

export function getPropertyMapMeta(canonicalName: string): PropertyMapMeta | null {
  return PROPERTY_MAP_META.find((item) => item.canonicalName === canonicalName) ?? null;
}

export function getPropertyAddress(meta: PropertyMapMeta, locale: Locale) {
  return meta.address[locale] ?? meta.address.ko;
}
