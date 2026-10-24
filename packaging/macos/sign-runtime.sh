#!/bin/bash
# Sign the bundled runtime trees (dsh and primary-runtime) with a Developer ID identity.
# Run after package:mac:<arch>:unsigned has prepared .desktop-build/targets/mac-<arch>.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST_ARCH="$(uname -m)"
ARCH="${ARCH:-$HOST_ARCH}"
case "$ARCH" in
  arm64) TARGET=arm64 ;;
  x86_64|intel) TARGET=x64 ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

BASE="${1:-$ROOT/apps/desktop/.desktop-build/targets/mac-${TARGET}}"
IDENTITY="${MACOS_SIGNING_IDENTITY:-${2:-}}"
ENTITLEMENTS="${MACOS_NESTED_ENTITLEMENTS:-$ROOT/packaging/macos/nested-entitlements.plist}"

if [ -z "$IDENTITY" ]; then
  echo "Set MACOS_SIGNING_IDENTITY to the full identity, for example:" >&2
  echo '  export MACOS_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)"' >&2
  exit 1
fi

if [ -d "$BASE/Contents/Resources" ]; then
  DSH="$BASE/Contents/Resources/app.asar.unpacked/dsh"
  RUNTIME="$BASE/Contents/Resources/runtime"
else
  DSH="$BASE/dsh"
  RUNTIME="$BASE/runtime"
fi

LO="$DSH/node_modules/@deepseek-ai/libreoffice-kit-darwin-${TARGET}/program/LibreOfficeDev.app"

if [ -d "$LO" ]; then
  echo "Signing LibreOffice bundle..."
  codesign --force --deep --sign "$IDENTITY" --options runtime --timestamp "$LO"
fi

echo "Signing runtime Mach-O files..."
find "$DSH" "$RUNTIME" -type f \( -name "*.dylib" -o -name "*.so" -o -name "*.so.*" -o -name "*.node" -o -name "*.exe" \) \
  ! -path "*/LibreOfficeDev.app/*" -print0 \
  | xargs -0 -n1 -P4 -I{} codesign --force --sign "$IDENTITY" --options runtime --timestamp \
      --entitlements "$ENTITLEMENTS" "{}"

echo "Signing remaining executable Mach-O files..."
find "$DSH" "$RUNTIME" -type f -perm -111 ! -path "*/LibreOfficeDev.app/*" ! -name "*.sh" -print0 \
  | while IFS= read -r -d '' f; do
      if file -b "$f" 2>/dev/null | grep -q "Mach-O"; then
        codesign --force --sign "$IDENTITY" --options runtime --timestamp \
          --entitlements "$ENTITLEMENTS" "$f"
      fi
    done

echo "Signing explicit launchers..."
for f in \
  "$RUNTIME/primary-runtime/dependencies/node/bin/node" \
  "$RUNTIME/primary-runtime/dependencies/python/bin/python3.12" \
  "$DSH/node_modules/@vscode/ripgrep-darwin-${TARGET}/bin/rg" \
  "$DSH/node_modules/node-pty/prebuilds/darwin-${TARGET}/spawn-helper"; do
  [ -e "$f" ] && codesign --force --sign "$IDENTITY" --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" "$f"
done

echo "Runtime signing complete."
