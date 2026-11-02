CREATE TABLE payment_requests (
 id UUID PRIMARY KEY,
 public_ref UUID NOT NULL UNIQUE,
 merchant_id UUID NOT NULL REFERENCES merchants(id),
 creator_id UUID NOT NULL REFERENCES users(id),
 merchant_name VARCHAR(80) NOT NULL,
 amount BIGINT NOT NULL CHECK(amount BETWEEN 1 AND 100000000),
 currency VARCHAR(3) NOT NULL CHECK(currency='VND'),
 description VARCHAR(140) NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 140),
 creation_key UUID NOT NULL,
 fingerprint VARCHAR(64) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','EXPIRED','CANCELLED')),
 state_changed_at TIMESTAMPTZ,
 UNIQUE(merchant_id,creation_key),
 CHECK(expires_at>=created_at+interval '5 minutes' AND expires_at<=created_at+interval '24 hours'),
 CHECK((status='PENDING' AND state_changed_at IS NULL) OR (status<>'PENDING' AND state_changed_at IS NOT NULL)),
 CHECK(status NOT IN ('PAID','CANCELLED') OR state_changed_at<expires_at),
 CHECK(status<>'EXPIRED' OR state_changed_at>=expires_at)
);
CREATE INDEX request_merchant_recent ON payment_requests(merchant_id,created_at DESC,id DESC);
CREATE TABLE payment_attempts (
 id UUID PRIMARY KEY,
 command_id UUID NOT NULL UNIQUE REFERENCES money_commands(id),
 request_id UUID NOT NULL REFERENCES payment_requests(id),
 actor_id UUID NOT NULL REFERENCES users(id),
 source_wallet_id UUID NOT NULL REFERENCES wallets(id),
 destination_wallet_id UUID NOT NULL REFERENCES wallets(id),
 amount BIGINT NOT NULL CHECK(amount BETWEEN 1 AND 100000000),
 payer_name VARCHAR(80) NOT NULL,
 status VARCHAR(16) NOT NULL CHECK(status IN ('SUCCEEDED','FAILED')),
 error_code VARCHAR(48),
 created_at TIMESTAMPTZ NOT NULL,
 created_xid XID8 NOT NULL DEFAULT pg_current_xact_id(),
 CHECK((status='SUCCEEDED' AND error_code IS NULL) OR (status='FAILED' AND error_code IS NOT NULL))
);
CREATE INDEX attempt_payer_recent ON payment_attempts(actor_id,created_at DESC,id DESC);
CREATE TABLE payments (
 id UUID PRIMARY KEY,
 request_id UUID NOT NULL UNIQUE REFERENCES payment_requests(id),
 attempt_id UUID NOT NULL UNIQUE REFERENCES payment_attempts(id),
 merchant_id UUID NOT NULL REFERENCES merchants(id),
 source_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
 destination_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
 amount BIGINT NOT NULL CHECK(amount BETWEEN 1 AND 100000000),
 ledger_transaction_id UUID NOT NULL UNIQUE REFERENCES ledger_transactions(id),
 created_at TIMESTAMPTZ NOT NULL,
 created_xid XID8 NOT NULL DEFAULT pg_current_xact_id()
);
CREATE INDEX merchant_payment_recent ON payments(merchant_id,created_at DESC,id DESC);
CREATE TRIGGER immutable_payment_attempt BEFORE UPDATE OR DELETE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION immutable_journal();
CREATE TRIGGER immutable_payment BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION immutable_journal();
CREATE FUNCTION protect_payment_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Request cannot be deleted' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.id,NEW.public_ref,NEW.merchant_id,NEW.creator_id,NEW.merchant_name,NEW.amount,NEW.currency,NEW.description,NEW.creation_key,NEW.fingerprint,NEW.created_at,NEW.expires_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.public_ref,OLD.merchant_id,OLD.creator_id,OLD.merchant_name,OLD.amount,OLD.currency,OLD.description,OLD.creation_key,OLD.fingerprint,OLD.created_at,OLD.expires_at)
   OR OLD.status<>'PENDING' THEN
   RAISE EXCEPTION 'Immutable request fields or terminal state' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_payment_request BEFORE UPDATE OR DELETE ON payment_requests FOR EACH ROW EXECUTE FUNCTION protect_payment_request();

-- A successful capture has its own command/attempt, exact immutable request and two exact legs.
CREATE FUNCTION payment_integrity(target UUID) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM payments p
 JOIN payment_requests r ON r.id=p.request_id
 JOIN payment_attempts a ON a.id=p.attempt_id
 JOIN money_commands c ON c.id=a.command_id
 JOIN wallets src ON src.id=a.source_wallet_id
 JOIN wallets dst ON dst.id=a.destination_wallet_id
 JOIN ledger_accounts sa ON sa.id=p.source_account_id
 JOIN ledger_accounts da ON da.id=p.destination_account_id
 JOIN ledger_transactions l ON l.id=p.ledger_transaction_id
 WHERE p.id=target AND r.status='PAID' AND p.merchant_id=r.merchant_id
 AND a.request_id=r.id AND a.status='SUCCEEDED' AND a.error_code IS NULL
 AND p.amount=r.amount AND a.amount=r.amount AND p.created_at=a.created_at
 AND r.state_changed_at=p.created_at AND p.created_at<r.expires_at
 AND src.user_id=a.actor_id AND src.ledger_account_id=p.source_account_id AND sa.account_type='PERSONAL'
 AND dst.merchant_id=r.merchant_id AND dst.ledger_account_id=p.destination_account_id AND da.account_type='MERCHANT'
 AND NOT EXISTS(SELECT 1 FROM merchant_memberships mm WHERE mm.merchant_id=r.merchant_id AND mm.user_id=a.actor_id)
 AND c.actor_id=a.actor_id AND c.operation_type='PAYMENT' AND c.resource_id=a.id AND c.status='SUCCEEDED'
 AND c.created_xid=a.created_xid AND a.created_xid=p.created_xid
 AND l.operation_type='PAYMENT' AND l.operation_id=p.id AND l.currency='VND'
 AND (SELECT count(*) FROM ledger_entries e WHERE e.transaction_id=l.id)=2
 AND EXISTS(SELECT 1 FROM ledger_entries e WHERE e.transaction_id=l.id AND e.account_id=p.source_account_id AND e.amount=-p.amount)
 AND EXISTS(SELECT 1 FROM ledger_entries e WHERE e.transaction_id=l.id AND e.account_id=p.destination_account_id AND e.amount=p.amount))
$$;
CREATE FUNCTION payment_attempt_integrity(target UUID) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM payment_attempts a JOIN money_commands c ON c.id=a.command_id
 JOIN payment_requests r ON r.id=a.request_id JOIN wallets src ON src.id=a.source_wallet_id JOIN wallets dst ON dst.id=a.destination_wallet_id
 WHERE a.id=target AND c.operation_type='PAYMENT' AND c.resource_id=a.id AND c.actor_id=a.actor_id AND c.status=a.status
 AND c.created_xid=a.created_xid AND src.user_id=a.actor_id AND dst.merchant_id=r.merchant_id
 AND ((a.status='FAILED' AND a.error_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.attempt_id=a.id))
   OR (a.status='SUCCEEDED' AND EXISTS(SELECT 1 FROM payments p WHERE p.attempt_id=a.id AND payment_integrity(p.id)))))
$$;
CREATE FUNCTION payment_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid BOOLEAN;
BEGIN
 IF TG_TABLE_NAME='payment_requests' THEN
  SELECT ((r.status='PAID')=EXISTS(SELECT 1 FROM payments p WHERE p.request_id=r.id)) AND EXISTS(SELECT 1 FROM merchant_memberships mm WHERE mm.merchant_id=r.merchant_id AND mm.user_id=r.creator_id AND mm.role='OWNER') INTO valid FROM payment_requests r WHERE r.id=NEW.id;
 ELSIF TG_TABLE_NAME='payment_attempts' THEN valid:=payment_attempt_integrity(NEW.id) AND NEW.created_xid=pg_current_xact_id();
 ELSIF TG_TABLE_NAME='payments' THEN valid:=payment_integrity(NEW.id) AND NEW.created_xid=pg_current_xact_id();
 ELSE
  IF NEW.operation_type<>'PAYMENT' THEN RETURN NULL; END IF;
  SELECT EXISTS(SELECT 1 FROM payments p WHERE p.ledger_transaction_id=NEW.id AND payment_integrity(p.id)) INTO valid;
 END IF;
 IF valid IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Payment/request/attempt/ledger linkage mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER request_capture_consistency AFTER INSERT OR UPDATE ON payment_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment_consistency();
CREATE CONSTRAINT TRIGGER attempt_consistency AFTER INSERT ON payment_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment_consistency();
CREATE CONSTRAINT TRIGGER capture_consistency AFTER INSERT ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment_consistency();
CREATE CONSTRAINT TRIGGER payment_journal_consistency AFTER INSERT ON ledger_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment_consistency();
GRANT SELECT,INSERT ON payment_requests,payment_attempts,payments TO nexapay_app;
GRANT UPDATE(status,state_changed_at) ON payment_requests TO nexapay_app;

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
    ELSIF c.operation_type='PAYMENT' THEN linked:=payment_attempt_integrity(c.resource_id);
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
       OR (c.operation_type='PAYMENT' AND payment_attempt_integrity(c.resource_id) IS DISTINCT FROM TRUE)
       OR c.operation_type NOT IN ('DEMO_FUNDING','TRANSFER','PAYMENT')
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
    UNION ALL
    SELECT 'payment_link',p.id::text FROM payments p WHERE payment_integrity(p.id) IS DISTINCT FROM TRUE
    UNION ALL
    SELECT 'payment_attempt',a.id::text FROM payment_attempts a WHERE payment_attempt_integrity(a.id) IS DISTINCT FROM TRUE
    UNION ALL
    SELECT 'orphan_payment_posting',l.id::text FROM ledger_transactions l WHERE l.operation_type='PAYMENT' AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.id=l.operation_id AND p.ledger_transaction_id=l.id)
    UNION ALL
    SELECT 'request_capture',r.id::text FROM payment_requests r WHERE (r.status='PAID')<>EXISTS(SELECT 1 FROM payments p WHERE p.request_id=r.id) OR NOT EXISTS(SELECT 1 FROM merchant_memberships mm WHERE mm.merchant_id=r.merchant_id AND mm.user_id=r.creator_id AND mm.role='OWNER')
$$;
