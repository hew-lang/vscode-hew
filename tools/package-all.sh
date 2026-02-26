#!/usr/bin/env bash
# Build platform-specific VS Code extension packages with bundled hew-lsp.
#
# Usage:
#   ./tools/package-all.sh                    # build all platforms
#   ./tools/package-all.sh linux-x64          # build one platform
#   ./tools/package-all.sh --local            # build for current platform only
#
# Prerequisites:
#   - Rust cross-compilation targets installed (rustup target add ...)
#   - npm dependencies installed (npm install)
#   - vsce installed (npx vsce)
#
# The script:
#   1. Cross-compiles hew-lsp for each target platform
#   2. Places the binary in server/hew-lsp[.exe]
#   3. Runs `vsce package --target <platform>` to produce a .vsix
#   4. Cleans server/ between platforms
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HEW_DIR="$(cd "$EXT_DIR/../../hew" && pwd)"

# VS Code platform → Rust target mapping
declare -A TARGETS=(
    [linux-x64]="x86_64-unknown-linux-gnu"
    [linux-arm64]="aarch64-unknown-linux-gnu"
    [darwin-x64]="x86_64-apple-darwin"
    [darwin-arm64]="aarch64-apple-darwin"
    [win32-x64]="x86_64-pc-windows-msvc"
)

build_platform() {
    local platform="$1"
    local rust_target="${TARGETS[$platform]}"

    if [ -z "$rust_target" ]; then
        echo "ERROR: Unknown platform: $platform"
        echo "Valid platforms: ${!TARGETS[*]}"
        exit 1
    fi

    echo "==> Building hew-lsp for $platform ($rust_target)"

    # Cross-compile hew-lsp
    (cd "$HEW_DIR" && cargo build --release -p hew-lsp --target "$rust_target")

    # Prepare server directory
    rm -rf "$EXT_DIR/server/"*

    local ext=""
    [[ "$platform" == win32-* ]] && ext=".exe"

    local binary="$HEW_DIR/target/$rust_target/release/hew-lsp${ext}"
    if [ ! -f "$binary" ]; then
        echo "ERROR: Binary not found: $binary"
        echo "  Make sure the Rust target is installed: rustup target add $rust_target"
        exit 1
    fi

    cp "$binary" "$EXT_DIR/server/hew-lsp${ext}"
    chmod +x "$EXT_DIR/server/hew-lsp${ext}"

    echo "==> Packaging hew-lang extension for $platform"
    (cd "$EXT_DIR" && npx vsce package --target "$platform")

    echo "==> Built: $(ls "$EXT_DIR"/hew-lang-*-"$platform"*.vsix 2>/dev/null)"
}

# Handle --local flag
if [ "${1:-}" = "--local" ]; then
    case "$(uname -s)-$(uname -m)" in
        Linux-x86_64)   platform="linux-x64" ;;
        Linux-aarch64)  platform="linux-arm64" ;;
        Darwin-x86_64)  platform="darwin-x64" ;;
        Darwin-arm64)   platform="darwin-arm64" ;;
        *)              echo "ERROR: Unsupported local platform: $(uname -s)-$(uname -m)"; exit 1 ;;
    esac
    build_platform "$platform"
    exit 0
fi

# Build specific platform or all
if [ $# -gt 0 ]; then
    for p in "$@"; do
        build_platform "$p"
    done
else
    for p in "${!TARGETS[@]}"; do
        build_platform "$p" || echo "WARNING: $p build failed, continuing..."
    done
fi

# Clean up server directory
rm -rf "$EXT_DIR/server/"*
echo "# Platform-specific hew-lsp binary is placed here during packaging" > "$EXT_DIR/server/README.md"

echo ""
echo "==> All packages:"
ls -lh "$EXT_DIR"/*.vsix 2>/dev/null
