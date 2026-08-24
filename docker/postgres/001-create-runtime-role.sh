#!/bin/sh
set -eu

if [ -z "${POSTGRES_APP_PASSWORD:-}" ]; then
  echo "POSTGRES_APP_PASSWORD is required" >&2
  exit 1
fi

POSTGRES_APP_USER=queueforge_app

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_user="$POSTGRES_APP_USER" \
  --set=app_password="$POSTGRES_APP_PASSWORD" <<-'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user')
\gexec

SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user')
\gexec
EOSQL
