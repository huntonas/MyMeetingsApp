#!/bin/sh
# Renders the app's icon art from assets/mark.svg (needs rsvg-convert: brew install librsvg). Commit the PNGs.
# icon.png is opaque (the App Store refuses transparency); mark.png is the transparent mark for Android and the splash.
# Google Play's 512 px icon and its feature graphic (assets/feature-graphic.svg, 1024 x 500, no alpha) go to
# store/google-play/. Text is set in Atkinson Hyperlegible from the app's own font package, and fontconfig is given
# only that font, so every machine renders the same letters.
set -eu
cd "$(dirname "$0")/../assets"
fonts=$(mktemp -d)
trap 'rm -rf "$fonts"' EXIT
font_dir=$(node -p 'path.dirname(require.resolve("@expo-google-fonts/atkinson-hyperlegible/package.json"))')
printf '<?xml version="1.0"?>\n<fontconfig><dir>%s</dir><cachedir>%s</cachedir></fontconfig>\n' "$font_dir" "$fonts" \
  > "$fonts/fonts.conf"
export PANGOCAIRO_BACKEND=fc FONTCONFIG_FILE="$fonts/fonts.conf"
rsvg-convert -w 1024 -h 1024 --background-color '#1f5f8b' mark.svg -o icon.png
rsvg-convert -w 1024 -h 1024 mark.svg -o mark.png
rsvg-convert -w 512 -h 512 --background-color '#1f5f8b' mark.svg -o ../store/google-play/icon.png
rsvg-convert -w 1024 -h 500 --background-color '#1f5f8b' feature-graphic.svg -o ../store/google-play/feature-graphic.png
