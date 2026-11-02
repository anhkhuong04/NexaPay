# P0-02 — Demo funding, ledger và command recovery

**Ngày:** 02/11/2026
**Trạng thái:** IN_PROGRESS — implementation theo yêu cầu tiếp tục dự án.

## Phạm vi và nguồn

Tiếp nối P0-01 đã verified. Nguồn: [PRD](../Docs/NexaPay_PRD_v0.1.md)
(FR-F01, FR-L01, FR-T04 phần command/recovery, FR-AU01, FR-RC01, US-03/13),
[Money Spec](../Docs/NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md) mục 1–4/7/8,
[ADR-001](../Docs/adr/ADR-001-project-baseline.md) D04–08/11/12/defaults,
[UI spec](../Docs/NexaPay_UIUX_DESIGN_SPEC_v0.1.md) UI-04 và recent commands.

Deliver: funding preset, quota UTC user/environment, signed issuance ledger,
terminal idempotency + bounded retry, actor-scoped lookup/recent commands,
funding review/result/unknown recovery và reconciliation CLI read-only.
Không triển khai P2P/history/merchant/bank; không tuyên bố toàn bộ P0 Done.

## Quyết định implementation theo baseline

- V2 additive; giữ nguyên V1 và dữ liệu. DEMO_ISSUANCE tạo metadata 0 duy nhất.
- PostgreSQL deferred triggers bảo vệ journal balanced/nonempty, currency,
  append trong cùng transaction và immutability. Projection được cập nhật bởi
  entry trigger SECURITY DEFINER; runtime không được UPDATE balance trực tiếp.
  MoneyPostingService là caller duy nhất trong application ghi journal/entries.
- Claim command → quota ENVIRONMENT rồi USER → accounts UUID tăng dần → ledger/audit.
  READ COMMITTED, lock_timeout 2s, statement_timeout 5s; tối đa 2 retries sau
  confirmed rollback, tổng budget 20s. Connection/commit uncertainty không retry mù.
- Fingerprint gồm operation/actor/source account/amount/currency. Schema/key lỗi
  không claim; business FAILED 422 commit cùng command/audit, không tiêu quota.
- Capabilities GET thêm `/api/v1/demo-fundings/capabilities`: preset, flag,
  remaining/reset từ server và environmentEpoch (UUID metadata, không phải secret).
- POST `/api/v1/demo-fundings`, GET `/api/v1/commands/DEMO_FUNDING/{key}`,
  GET `/api/v1/commands?limit=20&cursor=...`. Terminal envelope giữ nguyên
  originalHttpStatus/resourceId/status/result/error; tiền là strings.
- Browser lưu reference trước POST, draft chỉ memory, timeout 30s → UNKNOWN.
  Reload/re-auth chỉ lookup; không auto POST. Chỉ retry cùng key/payload trong
  tab còn draft. Recent commands recover committed results; logout xoá reference.

## Work packages

- [ ] F-01 Contract/schema/trigger design, UI wireframe.
- [ ] F-02 MoneyPostingService, quota/funding/terminal commands/audit và retry.
- [ ] F-03 PostgreSQL invariant/concurrency/rollback/recovery tests + reconciliation.
- [ ] F-04 Fluent funding/review/result/recent-command UI + frontend tests/E2E.
- [ ] F-05 Packaging/CI, docs, commit milestones và push theo workflow đã yêu cầu.

## Acceptance

| ID | Check | Evidence/status |
|---|---|---|
| F-T01 | Funding 100000: issuance -100000, personal +100000, balanced journal, quota/command/audit atomic | NOT RUN |
| F-T02 | 20 concurrent same key → one posting/result; changed fingerprint → 409 | NOT RUN; MM-02 funding |
| F-T03 | Concurrent distinct keys respect user/environment quota, UTC reset; no quota on replay/reject | NOT RUN; MM-06 |
| F-T04 | Committed rejection stays rejected after unlock/reset; new key can succeed | NOT RUN; MM-03 funding |
| F-T05 | Fault after posting rolls back all; lost response lookup/replay returns original; not-observed is not FAILED | NOT RUN; MM-04 |
| F-T06 | Header without entries, unbalanced/currency/zero/old append, update/delete denied; signed overflow rollback | NOT RUN; MM-05 |
| F-T07 | Account lock race and lock timeout rollback/retry bounded; actor isolation, CSRF/schema/throttle | NOT RUN; MM-07 funding |
| F-T08 | Read-only repeatable-read reconciliation checks projection/journal/operation/quota/issuance; detects corruption | NOT RUN; MM-08 funding |
| F-T09 | Review→fund→receipt→balance; duplicate/response-loss/reload/re-auth; no optimistic success or automatic resend | NOT RUN |
| F-T10 | Lint/typecheck/unit/build, backend regression, desktop/mobile/axe, Docker and hosted CI | NOT RUN |

MM-01 transfer contention, full MM-07 opposite transfers và full P0 reconciliation
được mở rộng cùng P0-03 P2P/history. Tests funding không thay thế các gates đó.

## Commands và evidence

Backend `./mvnw.cmd -B -ntp verify` (Docker Testcontainers), frontend `npm run lint`,
`npm run test`, `npm run build`, `npm run test:e2e`; packaging Maven `-Pweb` sau
frontend build. Kết quả thực tế sẽ cập nhật khi chạy, không coi plan là PASS.
