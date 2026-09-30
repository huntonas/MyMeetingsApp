#!/bin/sh
# Renders the app's icon art from assets/mark.svg (needs rsvg-convert: brew install librsvg). Commit the PNGs.
# icon.png is opaque (the App Store refuses transparency); mark.png is the transparent mark for Android and the splash.
set -eu
cd "$(dirname "$0")/../assets"
rsvg-convert -w 1024 -h 1024 --background-color '#1f5f8b' mark.svg -o icon.png
rsvg-convert -w 1024 -h 1024 mark.svg -o mark.png
