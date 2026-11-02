-- Exclusive ownership; preserve existing personal wallets and posted history.
CREATE TABLE merchants (
 id UUID PRIMARY KEY,
 display_name VARCHAR(80) NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 80),
 status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','LOCKED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE merchant_memberships (
 merchant_id UUID PRIMARY KEY REFERENCES merchants(id),
 user_id UUID NOT NULL UNIQUE REFERENCES users(id),
 role VARCHAR(16) NOT NULL DEFAULT 'OWNER' CHECK(role='OWNER')
);
ALTER TABLE wallets ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE wallets ADD COLUMN merchant_id UUID UNIQUE REFERENCES merchants(id);
ALTER TABLE wallets ADD CONSTRAINT wallet_exclusive_owner CHECK((user_id IS NULL) <> (merchant_id IS NULL));
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_account_type_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_account_types CHECK(account_type IN ('PERSONAL','MERCHANT','DEMO_ISSUANCE'));
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT customer_balance_limit CHECK(account_type NOT IN ('PERSONAL','MERCHANT') OR posted_balance BETWEEN 0 AND 1000000000000);

CREATE FUNCTION wallet_account_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ledger_accounts a WHERE a.id=NEW.ledger_account_id
   AND a.currency=NEW.currency AND a.account_type=CASE WHEN NEW.user_id IS NOT NULL THEN 'PERSONAL' ELSE 'MERCHANT' END) THEN
   RAISE EXCEPTION 'Wallet ownership/account type mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER wallet_account_kind AFTER INSERT ON wallets
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_account_kind();
CREATE TRIGGER immutable_wallet_ownership BEFORE UPDATE OR DELETE ON wallets FOR EACH ROW EXECUTE FUNCTION immutable_journal();
CREATE TRIGGER immutable_merchant_membership BEFORE UPDATE OR DELETE ON merchant_memberships FOR EACH ROW EXECUTE FUNCTION immutable_journal();
CREATE FUNCTION complete_merchant_graph() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID;
BEGIN
 IF TG_TABLE_NAME='merchants' THEN target:=NEW.id; ELSE target:=NEW.merchant_id; END IF;
 IF target IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM merchant_memberships WHERE merchant_id=target)
   OR NOT EXISTS(SELECT 1 FROM wallets w JOIN ledger_accounts a ON a.id=w.ledger_account_id
     WHERE w.merchant_id=target AND w.user_id IS NULL AND a.account_type='MERCHANT')) THEN
   RAISE EXCEPTION 'Merchant requires OWNER and its separate wallet' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER complete_merchant AFTER INSERT ON merchants
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION complete_merchant_graph();
CREATE CONSTRAINT TRIGGER complete_membership AFTER INSERT ON merchant_memberships
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION complete_merchant_graph();
CREATE CONSTRAINT TRIGGER complete_merchant_wallet AFTER INSERT ON wallets
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION complete_merchant_graph();
GRANT SELECT ON merchants,merchant_memberships TO nexapay_app;
GRANT INSERT(id,display_name) ON merchants TO nexapay_app;
GRANT UPDATE(display_name,updated_at) ON merchants TO nexapay_app;
GRANT INSERT(merchant_id,user_id) ON merchant_memberships TO nexapay_app;
GRANT INSERT(merchant_id) ON wallets TO nexapay_app;

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
                EXISTS(SELECT 1 FROM wallets d WHERE d.id=t.destination_wallet_id AND d.ledger_account_id=t.destination_account_id AND d.user_id IS NOT NULL)
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
    SELECT 'customer_limit',id::text FROM ledger_accounts WHERE account_type IN ('PERSONAL','MERCHANT') AND posted_balance NOT BETWEEN 0 AND 1000000000000
    UNION ALL
    SELECT 'merchant_graph',m.id::text FROM merchants m
    WHERE NOT EXISTS(SELECT 1 FROM merchant_memberships mm WHERE mm.merchant_id=m.id)
      OR NOT EXISTS(SELECT 1 FROM wallets w JOIN ledger_accounts a ON a.id=w.ledger_account_id
        WHERE w.merchant_id=m.id AND w.user_id IS NULL AND a.account_type='MERCHANT')
    UNION ALL
    SELECT 'wallet_account_type',w.id::text FROM wallets w JOIN ledger_accounts a ON a.id=w.ledger_account_id
    WHERE a.account_type<>CASE WHEN w.user_id IS NOT NULL THEN 'PERSONAL' ELSE 'MERCHANT' END
$$;
