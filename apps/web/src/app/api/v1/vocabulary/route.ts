import { V1_TAG_CATEGORIES, V1VocabularyResponse } from "@mymeetingapp/shared";

import { jsonResponse, withErrors } from "@/lib/api/respond";
import { getActiveVocabulary } from "@/server/vocabulary";

export const dynamic = "force-dynamic";

// For builds before the /api/v2 list (TestFlight build 12 among them), which refuse the whole list over a category
// they don't know. Remove it once the minimum supported version reads /api/v2.
export const GET = withErrors(async (_req: Request) =>
  jsonResponse(V1VocabularyResponse, { tags: await getActiveVocabulary(V1_TAG_CATEGORIES) }, "vocabulary"),
);
