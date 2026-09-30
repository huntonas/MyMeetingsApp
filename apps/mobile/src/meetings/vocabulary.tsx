import { VocabularyResponse } from "@mymeetingapp/shared";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { AppState } from "react-native";

import { fetchVocabulary } from "@/api/reads";
import { useCachedRead } from "@/cache/use-cached-read";

export type VocabularyTag = VocabularyResponse["tags"][number];

const VOCABULARY_READ = {
  kind: "vocabulary",
  key: "vocabulary",
  schema: VocabularyResponse,
  fetch: fetchVocabulary,
} as const;

const Tags = createContext<ReadonlyMap<string, VocabularyTag>>(new Map());

// The tag labels every chip needs. Its reuse window is 0 (decision 3), so it's read at launch and again each time the
// app comes back to the foreground, and a retired or new tag reaches the app within the promised 25 hours.
export function VocabularyProvider({ children }: { children: ReactNode }) {
  const { state, refresh } = useCachedRead(VOCABULARY_READ);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => {
      subscription.remove();
    };
  }, [refresh]);
  const tags = useMemo(
    () => new Map(state.status === "ready" ? state.data.tags.map((tag) => [tag.slug, tag] as const) : []),
    [state],
  );
  return <Tags.Provider value={tags}>{children}</Tags.Provider>;
}

export function useVocabularyTags(): ReadonlyMap<string, VocabularyTag> {
  return useContext(Tags);
}
