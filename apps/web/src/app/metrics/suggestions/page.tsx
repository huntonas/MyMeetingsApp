import { TAG_CATEGORIES } from "@mymeetingapp/shared";

import {
  approveSuggestionAction,
  mergeSuggestionAction,
  rejectSuggestionAction,
} from "@/app/metrics/actions";
import { utcTime } from "@/app/metrics/format";
import { Notice, type SearchParams } from "@/app/metrics/notice";
import { listPendingSuggestions, listRecentAiDecisions } from "@/server/admin/suggestions";
import { getActiveVocabulary } from "@/server/vocabulary";

export const dynamic = "force-dynamic";

export default async function SuggestionsPage({ searchParams }: { searchParams: SearchParams }) {
  const [pending, vocabulary, recent] = await Promise.all([
    listPendingSuggestions(),
    getActiveVocabulary(TAG_CATEGORIES),
    listRecentAiDecisions(),
  ]);
  return (
    <>
      <h1>Suggestions</h1>
      <Notice params={await searchParams} />
      <p>
        {pending.length} waiting for review. Reviewing a suggestion removes its link to the phone that sent
        it.
      </p>
      {pending.map((suggestion) => (
        <section key={suggestion.id} className="review">
          <h2>“{suggestion.text}”</h2>
          <p className="fine-print">
            Suggested {utcTime(suggestion.createdAt)}.{" "}
            {suggestion.decisions.map((ai) => `AI (${ai.model}): ${ai.decision}, ${ai.reason}`).join(" ")}
          </p>
          <form
            action={approveSuggestionAction}
            className="inline"
            aria-label={`Add “${suggestion.text}” as a new tag`}
          >
            <input type="hidden" name="suggestionId" value={suggestion.id} />
            <label>
              Label <input name="label" defaultValue={suggestion.text} required maxLength={40} />
            </label>
            <label>
              Category{" "}
              <select name="category" defaultValue="feel">
                {TAG_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Add as a new tag</button>
          </form>
          <form
            action={mergeSuggestionAction}
            className="inline"
            aria-label={`Merge “${suggestion.text}” into a tag`}
          >
            <input type="hidden" name="suggestionId" value={suggestion.id} />
            <select name="tagSlug" aria-label="Existing tag">
              {vocabulary.map((tag) => (
                <option key={tag.slug} value={tag.slug}>
                  {tag.label}
                </option>
              ))}
            </select>
            <button type="submit" className="secondary">
              Merge
            </button>
          </form>
          <form action={rejectSuggestionAction} className="inline" aria-label={`Reject “${suggestion.text}”`}>
            <input type="hidden" name="suggestionId" value={suggestion.id} />
            <button type="submit" className="secondary">
              Reject
            </button>
          </form>
        </section>
      ))}

      <h2>Recent AI decisions</h2>
      <table>
        <thead>
          <tr>
            <th>Suggestion</th>
            <th>AI decision</th>
            <th>Reason</th>
            <th>Model</th>
            <th>Now</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((ai) => (
            <tr key={ai.id}>
              <td>{ai.input}</td>
              <td>
                {ai.decision}
                {ai.tagSlug === null ? "" : ` (${ai.tagSlug})`}
              </td>
              <td>{ai.reason}</td>
              <td>{ai.model}</td>
              <td>{ai.status}</td>
              <td>{utcTime(ai.decidedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
