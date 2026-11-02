# P0-02 — Demo funding, ledger và command recovery

**Ngày:** 02/11/2026
**Trạng thái:** VERIFIED — F-01–05 hoàn tất; local và hosted CI passed. Toàn bộ P0 chưa Done.

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

- [x] F-01 Contract/schema/trigger design, UI wireframe.
- [x] F-02 MoneyPostingService, quota/funding/terminal commands/audit và retry.
- [x] F-03 PostgreSQL invariant/concurrency/rollback/recovery tests + reconciliation.
- [x] F-04 Fluent funding/review/result/recent-command UI + frontend tests/E2E.
- [x] F-05 Packaging/docs/commit/push và hosted CI đã pass.

## Acceptance

| ID | Check | Evidence/status |
|---|---|---|
| F-T01 | Funding 100000: issuance -100000, personal +100000, balanced journal, quota/command/audit atomic | PASSED — FundingIntegrationTest: journal/zero-sum, projection, quota và signup/money audit cùng commit |
| F-T02 | 20 concurrent same key → one posting/result; changed fingerprint → 409 | PASSED — 20 same-key concurrent results; store fingerprint 409. Unsupported funding preset HTTP 400 trước claim |
| F-T03 | Concurrent distinct keys respect user/environment quota, UTC reset; no quota on replay/reject | PASSED — 20 distinct keys chỉ 5 success; 2 actors tranh phần quota môi trường cuối; controllable clock tại UTC reset |
| F-T04 | Committed rejection stays rejected after unlock/reset; new key can succeed | PASSED — locked failure replay sau unlock và quota failure replay qua ngày; intent mới thành công |
| F-T05 | Fault after posting rolls back all; lost response lookup/replay returns original; not-observed is not FAILED | PASSED — fault sau audit rollback key/quota/journal/audit; HTTP technical 500, real browser mất response sau commit → lookup |
| F-T06 | Header without entries, unbalanced/currency/zero/old append, update/delete denied; signed overflow rollback | PASSED — empty/unbalanced/zero/currency/old append, runtime deny và owner immutability; Java overflow + DB SQLSTATE 22003 |
| F-T07 | Account lock race and lock timeout rollback/retry bounded; actor isolation, CSRF/schema/throttle | PASSED — owner lock trước funding; timeout 3 attempts rồi 503/key rollback; actor isolation/CSRF/schema và 30/min throttle |
| F-T08 | Read-only repeatable-read reconciliation checks projection/journal/operation/quota/issuance; detects corruption | PASSED — consistent read-only snapshot, rolled-back corruption probe, CLI findings exit nonzero; runtime findings 0 |
| F-T09 | Review→fund→receipt→balance; duplicate/response-loss/reload/re-auth; no optimistic success or automatic resend | PASSED — real browser review/receipt/quota, lost response, reload/re-auth no auto resend; reference/actor/epoch/mutation-cache tests |
| F-T10 | Lint/typecheck/unit/build, backend regression, desktop/mobile/axe, Docker and hosted CI | PASSED local — backend 39, frontend 12, E2E 8 + final funding 4; axe/reflow/visual QA, Docker, runtime smoke; hosted CI PASSED (run 41391311765) |

MM-01 transfer contention, full MM-07 opposite transfers và full P0 reconciliation
được mở rộng cùng P0-03 P2P/history. Tests funding không thay thế các gates đó.

## Commands và evidence

Backend `./mvnw.cmd -B -ntp verify` (Docker Testcontainers), frontend `npm run lint`,
`npm run test`, `npm run build`, `npm run test:e2e`; packaging Maven `-Pweb` sau
frontend build. Kết quả thực tế bên dưới; không coi image build bỏ tests là evidence test pass.


## Evidence thực thi ngày 02/11/2026

| Check | Working directory / command | Kết quả |
|---|---|---|
| Backend | Root: `./backend/mvnw.cmd -B -ntp -f backend/pom.xml -Pweb spotless:apply verify` | PASSED 39 tests, 0 failed/errors/skipped; `.tools/p002-backend-final.log`, `backend/target/surefire-reports/` |
| Frontend | frontend/: `npm run format:check`, `npm run lint`, `npm run test`, `npm run build`, `npm audit --audit-level=moderate` | PASSED 12 tests / 4 files, strict typecheck/build, audit 0 vulnerabilities |
| Browser | frontend/: `$env:E2E_BASE_URL='http://127.0.0.1:18082'; npm run test:e2e` | PASSED 8/8, 57.8s; `.tools/p002-e2e-final.log`; final funding-only 4/4, 46.9s sau packaging/config chỉnh cuối |
| Package/Compose | `docker compose --env-file .env -f infra/compose.yaml config --quiet`; `--profile app build app`; `--profile app up -d app` | PASSED; V2 additive applied trên DB local đã có P0-01, không reset volume; image Maven cache mount |
| Runtime | Root: `node infra/runtime-smoke.mjs` | PASSED restart/persisted wallet/SPA/API routing/default Secure/HttpOnly/Lax cookie |
| Reconciliation | Root: `Get-Content infra/reconcile.sql -Raw` pipe vào Compose `exec -T db psql -U nexapay_app -d nexapay` | PASSED sau E2E, findings 0. Isolated Testcontainers kiểm CLI nonzero bằng controlled findings; không mutate tiền runtime |
| Hosted CI | `.github/workflows/ci.yml` thêm reconciliation sau E2E | PASSED — [run 41391311765](https://github.com/anhkhuong04/NexaPay/actions/runs/41391311765), implementation commit `6cf14da`; toàn bộ frontend/backend/runtime/E2E/reconciliation và reports upload thành công |

- Runtime DB giữ nguyên quyền không UPDATE posted_balance. `SELECT FOR UPDATE`
  dùng function lock-only SECURITY DEFINER vì PostgreSQL yêu cầu UPDATE privilege
  để lock trực tiếp. Posting entry trigger cập nhật projection, không mở endpoint
  hay quyền SQL sửa số dư tổng quát.
- V2 được hoàn thiện và test trong disposable Testcontainers trước khi apply lần
  đầu vào DB local. Sau đó giữ checksum ổn định, không rewrite migration đã share.
- Không giữ P0 IN_PROGRESS command ở commit; deferred terminal guard liên kết
  funding/result. Audit terminal rejection dùng outcome FAILED, technical rollback
  không để lại audit/command giả. Lỗi constraint ngoài signup là technical 500.
- Review inline có heading/region và focus, thay dialog để bỏ hidden focus sentinels
  bị axe phát hiện. Không exclude/disable axe rules. Đã xem screenshot funding
  mobile và commands desktop; E2E kiểm 320px, keyboard/auth recovery và live status.
- Reports/screenshots/generated artifacts được gitignore; source tests và commands
  tái lập được commit. JAR được bundle lại sau frontend build, smoke subprocesses
  được dừng; Docker app local tiếp tục ở 18082. Không public deployment.
- Milestones: `264fc88` backend/contract/plan; `847f29b` funding/recovery UI;
  `5575c6b` race/CLI/error regression fixes. `6cf14da` hoàn thiện packaging/CI/docs và push main. Commit sau cùng chỉ cập nhật evidence/tài liệu.

## Handoff P0-03

Tiếp tục P2P exact recipient lookup, Send/Review/Result, transfer ownership,
insufficient-funds replay, transaction history/detail và mở rộng reconciliation.
Cần MM-01 overspend, A↔B lock order/MM-07 và MM-08 linkage transfer trước P0 Done.
Mở rộng command/ledger schema bằng migration mới, không sửa V1/V2 đã apply.

- Packaging regression: phát hiện static assets từ các lần Vite build cũ còn trong JAR local. Profile Maven web dọn riêng target/classes/static trước copy-resources, giữ compiled classes/test reports; kiểm tra danh sách asset trong JAR khớp dist hiện tại.

- Kiểm tra cuối: 18 documents/102 local links/case/fences, 2 OpenAPI files và refs, CI YAML, tracked secrets/cache scan đều pass. JAR chứa đúng 7 file SPA hiện tại, không còn 13 asset cũ; giữ đủ 39 JUnit reports tests. Final Docker build và health UP ở 18082 đã xác nhận.
