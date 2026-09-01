export function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skel-bar" style={{ width: "35%" }} />
      <div className="skel-bar" style={{ width: "85%", height: 19 }} />
      <div className="skel-bar" style={{ width: "55%", height: 19 }} />
      <div className="skel-bar" style={{ width: "92%" }} />
      <div className="skel-bar" style={{ width: "70%" }} />
    </div>
  );
}
