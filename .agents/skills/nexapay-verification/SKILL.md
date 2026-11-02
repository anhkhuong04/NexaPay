---
name: nexapay-verification
description: Verify an actual NexaPay change or assess slice readiness using impact-based checks and real build commands. Report evidence and unverified areas; exclude pure brainstorming or requirements analysis.
---

# NexaPay change verification

## Establish what can be verified

- Read [root instructions](../../../AGENTS.md) and scoped AGENTS.md for affected
  areas. Inspect the actual change, requirements and available manifests/wrappers,
  CI configuration and test setup; do not assume Git or application tooling exists.
- Use a diff when available and otherwise inspect changed files. Map behavioral
  acceptance to [PRD](../../../Docs/NexaPay_PRD_v0.1.md), money-sensitive checks to
  [Money Spec](../../../Docs/NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md), and UI states to
  [UI Spec](../../../Docs/NexaPay_UIUX_DESIGN_SPEC_v0.1.md).
- Build a small check list with command, working directory, prerequisites and
  expected observable behavior. Do not invent package scripts or treat an absent
  tool/test suite as a passed check.

## Choose checks by impact

| Change | Relevant checks |
|---|---|
| Docs/instructions/skills | Links/case, fences/tables/IDs, frontmatter/name, unfinished placeholders and consistency |
| Backend logic/API/auth | Compile/format and affected domain/API/ownership/session/CSRF regressions |
| Money/schema | PostgreSQL migrations/guards/permissions, relevant MM concurrency/rollback/recovery gates and reconciliation |
| UI behavior | Typecheck/lint, component/user-flow regressions; rendered states, keyboard/visual checks when affected |
| Cross-layer feature | Relevant backend/frontend gates and a connected acceptance journey |
| Infra/packaging | Actual config/build validation, same-origin routing and targeted smoke checks |

Use commands found in the project and record them accurately. For skill validation,
use a provided skill validator if available; it checks structure, not whether skill
selection and execution behave correctly. Do not hardcode a developer's tool path
or install tooling globally just to make verification appear complete.

## Execute and account for results

- Run the focused checks required by the impact; expand when a failure, new change
  or unresolved concern justifies it. Do not run application suites for a prose typo.
- For money correctness, mocks/H2 do not replace PostgreSQL integration evidence.
  Skipped tests, unavailable Docker/Testcontainers or a client timeout are not proof
  that money invariants passed or that a transaction failed.
- Preserve review/verification scope. In an implementation task, fix related defects
  within authorization and rerun affected checks. In review-only work, report findings;
  do not silently change code, disable tests or alter accepted rules to force a pass.
- Mark checks PASSED, FAILED or NOT RUN with the actual reason. Separate a tool's
  successful exit from the acceptance behavior it does or does not demonstrate.
- Report changed behavior and requirement IDs, exact commands/outcomes, remaining
  gaps and unmet release criteria. Do not mark a slice Done while required checks
  remain failed or unverified; verification does not itself authorize deployment.
