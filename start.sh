#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Please install Node.js 20 or later."
  exit 1
fi

if [ ! -f "node_modules/@modelcontextprotocol/sdk/package.json" ]; then
  echo "Runtime dependencies are missing or incomplete. Installing dependencies..."
  if ! npm install --omit=dev; then
    echo "Dependency installation failed. Please check your network or npm configuration."
    exit 1
  fi
fi

node dist/index.js
