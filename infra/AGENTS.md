# Infrastructure instructions

Follow root AGENTS.md. One instance serves SPA/API at one origin; PostgreSQL stays
on the Compose network. Local-only DB port binds 127.0.0.1. Keep owner/app roles
separate, never commit real credentials. `.env.example` is for local simulation.
From root: `docker compose --env-file .env -f infra/compose.yaml --profile app up --build -d`.
For local backend development omit the app profile and start `db` only.
Validate with `docker compose --env-file .env -f infra/compose.yaml config --quiet`.
Never delete volumes or reset data without task-specific authorization.
