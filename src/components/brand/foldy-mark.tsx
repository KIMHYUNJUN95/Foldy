/** Foldy app mark — the same three-bar logo as the app icon. Safe in server and client components. */
export function FoldyMark({ size = 42 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="22.5" fill="#EFE7FF" />
      <rect x="18" y="62" width="64" height="17" rx="8.5" fill="#5B2BD6" />
      <rect x="25" y="43" width="50" height="17" rx="8.5" fill="#8A63F0" />
      <rect x="32" y="24" width="36" height="17" rx="8.5" fill="#B9A0FA" />
      <path d="M30 70.5 H52" stroke="#EFE7FF" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
