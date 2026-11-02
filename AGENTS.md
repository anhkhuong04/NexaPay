# NexaPay — Agent instructions

## Project baseline

- Build a simulated VND wallet/payment portfolio using the accepted design baseline.
- Java 21, Spring Boot and PostgreSQL in a modular monolith; React, TypeScript,
  Vite and Fluent UI React v9 applying Fluent 2 with NexaPay theme tokens.
- Deliver P0, then P1a, P1b and P1c; P2 is optional. Do not expand the current task
  to a later release simply because its requirements exist.
- Accepted decisions may be implemented without requesting approval again.

## Sources and scope

- Start from [Docs/README.md](Docs/README.md). Before initial implementation
  planning, read Context, PRD, ADR-001, Architecture, Money Spec and UI Spec.
  For subsequent changes, load relevant sections and refresh documents that changed.
- PRD owns requirements, ADRs own decisions, Money Spec owns detailed money
  behavior, and Architecture/UI Spec define their respective implementation views.
- Read existing AGENTS.md files in each area you will edit, including when a
  session starts at the root. Scoped guidance must preserve project invariants.
- Resolve material contradictions before implementing affected behavior. Explain
  the conflict and record a decision change rather than inventing an exception.
- Planning/proposal examples are not newer product decisions. Actual maintained
  instructions and accepted specifications take precedence over their examples.

## Money and security invariants

- Simulated funds only; no real bank/card processing or real financial data.
- Only ledger MoneyPostingService posts ledger entries and balance projection.
  Never add a direct balance edit, manual seed balance or ledger repair shortcut.
- P0 business result, money writes, idempotency result and audit commit together.
- Follow [Money Spec](Docs/NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md) for integer money,
  JSON string amounts, account types, DB guards, lock order, terminal rejection
  replay and technical rollback. Numeric limits belong in the accepted ADR/config.
- Never interpret client timeout or an unobserved command lookup as money failure.
- Enforce server-side identity, resource ownership and merchant membership.
  Frontend guards and client-provided actor/role fields are not authorization.
- Preserve same-origin session authentication and CSRF protection. Do not bypass
  auth or expose secrets to make a demo/test pass.
- Do not add microservices, a broker, Redis or a replacement UI/auth stack without
  an accepted decision change. Pin compatible stable dependencies during scaffold.

## Working method and code conventions

- Map behavior changes to applicable FR/BR/US and acceptance criteria. A docs typo
  or formatting-only edit does not require inventing a new requirement.
- Inspect current code, manifests, migrations and tests before editing. Preserve
  unrelated user work; keep changes focused on the requested outcome.
- Plan substantial multi-step features in `Implementation Plan/`; keep small fixes
  small. Record actual evidence before marking a slice complete.
- Backend: package by feature, controllers call application APIs, no cross-module
  repository access or JPA entity REST responses. Use constructor injection,
  explicit DTO validation/error semantics and clear transaction boundaries.
- Do not force an interface/layer for every class. Keep external HTTP outside
  money transactions; retries must not continue an aborted DB transaction.
- Frontend: TypeScript strict, typed API models, TanStack Query for server state,
  Fluent controls/tokens and accessible semantic interactions. Do not duplicate
  server state or optimistically show money success.
- Evolve existing contracts/data deliberately. Do not rewrite migrations already
  applied in a shared environment or weaken checks to hide a failure.
- When scaffolding backend/frontend/infra, add scoped AGENTS.md with relevant
  conventions and real commands; use the proposal's area conventions as a starting
  point. Do not create empty code directories solely for instruction files.

## Project skills

- [nexapay-vertical-slice](.agents/skills/nexapay-vertical-slice/SKILL.md): substantial
  feature planning/delivery spanning contracts, data, API, UI and tests.
- [nexapay-money-change](.agents/skills/nexapay-money-change/SKILL.md): implement,
  debug or review changes affecting money correctness and recovery.
- [nexapay-fluent-ui](.agents/skills/nexapay-fluent-ui/SKILL.md): design, implement or
  review NexaPay screens/components with Fluent 2 and the accepted UI behavior.
- [nexapay-verification](.agents/skills/nexapay-verification/SKILL.md): select and run
  checks for an actual change or evaluate a slice's readiness.
- Load only applicable skills. They complement these instructions and do not
  authorize unrelated edits, external actions or changes to accepted requirements.

## Verification and reporting

- Use commands from actual manifests/wrappers and scoped instructions. Until code
  is scaffolded, do not invent build/test commands or claim application checks pass.
- Run checks proportionate to impact. Money/DB behavior requires the relevant
  PostgreSQL invariant/concurrency/recovery tests, not only mocks or H2.
- Keep docs/contracts/tests aligned. Update documented commands and CI when build
  tooling changes. Formatting/linting do not prove business correctness.
- Distinguish passed, failed and not-run checks; missing tools, skipped tests or
  unavailable environments are limitations, not successful verification.
- Report the behavior changed, relevant requirement IDs, checks actually executed
  and results, plus remaining work. Communicate with the user in Vietnamese unless
  requested otherwise; keep code identifiers consistent with the codebase.
- Complete authorized local work without unnecessary approval loops. Ask only for
  missing information that materially affects the task. Instructions do not by
  themselves authorize publishing, costs, destructive resets or contacting others.
