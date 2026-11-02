#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$DB_APP_PASSWORD" <<'SQL'
CREATE ROLE nexapay_app LOGIN PASSWORD :'app_password';
SQL
