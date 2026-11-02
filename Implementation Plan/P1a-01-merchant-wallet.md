# P1a-01 — Merchant onboarding & wallet

**Ngày:** 02/11/2026

**Trạng thái:** LOCAL VERIFIED — 60 backend / 34 frontend unit / 28 E2E; hosted CI pending; base `e940697`, branch `feat/p1a-01-merchant-wallet`.

## Goal và baseline

Deliver FR-M01, FR-A04, BR-02/04/05/20, ADR D05/06/10; merchant ACTIVE mô phỏng,
OWNER membership, ví riêng 0 VND atomic; UI workspace switching/profile. P0 DoD
đã VERIFIED; P1a chỉ Done sau payment/checkout/refund và MM-09 ở slice tiếp theo.
Không KYC/staff/multi-merchant, payment/refund/Console/API khóa ví hoặc seed tiền.

## Contracts và quyết định triển khai

- V4 additive: merchants(display_name 1..80 Unicode code points, ACTIVE), memberships
  OWNER unique merchant/user, wallets exactly one of user_id/merchant_id, ledger
  MERCHANT nonnegative/max 1000000000000 như PERSONAL. Giữ IDs/FKs V1–V3.
  Deferred guards bắt graph merchant+membership+wallet/account hợp lệ khi commit.
- `POST /api/v1/merchants` body `{displayName}` → 201 profile; actor từ session.
  Một merchant/user: serialize onboarding theo actor trong DB + unique constraint;
  duplicate/concurrent loser 409 MERCHANT_EXISTS, không tạo partial graph.
  Timeout/lost response: UI GET /merchants/me kiểm tra, không tự POST lại.
- `GET /merchants/me` → owned profile hoặc 404 MERCHANT_NOT_FOUND (chưa onboard);
  `GET/PATCH /merchants/{id}` và `GET /merchants/{id}/wallet` → owned only, unrelated
  404. PATCH chỉ displayName, trim/NFC/no control/1..80 points. 401/CSRF/strict JSON
  giữ nguyên. Không nhập ownerId/role/status/balance từ client.
- Membership là authority. Session summary lấy merchantId + effective MERCHANT role
  từ membership hiện tại, không cần logout/login hoặc sửa global grants; merchant
  APIs kiểm membership thật mỗi request, không tin role cache trong principal.
- WalletService public API provision/query merchant, recipient lookup lọc personal;
  funding/P2P/history `/wallets/me` vẫn personal-only. Ledger customer limit dùng
  chung cho PERSONAL/MERCHANT cả Java/DB; signed system accounts giữ nguyên.
- UI `/business/onboarding`, `/business/overview`, `/business/settings`; switcher
  personal/business, query keys actor+merchant+workspace. Chỉ render balance thật và
  metadata/profile, không fake payment KPI hoặc nút cho tính năng chưa triển khai.
  Workspace chưa onboard có CTA tạo merchant; refresh/session loss/error honest.
- UI prototype states trước nối API: onboarding name+demo disclosure, pending/error
  và check-existing action; business overview wallet pending/error/LOCKED+metadata;
  settings editable name/read-only ownership/currency. Fluent 2/tokens hiện tại,
  keyboard/focus, desktop/mobile/320px, axe và visual QA.

## Tasks và gate

- [x] 1. PostgreSQL integration RED: create/query/update/auth/ownership, concurrent
  onboarding, fault audit rollback, DB guards, P0 personal isolation. Implement V4
  và public module APIs, focused GREEN. Commit migration/API milestone.
- [x] 2. Fluent typed API/routes/workspace navigation; focused behavioral unit tests,
  no actor/merchant cache mixing; connected onboarding→business→rename→personal,
  reload/re-auth, duplicate/lost response recovery. Commit UI milestone.
- [x] 3. Full backend PostgreSQL `./backend/mvnw.cmd -B -ntp -f backend/pom.xml -Pweb verify`;
  frontend format/lint/test/build/audit. Compose config/build/up giữ volume; full
  desktop/mobile E2E/axe/reflow, packaged runtime smoke, reconciliation 0 findings.
- [ ] 4. Review actual diff, migration upgrade từ V3 có dữ liệu; cập nhật OpenAPI,
  UI states/README/index và evidence; commit/push main, hosted CI success trước VERIFIED.

## Verification risks

- Account typing/limits và personal-only P2P không bị nới khi thêm MERCHANT.
- Unique owner và deferred graph guard + audit failure rollback, runtime grants
  chỉ profile columns; migration owner riêng, không direct posted_balance grant.
- Session summary mới từ membership; missing membership không được đọc business.
- Frontend không tự retry POST khi unknown; stale response/account switch không
  cập nhật actor khác; recent/history/recovery P0 không bị thay nghĩa.

## Execution evidence

- Preflight: V1 wallets.user_id NOT NULL, PERSONAL-only account CHECK; recipient
  lookup hiện map profiles từ wallet.user. Cần sửa rõ exclusive ownership và lookup.
  History đã dùng personal reference. Không có merchant code/migration trước slice.
- Commands/outcomes sẽ cập nhật từ output thật; chưa claim acceptance pass.

- Backend milestone: initial behavior suite RED (missing merchant routes 404;
  spy setup MANDATORY error corrected by targeting unwrapped audit spy). GREEN
  focused **13/13** (10 merchant + 3 architecture). Full `-Pweb spotless:apply verify`
  **60/60**, 0 failures/errors/skips, 1m21s (`.tools/p1a01/backend-full.log`).
  Raw app-insert wrong account kind test avoids an existing personal unique owner,
  so its deferred kind guard is exercised directly. V3→V4 upgrade fixture verifies
  old wallet/audit and checksums; runtime upgrade snapshot also unchanged before E2E.
- Frontend milestone in progress: **33/33**, 10 files; lint/strict build/format pass.
  Includes unknown onboarding GET recovery, no auto POST, late actor result, name
  normalization/validation and separate wallet keys. Connected evidence pending.
- Compose config/build/up PASS, existing volume retained. Before/after snapshot of
  every existing account/balance/status/wallet owner and journal/audit counts is
  byte-identical (`.tools/p1a01/upgrade-result.log`); no seed/repair/reset.

- Review trước release: self-review module boundaries/ownership/guards/recovery,
  React hooks/API/cache/a11y checklist theo skills; không gọi đây là independent
  reviewer sign-off. Bổ sung 401 handling ở explicit GET recovery; **34/34** unit
  pass. UI strings tránh diễn giải implementation; mobile card spacing/44px reload
  được chỉnh sau visual QA. Full runtime/visual bản cuối vẫn là gate bắt buộc.
- Packaged smoke phát hiện local stale SpaController.class thiếu business routes
  trong khi Docker fresh build trả 200. Source thay đổi lúc javac đang chạy khiến
  class output mới timestamp nhưng nội dung cũ, Maven incremental bỏ qua. Chạy lại
  `clean verify` sau frontend build thay vì chấp nhận artifact cũ; lỗi này không
  được tính là gate PASS. `.tools/p1a01/runtime-stale-artifact.log`.

- UI/connected milestone: full P0+merchant **28/28** E2E pass, 3.2m. Sau mobile
  layout polish, merchant rerun bản image cuối **6/6**, 1.1m, không skip/retry.
  Keyboard Enter submit, axe WCAG2/2.1/2.2 tags, 320px, CSS zoom 200% desktop và
  visual desktop/mobile overview/settings/LOCKED fixture đã xem; name/UUID wrap.
  `.tools/p1a01/e2e-full.log`, `e2e-visual-final.log`; screenshots/reports ignored.
- Clean artifact gate: `-Pweb clean verify` **60/60**, 0 failed/errors/skips,
  BUILD SUCCESS, 2m19s (`.tools/p1a01/backend-full.log`). Compiled SpaController có
  business deep links; 7 frontend dist files byte-identical trong JAR. Packaged
  restart smoke hiện đang chạy; chỉ mark release sau output PASS và hosted CI.


## Acceptance evidence — local

| Gate | Evidence | Result |
|---|---|---|
| FR-M01 / BR-02 | Onboarding ACTIVE + one OWNER + separate zero wallet, personal ID/balance unchanged; audit atomically stored, no opening journal | PASSED |
| Concurrency / rollback | 8 concurrent onboarding requests → one 201 / seven 409; one account/membership, no orphans; audit failure rolls back create and rename | PASSED |
| FR-A04 / BR-20 | Unrelated read/update/wallet 404; 401/CSRF/strict JSON; owner/role/status/balance overposting rejected; no ADMIN grant | PASSED |
| BR-04/05 / MM regression | MERCHANT Java+DB customer limits, app role balance/status edits denied; wrong wallet kind/incomplete graph fail deferred commit; full P0 MM-01–08 suites retained | PASSED |
| Personal boundary | Merchant recipient lookup absent; P2P into merchant returns FAILED/RECIPIENT_NOT_FOUND, no debit; funding only credits personal | PASSED |
| Migration | V3 fixture→V4 preserves IDs/audit/checksums; existing local accounts/balances/wallet ownership/journal+audit counts identical across upgrade | PASSED |
| Session/workspace | Current membership appears in summary without re-login; APIs authorize membership each request; business/personal cache keys separate, late result actor guard | PASSED |
| Business UI | Create/rename/reload/personal↔business, keyboard Enter, loss-after-commit GET recovery/no double POST, 401 re-auth, actor switch privacy; pending/error/LOCKED fixture | PASSED |
| Accessibility / visuals | Desktop 1440/mobile 390, 320px reflow, CSS zoom 200% smoke, axe WCAG2/2.1/2.2 tags; final screenshots viewed; controls/UUID/name wrap | PASSED |
| Packaged runtime / reconciliation | Clean JAR business deep links, restart invalidation, persisted merchant/wallet/roles + existing P2P replay/history; read-only reconciliation 0 findings | PASSED |

### Commands / reports

- `./backend/mvnw.cmd -B -ntp -f backend/pom.xml -Pweb clean verify`:
  **60/60**, 0 failures/errors/skips, 2m19s; Spotless PASS;
  `backend/target/surefire-reports/`, `.tools/p1a01/backend-full.log`.
- Frontend `npm run test`: **34/34**, 10 files. Format/lint/strict build PASS;
  npm audit **0 vulnerabilities**. `.tools/p1a01/unit.log`, `format.log`, `lint.log`,
  `build.log`, `audit.log`.
- Connected full `E2E_BASE_URL=http://127.0.0.1:18082 npm run test:e2e`:
  **28/28**, 3.2m. Final business layout rerun **6/6**, 1.1m;
  `.tools/p1a01/e2e-full.log`, `e2e-visual-final.log`; reports/screenshots ignored.
- Compose config/build/up PASS; V1–V3 source unchanged, no reset/repair/seed.
  `.tools/p1a01/upgrade-result.log`, `docker-visual-final.log`.
- `node infra/runtime-smoke.mjs`: **PASS** after clean verify;
  `.tools/p1a01/runtime-final.log`. Local stale artifact failure described above
  is resolved and does not substitute for this passing run.
- `infra/reconcile.sql`: **0 findings**, exit 0 after E2E and runtime smoke;
  `.tools/p1a01/reconcile-final.log`. All prior snapshot/quota/command checks retained,
  plus merchant graph/account type. Fault fixture nonzero covered by backend suite.
- YAML: 4 OpenAPI files / 119 refs resolve, CI parses; 5 changed Markdown files /
  53 local links+case/fences pass. JAR matches all 7 frontend dist files, compiled
  controller contains business deep links. Self-review found no remaining important
  issue; this is not independent reviewer approval.
- Milestones: `7cead35` migration/API/DB tests/contracts, `d181d8b` business UI and
  connected recovery. Hosted CI pending before final VERIFIED status.

### Limits / next slice

Simulated VND only, one backend instance, session memory and local Compose; no
public deployment/performance claim. LOCKED browser case is a controlled GET
fixture, real DB lock/guards verified separately. CSS zoom/axe are measured smoke
checks, not certification or every browser/device. No payment/refund operations
in this slice, so **P1a overall and MM-09 remain pending**.

Next: **P1a-02 — Payment Request & Checkout**. Plan request/attempt/payment schemas
and immutable amounts/expiry, one capture, self-payment exclusion, cancel/expire/pay
serialization, owned business queries + payer review/recovery and reconciliation.
Use MERCHANT account capability/OWNER membership introduced here; no arbitrary
P2P/funding into merchant. P1a-03 follows for full/partial refund and MM-09.
