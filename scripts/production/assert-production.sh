#!/usr/bin/env bash
# Proves the Supabase CLI is linked to PRODUCTION before a command that changes it (docs/PRODUCTION-HANDOFF-YONI.md).
#
#   bash scripts/production/assert-production.sh <PRODUCTION_SUPABASE_REF> && <the command>
#
# Exits non-zero — so "&& <the command>" does not run — unless ALL hold:
#   - the ref you typed is a 20-character Supabase project ref;
#   - it is NOT the staging project;
#   - the CLI in this folder is linked to exactly that ref.
set -u
STAGING_REF="qpjwnxptitnmtsznjvkw"
PROD_REF="${1:-}"
LINKED="$(cat supabase/.temp/project-ref 2>/dev/null || true)"

echo "STAGING:     ref ${STAGING_REF} (never touched by these steps)"
echo "PRODUCTION:  ref ${PROD_REF:-<none typed>}"
echo "CLI linked:  ref ${LINKED:-<not linked>}"

if ! [[ "$PROD_REF" =~ ^[a-z0-9]{20}$ ]]; then
  echo "STOP — type the production ref from Supabase → Project Settings → General → Reference ID."; exit 1
fi
if [ "$PROD_REF" = "$STAGING_REF" ]; then
  echo "STOP — that is the STAGING project. Production and staging are never the same."; exit 1
fi
if [ "$LINKED" != "$PROD_REF" ]; then
  echo "STOP — the CLI is not linked to production. Run: npx supabase link --project-ref $PROD_REF"; exit 1
fi
echo "OK — linked to PRODUCTION ${PROD_REF}."
