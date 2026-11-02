CREATE TABLE refunds (
 id UUID PRIMARY KEY,
 command_id UUID NOT NULL UNIQUE REFERENCES money_commands(id),
 payment_id UUID NOT NULL REFERENCES payments(id),
 merchant_id UUID NOT NULL REFERENCES merchants(id),
 actor_id UUID NOT NULL REFERENCES users(id),
 payer_id UUID NOT NULL REFERENCES users(id),
 source_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
 destination_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
 source_wallet_id UUID NOT NULL REFERENCES wallets(id),
 destination_wallet_id UUID NOT NULL REFERENCES wallets(id),
 amount BIGINT NOT NULL CHECK(amount BETWEEN 1 AND 100000000),
 currency VARCHAR(3) NOT NULL CHECK(currency='VND'),
 note VARCHAR(140) NOT NULL DEFAULT '',
 merchant_name VARCHAR(80) NOT NULL,
 payer_name VARCHAR(80) NOT NULL,
 status VARCHAR(16) NOT NULL CHECK(status IN ('SUCCEEDED','FAILED')),
 ledger_transaction_id UUID UNIQUE REFERENCES ledger_transactions(id),
 error_code VARCHAR(48),
 created_at TIMESTAMPTZ NOT NULL,
 created_xid XID8 NOT NULL DEFAULT pg_current_xact_id(),
 CHECK((status='SUCCEEDED' AND ledger_transaction_id IS NOT NULL AND error_code IS NULL)
  OR (status='FAILED' AND ledger_transaction_id IS NULL AND error_code IS NOT NULL))
);
CREATE INDEX refunds_payment ON refunds(payment_id,status);
CREATE INDEX refunds_merchant_recent ON refunds(merchant_id,created_at DESC,id DESC);
CREATE INDEX refunds_payer_recent ON refunds(payer_id,created_at DESC,id DESC) WHERE status='SUCCEEDED';
CREATE TRIGGER immutable_refund BEFORE UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION immutable_journal();
GRANT SELECT,INSERT ON refunds TO nexapay_app;

-- Row locking only; runtime never gains UPDATE permission on immutable captures.
CREATE FUNCTION lock_refund_payment(target UUID, merchant UUID) RETURNS SETOF payments
LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p.* FROM public.payments p WHERE p.id=target AND p.merchant_id=merchant FOR UPDATE
$$;
REVOKE ALL ON FUNCTION lock_refund_payment(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_refund_payment(UUID,UUID) TO nexapay_app;

-- Serialize even direct inserts before the deferred aggregate check. Application takes this lock before accounts.
CREATE FUNCTION serialize_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.payments p WHERE p.id=NEW.payment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing original capture' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER serialize_refund BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION serialize_refund();
CREATE FUNCTION refund_integrity(target UUID) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM refunds f JOIN payments p ON p.id=f.payment_id
 JOIN payment_attempts a ON a.id=p.attempt_id JOIN money_commands c ON c.id=f.command_id
 JOIN merchant_memberships mm ON mm.merchant_id=f.merchant_id AND mm.user_id=f.actor_id AND mm.role='OWNER'
 WHERE f.id=target AND f.merchant_id=p.merchant_id AND f.payer_id=a.actor_id
 AND f.source_account_id=p.destination_account_id AND f.destination_account_id=p.source_account_id
 AND f.source_wallet_id=a.destination_wallet_id AND f.destination_wallet_id=a.source_wallet_id
 AND c.actor_id=f.actor_id AND c.operation_type='REFUND' AND c.resource_id=f.id AND c.status=f.status AND c.created_xid=f.created_xid
 AND ((f.status='FAILED' AND f.ledger_transaction_id IS NULL AND NOT EXISTS(SELECT 1 FROM ledger_transactions l WHERE l.operation_type='REFUND' AND l.operation_id=f.id))
 OR (f.status='SUCCEEDED' AND
  (SELECT coalesce(sum(other.amount::numeric),0) FROM refunds other WHERE other.payment_id=p.id AND other.status='SUCCEEDED')<=p.amount
  AND EXISTS(SELECT 1 FROM ledger_transactions l WHERE l.id=f.ledger_transaction_id AND l.operation_type='REFUND' AND l.operation_id=f.id AND l.currency='VND' AND l.created_xid=f.created_xid
   AND (SELECT count(*) FROM ledger_entries e WHERE e.transaction_id=l.id)=2
   AND EXISTS(SELECT 1 FROM ledger_entries e WHERE e.transaction_id=l.id AND e.account_id=f.source_account_id AND e.amount=-f.amount)
   AND EXISTS(SELECT 1 FROM ledger_entries e WHERE e.transaction_id=l.id AND e.account_id=f.destination_account_id AND e.amount=f.amount)))))
$$;
CREATE FUNCTION refund_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid BOOLEAN;
BEGIN
 IF TG_TABLE_NAME='refunds' THEN valid:=refund_integrity(NEW.id) AND NEW.created_xid=pg_current_xact_id();
 ELSE
  IF NEW.operation_type<>'REFUND' THEN RETURN NULL; END IF;
  SELECT EXISTS(SELECT 1 FROM refunds f WHERE f.ledger_transaction_id=NEW.id AND f.status='SUCCEEDED' AND refund_integrity(f.id)) INTO valid;
 END IF;
 IF valid IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Refund/capture/command/reverse journal linkage or aggregate mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER refund_consistency AFTER INSERT ON refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refund_consistency();
CREATE CONSTRAINT TRIGGER refund_journal_consistency AFTER INSERT ON ledger_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refund_consistency();

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
    ELSIF c.operation_type='REFUND' THEN linked:=refund_integrity(c.resource_id);
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
       OR (c.operation_type='REFUND' AND refund_integrity(c.resource_id) IS DISTINCT FROM TRUE)
       OR c.operation_type NOT IN ('DEMO_FUNDING','TRANSFER','PAYMENT','REFUND')
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
 UNION ALL SELECT 'refund_link',f.id::text FROM refunds f WHERE refund_integrity(f.id) IS DISTINCT FROM TRUE
 UNION ALL SELECT 'refund_total',p.id::text FROM payments p WHERE (SELECT coalesce(sum(f.amount::numeric),0) FROM refunds f WHERE f.payment_id=p.id AND f.status='SUCCEEDED')>p.amount
 UNION ALL SELECT 'orphan_refund_posting',l.id::text FROM ledger_transactions l WHERE l.operation_type='REFUND' AND NOT EXISTS(SELECT 1 FROM refunds f WHERE f.id=l.operation_id AND f.ledger_transaction_id=l.id AND f.status='SUCCEEDED')
$$;
