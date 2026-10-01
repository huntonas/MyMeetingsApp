import { type TAG_CATEGORIES, VocabularyResponse } from "@mymeetingapp/shared";
import { usePathname } from "expo-router";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from "react";

import { fetchVocabulary } from "@/api/reads";
import { onReturnToForeground } from "@/app-state/return-to-foreground";
import { useCachedRead } from "@/cache/use-cached-read";

export type VocabularyTag = VocabularyResponse["tags"][number];

const VOCABULARY_READ = {
  kind: "vocabulary",
  key: "vocabulary",
  schema: VocabularyResponse,
  fetch: fetchVocabulary,
} as const;

// Each category's heading, wherever tags are listed by category (Filters, the tag picker).
export const CATEGORY_TITLES: Record<(typeof TAG_CATEGORIES)[number], string> = {
  format: "Format",
  sharing: "Sharing",
  crowd: "Crowd",
  feel: "Feel",
  practical: "Practical",
};

const Tags = createContext<ReadonlyMap<string, VocabularyTag>>(new Map());
const Refresh = createContext<() => void>(() => undefined);

// The tag labels every chip needs. Its reuse window is 0 (decision 3), so it's read at launch and again each time the
// app returns from the background, and a retired or new tag reaches the app within the promised 25 hours.
export function VocabularyProvider({ children }: { children: ReactNode }) {
  const { state, refresh } = useCachedRead(VOCABULARY_READ);
  useEffect(() => onReturnToForeground(refresh), [refresh]);
  // After a failed read (an offline first launch, with nothing saved), every screen change tries again, so tag names
  // come back once the connection does rather than only after a trip to the background.
  const failed = useRef(false);
  failed.current = state.status === "failed";
  const pathname = usePathname();
  useEffect(() => {
    if (failed.current) refresh();
  }, [pathname, refresh]);
  const tags = useMemo(
    () => new Map(state.status === "ready" ? state.data.tags.map((tag) => [tag.slug, tag] as const) : []),
    [state],
  );
  return (
    <Refresh.Provider value={refresh}>
      <Tags.Provider value={tags}>{children}</Tags.Provider>
    </Refresh.Provider>
  );
}

export function useVocabularyTags(): ReadonlyMap<string, VocabularyTag> {
  return useContext(Tags);
}

// Reads the tag list again now, for a screen the server told a tag was retired (unknown_tag).
export function useRefreshVocabulary(): () => void {
  return useContext(Refresh);
}
