import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

// Reads again each time the screen comes back into view. The first focus is the mount, which has already read.
export function useRefreshOnFocus(refresh: () => void): void {
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      refresh();
    }, [refresh]),
  );
}
