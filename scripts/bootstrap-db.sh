#!/usr/bin/env bash
# bootstrap-db.sh — idempotent Postgres bootstrap for pz-crcon.
#
# Creates the `pzcrcon_user` role and `pzcrcon` database on the existing
# shared-postgres container on HomePL. Safe to re-run; skips creation if
# the role/db already exist.
#
# Required env vars:
#   PG_SUPERUSER_PASSWORD  — postgres superuser password (workspace .env)
#   PZ_DB_PASSWORD         — new password for pzcrcon_user (generate fresh)
#
# Optional env vars:
#   PG_CONTAINER  (default: shared-postgres)
#   PG_SUPERUSER  (default: postgres)
#   PZ_DB_USER    (default: pzcrcon_user)
#   PZ_DB_NAME    (default: pzcrcon)

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-shared-postgres}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
PZ_DB_USER="${PZ_DB_USER:-pzcrcon_user}"
PZ_DB_NAME="${PZ_DB_NAME:-pzcrcon}"

if [[ -z "${PG_SUPERUSER_PASSWORD:-}" ]]; then
  echo "ERROR: PG_SUPERUSER_PASSWORD not set" >&2
  exit 1
fi
if [[ -z "${PZ_DB_PASSWORD:-}" ]]; then
  echo "ERROR: PZ_DB_PASSWORD not set" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
  echo "ERROR: container '${PG_CONTAINER}' is not running" >&2
  exit 1
fi

run_psql() {
  docker exec -e PGPASSWORD="${PG_SUPERUSER_PASSWORD}" -i "${PG_CONTAINER}" \
    psql -v ON_ERROR_STOP=1 -U "${PG_SUPERUSER}" -d postgres "$@"
}

run_psql_db() {
  local db="$1"; shift
  docker exec -e PGPASSWORD="${PG_SUPERUSER_PASSWORD}" -i "${PG_CONTAINER}" \
    psql -v ON_ERROR_STOP=1 -U "${PG_SUPERUSER}" -d "${db}" "$@"
}

echo "==> bootstrapping pz-crcon DB on container '${PG_CONTAINER}'"

# 1. Create role if missing; always (re)set password to PZ_DB_PASSWORD
echo "==> ensuring role '${PZ_DB_USER}' exists"
run_psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PZ_DB_USER}') THEN
    CREATE ROLE ${PZ_DB_USER} LOGIN PASSWORD '${PZ_DB_PASSWORD}';
    RAISE NOTICE 'created role ${PZ_DB_USER}';
  ELSE
    ALTER ROLE ${PZ_DB_USER} WITH LOGIN PASSWORD '${PZ_DB_PASSWORD}';
    RAISE NOTICE 'role ${PZ_DB_USER} already exists; password updated';
  END IF;
END
\$\$;
SQL

# 2. Create database if missing (cannot wrap CREATE DATABASE in DO block)
echo "==> ensuring database '${PZ_DB_NAME}' exists"
DB_EXISTS=$(run_psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${PZ_DB_NAME}'" || true)
if [[ "${DB_EXISTS}" == "1" ]]; then
  echo "    database ${PZ_DB_NAME} already exists"
else
  run_psql -c "CREATE DATABASE ${PZ_DB_NAME} OWNER ${PZ_DB_USER};"
  echo "    created database ${PZ_DB_NAME}"
fi

# 3. Grants (idempotent)
echo "==> granting privileges"
run_psql -c "GRANT ALL PRIVILEGES ON DATABASE ${PZ_DB_NAME} TO ${PZ_DB_USER};"
run_psql_db "${PZ_DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${PZ_DB_USER};"
run_psql_db "${PZ_DB_NAME}" -c "ALTER SCHEMA public OWNER TO ${PZ_DB_USER};"

echo "==> done. DATABASE_URL example:"
echo "    postgresql://${PZ_DB_USER}:<PZ_DB_PASSWORD>@shared-postgres:5432/${PZ_DB_NAME}"
