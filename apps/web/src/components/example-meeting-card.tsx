import { STARTER_VOCABULARY } from "@mymeetingapp/shared";

// A made-up meeting showing the spec §5 display rule: a flat list of words with counts, highest first.
const EXAMPLE_TAGS = [
  ["welcoming", 14],
  ["laid-back", 9],
  ["coffee", 7],
  ["starts-on-time", 5],
] as const;

function labelOf(slug: string): string {
  const tag = STARTER_VOCABULARY.find((candidate) => candidate.slug === slug);
  if (tag === undefined) throw new Error(`no starter tag ${slug}`);
  return tag.label;
}

export function ExampleMeetingCard() {
  return (
    <figure className="meeting-card" aria-label="Example meeting">
      <p className="meeting-meta">Tuesday · 7:00 pm · 0.8 mi</p>
      <p className="meeting-name">Tuesday Night Step Study</p>
      <p className="meeting-meta">Open · In person</p>
      <ul className="tag-list">
        {EXAMPLE_TAGS.map(([slug, count]) => (
          <li key={slug}>
            {labelOf(slug)} <span className="count">{count}</span>
          </li>
        ))}
      </ul>
      <figcaption>An example. Each number is how many attendees chose that word.</figcaption>
    </figure>
  );
}
