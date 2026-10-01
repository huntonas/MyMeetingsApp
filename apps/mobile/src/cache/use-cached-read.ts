import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";

import { ApiError } from "@/api/client";
import { failureMessage } from "@/api/failure-message";
import { cachedRead, type CachedRead, type CachedResult } from "@/cache/cached-read";

// A failed read is `gone` when the server said the meeting no longer exists, rather than that something went wrong.
export type ReadState<T> =
  | { status: "loading" }
  | ({ status: "ready" } & CachedResult<T>)
  | { status: "failed"; message: string; gone: boolean };

// About this read only: the phone may well hold other saved copies (a search elsewhere, other meetings).
const NO_COPY =
  "We couldn't reach mymeetingapp, and this isn't saved on your phone yet. Check your connection and try again.";

// Reads `read` whenever its key changes, and again on refresh(); a refresh keeps showing what's already there.
export function useCachedRead<S extends z.ZodType>(read: CachedRead<S> | null) {
  const [state, setState] = useState<ReadState<z.output<S>>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(read);
  latest.current = read;
  const key = read?.key ?? null;
  const shownKey = useRef<string | null>(null);

  useEffect(() => {
    const current = latest.current;
    if (current === null) {
      // Otherwise the previous read's result (or failure) would stay on screen for a read that no longer applies.
      shownKey.current = null;
      setState({ status: "loading" });
      return;
    }
    let live = true;
    if (shownKey.current !== current.key) setState({ status: "loading" });
    shownKey.current = current.key;
    cachedRead(current).then(
      (result) => {
        if (live) setState({ status: "ready", ...result });
      },
      (error: unknown) => {
        if (!live) return;
        const gone = error instanceof ApiError && error.code === "meeting_not_found";
        setState({ status: "failed", message: failureMessage(error, NO_COPY), gone });
      },
    );
    return () => {
      live = false;
    };
  }, [key, attempt]);

  const refresh = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);
  return { state, refresh };
}
