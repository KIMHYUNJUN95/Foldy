"use client";

import { useLayoutEffect, useRef, useState } from "react";

// 출퇴근 현장 폼의 위도 · 경도 · 허용 반경(2026-10-15 화이트 리디자인, 시안 Settings-PC).
// - 위도 · 경도는 칸을 벗어날 때 범위를 확인하고 칸 바로 아래에 알린다(서버도 같은 범위를 다시 본다).
// - 「지도에서 보기 ↗」 는 지금 칸에 든 좌표로 Google 지도를 새 탭에 연다 — 지도 그림 대신.
// - 반경은 50/100/150/200 바로 고르기 + 직접 입력. 제출 값은 숨은 칸 하나(name="radius")라 서버 액션은 그대로.

type Copy = {
  latitude: string;
  longitude: string;
  latInvalid: string;
  lngInvalid: string;
  mapLink: string;
  radiusLabel: string;
  radiusCustom: string;
  radiusHint: string;
  radiusInvalid: string;
};

const PRESETS = [50, 100, 150, 200];

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

  const segRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  // 처음 자리 잡을 때는 미끄러지지 않게(왼쪽 끝에서 날아오는 것 방지) — 첫 측정 다음 프레임부터 전환을 켠다.
  const [pillReady, setPillReady] = useState(false);
  const preset = PRESETS.find((value) => String(value) === radius.trim()) ?? null;

  // 고른 칸 뒤로 흰 알약이 미끄러져 간다. 직접 입력한 값이 바로 고르기에 없으면 알약을 숨긴다.
  useLayoutEffect(() => {
    const seg = segRef.current;
    if (!seg || preset === null) {
      setPill(null);
      return;
    }
    const button = seg.querySelector<HTMLButtonElement>(`button[data-v="${preset}"]`);
    if (button) setPill({ x: button.offsetLeft, w: button.offsetWidth });
    const raf = requestAnimationFrame(() => setPillReady(true));
    return () => cancelAnimationFrame(raf);
  }, [preset]);

  const mapHref =
    lat.trim() && lng.trim() && inRange(lat, 90) && inRange(lng, 180)
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat.trim()},${lng.trim()}`)}`
      : null;

  return (
    <>
      <div className="stw-f">
        <div className="stw-two">
          <div className="stw-f">
            <label className={`stw-nf${latBad ? " is-bad" : ""}`}>
              <span>{copy.latitude}</span>
              <input
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
          </div>
          <div className="stw-f">
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
        </div>
        {latBad ? <span id="stw-lat-err" className="stw-err" role="alert">{copy.latInvalid}</span> : null}
        {lngBad ? <span id="stw-lng-err" className="stw-err" role="alert">{copy.lngInvalid}</span> : null}
        {mapHref ? (
          <a className="stw-link" href={mapHref} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start", fontSize: 12 }}>
            {copy.mapLink} ↗
          </a>
        ) : null}
      </div>

      <div className="stw-f" role="group" aria-labelledby="stw-rad-l">
        <span id="stw-rad-l" className="stw-k">
          {copy.radiusLabel}
        </span>
        <div className="stw-rad">
          <div className="stw-seg" ref={segRef}>
            <span
              className="stw-seg__pill"
              aria-hidden="true"
              style={{
                ...(pill ? { width: pill.w, transform: `translateX(${pill.x}px)` } : { width: 0, opacity: 0 }),
                ...(pillReady ? null : { transition: "none" }),
              }}
            />
            {PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                data-v={value}
                className={preset === value ? "on" : undefined}
                aria-pressed={preset === value}
                onClick={() => {
                  setRadius(String(value));
                  setRadiusBad(false);
                }}
              >
                {value}m
              </button>
            ))}
          </div>
          <label className={`stw-rad__in${radiusBad ? " is-bad" : ""}`}>
            <input
              name="radius"
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
        </div>
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
