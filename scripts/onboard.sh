#!/usr/bin/env bash
# Dani-Dex one-command onboarding.
#
#   curl -fsSL https://raw.githubusercontent.com/somdipto/dani-dex/main/scripts/onboard.sh | bash
#
# Paste that single line into any terminal on macOS, Linux or WSL. It detects the
# platform, downloads the newest Dani-Dex release from GitHub, installs it and
# opens the app so onboarding starts. On Windows, use PowerShell instead:
#
#   irm https://raw.githubusercontent.com/somdipto/dani-dex/main/scripts/onboard.ps1 | iex
#
# Options (append after `bash -s --` when piping):
#   --no-launch            install only, do not open the app at the end
#   --install-dir <path>   where to put the app (default: /Applications or ~/Applications
#                          on macOS, ~/Applications on Linux)
#   --dry-run              print the plan and stop before any download or change
#   --help                 show this help
set -euo pipefail

REPO="somdipto/dani-dex"
RELEASE_ROOT="${DANI_DEX_ONBOARD_RELEASE_ROOT:-https://github.com/${REPO}/releases/latest/download}"

NO_LAUNCH=0
DRY_RUN=0
INSTALL_DIR=""
MODE="install"

if [ -t 1 ]; then
  C_BOLD=$(printf '\033[1m'); C_DIM=$(printf '\033[2m'); C_GREEN=$(printf '\033[32m')
  C_RED=$(printf '\033[31m'); C_YELLOW=$(printf '\033[33m'); C_RESET=$(printf '\033[0m')
else
  C_BOLD=""; C_DIM=""; C_GREEN=""; C_RED=""; C_YELLOW=""; C_RESET=""
fi

say()  { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$C_BOLD" "$C_RESET" "$*"; }
ok()   { printf '%s ok %s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%serror%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

banner() {
  say ""
  say "${C_BOLD}  ____              _   ____"
  say " |  _ \\  __ _ _ __ (_) |  _ \\  _____  __"
  say " | | | |/ _\` | '_ \\| | | | | |/ _ \\ \\/ /"
  say " | |_| | (_| | | | | | | |_| |  __/>  <"
  say " |____/ \\__,_|_| |_|_| |____/ \\___/_/\\_\\${C_RESET}"
  say ""
  say " Your own AI team, on your own computer."
  say ""
}

usage() {
  cat <<'HELP'
Dani-Dex one-command onboarding.

  curl -fsSL https://raw.githubusercontent.com/somdipto/dani-dex/main/scripts/onboard.sh | bash

Paste that single line into any terminal on macOS, Linux or WSL. It detects the
platform, downloads the newest Dani-Dex release from GitHub, installs it and
opens the app so onboarding starts. On Windows, use PowerShell instead:

  irm https://raw.githubusercontent.com/somdipto/dani-dex/main/scripts/onboard.ps1 | iex

Options (append after `bash -s --` when piping):
  --no-launch            install only, do not open the app at the end
  --install-dir <path>   where to put the app (default: /Applications or
                         ~/Applications on macOS, ~/Applications on Linux)
  --dry-run              print the plan and stop before any download or change
  --help                 show this help
HELP
}

# resolve_asset <uname -s> <uname -m> prints "<platform>|<asset>" or fails.
resolve_asset() {
  local os arch
  os=$(printf '%s' "$1" | tr 'A-Z' 'a-z')
  arch=$(printf '%s' "$2" | tr 'A-Z' 'a-z')
  case "$os" in
    darwin)
      printf 'macos|%s\n' "Dani-Dex-mac-universal.dmg"
      ;;
    linux)
      case "$arch" in
        x86_64|amd64) printf 'linux|%s\n' "Dani-Dex-linux-x86_64.AppImage" ;;
        *) return 1 ;;
      esac
      ;;
    mingw*|msys*|cygwin*)
      printf 'windows|%s\n' "Dani-Dex-windows-x64.exe"
      ;;
    *)
      return 1
      ;;
  esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-launch) NO_LAUNCH=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --install-dir)
      [ $# -ge 2 ] || die "--install-dir needs a path"
      INSTALL_DIR=$2; shift
      ;;
    --resolve)
      # Hidden test hook: print the resolved asset for a given platform and stop.
      [ $# -ge 3 ] || die "usage: --resolve <uname-s> <uname-m>"
      MODE="resolve"; RESOLVE_OS=$2; RESOLVE_ARCH=$3; shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

if [ "$MODE" = "resolve" ]; then
  if resolved=$(resolve_asset "$RESOLVE_OS" "$RESOLVE_ARCH"); then
    platform=${resolved%%|*}; asset=${resolved#*|}
    printf 'platform=%s\nasset=%s\nurl=%s/%s\n' "$platform" "$asset" "$RELEASE_ROOT" "$asset"
    exit 0
  fi
  die "no Dani-Dex build for $RESOLVE_OS $RESOLVE_ARCH - grab one by hand from https://github.com/${REPO}/releases/latest"
fi

banner
step "Detecting your platform"
UNAME_S=$(uname -s); UNAME_M=$(uname -m)
resolved=$(resolve_asset "$UNAME_S" "$UNAME_M") || \
  die "no Dani-Dex build for ${UNAME_S} ${UNAME_M} yet. All downloads: https://github.com/${REPO}/releases/latest"
PLATFORM=${resolved%%|*}; ASSET=${resolved#*|}
URL="${RELEASE_ROOT}/${ASSET}"
ok "${UNAME_S} ${UNAME_M} - ${ASSET}"

case "$PLATFORM" in
  macos)
    if [ -n "$INSTALL_DIR" ]; then DEST_DIR=$INSTALL_DIR
    elif [ -w /Applications ]; then DEST_DIR=/Applications
    else DEST_DIR="$HOME/Applications"; fi
    ;;
  linux)   DEST_DIR=${INSTALL_DIR:-"$HOME/Applications"} ;;
  windows) DEST_DIR=${INSTALL_DIR:-"${TEMP:-/tmp}"} ;;
esac

if [ "$DRY_RUN" -eq 1 ]; then
  say ""
  say "${C_BOLD}Plan (dry run, nothing was downloaded or changed):${C_RESET}"
  say "  platform:    $PLATFORM"
  say "  download:    $URL"
  say "  install to:  $DEST_DIR"
  if [ "$NO_LAUNCH" -eq 1 ]; then say "  launch:      skipped (--no-launch)"; else say "  launch:      open the app, onboarding starts on first run"; fi
  exit 0
fi

command -v curl >/dev/null 2>&1 || die "curl is required. Install it (e.g. sudo apt install curl) and run the command again."

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t dani-dex)
cleanup() {
  [ -n "${DMG_MOUNT:-}" ] && hdiutil detach "$DMG_MOUNT" -quiet >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# The checksum file is the source of truth for both the file name and its hash:
# releases publish versioned names, so look ours up by artifact type and download
# that exact name. No checksum file at all falls back to the stable alias name.
SUMS_URL="${RELEASE_ROOT}/SHA256SUMS-${PLATFORM}.txt"
SUMS_TEXT=$(curl -fsSL "$SUMS_URL" 2>/dev/null | tr -d '\r' || true)
case "$PLATFORM" in
  macos) EXT=dmg ;;
  linux) EXT=AppImage ;;
  windows) EXT=exe ;;
esac
EXPECTED=""
NAME=$ASSET
if [ -n "$SUMS_TEXT" ]; then
  SUM_LINE=$(printf '%s\n' "$SUMS_TEXT" | grep "\.${EXT}\$" | head -n 1 || true)
  if [ -z "$SUM_LINE" ]; then
    die "the release publishes checksums but has no ${EXT} entry for this platform - not installing an unverifiable download."
  fi
  EXPECTED=$(printf '%s\n' "$SUM_LINE" | awk '{print $1}')
  NAME=$(printf '%s\n' "$SUM_LINE" | awk '{print $2}')
  URL="${RELEASE_ROOT}/${NAME}"
fi

step "Downloading Dani-Dex (${NAME})"
say "${C_DIM}  $URL${C_RESET}"
DOWNLOAD="$TMP/$NAME"
if [ -t 1 ]; then
  curl -fL --retry 3 --progress-bar -o "$DOWNLOAD" "$URL" || die "download failed - check your connection and try again."
else
  curl -fsSL --retry 3 -o "$DOWNLOAD" "$URL" || die "download failed - check your connection and try again."
fi
ok "downloaded $(du -h "$DOWNLOAD" | cut -f1)"

step "Verifying the download"
if [ -z "$EXPECTED" ]; then
  warn "this release has no checksum file - continuing without verification."
else
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL=$(sha256sum "$DOWNLOAD" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL=$(shasum -a 256 "$DOWNLOAD" | awk '{print $1}')
  else
    ACTUAL=""
    warn "no sha256 tool available - skipping checksum verification."
  fi
  if [ -n "$ACTUAL" ]; then
    [ "$ACTUAL" = "$EXPECTED" ] || die "checksum mismatch - the download is corrupt or tampered with. Not installing it."
    ok "checksum verified (${NAME})"
  fi
fi

case "$PLATFORM" in
  macos)
    step "Installing Dani-Dex"
    mkdir -p "$DEST_DIR"
    DMG_MOUNT="$TMP/mount"
    mkdir -p "$DMG_MOUNT"
    hdiutil attach -nobrowse -readonly -mountpoint "$DMG_MOUNT" "$DOWNLOAD" >/dev/null \
      || die "could not open the downloaded disk image. Try downloading again."
    APP=$(find "$DMG_MOUNT" -maxdepth 1 -name '*.app' | head -n 1)
    [ -n "$APP" ] || die "the disk image has no app inside - the download looks wrong."
    rm -rf "$DEST_DIR/Dani-Dex.app"
    cp -R "$APP" "$DEST_DIR/Dani-Dex.app" || die "could not copy the app into $DEST_DIR."
    hdiutil detach "$DMG_MOUNT" -quiet >/dev/null 2>&1 || true
    DMG_MOUNT=""
    # Unsigned builds trip Gatekeeper on first launch; dropping quarantine matches the
    # README's manual Control-click step.
    xattr -dr com.apple.quarantine "$DEST_DIR/Dani-Dex.app" >/dev/null 2>&1 || true
    ok "installed to $DEST_DIR/Dani-Dex.app"
    if [ "$NO_LAUNCH" -eq 0 ]; then
      step "Opening Dani-Dex"
      open "$DEST_DIR/Dani-Dex.app"
      ok "launched"
    fi
    ;;
  linux)
    step "Installing Dani-Dex"
    mkdir -p "$DEST_DIR"
    DEST="$DEST_DIR/Dani-Dex.AppImage"
    cp "$DOWNLOAD" "$DEST"
    chmod +x "$DEST"
    ok "installed to $DEST"
    if [ "$NO_LAUNCH" -eq 0 ]; then
      if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
        step "Opening Dani-Dex"
        nohup "$DEST" >/dev/null 2>&1 &
        ok "launched"
      else
        warn "no desktop session detected (headless or WSL without WSLg)."
        say "  Run it when you have a desktop: $DEST"
      fi
    fi
    ;;
  windows)
    step "Running the Windows installer"
    "$DOWNLOAD" || die "the installer did not finish. Run it by hand: $DOWNLOAD"
    APP_EXE="${LOCALAPPDATA:-$HOME/AppData/Local}/Programs/Dani-Dex/Dani-Dex.exe"
    if [ "$NO_LAUNCH" -eq 0 ] && [ -f "$APP_EXE" ]; then
      step "Opening Dani-Dex"
      "$APP_EXE" &
      ok "launched"
    else
      say "Open Dani-Dex from the Start Menu when you are ready."
    fi
    ;;
esac

say ""
say "${C_BOLD}${C_GREEN}Done.${C_RESET} Onboarding starts the first time Dani-Dex opens:"
say "  1. Pick an AI - OpenCode's free models work right away, no account needed."
say "  2. For ChatGPT, Claude or Grok, click Connect and sign in with that service."
say "  3. Tell the Chief agent what you want done."
say ""
