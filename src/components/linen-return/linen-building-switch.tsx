"use client";

// 린넨 반품 — 화면 제목 자리의 건물 이름 단추 + 「건물 바꾸기」 시트(시안 LinenBld-Phone · Linen-Phone).
// 이 화면을 연 건물을 쿠키에 남겨 다음에 `/mobile/linen-return` 이 그 건물 목록으로 바로 열리게 한다.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import { LINEN_LAST_BUILDING_COOKIE } from "@/lib/linen-return-constants";

export type LinenBuildingOption = { name: string; label: string; monthCount: number };

type Copy = {
  wChangeBld: string;
  wChangeBldSub: string;
  wChangeBldAria: string;
  wMonthCount: string;
  wNoMonth: string;
  searchPlaceholder: string;
  noBuildingResultTitle: string;
};

export function rememberLinenBuilding(name: string) {
  try {
    document.cookie = `${LINEN_LAST_BUILDING_COOKIE}=${encodeURIComponent(name)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    // 쿠키를 못 쓰면 다음에 건물 카드 화면이 열릴 뿐이다.
  }
}

export function LinenBuildingSwitch({
  current,
  currentLabel,
  buildings,
  copy,
  basePath = "/mobile/linen-return/list",
  size = "lg",
}: {
  current: string;
  currentLabel: string;
  buildings: LinenBuildingOption[];
  copy: Copy;
  basePath?: string;
  size?: "lg" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    rememberLinenBuilding(current);
  }, [current]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? buildings.filter((b) => b.label.toLowerCase().includes(q) || b.name.toLowerCase().includes(q)) : buildings;
  }, [buildings, query]);

  return (
    <>
      <button
        aria-label={copy.wChangeBldAria.replace("{bld}", currentLabel)}
        className={`lnw-bld${size === "md" ? " is-md" : ""}`}
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        type="button"
      >
        {currentLabel}
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <BottomSheet ariaLabel={copy.wChangeBld} onClose={() => setOpen(false)}>
          {({ close }) => (
            <div className="lnw-sheet">
              <div className="lnw-sheet__h">
                <h3>{copy.wChangeBld}</h3>
                <span>{copy.wChangeBldSub}</span>
              </div>
              <label className="lnw-search">
                <Search aria-hidden="true" />
                <input
                  aria-label={copy.searchPlaceholder}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={copy.searchPlaceholder}
                  type="search"
                  value={query}
                />
              </label>
              <div className="lnw-blist">
                {shown.length === 0 ? <p className="lnw-empty">{copy.noBuildingResultTitle}</p> : null}
                {shown.map((b) => (
                  <button
                    className={b.name === current ? "on" : ""}
                    key={b.name}
                    onClick={() => {
                      haptic("light");
                      rememberLinenBuilding(b.name);
                      close();
                      if (b.name !== current) router.push(`${basePath}?building=${encodeURIComponent(b.name)}`);
                    }}
                    type="button"
                  >
                    <span>{b.label}</span>
                    <em>{b.monthCount > 0 ? copy.wMonthCount.replace("{n}", String(b.monthCount)) : copy.wNoMonth}</em>
                  </button>
                ))}
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}
