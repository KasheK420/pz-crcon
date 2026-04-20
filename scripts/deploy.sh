#!/usr/bin/env bash
# deploy.sh — copy production compose + bootstrap script to HomePL.
#
# Run from the repo root on your local machine. Requires SSH access.

set -euo pipefail

SSH_HOST="${SSH_HOST:-85.215.222.81}"
SSH_PORT="${SSH_PORT:-2222}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_DIR="${REMOTE_DIR:-/opt/docker/pz-crcon}"

SSH="ssh -p ${SSH_PORT} -i ${SSH_KEY} root@${SSH_HOST}"
SCP="scp -P ${SSH_PORT} -i ${SSH_KEY}"

echo "==> ensuring ${REMOTE_DIR} exists on ${SSH_HOST}"
$SSH "mkdir -p ${REMOTE_DIR}"

echo "==> copying docker-compose.yml"
$SCP docker/docker-compose.deploy.yml "root@${SSH_HOST}:${REMOTE_DIR}/docker-compose.yml"

echo "==> copying bootstrap-db.sh"
$SCP scripts/bootstrap-db.sh "root@${SSH_HOST}:${REMOTE_DIR}/bootstrap-db.sh"
$SSH "chmod +x ${REMOTE_DIR}/bootstrap-db.sh"

echo
echo "==> next steps on the server:"
echo "    1. cd ${REMOTE_DIR}"
echo "    2. cp /path/to/your/.env .env   # or edit in place"
echo "    3. PG_SUPERUSER_PASSWORD=... PZ_DB_PASSWORD=... ./bootstrap-db.sh"
echo "    4. docker compose pull && docker compose up -d"
echo "    5. docker exec -it pz-crcon npx prisma migrate deploy"
echo "    6. bash scripts/verify-deploy.sh https://pz.majorluk.pl"
