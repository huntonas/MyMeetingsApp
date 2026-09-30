// Owner decision: no store listing exists yet, so the buttons aren't links. They become links in Phase 6.
export function StoreBadges() {
  return (
    <ul className="store-badges" aria-label="Download the app">
      <li>
        <span className="store-badge">
          App Store <small>coming soon</small>
        </span>
      </li>
      <li>
        <span className="store-badge">
          Google Play <small>coming soon</small>
        </span>
      </li>
    </ul>
  );
}
