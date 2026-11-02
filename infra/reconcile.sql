\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT * FROM reconciliation_findings() ORDER BY check_name,resource_id;
SELECT NOT EXISTS(SELECT 1 FROM reconciliation_findings()) AS reconciled \gset
\if :reconciled
    COMMIT;
    \echo PASS: funding ledger, projection, command linkage, quota and issuance reconcile.
\else
    ROLLBACK;
    \echo FAILED: investigate the IDs above. This command never repairs money.
    \quit 1
\endif
