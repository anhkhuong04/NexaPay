CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
    password_hash VARCHAR(100) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(20) NOT NULL CHECK (role IN ('INDIVIDUAL', 'MERCHANT', 'ADMIN')),
    PRIMARY KEY (user_id, role)
);
CREATE TABLE profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    display_name VARCHAR(80) NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE ledger_accounts (
    id UUID PRIMARY KEY,
    account_type VARCHAR(24) NOT NULL CHECK (account_type IN ('PERSONAL', 'DEMO_ISSUANCE')),
    currency VARCHAR(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
    posted_balance BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, currency),
    CHECK (account_type <> 'PERSONAL' OR posted_balance BETWEEN 0 AND 1000000000000)
);
CREATE TABLE wallets (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    ledger_account_id UUID NOT NULL UNIQUE,
    currency VARCHAR(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, currency),
    FOREIGN KEY (ledger_account_id, currency) REFERENCES ledger_accounts(id, currency)
);
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    actor_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(64) NOT NULL,
    resource_id UUID NOT NULL,
    outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('SUCCEEDED', 'FAILED')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    correlation_id VARCHAR(36) NOT NULL
);
CREATE INDEX audit_actor_time ON audit_events(actor_id, occurred_at DESC, id DESC);

-- Migration owner creates schema; runtime role cannot administer it or edit audit/money.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nexapay_app;
GRANT SELECT ON users, user_roles, profiles, ledger_accounts, wallets, audit_events TO nexapay_app;
GRANT INSERT ON users, user_roles, profiles, wallets, audit_events TO nexapay_app;
GRANT UPDATE (display_name, updated_at) ON profiles TO nexapay_app;
-- Opening projection is always the DB default zero. No runtime balance INSERT/UPDATE grant.
GRANT INSERT (id, account_type, currency, status) ON ledger_accounts TO nexapay_app;
