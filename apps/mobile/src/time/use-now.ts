import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { onReturnToForeground } from "@/app-state/return-to-foreground";

const MINUTE = 60_000;

// "Now" for a screen that shows what's on: moved on each minute while the screen is in view, and again each time it
// comes back into view or the app returns from the background.
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      const update = () => {
        setNow(new Date());
      };
      update();
      const tick = setInterval(update, MINUTE);
      const stopListening = onReturnToForeground(update);
      return () => {
        clearInterval(tick);
        stopListening();
      };
    }, []),
  );
  return now;
}
