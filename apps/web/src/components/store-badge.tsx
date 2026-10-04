// Owner decision: the App Store listing isn't approved yet, so the badge is plain text, not a link. Task 16 makes it
// one. There's no Google Play badge until the Android app exists.
export function StoreBadge() {
  return (
    <p className="store-badge">
      <small>Coming soon on the</small> App Store
    </p>
  );
}
