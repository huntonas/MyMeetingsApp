import { AA_MEETING_FINDER, HELP_LINES, NA_MEETING_FINDER } from "@mymeetingapp/shared";

// Spec §8: 988 and the SAMHSA National Helpline are always reachable, on the site as in the app (HELP_LINES).
export function HelpResources() {
  return (
    <section aria-labelledby="help">
      <h2 id="help">Need help now?</h2>
      <ul>
        {HELP_LINES.map((line) => (
          <li key={line.name}>
            <strong>{line.name}:</strong> {line.texts ? "call or text " : ""}
            <a href={`tel:${line.dial}`}>{line.shown}</a>, {line.when}.
          </li>
        ))}
        <li>
          Alcoholics Anonymous has its own meeting finder at <a href={AA_MEETING_FINDER}>aa.org</a>.
        </li>
        <li>
          Narcotics Anonymous has its own meeting finder at <a href={NA_MEETING_FINDER}>na.org</a>.
        </li>
      </ul>
    </section>
  );
}
