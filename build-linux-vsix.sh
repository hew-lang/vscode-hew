#!/usr/bin/env bash
# build-linux-vsix.sh — Build linux-x64 and linux-arm64 .vsix packages.
#
# Usage:
#   ./build-linux-vsix.sh [linux-x64|linux-arm64]   # one or both platforms
#   ./build-linux-vsix.sh                            # default: both
#
# Prerequisites:
#   - Docker (running)
#   - npm dependencies installed: npm install
#   - npx vsce available (installed via devDependencies)
#
# Design:
#   - hew-lsp is compiled inside rust:1.96.0-bookworm containers (Debian Bookworm,
#     glibc 2.36) to ensure a stable glibc floor for Linux distribution.
#   - linux-arm64 is built natively (the image is arm64 on Apple Silicon hosts).
#   - linux-x64 is built via cross-compilation using gcc-x86-64-linux-gnu inside
#     the same arm64 container. This avoids QEMU (which crashes on Apple Silicon
#     for Rust via qemu-x86_64) and produces a correct native x86_64 binary.
#   - The hew source tree is mounted read-only. A named Docker volume
#     (hew-lsp-cargo-target) serves as CARGO_TARGET_DIR, so no build artefacts
#     are written into the host checkout.
#   - Output .vsix files land in dist-staging/ (gitignored).
#
# glibc floor: 2.36 (Debian Bookworm) — compatible with Ubuntu 22.04+,
#   Fedora 37+, Debian 12+.
#
# Release day note: re-run this script from the final release tag worktree
#   (update HEW_SRC below or pass HEW_SRC=<path> env override) and copy
#   dist-staging/*.vsix to the release upload area.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$SCRIPT_DIR"

# Source tree: the hew repo at the desired commit.
# Override with: HEW_SRC=/path/to/hew ./build-linux-vsix.sh
HEW_SRC="${HEW_SRC:-$(cd "$EXT_DIR/../../hew" && pwd)}"

DIST_DIR="$EXT_DIR/dist-staging"
DOCKER_IMAGE="rust:1.96.0-bookworm"
CARGO_VOLUME="hew-lsp-cargo-target"

# VS Code platform → Rust target (Linux only)
platform_to_rust_target() {
    case "$1" in
        linux-x64)   echo "x86_64-unknown-linux-gnu" ;;
        linux-arm64) echo "aarch64-unknown-linux-gnu" ;;
        *)           echo "" ;;
    esac
}

usage() {
    echo "Usage: $0 [linux-x64|linux-arm64 ...]"
    echo "  Default: build both linux-x64 and linux-arm64"
    exit 1
}

check_prereqs() {
    if ! docker info &>/dev/null; then
        echo "ERROR: Docker is not running"
        exit 1
    fi
    if [ ! -d "$HEW_SRC" ]; then
        echo "ERROR: hew source not found at $HEW_SRC"
        echo "  Set HEW_SRC=<path> to override"
        exit 1
    fi
    if [ ! -f "$EXT_DIR/node_modules/.bin/vsce" ]; then
        echo "ERROR: vsce not found — run: npm install"
        exit 1
    fi
}

# Compile hew-lsp inside Docker for a given Rust target.
# Writes the binary to a local path (second argument).
docker_compile_hew_lsp() {
    local rust_target="$1"
    local out_binary="$2"

    echo "  ==> Compiling hew-lsp for $rust_target in Docker ($DOCKER_IMAGE)"

    # For x86_64 cross-compilation from aarch64, install the cross-linker.
    local setup_cross=""
    local linker_env=""
    if [ "$rust_target" = "x86_64-unknown-linux-gnu" ]; then
        setup_cross="apt-get update -qq && apt-get install -y -q gcc-x86-64-linux-gnu &&"
        linker_env="CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc"
    fi

    # Ensure the named volume exists (Docker creates it if absent).
    docker volume inspect "$CARGO_VOLUME" &>/dev/null \
        || docker volume create "$CARGO_VOLUME" &>/dev/null

    # Run the build inside the container:
    #   - Source mounted read-only at /src
    #   - Named volume for Cargo build artefacts (keeps host checkout clean)
    #   - rustup target add for cross-targets
    #   - Build hew-lsp only (-p hew-lsp) in release mode
    docker run --rm \
        -v "${HEW_SRC}:/src:ro" \
        -v "${CARGO_VOLUME}:/cargo-target" \
        -e CARGO_TARGET_DIR=/cargo-target \
        ${linker_env:+-e "$linker_env"} \
        "$DOCKER_IMAGE" \
        bash -euo pipefail -c "
            ${setup_cross}
            rustup target add ${rust_target} 2>/dev/null
            cargo build --release -p hew-lsp --target ${rust_target} \
                --manifest-path /src/Cargo.toml
            echo 'BUILD_OK'
        "

    # Extract the binary from the volume via a helper container.
    local volume_binary="/cargo-target/${rust_target}/release/hew-lsp"
    docker run --rm \
        -v "${CARGO_VOLUME}:/cargo-target:ro" \
        -v "$(dirname "$out_binary"):/out" \
        "$DOCKER_IMAGE" \
        cp "$volume_binary" "/out/$(basename "$out_binary")"

    chmod +x "$out_binary"
    echo "  ==> Binary ready: $out_binary ($(du -sh "$out_binary" | cut -f1))"
}

build_platform() {
    local platform="$1"
    local rust_target
    rust_target="$(platform_to_rust_target "$platform")"

    if [ -z "$rust_target" ]; then
        echo "ERROR: Unknown or unsupported platform: $platform"
        echo "Valid Linux platforms: linux-x64 linux-arm64"
        exit 1
    fi

    echo ""
    echo "==> Building $platform ($rust_target)"
    local start_ts
    start_ts=$(date +%s)

    # Compile inside Docker
    local lsp_binary
    lsp_binary="$(mktemp -d)/hew-lsp"
    docker_compile_hew_lsp "$rust_target" "$lsp_binary"

    # Place binary in server/ for vsce to bundle
    rm -rf "$EXT_DIR/server/"*
    cp "$lsp_binary" "$EXT_DIR/server/hew-lsp"
    chmod +x "$EXT_DIR/server/hew-lsp"

    # Run vsce package — output goes to EXT_DIR by default
    echo "  ==> Packaging .vsix for $platform"
    (cd "$EXT_DIR" && npx vsce package --target "$platform" 2>&1)

    # Move .vsix to dist-staging/
    mkdir -p "$DIST_DIR"
    local vsix
    # vsce names: hew-lang-<platform>-<version>.vsix
    vsix="$(find "$EXT_DIR" -maxdepth 1 -name "hew-lang-${platform}-*.vsix" | head -1)"
    if [ -z "$vsix" ]; then
        echo "ERROR: .vsix not found after packaging for $platform"
        exit 1
    fi
    mv "$vsix" "$DIST_DIR/"
    local dest
    dest="$DIST_DIR/$(basename "$vsix")"

    # Cleanup
    rm -rf "$EXT_DIR/server/"*
    echo "# Platform-specific hew-lsp binary is placed here during packaging" > "$EXT_DIR/server/README.md"
    rm -rf "$(dirname "$lsp_binary")"

    local end_ts
    end_ts=$(date +%s)
    local elapsed=$(( end_ts - start_ts ))

    echo "  ==> $platform done in ${elapsed}s"
    echo "  ==> Output: $dest"
    echo "  ==> sha256: $(shasum -a 256 "$dest" | awk '{print $1}')"
}

main() {
    check_prereqs

    local platforms=()
    if [ $# -eq 0 ]; then
        platforms=(linux-arm64 linux-x64)
    else
        for p in "$@"; do
            case "$p" in
                linux-x64|linux-arm64) platforms+=("$p") ;;
                *) echo "ERROR: Unknown platform: $p"; usage ;;
            esac
        done
    fi

    echo "==> Linux .vsix pipeline"
    echo "    hew source : $HEW_SRC"
    echo "    Docker image: $DOCKER_IMAGE"
    echo "    Cargo volume: $CARGO_VOLUME"
    echo "    Output dir  : $DIST_DIR"
    echo "    Platforms   : ${platforms[*]:-none}"

    local overall_start
    overall_start=$(date +%s)

    for platform in "${platforms[@]}"; do
        build_platform "$platform"
    done

    local overall_end
    overall_end=$(date +%s)
    echo ""
    echo "==> All platforms done in $(( overall_end - overall_start ))s"
    echo ""
    echo "==> dist-staging contents:"
    ls -lh "$DIST_DIR"/*.vsix 2>/dev/null
    echo ""
    echo "==> SHA-256 digests:"
    shasum -a 256 "$DIST_DIR"/*.vsix 2>/dev/null
}

main "$@"
