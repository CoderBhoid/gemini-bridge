#!/usr/bin/env bash
# Gemini Bridge - Background & Headless Browser Launcher
# Runs Chrome in the background without needing a visible tab open on your screen.

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$DIR/chrome-extension"
PROFILE_DIR="${GEMINI_BRIDGE_PROFILE:-$HOME/.config/gemini-bridge-profile}"
TARGET_URL="${2:-https://gemini.google.com}"

CHROME_BIN=""
for bin in google-chrome-stable google-chrome chromium chromium-browser; do
  if command -v "$bin" &>/dev/null; then
    CHROME_BIN="$bin"
    break
  fi
done

if [ -z "$CHROME_BIN" ]; then
  echo "Error: No Chrome or Chromium binary found in PATH."
  exit 1
fi

mkdir -p "$PROFILE_DIR"

if [ "$1" == "--login" ] || [ "$1" == "-l" ]; then
  echo "=== Opening Interactive Browser for One-Time Login ==="
  echo "Log into your account (Google Gemini, ChatGPT, or Claude)."
  echo "Once logged in, your session is saved to $PROFILE_DIR."
  echo "Close the window when done, then run './launch-headless.sh' to run invisibly."
  echo ""
  "$CHROME_BIN" \
    --user-data-dir="$PROFILE_DIR" \
    --load-extension="$EXT_DIR" \
    --disable-extensions-except="$EXT_DIR" \
    "$TARGET_URL"
  exit 0
fi

if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
  echo "Usage: ./launch-headless.sh [OPTIONS] [URL]"
  echo ""
  echo "Options:"
  echo "  --login, -l      Open visible window once to log into your webchat account"
  echo "  --help, -h       Display this help message"
  echo ""
  echo "URLs:"
  echo "  https://gemini.google.com (default)"
  echo "  https://chatgpt.com"
  echo "  https://claude.ai"
  echo ""
  echo "Examples:"
  echo "  ./launch-headless.sh --login              # First time: login"
  echo "  ./launch-headless.sh                      # Runs invisibly in the background"
  echo "  ./launch-headless.sh --login https://claude.ai"
  exit 0
fi

echo "=== Launching Gemini Bridge Headless Background Daemon ==="
echo "Binary:    $CHROME_BIN"
echo "Extension: $EXT_DIR"
echo "Profile:   $PROFILE_DIR"
echo "URL:       $TARGET_URL"
echo ""

nohup "$CHROME_BIN" \
  --headless=new \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  --user-data-dir="$PROFILE_DIR" \
  --load-extension="$EXT_DIR" \
  --disable-extensions-except="$EXT_DIR" \
  "$TARGET_URL" > /dev/null 2>&1 &

CHROME_PID=$!
echo "✓ Headless Chrome daemon running in background (PID: $CHROME_PID)"
echo "You can now run 'npm start' to start the CLI orchestrator."
echo "To terminate the background browser: kill $CHROME_PID"
