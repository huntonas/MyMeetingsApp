import { Platform, type TextStyle } from "react-native";

// Atkinson Hyperlegible, embedded at build time by the expo-font config plugin (app.config.ts). iOS names a face by its
// PostScript name; Android uses the one XML family and picks the face by weight.
export const FONT = {
  regular: Platform.select({ ios: "AtkinsonHyperlegible-Regular", default: "AtkinsonHyperlegible" }),
  bold: Platform.select({ ios: "AtkinsonHyperlegible-Bold", default: "AtkinsonHyperlegible" }),
} as const;

export type TextVariant = "title" | "heading" | "body" | "label" | "small";

const bold: TextStyle = { fontFamily: FONT.bold, fontWeight: "700" };
const regular: TextStyle = { fontFamily: FONT.regular, fontWeight: "400" };

// Sizes scale with Dynamic Type and Android font size: nothing sets allowFontScaling={false} or a fixed text height.
export const TEXT_STYLES: Record<TextVariant, TextStyle> = {
  title: { ...bold, fontSize: 28, lineHeight: 34 },
  heading: { ...bold, fontSize: 20, lineHeight: 26 },
  body: { ...regular, fontSize: 17, lineHeight: 24 },
  label: { ...bold, fontSize: 17, lineHeight: 22 },
  small: { ...regular, fontSize: 15, lineHeight: 20 },
};
