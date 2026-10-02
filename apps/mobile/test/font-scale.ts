import ReactNative from "react-native";

// iOS's largest Dynamic Type size, accessibility-extra-extra-extra-large, scales fonts by 3.12.
export const LARGEST_TEXT = 3.12;

// The text size the phone reports, as React Native hands it to the app.
export function setFontScale(fontScale: number) {
  const real = ReactNative.useWindowDimensions;
  jest.spyOn(ReactNative, "useWindowDimensions").mockImplementation(() => ({ ...real(), fontScale }));
}
