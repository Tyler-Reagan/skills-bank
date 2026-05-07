#!/usr/bin/env bash
# Regenerate platform icons (.icns, .ico, PNG) from build/icon.svg.
# Requires: ImageMagick (magick), iconutil, sips. macOS-only for .icns.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="build/icon.svg"
OUT="build"
ICONSET="$OUT/icon.iconset"

if [[ ! -f "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi

rm -rf "$ICONSET" "$OUT/icon.png" "$OUT/icon.icns" "$OUT/icon.ico"
mkdir -p "$ICONSET"

# Master 1024 PNG. -density and -background ensure crisp SVG raster.
magick -background none -density 1024 "$SRC" -resize 1024x1024 "$OUT/icon.png"

# .iconset for iconutil — Apple's required name/size matrix.
declare -a SIZES=(16 32 32 64 128 256 256 512 512 1024)
declare -a NAMES=(
  "icon_16x16.png" "icon_16x16@2x.png"
  "icon_32x32.png" "icon_32x32@2x.png"
  "icon_128x128.png" "icon_128x128@2x.png"
  "icon_256x256.png" "icon_256x256@2x.png"
  "icon_512x512.png" "icon_512x512@2x.png"
)
for i in "${!SIZES[@]}"; do
  sips -z "${SIZES[$i]}" "${SIZES[$i]}" "$OUT/icon.png" --out "$ICONSET/${NAMES[$i]}" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$OUT/icon.icns"

# .ico for Windows — pack 16/32/48/64/128/256.
magick -background none -density 1024 "$SRC" \
  \( -clone 0 -resize 16x16 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 48x48 \) \
  \( -clone 0 -resize 64x64 \) \
  \( -clone 0 -resize 128x128 \) \
  \( -clone 0 -resize 256x256 \) \
  -delete 0 "$OUT/icon.ico"

rm -rf "$ICONSET"

echo "wrote $OUT/icon.png, $OUT/icon.icns, $OUT/icon.ico"
