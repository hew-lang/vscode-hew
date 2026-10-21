#!/usr/bin/env bash
# Stage the bundled SDK for one VS Code target.
#
# Usage: scripts/stage-hew-sdk.sh <vscode-target> [archive-dir]
#
# hew-release.sha256 pins the hew release archives the extension bundles.
# The archive for the target is downloaded from the hew-lang/hew GitHub
# release (unless already present in archive-dir), checked against that pin,
# and the complete SDK tree is copied to sdk/, preserving its executable-relative
# libraries, standard library, headers and debugger helpers for `vsce package`.
# To bundle a different hew release, replace hew-release.sha256 with the
# matching lines from that release's checksums file.
set -euo pipefail

target="${1:?usage: $0 <vscode-target> [archive-dir]}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
archive_dir="${2:-$root/.tmp/hew-release}"
pin="$root/hew-release.sha256"

case "$target" in
    linux-x64) arch=linux-x86_64 ;;
    linux-arm64) arch=linux-aarch64 ;;
    darwin-arm64) arch=darwin-aarch64 ;;
    win32-x64) arch=windows-x86_64 ;;
    *) echo "error: unsupported target '$target'" >&2; exit 1 ;;
esac

line="$(grep -E "  hew-v[^ ]+-${arch}\.(tar\.gz|zip)$" "$pin" || true)"
if [ "$(printf '%s' "$line" | grep -c .)" -ne 1 ]; then
    echo "error: $pin must pin exactly one archive for $arch" >&2
    exit 1
fi
archive="${line##* }"
tag="${archive#hew-}"
tag="${tag%-"$arch".*}"

mkdir -p "$archive_dir"
if [ ! -f "$archive_dir/$archive" ]; then
    gh release download "$tag" --repo hew-lang/hew --pattern "$archive" --dir "$archive_dir"
fi
(cd "$archive_dir" && printf '%s\n' "$line" | sha256sum --check --strict -)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
case "$archive" in
    *.zip) unzip -q "$archive_dir/$archive" -d "$work" ;;
    *) tar -xzf "$archive_dir/$archive" -C "$work" ;;
esac
top="$work/hew-$tag-$arch"
exe=hew
[ "$arch" = windows-x86_64 ] && exe=hew.exe

# Keep the release layout intact: the compiler, language server and debugger
# resolve their matching libraries and resources relative to bin/hew.
for entry in "bin/$exe" lib std include share; do
    if [ ! -e "$top/$entry" ]; then
        echo "error: SDK archive is missing $entry" >&2
        exit 1
    fi
done
cp -R "$top" "$work/sdk"
chmod +x "$work/sdk/bin/$exe"
rm -rf "$root/sdk"
mv "$work/sdk" "$root/sdk"
echo "staged Hew SDK from $archive"
