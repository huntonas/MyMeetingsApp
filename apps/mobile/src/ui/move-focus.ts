import type { RefObject } from "react";
import { AccessibilityInfo, type Text, type View } from "react-native";

// Moves VoiceOver and TalkBack to `target`, as when a panel opens in place or closes again: without it, focus stays
// on a control that's gone. (sendAccessibilityEvent replaces the deprecated setAccessibilityFocus(findNodeHandle()).)
export function moveFocus(target: RefObject<Text | View | null>): void {
  if (target.current !== null) AccessibilityInfo.sendAccessibilityEvent(target.current, "focus");
}
