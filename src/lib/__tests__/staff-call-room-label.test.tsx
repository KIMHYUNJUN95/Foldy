import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PcCall, StaySummary } from "@/components/checkin-call/staff-call-views";
import { BuildingNamesProvider } from "@/components/shared/building-names";
import { roomsText } from "@/lib/checkin/staff-view";
import type { StaffCallStay } from "@/lib/checkin/staff-call";
import { getDictionary } from "@/lib/i18n";

// 서버 렌더러는 포털을 그리지 못한다 — 패널 내용만 보면 되므로 그 자리에 그대로 그린다.
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (node: unknown) => node,
}));
vi.stubGlobal("document", { body: {} }); // 포털 대상 인자(`document.body`)만 읽는다.

// 예약 요약의 방 표시 — docs/product/46 §6, CLAUDE.md 「건물 이름은 데이터」.
const LOCALES = ["ko", "ja", "en"] as const;

const stay = (over: Partial<StaffCallStay> = {}): StaffCallStay => ({
  stayId: "s1",
  leadName: "Kim",
  reservationNumber: "HM123",
  propertyKey: "arakicho_a",
  roomLabels: ["101"],
  checkInDate: "2026-11-06",
  checkOutDate: "2026-11-08",
  partySize: 2,
  ...over,
});

const decode = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

function renderSummary(locale: (typeof LOCALES)[number], value: StaffCallStay) {
  const dict = getDictionary(locale);
  return decode(
    renderToStaticMarkup(
      <BuildingNamesProvider labels={dict.cleaning.buildingLabels}>
        <StaySummary stay={value} copy={dict.checkinCall} />
      </BuildingNamesProvider>,
    ),
  );
}

function renderPanel(locale: (typeof LOCALES)[number], value: StaffCallStay) {
  const dict = getDictionary(locale);
  return decode(
    renderToStaticMarkup(
      <BuildingNamesProvider labels={dict.cleaning.buildingLabels}>
        <PcCall
          call={{ id: "c1", propertyKey: value.propertyKey, deviceName: "T", step: "find", language: "en", ringDeadlineAt: "2026-11-06T00:00:45.000Z" }}
          copy={dict.checkinCall}
          connected
          startedAtMs={null}
          canHangUp
          hasVideo={false}
          setVideoElement={() => {}}
          muted={false}
          micDenied={false}
          playbackBlocked={false}
          onToggleMute={() => {}}
          onRetryPlayback={() => {}}
          onHangUp={() => {}}
          onViewStay={null}
          stay={value}
        />
      </BuildingNamesProvider>,
    ),
  );
}

describe("모바일 시트 「방」 줄", () => {
  it.each(LOCALES)("%s — 건물 이름은 그 언어로, 방 번호는 한 번", (locale) => {
    const building = getDictionary(locale).cleaning.buildingLabels.arakicho_a;
    const html = renderSummary(locale, stay());
    expect(html).toContain(`${building} · 101`);
    if (locale !== "ko") expect(html).not.toContain("아라키초");
  });

  it.each(LOCALES)("%s — 라벨에 건물 이름이 들어 있어도 한 번만", (locale) => {
    const building = getDictionary(locale).cleaning.buildingLabels.arakicho_a;
    const html = renderSummary(locale, stay({ roomLabels: ["아라키초A 101"] }));
    expect(html).toContain(`${building} · 101`);
    expect(html.split(building)).toHaveLength(2);
    if (locale !== "ko") expect(html).not.toContain("아라키초");
  });

  it.each(LOCALES)("%s — 독채는 건물 이름 하나", (locale) => {
    const building = getDictionary(locale).cleaning.buildingLabels.okubo_a;
    const html = renderSummary(locale, stay({ propertyKey: "okubo_a", roomLabels: ["오쿠보A"] }));
    expect(html.split(building)).toHaveLength(2);
    expect(html).not.toContain(`${building} ·`);
    if (locale !== "ko") expect(html).not.toContain("오쿠보");
  });
});

describe("PC 패널 「예약」 줄", () => {
  it.each(LOCALES)("%s — 건물 · 방 · 인원, 원문 없음", (locale) => {
    const dict = getDictionary(locale);
    const building = dict.cleaning.buildingLabels.arakicho_a;
    const party = dict.checkinCall.partyN.replace("{n}", "2");
    const html = renderPanel(locale, stay({ roomLabels: ["아라키초A 101"] }));
    expect(html).toContain(`${building} · 101 · ${party}`);
    if (locale !== "ko") expect(html).not.toContain("아라키초");
  });

  it("독채는 건물 · 인원", () => {
    const dict = getDictionary("en");
    const html = renderPanel("en", stay({ propertyKey: "okubo_a", roomLabels: ["오쿠보A"] }));
    expect(html).toContain(`${dict.cleaning.buildingLabels.okubo_a} · ${dict.checkinCall.partyN.replace("{n}", "2")}`);
  });
});

describe("저장된 라벨 접기 — 실제 모양은 Beds24 방 이름(건물 이름 없음)", () => {
  const text = (propertyName: string, roomLabels: string[]) => roomsText({ propertyName, roomLabels, localizedProperty: "B", unknownRoomLabel: "?" });

  it("건물 구분 접두어를 뗀다", () => {
    expect(text("가부키초", ["K202"])).toBe("B · 202");
    expect(text("아라키초B", ["Ab101"])).toBe("B · 101");
    expect(text("STAY ARI Apartment Hotel", ["O102"])).toBe("B · 102");
  });

  it("같은 방의 Beds24 유닛은 한 번만", () => {
    expect(text("아라키초A", ["401", "401_2_2"])).toBe("B · 401");
  });

  it("접두어가 다른 방은 다른 방이다 — 합치지 않고 내부 키로 구분한다", () => {
    expect(text("아라키초A", ["A301", "301"])).toBe("B · A301, 301");
    expect(text("아라키초A", ["A301_2", "301_2", "301"])).toBe("B · A301, 301");
    expect(text("아라키초A", ["A301", "A301_2"])).toBe("B · 301");
    expect(text("아라키초A", ["A301", "302"])).toBe("B · 301, 302");
  });

  it("독채는 Beds24 방 이름이 달라도 건물 이름 하나", () => {
    expect(text("오쿠보A", ["ファミリー"])).toBe("B");
  });

  it("방을 모르면 원문 대신 문구로 알린다 — 독채 표시와 달라야 한다", () => {
    expect(text("가부키초", ["(unknown)"])).toBe("B · ?");
    expect(text("아라키초A", ["(unknown)"])).toBe("B · ?");
    expect(text("아라키초A", ["아라키초A (unknown)"])).toBe("B · ?");
    expect(text("가부키초", ["K202", "(unknown)", "(unknown)"])).toBe("B · 202, ?");
    expect(text("오쿠보A", ["(unknown)"])).toBe("B · ?");
  });

  it("빈 라벨은 그냥 뺀다", () => {
    expect(text("가부키초", ["", "  "])).toBe("B");
  });
});

describe("방 미확인 문구", () => {
  it.each(LOCALES)("%s — 통화 시트 · 패널에 그 언어 문구, 원문 없음", (locale) => {
    const dict = getDictionary(locale);
    expect(dict.checkinCall.roomUnknown).toBeTruthy();
    expect(dict.checkinStaff.roomUnknown).toBeTruthy();
    const building = dict.cleaning.buildingLabels.kabukicho;
    const value = stay({ propertyKey: "kabukicho", roomLabels: ["(unknown)"] });
    const line = `${building} · ${dict.checkinCall.roomUnknown}`;
    expect(renderSummary(locale, value)).toContain(line);
    expect(renderPanel(locale, value)).toContain(`${line} · ${dict.checkinCall.partyN.replace("{n}", "2")}`);
    expect(renderSummary(locale, value)).not.toContain("(unknown)");
  });
});
