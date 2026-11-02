# P0-03 — Chuyển tiền P2P và lịch sử giao dịch

**Ngày:** 02/11/2026 · **Trạng thái:** LOCAL VERIFIED — hosted CI pending

Tiếp nối P0-02 verified tại `9e91bb9`. Thực hiện trên branch
`feat/p0-03-p2p-history`; commit theo mốc, push vào repository đã được user chỉ định.

Nguồn: [PRD](../Docs/NexaPay_PRD_v0.1.md) FR-T01–04, FR-H01,
FR-L01, FR-AU01, FR-RC01; [Money Spec](../Docs/NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md)
MM-01–08; [UI spec](../Docs/NexaPay_UIUX_DESIGN_SPEC_v0.1.md) UI-05–07;
[ADR-001](../Docs/adr/ADR-001-project-baseline.md).

## Ràng buộc và interfaces

- V3 additive, không sửa V1/V2 hoặc reset dữ liệu. MoneyPostingService là writer
  duy nhất của journal; runtime không được sửa balance. READ COMMITTED, claim
  trước lock accounts theo PostgreSQL UUID, cùng transaction với result/audit.
- Chung throttle money 30/phút/actor giữa funding/transfer; recipient lookup có
  bucket riêng 30/phút. Retry confirmed rollback tối đa 3 attempts/20s.
- POST `/api/v1/transfers`: destinationWalletId UUID canonical, amount string
  1..100000000 VND, currency VND, note optional. Source từ session. Note strip,
  NFC, tối đa 140 Unicode code points, không control characters; omitted/empty
  canonical giống nhau. Giới hạn này là chi tiết input mới, không đổi money rule.
- Self/unknown/locked/insufficient/balance-limit là committed FAILED 422, replay
  nguyên trạng; malformed input/key/CSRF/throttle không claim. Fingerprint gồm
  source/destination/amount/currency/normalized note, không dựa vào raw JSON.
- Recipient exact lookup chỉ trả walletId/displayName; không email, balance,
  directory. Transfer detail chỉ initiator hoặc recipient của SUCCEEDED.
- GET `/api/v1/transactions`: cursor newest (createdAt,id), limit 20/max100;
  type INCOMING/OUTGOING/FUNDING, status SUCCEEDED/FAILED, from/to ISO UTC instants
  (inclusive/exclusive). Failed incoming không được hiển thị.
- GET `/api/v1/transactions/{type}/{id}` detail owned, type TRANSFER/DEMO_FUNDING;
  GET `/api/v1/transfers/{id}` alias cho transfer detail. Không lộ command key
  hoặc source user ID cho recipient. Amount/fee là strings.
- UI `/app/send`, `/app/transactions`, `/app/transactions/{type}/{id}`;
  review inline trước POST, reference actor/epoch/type/key trong sessionStorage,
  payload chỉ memory. Không overwrite reference unresolved của operation khác.
  Reload/re-auth lookup, không tự POST; receipt/history refetch theo actor.

## Tasks

### Task 1 — Contract, PostgreSQL transfer và money API

- [x] Tạo OpenAPI/wireframe; thêm TransferIntegrationTest HTTP trước implementation.
- [x] RED: focused Maven test thất bại vì endpoint chưa có.
- [x] V3 terminal transfers + guards + reconciliation giữ đầy đủ checks funding.
  TransferTransaction/Service/Controller; shared MoneyCommandExecutor; recipient
  lookup qua application WalletService, không truy cập repository module khác.
- [x] GREEN: PostgreSQL MM-01 (20 keys → 10 success), MM-02 same key/conflict,
  MM-03 failure replay sau funding, MM-04 audit fault rollback, MM-07 opposite
  direction/lock race/timeout, schema/CSRF/actor isolation. Regression funding.
- [x] Commit `feat: add atomic idempotent P2P transfers`.

### Task 2 — Owned history/detail và reconciliation

- [x] RED: history cursor/filter/detail/privacy integration tests.
- [x] History application read models, stable cursor, strict filters; transfer
  recipient thấy SUCCEEDED; funding/FAILED chỉ actor. No command key in history.
- [x] GREEN: pagination equal timestamps/filter boundaries, ownership 404,
  immutable terminal/link guards; read-only consistent reconciliation 0 findings.
- [x] Commit `feat: add owned transaction history and details`.

### Task 3 — Fluent UI send/review/result/history

- [x] RED: exact VND parser, generic recovery/cache isolation tests; browser
  journey real funding→P2P→history and uncertain response/reload/re-auth.
- [x] Typed APIs + Fluent form/review/receipt/UNKNOWN; actor-scoped history
  filters/cursor/detail; update navigation/deep links/recovery interoperability.
- [x] GREEN: frontend lint/unit/build, desktop/mobile E2E/axe, manual visual/
  keyboard/reflow checks. Commit `feat: add P2P and transaction history UI`.

### Task 4 — Full verification, review, packaging và handoff

- [x] Backend `./backend/mvnw.cmd -B -ntp -f backend/pom.xml -Pweb verify`;
  frontend `npm run format:check`, `npm run lint`, `npm run test`, `npm run build`.
- [x] Docker Compose build/up không reset volume; E2E `npm run test:e2e` against
  18082; runtime restart recovery smoke + read-only reconciliation CLI.
- [x] Fresh whole-branch code review; resolve important findings with RED→GREEN.
- [ ] Docs actual evidence, commit/push, hosted CI; chỉ mark verified khi pass.

## Review focus

1. Terminal replay trước business revalidation, kể cả destination đổi trạng thái.
2. Opposite transfer UUID lock order, shared throttle, technical retry/commit doubt.
3. Unknown recipient/failed incoming privacy; cursor equal timestamps/filter input.
4. Recovery cross-operation/tab navigation, stale response sau logout, no auto POST.
5. Migration nâng cấp P0-02, DB terminal/journal linkage và reconciliation giữ checks.

## Execution ledger

- Pre-flight: Task 1 produces generic command envelope/TRANSFER; Tasks 2/3 consume
  the same type. History excludes key by design; recovery uses commands endpoint.
- Accepted baseline được tiếp tục theo yêu cầu user; không có quyết định scope mới
  cần approval. Evidence sẽ được ghi sau từng mốc, không suy từ kế hoạch.

- Task 1 milestone: RED API 404 → GREEN 23/23 focused tests (5 transfer, 13 funding,
  2 retry/throttle, 3 architecture), `.tools/p003/backend-api.log`. Bao gồm 20
  distinct keys → 10 success, 20 same key → 1 posting, A↔B, normalized note replay,
  immutable failure, schema/CSRF và fault sau audit rollback. Lock timeout/race
  transfer và history/reconciliation bổ sung ở mốc kế tiếp.

- Task 2 milestone: history API RED 404 → GREEN; 13/13 focused tests (8 transfer,
  retry/throttle và architecture). Cursor equal timestamps, UTC [from,to),
  recipient privacy, detail ownership, shared throttle/lookup 30/min, destination
  lock race và 3-attempt lock timeout đều pass (`.tools/p003/history.log`).

- Backend full: `./backend/mvnw.cmd -B -ntp -f backend/pom.xml -Pweb spotless:apply verify`
  PASSED 50 tests/0 failures/errors/skips, 3m28s (`.tools/p003/backend-full.log`).
  Bao gồm 11 transfer tests: consistent read-only snapshot qua concurrent commit,
  orphan posting detection trong transaction rollback, immutable transfer,
  wrong journal amount không commit; raw control note regression RED→GREEN.
- Compose image build/up PASSED, V3 nâng cấp DB P0-02 sẵn có không reset volume.
  Packaged runtime smoke PASSED: restart/re-login lookup + identical P2P replay,
  balance/history persisted, SPA deep links, Secure/HttpOnly/Lax default cookie.
- Fresh whole-change review: 0 critical, 2 important. Re-auth mất draft và response
  sau unmount không invalidate views đều đã tái hiện bằng RED (unit + real browser).
  Fix pass: module memory intent qua same-actor re-auth (không persist payload),
  central actor-guarded terminal invalidation. GREEN evidence đang chạy.
- E2E harness đầu tiên điều hướng trước khi login kết thúc làm abort login;
  đã sửa chờ URL sau login. Không thay auth để né test. Input amount error cần
  hiển thị hướng dẫn parser thay generic API message; real browser RED tái hiện.

- Final review fix pass GREEN: 17/17 frontend tests (6 files), lint/strict build;
  16/16 real desktop/mobile E2E, 1.9m (`.tools/p003/e2e-full.log`). Finding 1:
  same-actor re-auth giữ memory payload, lookup trước, manual retry original key
  đúng 1 commit; reload module chỉ giữ reference. Finding 2: terminal response
  sau navigation invalidate actor views, delayed-response regression GREEN.
  Không có deferred review findings; reviewer declined-to-judge list rỗng.
- Visual QA: desktop review và mobile review/history đã xem; 320px reflow,
  labels/keyboard focus và axe WCAG2/2.1/2.2 checks pass. Screenshot capture trả
  focus về control/main sau axe (scan thay focus), không sửa/ẩn focus trong app.
- Documents/YAML: 24 Markdown / 130 links+case/fences; 3 OpenAPI / 96 refs và
  CI YAML parse pass. JAR re-bundle frontend bằng các packaging goals sau full
  verify, không dùng packaging-only làm evidence tests. Runtime findings 0.

## Acceptance evidence (local)

| Gate | Evidence | Result |
|---|---|---|
| MM-01 / FR-T01–03 | 20 distinct 10000 commands from 100000 → 10 success, no negative, total preserved | PASSED |
| MM-02 / FR-T04 | 20 same key → one posting; normalized note replay; changed amount 409 | PASSED |
| MM-03 | Insufficient failure replays after funding; locked failure replays after unlock | PASSED |
| MM-04 | Fault after audit rolls back both legs/command; lost response lookup; packaged restart/re-login exact replay | PASSED |
| MM-05 | Existing journal/currency/nonempty/immutability/overflow guards; V3 transfer immutability/wrong amount commit denial | PASSED |
| MM-06 | Funding 13-test regression, concurrency quotas/UTC rollover included in full suite | PASSED |
| MM-07 | A↔B concurrency, recipient lock race and actual 3-attempt lock timeout rollback; bounded retry unit regression | PASSED |
| MM-08 / FR-RC01 | Read-only repeatable-read snapshot across concurrent commit; orphan probe rollback; CLI findings 0 and nonzero on fixture | PASSED |
| FR-H01 / NFR-01/10 | Equal-timestamp cursor/filter UTC range; initiator/recipient ownership, unrelated 404, failed incoming excluded; minimal exact lookup | PASSED |
| UI-05–07 | Real funding→P2P→receipt/detail/history two actors; no pre-review POST; keyboard confirm, axe and 320px | PASSED |
| Recovery/UI cache | Re-auth original-key manual retry; reload memory loss/reference only; delayed response after navigation; logout/switch isolation | PASSED |

### Commands / reports

- Backend full verify: **50/50** tests, zero failed/errors/skipped, 3m28s;
  `backend/target/surefire-reports/`, `.tools/p003/backend-full.log`.
- Frontend `npm run lint`, `npm run test`, `npm run build`, `npm run format:check`:
  **17/17** unit tests, 6 files; lint/typecheck/format pass; audit **0 vulnerabilities**.
- Real Compose `E2E_BASE_URL=http://127.0.0.1:18082 npm run test:e2e`:
  **16/16**, 1.9m; final keyboard/visual-focused rerun **2/2**, 19.5s.
  Reports `frontend/playwright-report/`, screenshots `frontend/test-results/` ignored.
- Compose final image healthy; V1/V2 checksums unchanged, V3 additive upgrades
  existing local database. No volume reset or balance seed/repair.
- `node infra/runtime-smoke.mjs`: PASS restart/lookup/replay/history/deep links
  and default cookie; `infra/reconcile.sql`: PASS findings **0** after E2E.
- Packaging-only Maven goals refresh JAR SPA after frontend fix; full tests evidence
  remains the verify run, not packaging-only execution. Hosted pipeline runs -Pweb
  verify itself. Source commits `f412774`, `fcff18d`, `f73d6ae`, `e7c5227`.

### Limits / handoff

Simulated VND only, one instance/session memory, no public deployment or real bank.
A full reload loses draft payload; 404 lookup remains UNKNOWN. Lost reference for
an uncommitted command cannot be recovered from server history. These are baseline
limits, not FAILED financial results. P1a/P1b/P1c remain outside this slice.
No performance/throughput or accessibility certification claim; measured scenarios
and automated axe/keyboard/reflow checks above do not substitute for every device.
