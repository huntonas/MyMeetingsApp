import { useColorScheme } from "react-native";

// "Direction A · Calm": the website's tokens exactly (apps/web/src/app/globals.css), light and dark, following the
// system appearance. No other file writes a colour.
const PALETTES = {
  light: {
    bg: "#fbfaf7",
    surface: "#ffffff",
    text: "#1d2327",
    muted: "#55606a",
    line: "#dcd8cf",
    accent: "#1f5f8b",
    accentText: "#ffffff",
    tagBg: "#eef3f7",
    noticeBg: "#fff6d6",
  },
  dark: {
    bg: "#15191c",
    surface: "#1d2226",
    text: "#eceff1",
    muted: "#a9b3bb",
    line: "#333b41",
    accent: "#8cc4ec",
    accentText: "#0e1418",
    tagBg: "#243039",
    noticeBg: "#3a3218",
  },
} as const;

export type Palette = (typeof PALETTES)["light"] | (typeof PALETTES)["dark"];

export function useColors(): Palette {
  return useColorScheme() === "dark" ? PALETTES.dark : PALETTES.light;
}
