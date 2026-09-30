import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";

import { ApiError, Unreachable } from "@/api/client";
import { cachedRead, type CachedRead, type CachedResult } from "@/cache/cached-read";

export type ReadState<T> =
  { status: "loading" } | ({ status: "ready" } & CachedResult<T>) | { status: "failed"; message: string };

const NO_COPY =
  "We couldn't reach mymeetingapp, and there's no saved copy on this phone yet. Check your connection and try again.";

// Anything else (a bug, a native module throwing) is ours, not the server's or the connection's; say so plainly
// instead of leaving the screen on "Loading" forever.
const GENERIC_FAILURE = "Something went wrong on this phone. Try again.";

function failureMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Unreachable) return NO_COPY;
  return GENERIC_FAILURE;
}

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
        if (live) setState({ status: "failed", message: failureMessage(error) });
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
