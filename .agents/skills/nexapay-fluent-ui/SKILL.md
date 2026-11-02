---
name: nexapay-fluent-ui
description: Design, implement or review NexaPay React screens, forms and components using Fluent UI React v9, Fluent 2 and NexaPay tokens. Use for interaction, responsive layout or accessibility work, not backend-only tasks.
---

# NexaPay Fluent UI workflows

## Scope the screen or interaction

- Read [root instructions](../../../AGENTS.md), any frontend AGENTS.md and the
  relevant [UI Spec](../../../Docs/NexaPay_UIUX_DESIGN_SPEC_v0.1.md) sections.
  Identify workspace, release, user task, route and required states.
- Follow [PRD](../../../Docs/NexaPay_PRD_v0.1.md) for validation/authorization and
  [Money Spec](../../../Docs/NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md) for money/recovery.
  UI convenience must not change server rules or command semantics.
- Preserve the requested mode: prototype/design, implementation or review. Label
  fixtures/prototypes; do not imply they are wired to authoritative API behavior.

## Build within the existing system

- Inspect existing components, theme, API types and query keys first. Prefer
  `@fluentui/react-components`, Fluent System Icons, semantic NexaPay tokens and
  reusable domain components; do not replace Vite/React or add another UI kit.
- Implement only the relevant slice. Include loading, empty, error, disabled and
  result states where applicable; do not render future-feature controls as working.
- Keep TypeScript/API models explicit. Use TanStack Query for server state and
  local/form state for interaction. Avoid broad `any`, duplicated server state or
  effects that merely copy derived values between states.
- Use exact integer money parsing/formatting with canonical string payloads; do not
  coerce API amounts through floating point or round invalid input silently.
- For money flows, show review and authoritative outcomes, preserve the same intent
  on uncertainty, and do not automatically POST on refresh/re-auth. Refetch balances
  and history after confirmed mutation; never show optimistic money success.
- Key caches by actor/workspace, cancel obsolete requests and prevent stale results
  crossing logout/account switches. Preserve available/held/total distinctions when
  the implemented release includes holds.

## Check the user experience

- Use visible labels, semantic controls, accessible names and contextual error/status
  announcements. Check keyboard/focus, responsive reflow, text zoom and contrast;
  sticky actions must not hide focused fields. Respect reduced motion.
- Test the affected components/user flows and inspect the rendered result at relevant
  viewport sizes when UI changes. Automated accessibility scans complement manual
  keyboard/visual checks rather than proving full accessibility.
- Discover actual frontend scripts before running checks. Report design/behavior
  delivered, API dependencies, checked viewports/states, results and unverified areas.
  For review-only requests, return findings with locations instead of editing.
