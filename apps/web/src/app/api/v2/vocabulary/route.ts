import { VocabularyResponse } from "@mymeetingapp/shared";

import { jsonResponse, withErrors } from "@/lib/api/respond";
import { getActiveVocabulary } from "@/server/vocabulary";

export const dynamic = "force-dynamic";

// Every active tag. Its categories are open-ended (VocabularyResponse), so the server can add one without breaking
// the apps reading this list.
export const GET = withErrors(async (_req: Request) =>
  jsonResponse(VocabularyResponse, { tags: await getActiveVocabulary() }, "vocabulary"),
);
