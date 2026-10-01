import { useCallback, useMemo, useState } from "react";
import { AccessibilityInfo } from "react-native";

// What an action did, for the screen to show (as an alert) and for VoiceOver and TalkBack to announce at once.
export interface Notice {
  text: string | null;
  // null clears it, as when the person starts something new.
  tell: (text: string | null) => void;
}

export function useNotice(): Notice {
  const [text, setText] = useState<string | null>(null);
  const tell = useCallback((next: string | null) => {
    setText(next);
    if (next !== null) AccessibilityInfo.announceForAccessibility(next);
  }, []);
  return useMemo(() => ({ text, tell }), [text, tell]);
}
