#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
rsvg-convert -w 128 -h 128 "$root/brand/hew-bluejay.svg" -o "$root/icons/hew-light.png"
rsvg-convert -w 128 -h 128 "$root/brand/hew-bluejay-dark.svg" -o "$root/icons/hew-dark.png"
rsvg-convert -w 128 -h 128 "$root/brand/hew-bluejay-app-icon.svg" -o "$root/icons/hew-extension.png"
magick identify "$root/icons/hew-light.png" "$root/icons/hew-dark.png" "$root/icons/hew-extension.png"
