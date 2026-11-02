---
name: nexapay-vertical-slice
description: Plan or deliver a substantial NexaPay feature spanning data, API, UI and tests. Use for end-to-end slices or release-gate planning, not isolated small fixes or editorial changes.
---

# NexaPay vertical slices

## Establish the slice

- Locate the workspace root using [AGENTS.md](../../../AGENTS.md) and the
  [documentation index](../../../Docs/README.md); do not assume the shell is at root.
- Identify whether the request is planning, implementation or review. Planning
  produces a reviewable plan, not unrequested code; implementation continues through
  the authorized changes and verification. Keep review findings separate from edits.
- Read the relevant [PRD](../../../Docs/NexaPay_PRD_v0.1.md),
  [ADR](../../../Docs/adr/ADR-001-project-baseline.md) and
  [Architecture](../../../Docs/NexaPay_SYSTEM_ARCHITECTURE_v0.1.md) sections. For the
  first implementation plan, follow root instructions to read the full baseline.
- Select applicable release, FR/BR/US and acceptance criteria. Inspect the actual
  code/build/test state before treating a prerequisite as implemented or missing.

## Plan and deliver

- For substantial work, maintain one slice plan in `Implementation Plan/` with its
  goal, requirements, dependencies, affected contracts/schema/UI, acceptance checks,
  work remaining and execution evidence. Reuse a relevant plan; do not create a
  parallel memory/backlog that claims different completion status.
- Make the smallest coherent end-to-end increment. Define/review migrations and
  API semantics before their business implementation; prototype the relevant UI
  states before connecting them. Do not design all P1 schemas/screens for a P0 task.
- Preserve public module boundaries and typed contracts. Do not invent endpoints,
  money rules or role grants because frontend code would be easier to implement.
- Consult [Money Spec](../../../Docs/NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md) for money
  behavior and [UI Spec](../../../Docs/NexaPay_UIUX_DESIGN_SPEC_v0.1.md) for screens.
  Apply the money/UI skills when their workflows are relevant, not by default.
- Add focused acceptance/regression coverage and update affected docs/contracts.
  Discover real commands from build manifests and scoped AGENTS.md; never fill a
  plan with imaginary commands or fabricated results.
- Verify the connected behavior at the layers affected. If an external prerequisite
  prevents a check, complete independent authorized work and report the limitation.
  Do not mark the slice Done just because its happy-path endpoint returns success.

## Handoff

Report delivered behavior and requirement IDs, checks and actual outcomes, changes
to contracts/migrations/docs, and unmet acceptance criteria. A future P1 capability,
prototype fixture or unchecked test is not completed production behavior.
