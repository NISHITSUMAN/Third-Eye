export function EarthVisual() {
  return (
    <div
      className="earth-stage earth-stage-enhanced"
      role="img"
      aria-label="Enhanced illustrative Earth globe with detailed coastlines, latitude and longitude lines, and radar-inspired orbital paths"
    >
      <div className="earth-halo" aria-hidden="true" />
      <img
        className="earth-image"
        src="/third-eye-earth-enhanced.webp"
        alt=""
        width="1450"
        height="1085"
        fetchPriority="high"
        decoding="async"
      />
      <span className="earth-image-glint" aria-hidden="true" />
    </div>
  );
}
