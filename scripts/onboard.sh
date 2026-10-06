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
  say "Dani-Dex setup"
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
      case "$arch" in
        arm64|x86_64) printf 'macos|%s\n' "Dani-Dex-mac-universal.dmg" ;;
        *) return 1 ;;
      esac
      ;;
    linux)
      case "$arch" in
        x86_64|amd64) printf 'linux|%s\n' "Dani-Dex-linux-x86_64.AppImage" ;;
        *) return 1 ;;
      esac
      ;;
    mingw*|msys*|cygwin*)
      case "$arch" in
        x86_64|amd64) printf 'windows|%s\n' "Dani-Dex-windows-x64.exe" ;;
        *) return 1 ;;
      esac
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
      [ -n "$2" ] && [[ "$2" != --* ]] || die "--install-dir needs a path"
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
INSTALL_STAGE=""
INSTALL_LOCK=""
DEST=""
cleanup() {
  [ -n "${DMG_MOUNT:-}" ] && hdiutil detach "$DMG_MOUNT" -quiet >/dev/null 2>&1 || true
  if [ -n "$INSTALL_STAGE" ]; then
    if [ -e "$INSTALL_STAGE/previous" ] && [ ! -e "$DEST" ]; then
      mv "$INSTALL_STAGE/previous" "$DEST" || warn "restore failed; previous app remains in $INSTALL_STAGE/previous"
    fi
    # Preserve a recovery copy if restoration failed.
    [ -e "$INSTALL_STAGE/previous" ] || rm -rf "$INSTALL_STAGE"
  fi
  if [ -n "$INSTALL_LOCK" ] && [ ! -e "$INSTALL_STAGE/previous" ]; then rmdir "$INSTALL_LOCK"; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

# Require the exact artifact name and hash before downloading.
SUMS_URL="${RELEASE_ROOT}/SHA256SUMS-${PLATFORM}.txt"
SUMS_TEXT=$(curl -fsSL --connect-timeout 15 --max-time 30 "$SUMS_URL" | tr -d '\r') \
  || die "could not fetch release checksums. Not installing an unverifiable download."
case "$PLATFORM" in
  macos) EXT=dmg ;;
  linux) EXT=AppImage ;;
  windows) EXT=exe ;;
esac
SUM_LINES=$(printf '%s\n' "$SUMS_TEXT" | grep "\.${EXT}\$" || true)
[ "$(printf '%s\n' "$SUM_LINES" | grep -c . || true)" -eq 1 ] \
  || die "release checksums must contain one valid artifact for this platform. Not installing."
[[ "$SUM_LINES" =~ ^([[:xdigit:]]{64})[[:blank:]]+\*?(Dani-Dex-[A-Za-z0-9._-]+)$ ]] \
  || die "invalid release checksum entry. Not installing."
EXPECTED=$(printf '%s' "${BASH_REMATCH[1]}" | tr 'A-F' 'a-f')
NAME=${BASH_REMATCH[2]}
case "$PLATFORM:$NAME" in
  macos:Dani-Dex-*-universal.dmg|linux:Dani-Dex-*-x86_64.AppImage|windows:Dani-Dex-*-x64.exe) ;;
  *) die "wrong artifact for this platform. Not installing." ;;
esac
URL="${RELEASE_ROOT}/${NAME}"

if command -v sha256sum >/dev/null 2>&1; then HASH_TOOL=sha256sum
elif command -v shasum >/dev/null 2>&1; then HASH_TOOL=shasum
else die "a SHA256 tool is required. Not installing an unverifiable download."; fi

step "Downloading Dani-Dex (${NAME})"
say "${C_DIM}  $URL${C_RESET}"
DOWNLOAD="$TMP/$NAME"
if [ -t 1 ]; then
  curl -fL --connect-timeout 15 --speed-time 30 --speed-limit 1 --retry 3 --progress-bar -o "$DOWNLOAD" "$URL" || die "download failed - check your connection and try again."
else
  curl -fsSL --connect-timeout 15 --speed-time 30 --speed-limit 1 --retry 3 -o "$DOWNLOAD" "$URL" || die "download failed - check your connection and try again."
fi
ok "downloaded $(du -h "$DOWNLOAD" | cut -f1)"

step "Verifying the download"
if [ "$HASH_TOOL" = sha256sum ]; then ACTUAL=$(sha256sum "$DOWNLOAD" | awk '{print $1}')
else ACTUAL=$(shasum -a 256 "$DOWNLOAD" | awk '{print $1}'); fi
[ "$ACTUAL" = "$EXPECTED" ] || die "checksum mismatch - the download is corrupt or tampered with. Not installing it."
ok "checksum verified (${NAME})"

install_path() {
  DEST=$2
  mkdir "${DEST}.install-lock" || die "another install or interrupted install owns ${DEST}.install-lock"
  INSTALL_LOCK="${DEST}.install-lock"
  INSTALL_STAGE=$(mktemp -d "$DEST_DIR/.dani-dex-install-XXXXXX")
  cp -R "$1" "$INSTALL_STAGE/next"
  [ "$PLATFORM" != linux ] || chmod +x "$INSTALL_STAGE/next"
  [ ! -e "$DEST" ] || mv "$DEST" "$INSTALL_STAGE/previous"
  mv "$INSTALL_STAGE/next" "$DEST"
  rm -rf "$INSTALL_STAGE"
  INSTALL_STAGE=""
  rmdir "$INSTALL_LOCK"
  INSTALL_LOCK=""
}

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
    install_path "$APP" "$DEST_DIR/Dani-Dex.app"
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
    install_path "$DOWNLOAD" "$DEST_DIR/Dani-Dex.AppImage"
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
say "Installed. Open Dani-Dex to complete setup."
