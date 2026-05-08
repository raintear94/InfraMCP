$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js was not found. Please install Node.js 20 or later."
  exit 1
}
if (-not (Test-Path -LiteralPath "node_modules/@modelcontextprotocol/sdk/package.json")) {
  Write-Host "Runtime dependencies are missing or incomplete. Installing dependencies..."
  npm install --omit=dev
}
node dist/index.js
