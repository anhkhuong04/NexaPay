# NexaPay documentation instructions

These rules apply to changes under Docs; also follow the root AGENTS.md.

## Document ownership

- [README.md](README.md) is the index of maintained product and agent documents.
- PRD owns FR/BR/US and release gates; ADRs record accepted decisions and their
  trade-offs; Money Movement Spec owns transaction/recovery behavior.
- Architecture and UI Spec must agree with those sources. Workflow instructions
  describe how to apply them, not a second set of product rules.
- Keep Accepted, Proposed and Implemented/Verified distinct. A design decision or
  plan is not evidence that code, tests, deployment or skill discovery succeeded.
- Preserve existing FR/BR/US/MM identifiers; add new IDs instead of renumbering
  unrelated requirements. Update affected mappings/acceptance when behavior changes.

## Editing and verification

- Keep Vietnamese prose, code identifiers, exact filenames and Docs casing intact.
  Preserve intentionally retained `_v0.1` filenames whose content version is v0.2.
- Use repository-relative Markdown links and correct filename casing for Linux.
  Do not put machine-specific paths or secrets in shared instructions.
- Update the index when adding a maintained document. Update date/version/changelog
  when a design decision changes; small editorial fixes need no artificial ADR.
- When a change affects money, permission or recovery, update the appropriate ADR,
  requirements and dependent specs together; do not silently relax an invariant.
- Check changed links, code fences, table structure and referenced requirement IDs.
  Do not run application suites for a documentation-only edit unless code generation
  or documented executable behavior actually changed.
- Keep historical examples clearly labelled. Link to live AGENTS/SKILL files rather
  than maintaining a competing copy of their operational rules.
