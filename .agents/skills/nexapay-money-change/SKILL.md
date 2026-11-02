---
name: nexapay-money-change
description: Implement, debug or review NexaPay changes affecting ledger, balances, funding quotas, idempotency, transfers, payments, refunds or withdrawal holds. Exclude presentation-only edits.
---

# NexaPay money changes

## Understand the requested behavior

- Locate [root instructions](../../../AGENTS.md). Read relevant sections of the
  [Money Movement Spec](../../../Docs/NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md),
  [PRD](../../../Docs/NexaPay_PRD_v0.1.md) and
  [accepted ADR](../../../Docs/adr/ADR-001-project-baseline.md).
- Preserve the requested mode: implement, debug or review. For review-only work,
  produce actionable findings with code references and failure scenarios, not edits.
- Inspect existing posting paths, schema/constraints, transaction boundaries,
  authorization and tests. Identify affected FR/BR/MM gates before changing behavior.

## Protect the financial boundary

- Trace actor/ownership, account types, canonical money parsing, arithmetic limits,
  operation identity, key/fingerprint scope, lock order and commit boundary.
  Read actual limits/parameters from the ADR/spec/config; do not duplicate them here.
- Keep posting through MoneyPostingService inside the use-case transaction.
  Distinguish a committed business rejection from a technical rollback and from
  the browser not knowing the result. Preserve terminal result replay.
- Examine failure before commit, commit with response loss, duplicate concurrent
  requests and insufficient funds where relevant. Lookup not observed does not
  justify a new key or a FAILED financial result.
- Review lock/retry code against the global order and DB semantics. Retry outside
  the rolled-back transaction, within the accepted budget; no external HTTP while
  holding money locks and no catch-and-continue in an aborted PostgreSQL transaction.
- For migrations, preserve existing data and enforce relevant unique/FK/check/commit
  guards and posted-history immutability. Inspect runtime DB permissions as well as
  application paths. Do not weaken a guard to get a test green.
- For payment/refund/hold changes, use the spec's eligibility, expiry, lock exceptions
  and state transitions. Do not generalize a customer nonnegative rule to signed
  system accounts, or treat provider timeout as permission to release held funds.

## Verify and report

- Add/run focused regression tests on PostgreSQL when locks, constraints, rollback
  or idempotency matter. Select relevant MM gates and assert balances, entries,
  operation/result linkage and authorization, not only response codes.
- Use concurrency/failure injection where the change can affect those behaviors;
  mocks or an in-memory DB cannot substitute for the required PostgreSQL evidence.
- Check reconciliation impact using a consistent read snapshot. Never repair posted
  history/balances or reset a dataset as a debugging shortcut.
- Report the invariant enforced or violated, affected FR/BR/MM references, actual
  checks/outcomes and remaining uncertainty. A review may conclude no finding;
  do not invent a defect or claim a skipped correctness test passed.
