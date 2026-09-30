// Owner decision: the privacy promise comes first. Each line restates spec §2 in plain words.
export function PrivacyPromise() {
  return (
    <>
      <ul className="promise" aria-label="Our privacy promise">
        <li>
          <strong>No account.</strong> The app never asks for a name, email, phone number or sign-in.
        </li>
        <li>
          <strong>Your exact location stays on your phone.</strong> A search sends only a point rounded to
          about 1 km, and we don't keep it.
        </li>
        <li>
          <strong>Your sobriety date and favorites stay on your phone.</strong>
        </li>
        <li>
          <strong>No ads, no tracking, no analytics and no cookies,</strong> in the app or on this site.
        </li>
      </ul>
      <p>
        <a href="/privacy">How we handle data</a>
      </p>
    </>
  );
}
