#!/bin/bash
# Build an unsigned DeepSeek Harness DMG for the host architecture.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

HOST_ARCH="$(uname -m)"
ARCH="${ARCH:-$HOST_ARCH}"
case "$ARCH" in
  arm64) TARGET=arm64 ;;
  x86_64|intel) TARGET=x64 ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

if [ "$TARGET" = arm64 ] && [ "$HOST_ARCH" != arm64 ]; then
  echo "arm64 builds require an Apple Silicon host: the bundled Node/Python runtime is prepared for the build host." >&2
  exit 1
fi

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number)
  if (major < 22 || (major === 22 && minor < 19)) {
    console.error(`Node.js ${process.versions.node} is too old; use 22.19+ or 24+.`)
    process.exit(1)
  }
'

pnpm install --frozen-lockfile
pnpm --filter @deepseek-ai/dsh-desktop run "package:mac:${TARGET}:unsigned"

mkdir -p "$ROOT/dist"
cp "$ROOT/apps/desktop/.desktop-build/targets/mac-${TARGET}/unsigned-artifacts/"*-mac-${TARGET}-unsigned.dmg "$ROOT/dist/"
ls -lh "$ROOT/dist/"*-mac-${TARGET}-unsigned.dmg
