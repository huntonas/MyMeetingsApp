#!/bin/sh
# Renders the App Store screenshots (store/screenshots/<name>.png, 1320 x 2868, no alpha) from the raw captures in
# store/screenshots/raw/, the headlines in store/screenshots/headlines.txt and the frame in store/screenshots/frame.svg
# (needs rsvg-convert: brew install librsvg). Commit the PNGs. Headlines are set in Atkinson Hyperlegible Bold from the
# app's own font package, and fontconfig is given only that font, so every machine renders the same letters.
set -eu
cd "$(dirname "$0")/../store/screenshots"
work=$(mktemp -d)
trap 'rm -rf "$work" .frame-*.svg' EXIT
font_dir=$(node -p 'path.dirname(require.resolve("@expo-google-fonts/atkinson-hyperlegible/package.json"))')
printf '<?xml version="1.0"?>\n<fontconfig><dir>%s</dir><cachedir>%s</cachedir></fontconfig>\n' "$font_dir" "$work" \
  > "$work/fonts.conf"
export PANGOCAIRO_BACKEND=fc FONTCONFIG_FILE="$work/fonts.conf"
size=100
grep -v '^#' headlines.txt | while IFS= read -r line; do
  name=${line%%|*}
  # Each line of the headline as a <tspan>, the block centred above the phone.
  headline=$(printf '%s\n' "${line#*|}" | sed 's/&/\&amp;/g; s/</\&lt;/g' | awk -F'|' -v size="$size" '{
    lh = size * 1.18; y = 270 - (NF - 1) * lh / 2 + 0.35 * size
    for (i = 1; i <= NF; i++) printf "<tspan x=\"660\" y=\"%d\">%s</tspan>", y + (i - 1) * lh, $i
  }')
  # librsvg loads images only from the SVG's own folder and below, so the filled-in frame is written here.
  sed -e "s|@SIZE@|$size|" -e "s|@RAW@|raw/$name.png|" -e "s|@HEADLINE@|$headline|" frame.svg > ".frame-$name.svg"
  rsvg-convert --background-color '#1f5f8b' ".frame-$name.svg" -o "$name.png"
  echo "$name.png"
done
