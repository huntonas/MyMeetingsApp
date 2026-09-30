import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

import { onReturnToForeground } from "@/app-state/return-to-foreground";

// Reads again each time the screen comes back into view, and each time the app returns from the background while the
// screen is in view (focus doesn't change then). The first focus is the mount, which has already read.
export function useRefreshOnFocus(refresh: () => void): void {
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) first.current = false;
      else refresh();
      return onReturnToForeground(refresh);
    }, [refresh]),
  );
}
