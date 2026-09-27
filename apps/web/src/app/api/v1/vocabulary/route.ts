import { VocabularyResponse } from "@mymeetingapp/shared";

import { jsonResponse, withErrors } from "@/lib/api/respond";
import { getActiveVocabulary } from "@/server/vocabulary";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (_req: Request) =>
  jsonResponse(VocabularyResponse, { tags: await getActiveVocabulary() }, "vocabulary"),
);
