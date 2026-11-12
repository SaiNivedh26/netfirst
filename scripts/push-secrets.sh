#!/usr/bin/env bash
# Loads .env files into AWS Secrets Manager as two secrets.
# NEVER prints secret values — uses temp files and immediate deletion.
set -euo pipefail

PROFILE="sai-nivedh-26"
REGION="us-east-1"
API_ENV="/home/sai-nivedh-26/paypal/netfirst/api/.env"
AGGRID_ENV="/home/sai-nivedh-26/paypal/hackathon-paypal-ag-grid-boilerplate/.env.local"

upsert_secret() {
  local name="$1"
  local env_file="$2"

  if [ ! -f "$env_file" ]; then
    echo "WARNING: $env_file not found, skipping $name"
    return
  fi

  # Build JSON object from env file (skip comments and empty lines)
  local tmp
  tmp=$(mktemp)
  python3 -c "
import json, sys
result = {}
with open('$env_file') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' in line:
            k, _, v = line.partition('=')
            result[k.strip()] = v.strip().strip('\"').strip(\"'\")
print(json.dumps(result))
" > "$tmp"

  # Check if secret exists
  if aws secretsmanager describe-secret --secret-id "$name" --region "$REGION" --profile "$PROFILE" &>/dev/null; then
    echo "Updating secret: $name"
    aws secretsmanager put-secret-value \
      --secret-id "$name" \
      --secret-string "file://$tmp" \
      --region "$REGION" \
      --profile "$PROFILE" > /dev/null
  else
    echo "Creating secret: $name"
    aws secretsmanager create-secret \
      --name "$name" \
      --secret-string "file://$tmp" \
      --region "$REGION" \
      --profile "$PROFILE" > /dev/null
  fi

  rm -f "$tmp"
  echo "Done: $name"
}

upsert_secret "netfirst/api" "$API_ENV"
upsert_secret "netfirst/aggrid" "$AGGRID_ENV"

echo ""
echo "Secrets pushed to AWS Secrets Manager (us-east-1):"
echo "  netfirst/api"
echo "  netfirst/aggrid"
