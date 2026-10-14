// 공용 빈 화면(2026-10-14, 시안 Motion-B-Empty-Phone) — 회색 글자 한 줄 대신 선으로 그린 바구니가 세 겹으로 천천히 떠다니고(겹마다 높이가 달라
// 입체감) 반짝이가 돌며, 바닥 빛이 숨 쉰다. 6초 느린 반복 · 동작 줄이기면 멈춤. 서버 컴포넌트에서도 쓸 수 있게 상태 없음.
import "./foldy-empty.css";

export function FoldyEmpty({ title, sub, compact = false }: { title: string; sub?: string; compact?: boolean }) {
  return (
    <div className={`fem${compact ? " fem--compact" : ""}`}>
      <div className="fem__stage" aria-hidden="true">
        <span className="fem__bg" />
        <span className="fem__ly fem__l0">
          <svg viewBox="0 0 200 170" fill="none">
            <path d="M44 78h112l-12 60a10 10 0 0 1-10 8H66a10 10 0 0 1-10-8z" fill="#F4F1FD" stroke="#7A52E6" strokeWidth="2.6" strokeLinejoin="round" />
            <path d="M36 78h128" stroke="#7A52E6" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </span>
        <span className="fem__ly fem__l1">
          <svg viewBox="0 0 200 170" fill="none">
            <path d="M70 78l18-34M130 78l-18-34" stroke="#7A52E6" strokeWidth="2.6" strokeLinecap="round" />
            <path d="M84 104l12 12 22-24" stroke="#B9A0FA" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="fem__ly fem__l2">
          <svg viewBox="0 0 200 170" fill="none">
            <rect x="122" y="40" width="34" height="26" rx="6" fill="#fff" stroke="#B9A0FA" strokeWidth="2" transform="rotate(12 139 53)" />
            <path d="M131 52h16M131 58h10" stroke="#D9CCFB" strokeWidth="2" strokeLinecap="round" transform="rotate(12 139 53)" />
          </svg>
        </span>
        <span className="fem__tw fem__t0" />
        <span className="fem__tw fem__t1" />
        <span className="fem__tw fem__t2" />
        <span className="fem__tw fem__t3" />
      </div>
      <span className="fem__sh" aria-hidden="true" />
      <b className="fem__t">{title}</b>
      {sub ? <p className="fem__s">{sub}</p> : null}
    </div>
  );
}
