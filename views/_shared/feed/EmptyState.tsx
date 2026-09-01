export function EmptyState({ title, message, tone }: { readonly title: string; readonly message: string; readonly tone?: "error" }) {
  return (
    <div className={`feed-empty${tone === "error" ? " feed-empty--error" : ""}`}>
      <p className="feed-empty-title">{title}</p>
      <p className="feed-empty-sub">{message}</p>
    </div>
  );
}
