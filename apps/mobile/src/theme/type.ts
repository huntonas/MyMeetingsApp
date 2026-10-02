import { Platform, type TextStyle } from "react-native";

// Atkinson Hyperlegible, embedded at build time by the expo-font config plugin (app.config.ts). iOS names a face by its
// PostScript name; Android uses the one XML family and picks the face by weight.
export const FONT = {
  regular: Platform.select({ ios: "AtkinsonHyperlegible-Regular", default: "AtkinsonHyperlegible" }),
  bold: Platform.select({ ios: "AtkinsonHyperlegible-Bold", default: "AtkinsonHyperlegible" }),
} as const;

export type TextVariant = "title" | "heading" | "body" | "label" | "small" | "smallBold" | "header";

const bold: TextStyle = { fontFamily: FONT.bold, fontWeight: "700" };
const regular: TextStyle = { fontFamily: FONT.regular, fontWeight: "400" };

// Sizes scale with Dynamic Type and Android font size: nothing sets allowFontScaling={false} or a fixed text height.
// "header" is the words in the header bar (its title on the tabs, and its buttons).
export const TEXT_STYLES: Record<TextVariant, TextStyle> = {
  title: { ...bold, fontSize: 28, lineHeight: 34 },
  heading: { ...bold, fontSize: 20, lineHeight: 26 },
  body: { ...regular, fontSize: 17, lineHeight: 24 },
  label: { ...bold, fontSize: 17, lineHeight: 22 },
  small: { ...regular, fontSize: 15, lineHeight: 20 },
  smallBold: { ...bold, fontSize: 15, lineHeight: 20 },
  header: { ...bold, fontSize: 17, lineHeight: 22 },
};

// The most a variant grows with the phone's text size; <AppText> applies it, and nothing else caps text. The header bar
// keeps its height, so its words stop at one and a half times, as iOS's own navigation bars stop growing. A title stops
// at twice its size, still larger than body text at the largest size, so a long word in it fits the phone's width.
export const MAX_FONT_SCALE: Partial<Record<TextVariant, number>> = { title: 2, header: 1.5 };
