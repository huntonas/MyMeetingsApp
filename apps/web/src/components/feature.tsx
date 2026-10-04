import type { ReactNode } from "react";

// One of the landing page's features: its words beside its screenshots. The stylesheet alternates the sides on wide
// screens and stacks them on narrow ones, words first.
export function Feature({
  id,
  title,
  children,
  media,
}: {
  id: string;
  title: string;
  children: ReactNode;
  media: ReactNode;
}) {
  return (
    <section className="feature" aria-labelledby={id}>
      <div className="feature-text">
        <h2 id={id}>{title}</h2>
        {children}
      </div>
      <div className="feature-media">{media}</div>
    </section>
  );
}
