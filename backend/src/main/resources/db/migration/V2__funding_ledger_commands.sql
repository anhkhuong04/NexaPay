CREATE TABLE demo_environment (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    epoch UUID NOT NULL DEFAULT gen_random_uuid(),
    issuance_account_id UUID NOT NULL UNIQUE REFERENCES ledger_accounts(id)
);
CREATE UNIQUE INDEX one_demo_issuance ON ledger_accounts(account_type) WHERE account_type = 'DEMO_ISSUANCE';
WITH account AS (
    INSERT INTO ledger_accounts(id, account_type) VALUES(gen_random_uuid(), 'DEMO_ISSUANCE') RETURNING id
) INSERT INTO demo_environment(issuance_account_id) SELECT id FROM account;

CREATE TABLE ledger_transactions (
    id UUID PRIMARY KEY,
    operation_type VARCHAR(32) NOT NULL,
    operation_id UUID NOT NULL,
    currency VARCHAR(3) NOT NULL CHECK(currency = 'VND'),
    status VARCHAR(16) NOT NULL DEFAULT 'POSTED' CHECK(status = 'POSTED'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    created_xid XID8 NOT NULL DEFAULT pg_current_xact_id(),
    UNIQUE(operation_type, operation_id),
    UNIQUE(id, currency)
);
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY,
    transaction_id UUID NOT NULL,
    account_id UUID NOT NULL,
    currency VARCHAR(3) NOT NULL CHECK(currency = 'VND'),
    amount BIGINT NOT NULL CHECK(amount <> 0),
    FOREIGN KEY(transaction_id, currency) REFERENCES ledger_transactions(id, currency),
    FOREIGN KEY(account_id, currency) REFERENCES ledger_accounts(id, currency),
    UNIQUE(transaction_id, account_id)
);
CREATE INDEX entries_account ON ledger_entries(account_id);

-- SELECT FOR UPDATE requires an UPDATE privilege in PostgreSQL. Expose only a
-- row-lock capability rather than grant runtime permission to edit account data.
CREATE FUNCTION lock_ledger_account(target UUID)
RETURNS TABLE(id UUID,account_type VARCHAR,status VARCHAR,posted_balance BIGINT)
LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT a.id,a.account_type,a.status,a.posted_balance FROM public.ledger_accounts a WHERE a.id=target FOR UPDATE
$$;
REVOKE ALL ON FUNCTION lock_ledger_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_ledger_account(UUID) TO nexapay_app;

CREATE FUNCTION immutable_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Posted journal is immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER immutable_transactions BEFORE UPDATE OR DELETE ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION immutable_journal();
CREATE TRIGGER immutable_entries BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION immutable_journal();

CREATE FUNCTION apply_ledger_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.ledger_transactions
        WHERE id = NEW.transaction_id AND created_xid = pg_current_xact_id()) THEN
        RAISE EXCEPTION 'Cannot append to an older journal' USING ERRCODE = '23514';
    END IF;
    UPDATE public.ledger_accounts SET posted_balance = posted_balance + NEW.amount
    WHERE id = NEW.account_id AND currency = NEW.currency;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account currency mismatch' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER apply_entry BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION apply_ledger_entry();

CREATE FUNCTION balanced_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal UUID; n BIGINT; total NUMERIC;
BEGIN
    IF TG_TABLE_NAME = 'ledger_transactions' THEN journal := NEW.id; ELSE journal := NEW.transaction_id; END IF;
    SELECT count(*), coalesce(sum(amount::numeric),0) INTO n,total FROM ledger_entries WHERE transaction_id=journal;
    IF n < 2 OR total <> 0 THEN
        RAISE EXCEPTION 'Journal must contain at least two balanced entries' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER balanced_header AFTER INSERT ON ledger_transactions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION balanced_journal();
CREATE CONSTRAINT TRIGGER balanced_entries AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION balanced_journal();

CREATE TABLE money_commands (
    id UUID PRIMARY KEY,
    actor_id UUID NOT NULL REFERENCES users(id),
    operation_type VARCHAR(32) NOT NULL,
    command_key UUID NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    resource_id UUID,
    status VARCHAR(16) NOT NULL CHECK(status IN ('IN_PROGRESS','SUCCEEDED','FAILED')),
    http_status INTEGER,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    created_xid XID8 NOT NULL DEFAULT pg_current_xact_id(),
    UNIQUE(actor_id, operation_type, command_key)
);
CREATE INDEX command_recent ON money_commands(actor_id, created_at DESC, id DESC);
CREATE TABLE demo_fundings (
    id UUID PRIMARY KEY,
    command_id UUID NOT NULL UNIQUE REFERENCES money_commands(id),
    actor_id UUID NOT NULL REFERENCES users(id),
    account_id UUID NOT NULL REFERENCES ledger_accounts(id),
    amount BIGINT NOT NULL CHECK(amount = 100000),
    currency VARCHAR(3) NOT NULL CHECK(currency = 'VND'),
    status VARCHAR(16) NOT NULL CHECK(status IN ('SUCCEEDED','FAILED')),
    ledger_transaction_id UUID UNIQUE REFERENCES ledger_transactions(id),
    error_code VARCHAR(48),
    created_at TIMESTAMPTZ NOT NULL,
    CHECK ((status = 'SUCCEEDED' AND ledger_transaction_id IS NOT NULL AND error_code IS NULL)
        OR (status = 'FAILED' AND ledger_transaction_id IS NULL AND error_code IS NOT NULL))
);
CREATE TABLE funding_quotas (
    scope VARCHAR(16) NOT NULL CHECK(scope IN ('ENVIRONMENT','USER')),
    subject UUID NOT NULL,
    utc_date DATE NOT NULL,
    spent BIGINT NOT NULL DEFAULT 0 CHECK(spent >= 0 AND
        ((scope='ENVIRONMENT' AND spent <= 50000000) OR (scope='USER' AND spent <= 500000))),
    PRIMARY KEY(scope,subject,utc_date)
);
CREATE FUNCTION protect_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' OR OLD.created_xid <> pg_current_xact_id() THEN
        RAISE EXCEPTION 'Terminal commands are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER protect_command BEFORE UPDATE OR DELETE ON money_commands FOR EACH ROW EXECUTE FUNCTION protect_command();
CREATE TRIGGER immutable_fundings BEFORE UPDATE OR DELETE ON demo_fundings FOR EACH ROW EXECUTE FUNCTION immutable_journal();
CREATE FUNCTION terminal_command() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c money_commands;
BEGIN
    SELECT * INTO c FROM money_commands WHERE id=NEW.id;
    IF c.status='IN_PROGRESS' OR c.payload IS NULL OR
       c.http_status IS DISTINCT FROM (CASE WHEN c.status='SUCCEEDED' THEN 201 ELSE 422 END) OR
       NOT EXISTS(SELECT 1 FROM demo_fundings f WHERE f.id=c.resource_id AND f.command_id=c.id
           AND f.status=c.status AND f.actor_id=c.actor_id AND
           (f.status='FAILED' OR EXISTS(SELECT 1 FROM ledger_transactions l WHERE l.id=f.ledger_transaction_id
               AND l.operation_type='DEMO_FUNDING' AND l.operation_id=f.id))) THEN
        RAISE EXCEPTION 'P0 command must commit a terminal linked result' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER terminal_command AFTER INSERT OR UPDATE ON money_commands
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION terminal_command();

REVOKE ALL ON FUNCTION apply_ledger_entry() FROM PUBLIC;
GRANT SELECT ON demo_environment, ledger_transactions, ledger_entries, money_commands, demo_fundings, funding_quotas TO nexapay_app;
GRANT INSERT (id,operation_type,operation_id,currency) ON ledger_transactions TO nexapay_app;
GRANT INSERT ON ledger_entries, money_commands, demo_fundings, funding_quotas TO nexapay_app;
GRANT UPDATE(resource_id,status,http_status,payload) ON money_commands TO nexapay_app;
GRANT UPDATE(spent) ON funding_quotas TO nexapay_app;

CREATE FUNCTION reconciliation_findings() RETURNS TABLE(check_name TEXT,resource_id TEXT)
LANGUAGE SQL STABLE AS $$
    SELECT 'projection',a.id::text FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id
    GROUP BY a.id HAVING a.posted_balance::numeric <> coalesce(sum(e.amount::numeric),0)
    UNION ALL
    SELECT 'journal',t.id::text FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.transaction_id=t.id
    GROUP BY t.id HAVING count(e.id)<2 OR coalesce(sum(e.amount::numeric),0)<>0 OR count(*) FILTER(WHERE e.currency<>t.currency)>0
    UNION ALL
    SELECT 'funding_link',f.id::text FROM demo_fundings f LEFT JOIN ledger_transactions t
    ON t.operation_type='DEMO_FUNDING' AND t.operation_id=f.id
    WHERE (f.status='SUCCEEDED' AND (t.id IS NULL OR t.id IS DISTINCT FROM f.ledger_transaction_id))
       OR (f.status='FAILED' AND t.id IS NOT NULL)
    UNION ALL
    SELECT 'orphan_posting',t.id::text FROM ledger_transactions t LEFT JOIN demo_fundings f ON f.id=t.operation_id
    WHERE t.operation_type='DEMO_FUNDING' AND (f.id IS NULL OR f.status<>'SUCCEEDED')
    UNION ALL
    SELECT 'command_link',c.id::text FROM money_commands c LEFT JOIN demo_fundings f ON f.command_id=c.id
    WHERE c.status='IN_PROGRESS' OR f.id IS NULL OR f.status<>c.status OR c.resource_id IS DISTINCT FROM f.id
    UNION ALL
    SELECT 'quota',coalesce(actual.scope,expected.scope)||':'||coalesce(actual.subject,expected.subject)::text||':'||coalesce(actual.utc_date,expected.utc_date)::text
    FROM funding_quotas actual FULL JOIN (
        SELECT 'USER'::varchar AS scope,actor_id AS subject,(created_at AT TIME ZONE 'UTC')::date AS utc_date,sum(amount::numeric) AS spent
        FROM demo_fundings WHERE status='SUCCEEDED' GROUP BY actor_id,(created_at AT TIME ZONE 'UTC')::date
        UNION ALL
        SELECT 'ENVIRONMENT'::varchar,(SELECT epoch FROM demo_environment),(created_at AT TIME ZONE 'UTC')::date,sum(amount::numeric)
        FROM demo_fundings WHERE status='SUCCEEDED' GROUP BY (created_at AT TIME ZONE 'UTC')::date
    ) expected USING(scope,subject,utc_date) WHERE coalesce(actual.spent::numeric,0)<>coalesce(expected.spent,0)
    UNION ALL
    SELECT 'issuance',a.id::text FROM demo_environment d JOIN ledger_accounts a ON a.id=d.issuance_account_id
    WHERE a.posted_balance::numeric<>-(SELECT coalesce(sum(amount::numeric),0) FROM demo_fundings WHERE status='SUCCEEDED')
    UNION ALL
    SELECT 'customer_limit',id::text FROM ledger_accounts WHERE account_type='PERSONAL' AND posted_balance NOT BETWEEN 0 AND 1000000000000
$$;
