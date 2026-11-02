-- Additive P0-03: immutable terminal transfers and deferred operation linkage.
CREATE TABLE transfers (
    id UUID PRIMARY KEY,
    command_id UUID NOT NULL UNIQUE REFERENCES money_commands(id),
    actor_id UUID NOT NULL REFERENCES users(id),
    source_wallet_id UUID NOT NULL REFERENCES wallets(id),
    source_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
    destination_wallet_id UUID NOT NULL,
    destination_account_id UUID REFERENCES ledger_accounts(id),
    sender_name VARCHAR(80) NOT NULL,
    recipient_name VARCHAR(80) NOT NULL,
    amount BIGINT NOT NULL CHECK(amount BETWEEN 1 AND 100000000),
    currency VARCHAR(3) NOT NULL CHECK(currency='VND'),
    note VARCHAR(140) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL CHECK(status IN ('SUCCEEDED','FAILED')),
    ledger_transaction_id UUID UNIQUE REFERENCES ledger_transactions(id),
    error_code VARCHAR(48),
    created_at TIMESTAMPTZ NOT NULL,
    CHECK ((status='SUCCEEDED' AND ledger_transaction_id IS NOT NULL AND error_code IS NULL
        AND destination_account_id IS NOT NULL AND source_account_id<>destination_account_id)
        OR (status='FAILED' AND ledger_transaction_id IS NULL AND error_code IS NOT NULL))
);
CREATE INDEX transfers_actor_recent ON transfers(actor_id,created_at DESC,id DESC);
CREATE INDEX transfers_recipient_recent ON transfers(destination_wallet_id,created_at DESC,id DESC) WHERE status='SUCCEEDED';
CREATE INDEX fundings_actor_recent ON demo_fundings(actor_id,created_at DESC,id DESC);
CREATE TRIGGER immutable_transfers BEFORE UPDATE OR DELETE ON transfers FOR EACH ROW EXECUTE FUNCTION immutable_journal();
GRANT SELECT,INSERT ON transfers TO nexapay_app;

CREATE OR REPLACE FUNCTION terminal_command() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c money_commands; linked BOOLEAN;
BEGIN
    SELECT * INTO c FROM money_commands WHERE id=NEW.id;
    IF c.operation_type='DEMO_FUNDING' THEN
        SELECT EXISTS(SELECT 1 FROM demo_fundings f WHERE f.id=c.resource_id AND f.command_id=c.id
            AND f.status=c.status AND f.actor_id=c.actor_id AND
            (f.status='FAILED' OR EXISTS(SELECT 1 FROM ledger_transactions l WHERE l.id=f.ledger_transaction_id
                AND l.operation_type='DEMO_FUNDING' AND l.operation_id=f.id))) INTO linked;
    ELSIF c.operation_type='TRANSFER' THEN
        SELECT EXISTS(SELECT 1 FROM transfers t JOIN wallets w ON w.id=t.source_wallet_id
            WHERE t.id=c.resource_id AND t.command_id=c.id AND t.status=c.status AND t.actor_id=c.actor_id
            AND w.user_id=t.actor_id AND w.ledger_account_id=t.source_account_id
            AND (t.status='FAILED' OR (
                EXISTS(SELECT 1 FROM wallets d WHERE d.id=t.destination_wallet_id AND d.ledger_account_id=t.destination_account_id)
                AND EXISTS(SELECT 1 FROM ledger_transactions l WHERE l.id=t.ledger_transaction_id AND l.operation_type='TRANSFER' AND l.operation_id=t.id)
                AND (SELECT count(*) FROM ledger_entries e WHERE e.transaction_id=t.ledger_transaction_id)=2
                AND EXISTS(SELECT 1 FROM ledger_entries e WHERE e.transaction_id=t.ledger_transaction_id AND e.account_id=t.source_account_id AND e.amount=-t.amount)
                AND EXISTS(SELECT 1 FROM ledger_entries e WHERE e.transaction_id=t.ledger_transaction_id AND e.account_id=t.destination_account_id AND e.amount=t.amount)))) INTO linked;
    ELSE linked:=FALSE;
    END IF;
    IF c.status='IN_PROGRESS' OR c.payload IS NULL OR
       c.http_status IS DISTINCT FROM (CASE WHEN c.status='SUCCEEDED' THEN 201 ELSE 422 END)
       OR linked IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'P0 command must commit a terminal linked result' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END $$;

-- Guard the resource insertion too: a terminal command cannot acquire extra
-- resources later, and no transfer resource can exist without its matching claim.
CREATE FUNCTION linked_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c money_commands;
BEGIN
    SELECT * INTO c FROM money_commands WHERE id=NEW.command_id;
    IF c.created_xid<>pg_current_xact_id() OR c.operation_type<>'TRANSFER'
       OR c.resource_id IS DISTINCT FROM NEW.id OR c.status<>NEW.status OR c.actor_id<>NEW.actor_id THEN
        RAISE EXCEPTION 'Transfer requires its own terminal command transaction' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER linked_transfer AFTER INSERT ON transfers
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION linked_transfer();

CREATE OR REPLACE FUNCTION reconciliation_findings() RETURNS TABLE(check_name TEXT,resource_id TEXT)
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
       OR (f.status='SUCCEEDED' AND (
           (SELECT count(*) FROM ledger_entries e WHERE e.transaction_id=t.id)<>2 OR
           NOT EXISTS(SELECT 1 FROM ledger_entries e WHERE e.transaction_id=t.id AND e.account_id=f.account_id AND e.amount=f.amount) OR
           NOT EXISTS(SELECT 1 FROM ledger_entries e WHERE e.transaction_id=t.id AND e.account_id=(SELECT issuance_account_id FROM demo_environment) AND e.amount=-f.amount)))
    UNION ALL
    SELECT 'orphan_posting',t.id::text FROM ledger_transactions t LEFT JOIN demo_fundings f ON f.id=t.operation_id
    WHERE t.operation_type='DEMO_FUNDING' AND (f.id IS NULL OR f.status<>'SUCCEEDED')
    UNION ALL
    SELECT 'command_link',c.id::text FROM money_commands c
    LEFT JOIN demo_fundings f ON f.command_id=c.id AND c.operation_type='DEMO_FUNDING'
    LEFT JOIN transfers x ON x.command_id=c.id AND c.operation_type='TRANSFER'
    WHERE c.status='IN_PROGRESS' OR c.payload IS NULL OR c.http_status IS DISTINCT FROM (CASE WHEN c.status='SUCCEEDED' THEN 201 ELSE 422 END)
       OR (c.operation_type='DEMO_FUNDING' AND (f.id IS NULL OR f.status<>c.status OR c.resource_id IS DISTINCT FROM f.id OR c.actor_id IS DISTINCT FROM f.actor_id))
       OR (c.operation_type='TRANSFER' AND (x.id IS NULL OR x.status<>c.status OR c.resource_id IS DISTINCT FROM x.id OR c.actor_id IS DISTINCT FROM x.actor_id))
       OR c.operation_type NOT IN ('DEMO_FUNDING','TRANSFER')
    UNION ALL
    SELECT 'transfer_link',x.id::text FROM transfers x LEFT JOIN ledger_transactions l ON l.operation_type='TRANSFER' AND l.operation_id=x.id
    WHERE (x.status='FAILED' AND l.id IS NOT NULL)
       OR (x.status='SUCCEEDED' AND (l.id IS DISTINCT FROM x.ledger_transaction_id
           OR (SELECT count(*) FROM ledger_entries e WHERE e.transaction_id=l.id)<>2
           OR NOT EXISTS(SELECT 1 FROM ledger_entries e WHERE e.transaction_id=l.id AND e.account_id=x.source_account_id AND e.amount=-x.amount)
           OR NOT EXISTS(SELECT 1 FROM ledger_entries e WHERE e.transaction_id=l.id AND e.account_id=x.destination_account_id AND e.amount=x.amount)))
    UNION ALL
    SELECT 'orphan_transfer_posting',l.id::text FROM ledger_transactions l LEFT JOIN transfers x ON x.id=l.operation_id
    WHERE l.operation_type='TRANSFER' AND (x.id IS NULL OR x.status<>'SUCCEEDED')
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
