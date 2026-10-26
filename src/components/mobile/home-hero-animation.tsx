"use client";

import dynamic from "next/dynamic";
import homeHeroTopV2 from "@/assets/home-hero-top-v2.json";

// lottie-web 은 모듈 초기화 시점에 브라우저 API(canvas, document)에 접근한다.
// dynamic({ ssr: false }) 로 SSR 실패를 막고 클라이언트 하이드레이션을 올바르게 한다.
const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

export function HomeHeroAnimation() {
  return (
    // 카드 크롬 없음 — 애니메이션이 아이보리 캔버스 위에 바로 놓인다. 은은한
    // 방사형 가장자리 페이드가 바깥 가닥을 배경에 녹여 3D
    // 모션이 박스 그래픽이 아니라 페이지의 일부처럼 읽힌다.
    <section className="-mt-1 bg-transparent">
      <Lottie
        aria-hidden="true"
        autoplay
        className="mx-auto h-56 w-full [mask-image:radial-gradient(72%_72%_at_50%_46%,#000_52%,transparent_82%)] [-webkit-mask-image:radial-gradient(72%_72%_at_50%_46%,#000_52%,transparent_82%)]"
        animationData={homeHeroTopV2}
        loop
      />
      {/*
        재사용 가능성 때문에 남겨둔 이전 상단 히어로 소스:
        /public/animations/home-hero.lottie (DotLottieReact)
      */}
    </section>
  );
}
