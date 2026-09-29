// Spec §8: 988 and the SAMHSA National Helpline are always reachable, on the site as in the app.
export function HelpResources() {
  return (
    <section aria-labelledby="help">
      <h2 id="help">Need help now?</h2>
      <ul>
        <li>
          <strong>988 Suicide & Crisis Lifeline:</strong> call or text <a href="tel:988">988</a>, any time.
        </li>
        <li>
          <strong>SAMHSA National Helpline:</strong> <a href="tel:18006624357">1-800-662-4357</a>, free and
          confidential, 24 hours a day.
        </li>
        <li>
          Alcoholics Anonymous has its own meeting finder at <a href="https://www.aa.org/find-aa">aa.org</a>.
        </li>
      </ul>
    </section>
  );
}
