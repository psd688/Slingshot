#!/bin/bash

# Change directory to the folder where this script is located
cd "$(dirname "$0")"

echo "================================================================="
echo "       🚀 PIXAZON SLINGSHOT INTERACTIVE WALL (MAC LAUNCHER)      "
echo "================================================================="
echo ""

# 1. Determine which Node binary to use (System node or Bundled portable node)
NODE_CMD=""

if command -v node >/dev/null 2>&1; then
    NODE_CMD="node"
    echo "  [✓] Found System Node.js: $(node -v)"
else
    ARCH=$(uname -m)
    echo "  [*] System Node.js not detected. Using bundled portable Node runtime..."
    echo "  [*] Detected Mac Architecture: $ARCH"

    if [ "$ARCH" = "arm64" ]; then
        NODE_BIN="./bin/node-darwin-arm64"
    else
        NODE_BIN="./bin/node-darwin-x64"
    fi

    if [ -f "$NODE_BIN" ]; then
        chmod +x "$NODE_BIN"
        NODE_CMD="$NODE_BIN"
        echo "  [✓] Using bundled: $NODE_BIN"
    else
        echo "  [!] ERROR: Bundled Node binary not found at $NODE_BIN"
        echo "      Please install Node.js from https://nodejs.org/"
        read -p "Press Enter to exit..."
        exit 1
    fi
fi

# 2. Kill any stale server on port 3000 if running
lsof -ti:3000 | xargs kill -9 >/dev/null 2>&1
lsof -ti:3443 | xargs kill -9 >/dev/null 2>&1

echo "  [*] Starting Slingshot Server..."
$NODE_CMD server.js &
SERVER_PID=$!

# Ensure server stops cleanly when terminal is closed
trap "echo ''; echo 'Shutting down Slingshot Server...'; kill $SERVER_PID 2>/dev/null; exit 0" INT TERM EXIT

# Wait for server to initialize
sleep 2

# 3. Automatically open TV Wall in default browser
echo "  [*] Opening TV Display Wall in Browser..."
open "http://localhost:3000/tv.html"

echo ""
echo "================================================================="
echo "  📺 TV Display Wall:    http://localhost:3000/tv.html"
echo "  📱 Phone Controller:   Open the QR code shown on the TV wall"
echo "                         or use the HTTPS address shown above"
echo "================================================================="
echo "  Leave this window OPEN while running the event."
echo "  Press Ctrl+C or close this window to stop the server."
echo "================================================================="
echo ""

# Wait on background server process
wait $SERVER_PID

