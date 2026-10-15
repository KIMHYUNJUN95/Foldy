export function BoardEmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="bdw-empty">
      <b>{title}</b>
      <span>{subtitle}</span>
    </div>
  );
}
