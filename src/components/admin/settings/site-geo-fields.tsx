"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { coordsLine, RADIUS_PRESETS, radiusPreset } from "@/lib/attendance-site-panel";

// 출퇴근 현장 폼의 위도 · 경도 · 허용 반경(2026-10-15 화이트 리디자인 → 2026-11-12 다듬기, 시안 SiteNew).
// - 좌표는 한 줄 「35.6938, 139.7034」로 접어 두고 「좌표 고치기」로 칸을 편다. 비었거나 틀린 좌표면 처음부터 편다.
//   접혀 있을 때도 숨은 칸으로 같은 이름(latitude · longitude)이 실려 서버 액션은 그대로다.
// - 위도 · 경도는 칸을 벗어날 때 범위를 확인하고 칸 바로 아래에 알린다(서버도 같은 범위를 다시 본다).
// - 「지도에서 보기 ↗」 는 지금 좌표로 Google 지도를 새 탭에 연다 — 지도 그림 대신.
// - 반경은 한 줄 「50m · 100m · 150m · 200m · 직접」. 「직접」을 고르면 m 칸이 나온다. 제출 값은 숨은 칸 하나(name="radius").

type Copy = {
  latitude: string;
  longitude: string;
  latInvalid: string;
  lngInvalid: string;
  mapLink: string;
  editCoords: string;
  radiusLabel: string;
  radiusCustom: string;
  radiusCustomShort: string;
  radiusHint: string;
  radiusInvalid: string;
};

function inRange(raw: string, limit: number) {
  if (raw.trim() === "") return true; // 빈 칸은 브라우저 required 가 막는다
  const value = Number(raw);
  return Number.isFinite(value) && Math.abs(value) <= limit;
}

export function SiteGeoFields({
  initialLat,
  initialLng,
  initialRadius,
  copy,
}: {
  initialLat: string;
  initialLng: string;
  initialRadius: string;
  copy: Copy;
}) {
  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [radius, setRadius] = useState(initialRadius);
  const [latBad, setLatBad] = useState(false);
  const [lngBad, setLngBad] = useState(false);
  const [radiusBad, setRadiusBad] = useState(false);
  const [coordsOpen, setCoordsOpen] = useState(() => coordsLine(initialLat, initialLng) === null);
  const [custom, setCustom] = useState(() => radiusPreset(initialRadius) === null);
  const latRef = useRef<HTMLInputElement>(null);
  const customRef = useRef<HTMLInputElement>(null);

  const segRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  // 처음 자리 잡을 때는 미끄러지지 않게(왼쪽 끝에서 날아오는 것 방지) — 첫 측정 다음 프레임부터 전환을 켠다.
  const [pillReady, setPillReady] = useState(false);
  const preset = custom ? null : radiusPreset(radius);
  const selectedKey = custom ? "custom" : preset === null ? null : String(preset);

  // 고른 칸 뒤로 흰 알약이 미끄러져 간다.
  useLayoutEffect(() => {
    const seg = segRef.current;
    if (!seg || selectedKey === null) {
      setPill(null);
      return;
    }
    const button = seg.querySelector<HTMLButtonElement>(`button[data-v="${selectedKey}"]`);
    if (button) setPill({ x: button.offsetLeft, w: button.offsetWidth });
    const raf = requestAnimationFrame(() => setPillReady(true));
    return () => cancelAnimationFrame(raf);
  }, [selectedKey]);

  const line = coordsLine(lat, lng);
  const mapHref = line
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat.trim()},${lng.trim()}`)}`
    : null;
  const mapLink = mapHref ? (
    <a className="stw-link" href={mapHref} target="_blank" rel="noreferrer">
      {copy.mapLink} ↗
    </a>
  ) : null;

  return (
    <>
      {coordsOpen ? (
        <div className="stw-f stw-reveal">
          <div className="stw-two">
            <label className={`stw-nf${latBad ? " is-bad" : ""}`}>
              <span>{copy.latitude}</span>
              <input
                ref={latRef}
                className="mono"
                name="latitude"
                inputMode="decimal"
                spellCheck={false}
                required
                value={lat}
                onChange={(event) => {
                  setLat(event.target.value);
                  if (latBad) setLatBad(!inRange(event.target.value, 90));
                }}
                onBlur={() => setLatBad(!inRange(lat, 90))}
                aria-invalid={latBad}
                aria-describedby={latBad ? "stw-lat-err" : undefined}
                autoComplete="off"
              />
            </label>
            <label className={`stw-nf${lngBad ? " is-bad" : ""}`}>
              <span>{copy.longitude}</span>
              <input
                className="mono"
                name="longitude"
                inputMode="decimal"
                spellCheck={false}
                required
                value={lng}
                onChange={(event) => {
                  setLng(event.target.value);
                  if (lngBad) setLngBad(!inRange(event.target.value, 180));
                }}
                onBlur={() => setLngBad(!inRange(lng, 180))}
                aria-invalid={lngBad}
                aria-describedby={lngBad ? "stw-lng-err" : undefined}
                autoComplete="off"
              />
            </label>
          </div>
          {latBad ? <span id="stw-lat-err" className="stw-err" role="alert">{copy.latInvalid}</span> : null}
          {lngBad ? <span id="stw-lng-err" className="stw-err" role="alert">{copy.lngInvalid}</span> : null}
          {mapLink ? <span className="stw-coords__acts">{mapLink}</span> : null}
        </div>
      ) : (
        <div className="stw-coords">
          <input type="hidden" name="latitude" value={lat} />
          <input type="hidden" name="longitude" value={lng} />
          <span className="num">{line}</span>
          <span className="stw-coords__acts">
            <button
              type="button"
              className="stw-link"
              onClick={() => {
                setCoordsOpen(true);
                requestAnimationFrame(() => latRef.current?.focus());
              }}
            >
              {copy.editCoords}
            </button>
            {mapLink}
          </span>
        </div>
      )}

      <div className="stw-f" role="group" aria-labelledby="stw-rad-l">
        <span id="stw-rad-l" className="stw-k">
          {copy.radiusLabel}
        </span>
        <input type="hidden" name="radius" value={radius} />
        <div className="stw-seg is-full" ref={segRef}>
          <span
            className="stw-seg__pill"
            aria-hidden="true"
            style={{
              ...(pill ? { width: pill.w, transform: `translateX(${pill.x}px)` } : { width: 0, opacity: 0 }),
              ...(pillReady ? null : { transition: "none" }),
            }}
          />
          {RADIUS_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              data-v={value}
              className={selectedKey === String(value) ? "on" : undefined}
              aria-pressed={selectedKey === String(value)}
              onClick={() => {
                setCustom(false);
                setRadius(String(value));
                setRadiusBad(false);
              }}
            >
              {value}m
            </button>
          ))}
          <button
            type="button"
            data-v="custom"
            className={custom ? "on" : undefined}
            aria-pressed={custom}
            onClick={() => {
              setCustom(true);
              requestAnimationFrame(() => customRef.current?.focus());
            }}
          >
            {copy.radiusCustomShort}
          </button>
        </div>
        {custom ? (
          <label className={`stw-rad__in stw-reveal${radiusBad ? " is-bad" : ""}`}>
            <input
              ref={customRef}
              inputMode="numeric"
              required
              value={radius}
              aria-label={copy.radiusCustom}
              aria-invalid={radiusBad}
              onChange={(event) => {
                const next = event.target.value.replace(/[^0-9]/g, "");
                setRadius(next);
                if (radiusBad) setRadiusBad(!(Number(next) >= 1));
              }}
              onBlur={() => setRadiusBad(!(Number(radius) >= 1))}
              autoComplete="off"
            />
            <span aria-hidden="true">m</span>
          </label>
        ) : null}
        {radiusBad ? (
          <span className="stw-err" role="alert">
            {copy.radiusInvalid}
          </span>
        ) : (
          <span className="stw-hint">{copy.radiusHint}</span>
        )}
      </div>
    </>
  );
}
