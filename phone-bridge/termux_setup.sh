#!/data/data/com.termux/files/usr/bin/bash
# Script to configure Android Termux for Phone System 1 microservice

set -e

echo "=== Termux Phone System 1 Setup ==="
pkg update -y
pkg install -y nodejs-lts git termux-tools curl

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

mkdir -p ~/phone-bridge
cp phone_laya_server.js ~/phone-bridge/ 2>/dev/null || true

echo ""
echo "Setup complete. Start the server on your phone with:"
echo "  node ~/phone-bridge/phone_laya_server.js"
