#!/usr/bin/env bash
# verify-deploy.sh — sanity check the deployed pz-crcon instance.
#
# Usage: bash scripts/verify-deploy.sh [base-url]
# Defaults to https://pz.majorluk.pl.

set -euo pipefail

URL="${1:-https://pz.majorluk.pl}"
echo "==> GET ${URL}/api/status"
out=$(curl -fsS "${URL}/api/status")
echo "${out}"
echo "${out}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'online' in d, 'response missing \"online\" field'
print('OK:', d.get('serverName', '?'),
      'online=', d.get('online'),
      'players=', (d.get('players') or {}).get('count', '?'))
"
