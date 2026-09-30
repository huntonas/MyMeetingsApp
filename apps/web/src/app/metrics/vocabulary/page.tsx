import { setTagRetiredAction } from "@/app/metrics/actions";
import { Notice, type SearchParams } from "@/app/metrics/notice";
import { listVocabulary } from "@/server/admin/vocabulary";

export const dynamic = "force-dynamic";

export default async function VocabularyPage({ searchParams }: { searchParams: SearchParams }) {
  const vocabulary = await listVocabulary();
  return (
    <>
      <h1>Vocabulary</h1>
      <Notice params={await searchParams} />
      <p>
        Retiring a tag hides it in the app and keeps its counts. Tags are never deleted. New tags come from
        approving a suggestion.
      </p>
      <table>
        <thead>
          <tr>
            <th>Tag</th>
            <th>Category</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {vocabulary.map((tag) => {
            const retire = tag.status === "active";
            return (
              <tr key={tag.id}>
                <td>
                  {tag.label} <code>{tag.slug}</code>
                </td>
                <td>{tag.category}</td>
                <td>{tag.status}</td>
                <td>
                  <form
                    action={setTagRetiredAction}
                    className="inline"
                    aria-label={`${retire ? "Retire" : "Restore"} “${tag.label}”`}
                  >
                    <input type="hidden" name="tagId" value={tag.id} />
                    <input type="hidden" name="retired" value={retire ? "true" : "false"} />
                    <button type="submit" className="secondary">
                      {retire ? "Retire" : "Restore"}
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
