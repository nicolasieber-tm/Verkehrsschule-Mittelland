#!/usr/bin/env bash
# Run create-admin against the production Postgres (via Railway public proxy).
# Usage: bash scripts/prod-admin.sh   (interactive — prompts for password)
#        ADMIN_EMAIL=foo@bar.ch bash scripts/prod-admin.sh
set -e
cd "$(dirname "$0")/.."

if ! command -v railway >/dev/null 2>&1; then
  echo "railway CLI not found"; exit 1
fi

echo "→ Hole DATABASE_PUBLIC_URL von Railway..."
JSON=$(railway variables --service Postgres --json)
URL=$(node -e "console.log(JSON.parse(process.argv[1]).DATABASE_PUBLIC_URL || '')" "$JSON")
if [ -z "$URL" ]; then
  echo "✗ Konnte DATABASE_PUBLIC_URL nicht ermitteln. Bist du im richtigen Railway-Projekt? (railway status)"
  exit 1
fi
echo "→ Verbunden mit Production-Postgres."
DATABASE_URL="$URL" npm run create-admin
