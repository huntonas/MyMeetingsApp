// Owner decision: one screenshot area, empty until the app has real screens. No stock photos.
export function ScreenshotPlaceholder() {
  return (
    <div className="screenshot-placeholder" role="img" aria-label="App screenshot coming soon">
      <span aria-hidden="true">Screenshot coming soon</span>
    </div>
  );
}
