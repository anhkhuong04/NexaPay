\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT * FROM reconciliation_findings() ORDER BY check_name,resource_id;
SELECT NOT EXISTS(SELECT 1 FROM reconciliation_findings()) AS reconciled \gset
\if :reconciled
    COMMIT;
    \echo PASS: funding, P2P and merchant payment ledger, projection, command linkage, quota, issuance and merchant ownership reconcile.
\else
    \echo FAILED: investigate the IDs above. This command never repairs money.
    DO $$ BEGIN RAISE EXCEPTION 'Reconciliation mismatch; read-only investigation required'; END $$;
\endif
