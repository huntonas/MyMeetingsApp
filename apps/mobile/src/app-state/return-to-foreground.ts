import { AppState } from "react-native";

// Calls `callback` each time the app comes back after being in the background. Going inactive and straight back (a
// notification banner, the app switcher, an incoming call screen) isn't a return: the app never left. iOS can pass
// through "inactive" on the way back, so what counts is having been in the background since the app was last active.
// Returns the unsubscribe function, so it fits straight into an effect.
export function onReturnToForeground(callback: () => void): () => void {
  let away = false;
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "background") away = true;
    if (state === "active" && away) {
      away = false;
      callback();
    }
  });
  return () => {
    subscription.remove();
  };
}
